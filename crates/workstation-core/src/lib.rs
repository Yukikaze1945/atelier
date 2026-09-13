pub mod asset_metadata;
pub mod commands;
pub mod media;
pub mod model;
pub mod store;
pub mod subtitles;
pub mod timeline_actions;
pub mod timeline_edit;
pub mod video_settings;

use commands::text;
use model::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use store::{decode, encode, sql, Result, Store};

pub struct Engine {
    pub store: Store,
    pub media: media::MediaManager,
}
impl Engine {
    pub fn new(root: &Path) -> Result<Self> {
        let store = Store::new(root)?;
        let media = media::MediaManager::new(&store)?;
        Ok(Self { store, media })
    }
    pub fn call(&self, method: &str, params: Value) -> Result<Value> {
        match method {
            "media.capabilities" => Ok(self.media.capabilities()),
            "media.inspect" => self.media.inspect(text(&params, "uri")?),
            "media.jobs" => Ok(json!(self.media.jobs(params["projectId"].as_str())?)),
            "media.cancel" => Ok(json!(self.media.cancel(text(&params, "jobId")?)?)),
            "media.export" => {
                let project = self.store.get(text(&params, "projectId")?)?;
                if params["expectedRevision"].as_u64() != Some(project.project.revision) {
                    return Err("REVISION_CONFLICT：请刷新工程后导出".into());
                }
                Ok(json!(self.media.export(
                    &project,
                    Path::new(text(&params, "outputPath")?),
                    params["profile"].as_str().unwrap_or("mp4-h264")
                )?))
            }
            "system.videoPresets" => Ok(video_settings::presets()),
            "system.info" => Ok(
                json!({"version":"0.1.0-dev.1","protocolVersion":1,"projectFormatVersion":0,"stateDirectory":self.store.root,"semanticSearch":{"available":false,"candidate":"WeMM-Embedding-2B"},"mediaBackend":self.media.capabilities()}),
            ),
            "project.list" => {
                let mut stmt = sql(self
                    .store
                    .catalog
                    .prepare("SELECT id,directory FROM projects"))?;
                let rows =
                    sql(stmt
                        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))))?;
                let mut projects = vec![];
                for row in rows {
                    let (id, directory) = sql(row)?;
                    match self.store.get(&id) {
                        Ok(view)=>projects.push(json!({"id":id,"name":view.project.name,"directory":directory,"modifiedAt":view.project.modified_at,"createdAt":view.project.created_at,"assetCount":view.project.assets.iter().filter(|a|!a.archived).count(),"pageCount":view.project.workspace.pages.len(),"frameRate":view.project.timeline.as_ref().map(|t|&t.frame_rate),"offline":false})),
                        Err(error)=>projects.push(json!({"id":id,"name":Path::new(&directory).file_name().unwrap_or_default().to_string_lossy(),"directory":directory,"offline":true,"error":error,"modifiedAt":0,"assetCount":0,"pageCount":0})),
                    }
                }
                projects.sort_by_key(|v| std::cmp::Reverse(v["modifiedAt"].as_u64().unwrap_or(0)));
                Ok(json!(projects))
            }
            "project.create" => {
                let name = text(&params, "name")?;
                validate_directory_name(name)?;
                let parent = PathBuf::from(text(&params, "parentDirectory")?);
                if !parent.is_dir() {
                    return Err("项目保存位置不存在，请先选择有效文件夹".into());
                }
                let mut workspace = if let Some(w) = params.get("workspace") {
                    serde_json::from_value(w.clone()).map_err(|e| e.to_string())?
                } else if let Some(template_id) = params["templateId"]
                    .as_str()
                    .filter(|s| *s != "builtin.standard")
                {
                    let body: String = sql(self.store.catalog.query_row(
                        "SELECT body FROM templates WHERE id=?",
                        [template_id],
                        |r| r.get(0),
                    ))?;
                    decode::<WorkflowTemplate>(&body)?.workspace
                } else {
                    default_workspace()
                };
                // A template is a copy, not a shared live workspace. Remap node references together.
                fresh_node_ids(&mut workspace);
                let mut project = Project {
                    format_version: 0,
                    id: id(),
                    name: name.into(),
                    revision: 0,
                    created_at: now(),
                    modified_at: now(),
                    workspace,
                    assets: vec![],
                    timeline: if params["projectTemplate"] == "blank" {
                        None
                    } else {
                        Some(empty_timeline())
                    },
                    archive: vec![],
                    template_ref: params["templateId"].as_str().map(String::from),
                };
                if let (Some(timeline), Some(settings)) =
                    (&mut project.timeline, params.get("timelineSettings"))
                {
                    video_settings::configure(timeline, settings)?;
                }
                Ok(json!(self.store.create(&project, &parent.join(name))?))
            }
            "project.open" => Ok(json!(self
                .store
                .open_directory(Path::new(text(&params, "directory")?))?)),
            "project.get" => Ok(json!(self.store.get(text(&params, "projectId")?)?)),
            "project.command" => {
                let plugins = self.store.plugins()?;
                let expected = params["expectedRevision"]
                    .as_u64()
                    .ok_or("缺少 expectedRevision")?;
                let command = &params["command"];
                // Discover an old or externally imported timed asset before inserting it.
                // Do not hold the SQLite write transaction during media discovery.
                let mut inspected = None;
                if (command["type"] == "timeline.add" && command.get("durationTicks").is_none())
                    || command["type"] == "timeline.restoreSource"
                {
                    let view = self.store.get(text(&params, "projectId")?)?;
                    if view.project.revision != expected {
                        return Err("REVISION_CONFLICT：工程已改变，请刷新后重试".into());
                    }
                    let asset_id = if command["type"] == "timeline.add" {
                        command["assetId"].as_str()
                    } else {
                        view.project
                            .timeline
                            .as_ref()
                            .and_then(|t| t.clips.iter().find(|c| c.id == command["clipId"]))
                            .map(|c| c.asset_id.as_str())
                    };
                    if let Some(asset) = view
                        .project
                        .assets
                        .iter()
                        .find(|a| Some(a.id.as_str()) == asset_id)
                    {
                        if asset_metadata::timed(&asset.media_type)
                            && (asset_metadata::duration(&asset.metadata).is_none()
                                || (asset.media_type == "video"
                                    && !asset.metadata["streams"].is_array()))
                        {
                            let data = asset_metadata::inspect(
                                &self.media,
                                &asset_metadata::uri(&view, asset)?,
                                &asset.metadata,
                            )
                            .map_err(|e| {
                                format!("无法读取素材真实时长，未添加五秒占位片段：{e}")
                            })?;
                            inspected = Some((asset.id.clone(), data));
                        }
                    }
                }
                Ok(json!(self.store.mutate(
                    text(&params, "projectId")?,
                    expected,
                    command["type"].as_str().unwrap_or("edit"),
                    |p| {
                        if let Some((asset_id, data)) = inspected {
                            let asset = p
                                .assets
                                .iter_mut()
                                .find(|a| a.id == asset_id)
                                .ok_or("素材不存在")?;
                            asset.metadata = data;
                            asset.revision += 1;
                        }
                        commands::apply(p, command, &plugins)
                    }
                )?))
            }
            "project.undo" | "project.redo" => Ok(json!(self.store.history(
                text(&params, "projectId")?,
                params["expectedRevision"]
                    .as_u64()
                    .ok_or("缺少 expectedRevision")?,
                method == "project.redo"
            )?)),
            "workspace.replacementReport" => {
                let project = self.store.get(text(&params, "projectId")?)?;
                commands::replacement_report(
                    &project.project,
                    &self.store.plugins()?,
                    text(&params, "nodeId")?,
                    text(&params, "pluginId")?,
                    text(&params, "pageId")?,
                )
            }
            "information.resolve" => {
                let project = self.store.get(text(&params, "projectId")?)?;
                commands::resolve_information(
                    &project.project,
                    &self.store.plugins()?,
                    text(&params, "nodeId")?,
                )
            }
            "asset.inspect" => {
                let view = self.store.get(text(&params, "projectId")?)?;
                let expected = params["expectedRevision"]
                    .as_u64()
                    .ok_or("缺少 expectedRevision")?;
                if view.project.revision != expected {
                    return Err("REVISION_CONFLICT：工程已改变，请刷新后重试".into());
                }
                let asset = view
                    .project
                    .assets
                    .iter()
                    .find(|a| a.id == params["assetId"])
                    .ok_or("素材不存在")?;
                let data = asset_metadata::inspect(
                    &self.media,
                    &asset_metadata::uri(&view, asset)?,
                    &asset.metadata,
                )?;
                let asset_id = asset.id.clone();
                Ok(json!(self.store.mutate(
                    &view.project.id,
                    expected,
                    "读取源媒体信息",
                    move |project| {
                        let asset = project
                            .assets
                            .iter_mut()
                            .find(|a| a.id == asset_id)
                            .ok_or("素材不存在")?;
                        asset.metadata = data;
                        asset.revision += 1;
                        Ok(())
                    }
                )?))
            }
            "asset.import" => self.import(&params),
            "asset.search" => {
                if params["mode"] == "semantic" {
                    return Err("CAPABILITY_UNAVAILABLE：尚未安装 Embedding 搜索实现，当前仅支持名称和元数据搜索".into());
                }
                let project = self.store.get(text(&params, "projectId")?)?;
                let query = params["query"].as_str().unwrap_or("").to_lowercase();
                let include_archived = params["includeArchived"].as_bool().unwrap_or(false);
                let assets = project
                    .project
                    .assets
                    .iter()
                    .filter(|a| {
                        (!a.archived || include_archived)
                            && (a.name.to_lowercase().contains(&query)
                                || a.metadata.to_string().to_lowercase().contains(&query))
                    })
                    .collect::<Vec<_>>();
                Ok(
                    json!({"mode":"text","results":assets,"projectRevision":project.project.revision}),
                )
            }
            "template.list" => {
                let mut stmt = sql(self
                    .store
                    .catalog
                    .prepare("SELECT body FROM templates ORDER BY rowid DESC"))?;
                let values = sql(stmt.query_map([], |r| r.get::<_, String>(0)))?
                    .map(|r| decode::<Value>(&sql(r)?))
                    .collect::<Result<Vec<_>>>()?;
                Ok(json!(values))
            }
            "template.save" => {
                let name = text(&params, "name")?.trim();
                if name.is_empty() {
                    return Err("模板名称不能为空".into());
                }
                let workspace = self
                    .store
                    .get(text(&params, "projectId")?)?
                    .project
                    .workspace;
                let mut workspace = workspace.clone();
                for node in &mut workspace.pages {
                    node.private_state = json!({});
                }
                let template = WorkflowTemplate {
                    id: id(),
                    name: name.into(),
                    version: 1,
                    created_at: now(),
                    workspace,
                };
                sql(self.store.catalog.execute(
                    "INSERT INTO templates(id,body) VALUES(?1,?2)",
                    rusqlite::params![template.id, encode(&template)?],
                ))?;
                Ok(json!(template))
            }
            "plugin.list" => Ok(json!(self.store.plugins()?)),
            "plugin.inspect" | "plugin.install" => {
                let directory = Path::new(text(&params, "directory")?)
                    .canonicalize()
                    .map_err(|e| e.to_string())?;
                let manifest: Manifest = decode(
                    &std::fs::read_to_string(directory.join("plugin.json"))
                        .map_err(|e| format!("无法读取 plugin.json：{e}"))?,
                )?;
                validate_manifest(&manifest, &directory)?;
                if manifest.id == builtin_manifest().id {
                    return Err("插件包 ID 与预装基础套件冲突".into());
                }
                let plugin = Plugin {
                    manifest,
                    directory: Some(directory.to_string_lossy().into()),
                    enabled: true,
                    builtin: false,
                    installed_at: now(),
                };
                if method == "plugin.install" {
                    self.store.save_plugin(&plugin)?;
                }
                Ok(json!(plugin))
            }
            "plugin.enable" => {
                let mut plugin = self
                    .store
                    .plugins()?
                    .into_iter()
                    .find(|p| p.manifest.id == params["pluginId"])
                    .ok_or("插件不存在")?;
                plugin.enabled = params["enabled"].as_bool().ok_or("缺少 enabled")?;
                self.store.save_plugin(&plugin)?;
                Ok(json!(plugin))
            }
            "plugin.uninstall" => {
                let plugin = self
                    .store
                    .plugins()?
                    .into_iter()
                    .find(|p| p.manifest.id == params["pluginId"])
                    .ok_or("插件不存在")?;
                if plugin.builtin {
                    return Err("预装插件可禁用；项目可以自由移除其页面".into());
                }
                sql(self
                    .store
                    .catalog
                    .execute("DELETE FROM plugins WHERE id=?", [plugin.manifest.id]))?;
                Ok(json!({"removed":true,"filesPreserved":true}))
            }
            "media.plan" => {
                let project = self.store.get(text(&params, "projectId")?)?;
                self.media.plan(&project)
            }
            _ => Err(format!("METHOD_NOT_FOUND：{method}")),
        }
    }
    fn import(&self, params: &Value) -> Result<Value> {
        let project_id = text(params, "projectId")?;
        let expected = params["expectedRevision"]
            .as_u64()
            .ok_or("缺少 expectedRevision")?;
        let directory = self.store.project_directory(project_id)?;
        let files = params["files"].as_array().ok_or("缺少导入文件")?;
        let mode = params["mode"].as_str().unwrap_or("link");
        if !["link", "copy"].contains(&mode) {
            return Err("未知导入方式".into());
        }
        // Validate every source before making a copy or changing the project.
        let mut candidates = vec![];
        for file in files {
            let path = PathBuf::from(text(file, "path")?)
                .canonicalize()
                .map_err(|e| format!("素材不可用：{e}"))?;
            let metadata = path.metadata().map_err(|e| e.to_string())?;
            if !metadata.is_file() {
                return Err("请选择文件；文件夹递归导入尚未实现".into());
            }
            let uri = url::Url::from_file_path(&path)
                .map_err(|_| "文件 URI 无效")?
                .to_string();
            let mut analysis = file
                .get("metadata")
                .filter(|m| m.is_object())
                .cloned()
                .unwrap_or(json!({}));
            if asset_metadata::timed(asset_metadata::kind(&path))
                && (asset_metadata::duration(&analysis).is_none()
                    || (asset_metadata::kind(&path) == "video" && !analysis["streams"].is_array()))
            {
                match asset_metadata::inspect(&self.media, &uri, &analysis) {
                    Ok(result) => analysis = result,
                    Err(error) => {
                        analysis["probeStatus"] = json!("failed");
                        analysis["probeError"] = json!(error);
                    }
                }
            }
            candidates.push((path, metadata.len(), uri, analysis));
        }
        let view = self
            .store
            .mutate(project_id, expected, "导入素材", |project| {
                for (path, size, uri, analysis) in &candidates {
                    if project
                        .assets
                        .iter()
                        .any(|a| a.source_uri == *uri && !a.archived)
                    {
                        continue;
                    }
                    let asset_id = id();
                    let name = path.file_name().unwrap().to_string_lossy().to_string();
                    let relative = if mode == "copy" {
                        let relative = format!("media/{asset_id}/{name}");
                        let output = directory.join(&relative);
                        std::fs::create_dir_all(output.parent().unwrap())
                            .map_err(|e| e.to_string())?;
                        std::fs::copy(path, &output).map_err(|e| format!("复制素材失败：{e}"))?;
                        Some(relative)
                    } else {
                        None
                    };
                    let media_type = asset_metadata::kind(path);
                    project.assets.push(Asset {
                        id: asset_id,
                        revision: 0,
                        name,
                        media_type: media_type.into(),
                        source_uri: uri.clone(),
                        project_path: relative,
                        size: *size,
                        imported_at: now(),
                        archived: false,
                        metadata: analysis.clone(),
                    });
                }
                Ok(())
            })?;
        Ok(json!(view))
    }
}

fn fresh_node_ids(workspace: &mut Workspace) {
    let mapping = workspace
        .pages
        .iter()
        .map(|n| (n.id.clone(), id()))
        .collect::<std::collections::HashMap<_, _>>();
    for node in &mut workspace.pages {
        node.id = mapping[&node.id].clone();
        node.private_state = json!({});
    }
    for link in &mut workspace.links {
        link.id = id();
        if let Some(id) = mapping.get(&link.source) {
            link.source = id.clone()
        }
        if let Some(id) = mapping.get(&link.target) {
            link.target = id.clone()
        }
    }
}
pub fn validate_directory_name(name: &str) -> Result<()> {
    let stem = name.split('.').next().unwrap_or("").to_uppercase();
    if name.trim().is_empty()
        || name.len() > 180
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "/\\<>:\"|?*".contains(c))
        || [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ]
        .contains(&stem.as_str())
    {
        return Err("项目名称不可为空或包含无效文件夹字符".into());
    }
    Ok(())
}
fn validate_manifest(manifest: &Manifest, directory: &Path) -> Result<()> {
    if manifest.sdk_version != 1
        || manifest.id.is_empty()
        || !manifest
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
    {
        return Err("插件 ID 或 SDK 版本无效".into());
    }
    let mut pages = std::collections::HashSet::new();
    for def in &manifest.pages {
        if !pages.insert(&def.id) {
            return Err("插件页面 ID 重复".into());
        }
        if !def.renderer.starts_with("builtin:") {
            let entry = directory
                .join(&def.renderer)
                .canonicalize()
                .map_err(|_| "插件页面入口不存在")?;
            if !entry.starts_with(directory) || !entry.is_file() {
                return Err("页面入口不在插件目录内".into());
            }
        }
        let mut ports = std::collections::HashSet::new();
        for port in &def.ports {
            if !ports.insert(&port.id) || !["input", "output"].contains(&port.direction.as_str()) {
                return Err("信息端口定义无效".into());
            }
        }
        let mut fields = std::collections::HashSet::new();
        for field in &def.options {
            if !fields.insert(text(field, "id")?.to_string())
                || !["boolean", "select", "text", "number"].contains(&text(field, "type")?)
            {
                return Err("节点选项定义无效".into());
            }
        }
    }
    Ok(())
}

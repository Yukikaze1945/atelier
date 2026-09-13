use crate::model::*;
use crate::store::{decode, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("缺少字段 {key}"))
}
pub fn number(v: &Value, key: &str) -> Result<i64> {
    v.get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("缺少整数 {key}"))
}

pub fn definition<'a>(
    plugins: &'a [Plugin],
    plugin_id: &str,
    page_id: &str,
) -> Result<(&'a Manifest, &'a PageDefinition)> {
    let plugin = plugins
        .iter()
        .find(|p| p.manifest.id == plugin_id && p.enabled)
        .ok_or("插件未安装或已禁用")?;
    let definition = plugin
        .manifest
        .pages
        .iter()
        .find(|d| d.id == page_id)
        .ok_or("插件未提供该页面")?;
    Ok((&plugin.manifest, definition))
}

pub fn link_compatible(workspace: &Workspace, link: &InformationLink) -> bool {
    let source = workspace
        .pages
        .iter()
        .find(|n| n.id == link.source)
        .and_then(|n| {
            n.definition
                .ports
                .iter()
                .find(|p| p.id == link.source_port && p.direction == "output")
        });
    let target = workspace
        .pages
        .iter()
        .find(|n| n.id == link.target)
        .and_then(|n| {
            n.definition
                .ports
                .iter()
                .find(|p| p.id == link.target_port && p.direction == "input")
        });
    matches!((source,target), (Some(a),Some(b)) if a.data_type==b.data_type && a.data_type==link.data_type)
}

pub fn resolve_information(project: &Project, plugins: &[Plugin], node_id: &str) -> Result<Value> {
    let target = project
        .workspace
        .pages
        .iter()
        .find(|n| n.id == node_id)
        .ok_or("页面不存在")?;
    let bindings = target.definition.ports.iter().filter(|p| p.direction == "input").map(|port| {
        let Some(link) = project.workspace.links.iter().find(|l| l.target == node_id && l.target_port == port.id && link_compatible(&project.workspace, l)) else {
            return json!({"inputPort":port.id,"dataType":port.data_type,"status":"unconnected","value":null});
        };
        let source = project.workspace.pages.iter().find(|n| n.id == link.source).unwrap();
        if !plugins.iter().any(|p| p.enabled && p.manifest.id == source.plugin_id && p.manifest.version == source.plugin_version) {
            return json!({"inputPort":port.id,"dataType":port.data_type,"linkId":link.id,"status":"source-unavailable","value":null});
        }
        // Reading a binding never calls a plugin. Custom values must have been explicitly published.
        let published = source.private_state.get("outputs").and_then(|v| v.get(&link.source_port));
        let value = published.cloned().unwrap_or_else(|| match port.data_type.as_str() {
            "workstation.assets@1" => json!({"projectId":project.id,"assets":project.assets.iter().filter(|a|!a.archived).map(|a|json!({"id":a.id,"revision":a.revision})).collect::<Vec<_>>()}),
            "workstation.timeline@1" => project.timeline.as_ref().map(|t|json!({"projectId":project.id,"timelineId":t.id,"projectRevision":project.revision})).unwrap_or(Value::Null),
            _ => Value::Null,
        });
        json!({"inputPort":port.id,"dataType":port.data_type,"linkId":link.id,"sourceNode":source.id,"sourcePort":link.source_port,"status":if value.is_null(){"no-value"}else{"available"},"value":value})
    }).collect::<Vec<_>>();
    Ok(json!({"nodeId":node_id,"projectRevision":project.revision,"bindings":bindings}))
}

fn option_valid(field: &Value, value: &Value) -> bool {
    match field["type"].as_str() {
        Some("boolean") => value.is_boolean(),
        Some("number") => value.as_f64().is_some_and(|n| {
            n.is_finite()
                && field["min"].as_f64().is_none_or(|min| n >= min)
                && field["max"].as_f64().is_none_or(|max| n <= max)
        }),
        Some("select") => field["choices"]
            .as_array()
            .is_some_and(|a| a.iter().any(|c| c["value"] == *value)),
        Some("text") => value.is_string(),
        _ => false,
    }
}

pub fn replacement_report(
    project: &Project,
    plugins: &[Plugin],
    node_id: &str,
    plugin_id: &str,
    page_id: &str,
) -> Result<Value> {
    let old = project
        .workspace
        .pages
        .iter()
        .find(|n| n.id == node_id)
        .ok_or("页面不存在")?;
    let (plugin, def) = definition(plugins, plugin_id, page_id)?;
    let mut workspace = project.workspace.clone();
    let new = workspace
        .pages
        .iter_mut()
        .find(|n| n.id == node_id)
        .unwrap();
    new.definition = def.clone();
    new.plugin_id = plugin.id.clone();
    let connections = workspace.links.iter().filter(|l|l.source==node_id||l.target==node_id).map(|l|json!({"id":l.id,"compatible":link_compatible(&workspace,l),"dataType":l.data_type})).collect::<Vec<_>>();
    // Field names from unrelated plugins are not sufficient evidence of semantic compatibility.
    let reusable = if old.plugin_id == plugin.id && old.definition.id == def.id {
        def.options
            .iter()
            .filter_map(|f| {
                let key = f["id"].as_str()?;
                old.config
                    .get(key)
                    .filter(|v| option_valid(f, v))
                    .map(|_| key.to_string())
            })
            .collect::<Vec<_>>()
    } else {
        vec![]
    };
    Ok(
        json!({"sameType":old.definition.kind==def.kind,"connections":connections,"reusableOptions":reusable,"preservesOldState":true}),
    )
}

pub fn apply(project: &mut Project, command: &Value, plugins: &[Plugin]) -> Result<()> {
    let kind = text(command, "type")?;
    if crate::timeline_actions::apply_action(project, command, plugins)? {
        return Ok(());
    }
    if [
        "timeline.update",
        "timeline.remove",
        "timeline.split",
        "timeline.restoreSource",
    ]
    .contains(&kind)
        && command["linked"] != false
    {
        if let Some(timeline) = &project.timeline {
            if let Some(selected) = timeline
                .clips
                .iter()
                .find(|c| c.id == command["clipId"])
                .cloned()
            {
                if let Some(group) = &selected.link_group {
                    let peers: Vec<_> = timeline
                        .clips
                        .iter()
                        .filter(|c| c.link_group.as_ref() == Some(group))
                        .cloned()
                        .collect();
                    let right_group = id();
                    for peer in peers {
                        let mut sub = command.clone();
                        sub["linked"] = json!(false);
                        sub["clipId"] = json!(peer.id);
                        sub["rightLinkGroup"] = json!(right_group);
                        if kind == "timeline.update" {
                            for (key, old, base) in [
                                ("startTicks", selected.start_ticks, peer.start_ticks),
                                ("inTicks", selected.in_ticks, peer.in_ticks),
                                (
                                    "durationTicks",
                                    selected.duration_ticks,
                                    peer.duration_ticks,
                                ),
                            ] {
                                if let Some(value) = command[key].as_i64() {
                                    sub[key] = json!(base + value - old);
                                }
                            }
                            if peer.id != selected.id {
                                sub.as_object_mut().unwrap().remove("trackId");
                            }
                        }
                        apply(project, &sub, plugins)?;
                    }
                    return Ok(());
                }
            }
        }
    }
    if kind.starts_with("timeline.")
        && ![
            "timeline.trackUpdate",
            "timeline.trackAdd",
            "timeline.settings",
            "timeline.create",
            "timeline.resolveOverlaps",
        ]
        .contains(&kind)
    {
        if let Some(t) = &project.timeline {
            let current_track = t
                .clips
                .iter()
                .find(|c| c.id == command["clipId"])
                .map(|c| c.track_id.as_str());
            if t.tracks.iter().any(|tr| {
                tr.locked && (Some(tr.id.as_str()) == current_track || command["trackId"] == tr.id)
            }) {
                return Err("轨道已锁定，请先解锁".into());
            }
        }
    }
    let mut overwrite_id = None;
    match kind {
        "project.rename" => {
            let name = text(command, "name")?.trim();
            if name.is_empty() {
                return Err("项目名称不能为空".into());
            }
            project.name = name.into();
        }
        "workspace.add" => {
            let (manifest, def) = definition(
                plugins,
                text(command, "pluginId")?,
                text(command, "pageId")?,
            )?;
            project
                .workspace
                .pages
                .push(page_node(manifest, def, project.workspace.pages.len()));
        }
        "workspace.remove" => {
            let index = project
                .workspace
                .pages
                .iter()
                .position(|n| n.id == command["nodeId"])
                .ok_or("页面不存在")?;
            let node = project.workspace.pages.remove(index);
            archive(
                project,
                "page",
                node.definition.name.clone(),
                json!({"node":node,"index":index}),
            );
        }
        "workspace.replace" => {
            let node_id = text(command, "nodeId")?;
            let report = replacement_report(
                project,
                plugins,
                node_id,
                text(command, "pluginId")?,
                text(command, "pageId")?,
            )?;
            let index = project
                .workspace
                .pages
                .iter()
                .position(|n| n.id == node_id)
                .unwrap();
            let old = project.workspace.pages[index].clone();
            let (manifest, def) = definition(
                plugins,
                text(command, "pluginId")?,
                text(command, "pageId")?,
            )?;
            let mut node = page_node(manifest, def, index);
            node.id = old.id.clone();
            node.position = old.position.clone();
            node.expanded = old.expanded;
            for key in report["reusableOptions"].as_array().unwrap() {
                let key = key.as_str().unwrap();
                node.config.insert(key.into(), old.config[key].clone());
            }
            project.workspace.pages[index] = node;
            archive(
                project,
                "replacement",
                old.definition.name.clone(),
                json!({"node":old,"index":index}),
            );
        }
        "workspace.configure" => {
            let node = project
                .workspace
                .pages
                .iter_mut()
                .find(|n| n.id == command["nodeId"])
                .ok_or("页面不存在")?;
            if let Some(position) = command.get("position") {
                node.position =
                    serde_json::from_value(position.clone()).map_err(|e| e.to_string())?;
            }
            if let Some(expanded) = command["expanded"].as_bool() {
                node.expanded = expanded;
            }
            if let Some(config) = command["config"].as_object() {
                for (key, value) in config {
                    let field = node
                        .definition
                        .options
                        .iter()
                        .find(|f| f["id"] == *key)
                        .ok_or("插件没有声明此选项")?;
                    if !option_valid(field, value) {
                        return Err(format!("选项 {key} 的值无效"));
                    }
                    node.config.insert(key.clone(), value.clone());
                }
            }
        }
        "workspace.state" | "information.publish" => {
            let node = project
                .workspace
                .pages
                .iter_mut()
                .find(|n| n.id == command["nodeId"])
                .ok_or("页面不存在")?;
            if !node.private_state.is_object() {
                node.private_state = json!({});
            }
            if kind == "workspace.state" {
                node.private_state["pageState"] = command.get("state").ok_or("缺少 state")?.clone();
            } else {
                let port_id = text(command, "portId")?;
                if node
                    .definition
                    .ports
                    .iter()
                    .any(|p| p.id == port_id && p.data_type == "workstation.subtitles@1")
                {
                    crate::subtitles::validate(command.get("value").ok_or("缺少字幕数据")?)?;
                }
                if !node
                    .definition
                    .ports
                    .iter()
                    .any(|p| p.id == port_id && p.direction == "output")
                {
                    return Err("输出端口不存在".into());
                }
                if !node.private_state["outputs"].is_object() {
                    node.private_state["outputs"] = json!({});
                }
                node.private_state["outputs"][port_id] =
                    command.get("value").ok_or("缺少 value")?.clone();
            }
        }
        "workspace.reorder" => {
            let order: Vec<String> =
                serde_json::from_value(command["nodeIds"].clone()).map_err(|e| e.to_string())?;
            if order.len() != project.workspace.pages.len()
                || order.iter().collect::<std::collections::HashSet<_>>().len() != order.len()
            {
                return Err("页面顺序必须包含所有节点且不能重复".into());
            }
            let nodes = order
                .iter()
                .map(|id| {
                    project
                        .workspace
                        .pages
                        .iter()
                        .find(|n| &n.id == id)
                        .cloned()
                        .ok_or("页面不存在".into())
                })
                .collect::<Result<Vec<_>>>()?;
            project.workspace.pages = nodes;
        }
        "information.connect" => {
            let link = InformationLink {
                id: id(),
                source: text(command, "source")?.into(),
                source_port: text(command, "sourcePort")?.into(),
                target: text(command, "target")?.into(),
                target_port: text(command, "targetPort")?.into(),
                data_type: text(command, "dataType")?.into(),
            };
            if link.source == link.target || !link_compatible(&project.workspace, &link) {
                return Err("信息端口类型或方向不匹配".into());
            }
            if command["replace"] == true {
                project
                    .workspace
                    .links
                    .retain(|l| l.target != link.target || l.target_port != link.target_port);
            }
            if let Some(id) = command["replaceLinkId"].as_str() {
                project.workspace.links.retain(|l| l.id != id);
            }
            if project.workspace.links.iter().any(|l| {
                l.target == link.target
                    && l.target_port == link.target_port
                    && link_compatible(&project.workspace, l)
            }) {
                return Err("该输入端口已有连接，请先断开".into());
            }
            project.workspace.links.push(link);
        }
        "information.disconnect" => {
            project
                .workspace
                .links
                .retain(|l| l.id != command["linkId"]);
        }
        "asset.archive" | "asset.restore" => {
            let asset = project
                .assets
                .iter_mut()
                .find(|a| a.id == command["assetId"])
                .ok_or("素材不存在")?;
            asset.archived = kind == "asset.archive";
            asset.revision += 1;
        }
        "asset.metadata" => {
            let asset = project
                .assets
                .iter_mut()
                .find(|a| a.id == command["assetId"])
                .ok_or("素材不存在")?;
            let fields = command["metadata"].as_object().ok_or("元数据需要为对象")?;
            if !asset.metadata.is_object() {
                asset.metadata = json!({})
            }
            for (key, value) in fields {
                asset.metadata[key] = value.clone();
            }
            asset.revision += 1;
        }
        "timeline.create" => {
            if project.timeline.is_some() {
                return Err("当前项目已有时间线".into());
            }
            project.timeline = Some(empty_timeline());
            if let Some(settings) = command.get("settings") {
                crate::video_settings::configure(project.timeline.as_mut().unwrap(), settings)?;
            }
        }
        "timeline.settings" => {
            let timeline = project.timeline.as_mut().ok_or("项目没有时间线")?;
            crate::video_settings::configure(
                timeline,
                command.get("settings").ok_or("缺少 settings")?,
            )?;
        }
        "timeline.add" => {
            let asset = project
                .assets
                .iter()
                .find(|a| a.id == command["assetId"] && !a.archived)
                .ok_or("素材不存在或已归档")?;
            let timeline = project.timeline.as_mut().ok_or("项目没有时间线")?;
            let track_id = text(command, "trackId")?;
            let track = timeline
                .tracks
                .iter()
                .find(|t| t.id == track_id)
                .ok_or("轨道不存在")?;
            if (track.kind == "audio" && !["audio", "video"].contains(&asset.media_type.as_str()))
                || (track.kind == "video"
                    && !["video", "image"].contains(&asset.media_type.as_str()))
            {
                return Err("素材不适用于此轨道".into());
            }
            let duration = command["durationTicks"]
                .as_i64()
                .or_else(|| {
                    asset.metadata["duration"]
                        .as_f64()
                        .filter(|d| d.is_finite() && *d > 0.0)
                        .map(|d| (d * timeline.timebase as f64).round() as i64)
                })
                .or_else(|| (asset.media_type == "image").then_some(timeline.timebase as i64 * 5))
                .ok_or("源媒体时长未知，请先重新读取素材信息；不会默认截成五秒")?;
            let start = command["startTicks"].as_i64().unwrap_or_else(|| {
                timeline
                    .clips
                    .iter()
                    .filter(|c| c.track_id == track_id)
                    .map(|c| c.start_ticks + c.duration_ticks)
                    .max()
                    .unwrap_or(0)
            });
            let has_audio = asset.media_type == "video"
                && asset.metadata["streams"]
                    .as_array()
                    .map(|s| s.iter().any(|s| s["type"] == "audio"))
                    .unwrap_or(false);
            let group = (has_audio && track.kind == "video").then(id);
            let audio_name = format!("A{}", track.name.strip_prefix('V').unwrap_or("1"));
            if let Some(group_id) = &group {
                let audio_track = if let Some(tr) = timeline
                    .tracks
                    .iter()
                    .find(|t| t.kind == "audio" && t.name == audio_name)
                {
                    if tr.locked {
                        return Err("关联音频轨道已锁定".into());
                    }
                    tr.id.clone()
                } else {
                    let new_id = id();
                    timeline.tracks.push(Track {
                        color: None,
                        id: new_id.clone(),
                        name: audio_name,
                        kind: "audio".into(),
                        locked: false,
                        muted: false,
                        solo: false,
                        disabled: false,
                    });
                    new_id
                };
                let audio_id = id();
                timeline.clips.push(Clip {
                    disabled: false,
                    color: None,
                    id: audio_id.clone(),
                    link_group: Some(group_id.clone()),
                    asset_id: asset.id.clone(),
                    name: asset.name.clone(),
                    track_id: audio_track,
                    start_ticks: start,
                    in_ticks: 0,
                    duration_ticks: duration,
                    extensions: BTreeMap::new(),
                });
                let covered = crate::timeline_edit::overwrite(timeline, &audio_id)?;
                for c in covered {
                    project.archive.push(ArchiveEntry {
                        id: id(),
                        kind: "clip".into(),
                        label: format!("覆盖归档：{}", c.name),
                        archived_at: now(),
                        data: json!(c),
                    });
                }
            }
            timeline.clips.push(Clip {
                disabled: false,
                color: None,
                link_group: group,
                id: id(),
                asset_id: asset.id.clone(),
                name: asset.name.clone(),
                track_id: track_id.into(),
                start_ticks: start,
                in_ticks: 0,
                duration_ticks: duration,
                extensions: BTreeMap::new(),
            });
            overwrite_id = timeline.clips.last().map(|c| c.id.clone());
        }
        "timeline.restoreSource" => {
            let timeline = project.timeline.as_mut().ok_or("项目没有时间线")?;
            let clip = timeline
                .clips
                .iter_mut()
                .find(|c| c.id == command["clipId"])
                .ok_or("片段不存在")?;
            let asset = project
                .assets
                .iter()
                .find(|a| a.id == clip.asset_id)
                .ok_or("素材不存在")?;
            if !crate::asset_metadata::timed(&asset.media_type) {
                return Err("静态图片没有完整源时长".into());
            }
            let duration =
                crate::asset_metadata::duration(&asset.metadata).ok_or("源媒体时长未知")?;
            clip.in_ticks = 0;
            clip.duration_ticks = (duration * timeline.timebase as f64).round() as i64;
            overwrite_id = Some(clip.id.clone());
        }
        "timeline.trackAdd" => {
            let t = project.timeline.as_mut().ok_or("项目没有时间线")?;
            let kind = text(command, "kind")?;
            if !["video", "audio"].contains(&kind) {
                return Err("轨道类型无效".into());
            }
            let number = t
                .tracks
                .iter()
                .filter(|tr| tr.kind == kind)
                .filter_map(|tr| tr.name.trim_start_matches(['V', 'A']).parse::<usize>().ok())
                .max()
                .unwrap_or(0)
                + 1;
            let tr = Track {
                color: None,
                id: id(),
                name: command["name"]
                    .as_str()
                    .map(String::from)
                    .unwrap_or_else(|| {
                        format!("{}{}", if kind == "video" { "V" } else { "A" }, number)
                    }),
                kind: kind.into(),
                locked: false,
                muted: false,
                solo: false,
                disabled: false,
            };
            if kind == "video" {
                t.tracks.insert(0, tr);
            } else {
                t.tracks.push(tr);
            }
        }
        "timeline.trackUpdate" => {
            let t = project.timeline.as_mut().ok_or("项目没有时间线")?;
            let tr = t
                .tracks
                .iter_mut()
                .find(|t| t.id == command["trackId"])
                .ok_or("轨道不存在")?;
            if let Some(v) = command["locked"].as_bool() {
                tr.locked = v;
            }
            if let Some(v) = command["muted"].as_bool() {
                tr.muted = v;
            }
            if let Some(v) = command["solo"].as_bool() {
                tr.solo = v;
            }
            if let Some(v) = command["disabled"].as_bool() {
                tr.disabled = v;
            }
            if let Some(v) = command["name"].as_str() {
                tr.name = v.into();
            }
            if let Some(v) = command["color"].as_str() {
                tr.color = Some(v.into());
            }
        }
        "timeline.update" => {
            let timeline = project.timeline.as_mut().ok_or("项目没有时间线")?;
            let clip = timeline
                .clips
                .iter_mut()
                .find(|c| c.id == command["clipId"])
                .ok_or("片段不存在")?;
            if let Some(v) = command["name"].as_str() {
                clip.name = v.into();
            }
            if let Some(v) = command["color"].as_str() {
                clip.color = Some(v.into());
            }
            if let Some(v) = command["disabled"].as_bool() {
                clip.disabled = v;
            }
            if let Some(start) = command["startTicks"].as_i64() {
                clip.start_ticks = start;
            }
            if let Some(source) = command["inTicks"].as_i64() {
                clip.in_ticks = source;
            }
            if let Some(duration) = command["durationTicks"].as_i64() {
                clip.duration_ticks = duration;
            }
            if let Some(track) = command["trackId"].as_str() {
                clip.track_id = track.into();
            }
            overwrite_id = Some(clip.id.clone());
        }
        "timeline.resolveOverlaps" => {
            let timeline = project.timeline.as_mut().ok_or("项目没有时间线")?;
            let covered = crate::timeline_edit::resolve_overlaps(timeline)?;
            for clip in covered {
                archive(
                    project,
                    "clip",
                    format!("覆盖归档：{}", clip.name),
                    json!(clip),
                );
            }
        }
        "timeline.split" => {
            let timeline = project.timeline.as_mut().ok_or("项目没有时间线")?;
            let index = timeline
                .clips
                .iter()
                .position(|c| c.id == command["clipId"])
                .ok_or("片段不存在")?;
            let at = number(command, "atTicks")?;
            let left = &mut timeline.clips[index];
            let offset = at - left.start_ticks;
            if offset <= 0 || offset >= left.duration_ticks {
                return Err("请在片段内部选择分割点".into());
            }
            let mut right = left.clone();
            right.id = id();
            right.link_group = command["rightLinkGroup"].as_str().map(String::from);
            right.start_ticks = at;
            right.in_ticks += offset;
            right.duration_ticks -= offset;
            left.duration_ticks = offset;
            timeline.clips.insert(index + 1, right);
        }
        "timeline.remove" => {
            let timeline = project.timeline.as_mut().ok_or("项目没有时间线")?;
            let index = timeline
                .clips
                .iter()
                .position(|c| c.id == command["clipId"])
                .ok_or("片段不存在")?;
            let clip = timeline.clips.remove(index);
            archive(project, "clip", clip.name.clone(), json!(clip));
        }
        "archive.restore" => {
            let index = project
                .archive
                .iter()
                .position(|a| a.id == command["archiveId"])
                .ok_or("归档项不存在")?;
            let entry = project.archive[index].clone();
            match entry.kind.as_str() {
                "track" => {
                    let track: Track = serde_json::from_value(entry.data["track"].clone())
                        .map_err(|e| e.to_string())?;
                    let clips: Vec<Clip> = serde_json::from_value(entry.data["clips"].clone())
                        .map_err(|e| e.to_string())?;
                    let t = project.timeline.as_mut().ok_or("没有时间线")?;
                    if t.tracks.iter().any(|tr| tr.id == track.id)
                        || clips.iter().any(|c| t.clips.iter().any(|x| x.id == c.id))
                    {
                        return Err("恢复目标已存在".into());
                    }
                    if track.kind == "video" {
                        t.tracks.insert(0, track);
                    } else {
                        t.tracks.push(track);
                    }
                    t.clips.extend(clips);
                }
                "clip" => {
                    let clip: Clip = decode(&entry.data.to_string())?;
                    let timeline = project.timeline.as_mut().ok_or("没有可恢复到的时间线")?;
                    if timeline.clips.iter().any(|c| c.id == clip.id) {
                        return Err("片段已存在".into());
                    }
                    timeline.clips.push(clip);
                    overwrite_id = timeline.clips.last().map(|c| c.id.clone());
                }
                "page" | "replacement" => {
                    let node: PageNode = decode(&entry.data["node"].to_string())?;
                    if let Some(current) =
                        project.workspace.pages.iter().position(|n| n.id == node.id)
                    {
                        let replaced =
                            std::mem::replace(&mut project.workspace.pages[current], node);
                        archive(
                            project,
                            "replacement",
                            replaced.definition.name.clone(),
                            json!({"node":replaced,"index":current}),
                        );
                    } else {
                        let i = (entry.data["index"].as_u64().unwrap_or(0) as usize)
                            .min(project.workspace.pages.len());
                        project.workspace.pages.insert(i, node);
                    }
                }
                _ => return Err("不支持恢复这种归档".into()),
            }
            project.archive.remove(index);
        }
        _ => return Err(format!("未知项目操作：{kind}")),
    }
    if let Some(clip_id) = overwrite_id {
        let covered = crate::timeline_edit::overwrite(
            project.timeline.as_mut().ok_or("项目没有时间线")?,
            &clip_id,
        )?;
        for clip in covered {
            archive(
                project,
                "clip",
                format!("覆盖归档：{}", clip.name),
                json!(clip),
            );
        }
    }
    Ok(())
}

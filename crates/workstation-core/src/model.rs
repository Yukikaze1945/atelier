use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Port {
    pub id: String,
    pub label: String,
    pub data_type: String,
    pub direction: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDefinition {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub icon: String,
    pub description: String,
    pub renderer: String,
    #[serde(default)]
    pub ports: Vec<Port>,
    #[serde(default)]
    pub options: Vec<Value>,
    #[serde(default)]
    pub preview: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub sdk_version: u32,
    pub author: String,
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub pages: Vec<PageDefinition>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub themes: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub manifest: Manifest,
    pub directory: Option<String>,
    pub enabled: bool,
    pub builtin: bool,
    pub installed_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageNode {
    pub id: String,
    pub plugin_id: String,
    pub plugin_version: String,
    pub definition: PageDefinition,
    pub position: Position,
    pub expanded: bool,
    #[serde(default)]
    pub config: BTreeMap<String, Value>,
    #[serde(default)]
    pub private_state: Value,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InformationLink {
    pub id: String,
    pub source: String,
    pub source_port: String,
    pub target: String,
    pub target_port: String,
    pub data_type: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Workspace {
    pub pages: Vec<PageNode>,
    #[serde(default)]
    pub links: Vec<InformationLink>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub revision: u64,
    pub name: String,
    pub media_type: String,
    pub source_uri: String,
    pub project_path: Option<String>,
    pub size: u64,
    pub imported_at: u64,
    pub archived: bool,
    #[serde(default)]
    pub metadata: Value,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_group: Option<String>,
    pub id: String,
    pub asset_id: String,
    pub name: String,
    pub track_id: String,
    pub start_ticks: i64,
    pub in_ticks: i64,
    pub duration_ticks: i64,
    #[serde(default)]
    pub extensions: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Track {
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub solo: bool,
    #[serde(default)]
    pub disabled: bool,
    pub id: String,
    pub name: String,
    pub kind: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FrameRate {
    pub numerator: u32,
    pub denominator: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub id: String,
    pub name: String,
    pub timebase: u32,
    pub frame_rate: FrameRate,
    pub width: u32,
    pub height: u32,
    pub tracks: Vec<Track>,
    pub clips: Vec<Clip>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub archived_at: u64,
    pub data: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub format_version: u32,
    pub id: String,
    pub name: String,
    pub revision: u64,
    pub created_at: u64,
    pub modified_at: u64,
    pub workspace: Workspace,
    pub assets: Vec<Asset>,
    pub timeline: Option<Timeline>,
    pub archive: Vec<ArchiveEntry>,
    #[serde(default)]
    pub template_ref: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    #[serde(flatten)]
    pub project: Project,
    pub directory: String,
    pub can_undo: bool,
    pub can_redo: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowTemplate {
    pub id: String,
    pub name: String,
    pub version: u32,
    pub created_at: u64,
    pub workspace: Workspace,
}

pub fn builtin_manifest() -> Manifest {
    serde_json::from_str(include_str!("../../../plugins/official-base/plugin.json"))
        .expect("valid bundled manifest")
}
pub fn page_node(plugin: &Manifest, definition: &PageDefinition, index: usize) -> PageNode {
    let config = definition
        .options
        .iter()
        .filter_map(|field| {
            Some((
                field.get("id")?.as_str()?.to_string(),
                field.get("default")?.clone(),
            ))
        })
        .collect();
    PageNode {
        id: id(),
        plugin_id: plugin.id.clone(),
        plugin_version: plugin.version.clone(),
        definition: definition.clone(),
        position: Position {
            x: 60.0 + index as f64 * 340.0,
            y: 100.0,
        },
        expanded: false,
        config,
        private_state: json!({}),
    }
}
pub fn default_workspace() -> Workspace {
    let manifest = builtin_manifest();
    let pages: Vec<_> = manifest
        .pages
        .iter()
        .enumerate()
        .map(|(i, d)| page_node(&manifest, d, i))
        .collect();
    let links = vec![
        InformationLink {
            id: id(),
            source: pages[0].id.clone(),
            source_port: "assets".into(),
            target: pages[1].id.clone(),
            target_port: "assets".into(),
            data_type: "workstation.assets@1".into(),
        },
        InformationLink {
            id: id(),
            source: pages[1].id.clone(),
            source_port: "timeline".into(),
            target: pages[2].id.clone(),
            target_port: "timeline".into(),
            data_type: "workstation.timeline@1".into(),
        },
    ];
    Workspace { pages, links }
}
pub fn empty_timeline() -> Timeline {
    Timeline {
        id: id(),
        name: "Timeline 1".into(),
        timebase: 240_000,
        frame_rate: FrameRate {
            numerator: 24,
            denominator: 1,
        },
        width: 1920,
        height: 1080,
        tracks: vec![
            Track {
                color: None,
                id: "v2".into(),
                locked: false,
                muted: false,
                solo: false,
                disabled: false,
                name: "V2".into(),
                kind: "video".into(),
            },
            Track {
                color: None,
                id: "v1".into(),
                locked: false,
                muted: false,
                solo: false,
                disabled: false,
                name: "V1".into(),
                kind: "video".into(),
            },
            Track {
                color: None,
                id: "a1".into(),
                locked: false,
                muted: false,
                solo: false,
                disabled: false,
                name: "A1".into(),
                kind: "audio".into(),
            },
        ],
        clips: vec![],
    }
}
pub fn archive(project: &mut Project, kind: &str, label: String, data: Value) {
    project.archive.push(ArchiveEntry {
        id: id(),
        kind: kind.into(),
        label,
        archived_at: now(),
        data,
    });
}

pub fn validate_workspace(workspace: &Workspace) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    for node in &workspace.pages {
        if !ids.insert(&node.id) {
            return Err("页面节点 ID 重复".into());
        }
        if !node.position.x.is_finite() || !node.position.y.is_finite() {
            return Err("节点位置无效".into());
        }
    }
    let mut links = std::collections::HashSet::new();
    for link in &workspace.links {
        if !links.insert(&link.id) {
            return Err("信息连接 ID 重复".into());
        }
    }
    Ok(())
}

pub fn validate_project(project: &Project) -> Result<(), String> {
    if project.format_version != 0 {
        return Err("不支持此工程格式，请使用兼容版本".into());
    }
    validate_workspace(&project.workspace)?;
    if let Some(t) = &project.timeline {
        if t.timebase == 0 || t.frame_rate.numerator == 0 || t.frame_rate.denominator == 0 {
            return Err("时间基准无效".into());
        }
        let mut ids = std::collections::HashSet::new();
        for clip in &t.clips {
            if !ids.insert(&clip.id)
                || clip.start_ticks < 0
                || clip.in_ticks < 0
                || clip.duration_ticks <= 0
                || clip.start_ticks.checked_add(clip.duration_ticks).is_none()
            {
                return Err("片段 ID 或时间范围无效".into());
            }
            if !t.tracks.iter().any(|tr| tr.id == clip.track_id)
                || !project.assets.iter().any(|a| a.id == clip.asset_id)
            {
                return Err("片段引用的轨道或素材不存在".into());
            }
        }
    }
    Ok(())
}

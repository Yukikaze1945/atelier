use crate::{model::*, store::Result};
use serde_json::{json, Value};

pub fn validate(value: &Value) -> Result<()> {
    if value["schema"] != "workstation.subtitles@1"
        || value["timebase"].as_u64().filter(|v| *v > 0).is_none()
    {
        return Err("字幕协议或时间基准无效".into());
    }
    let cues = value["cues"].as_array().ok_or("缺少字幕列表")?;
    for cue in cues {
        let start = cue["startTicks"].as_i64().ok_or("字幕起点须为整数")?;
        let end = cue["endTicks"].as_i64().ok_or("字幕终点须为整数")?;
        if start < 0 || end <= start || cue["text"].as_str().is_none() {
            return Err("字幕时间或文本无效".into());
        }
    }
    Ok(())
}
pub fn refresh_ports(project: &mut Project, plugins: &[Plugin]) {
    for node in &mut project.workspace.pages {
        let Some(manifest) = plugins
            .iter()
            .find(|p| p.manifest.id == node.plugin_id && p.manifest.version == node.plugin_version)
            .map(|p| &p.manifest)
        else {
            continue;
        };
        if let Some(def) = manifest.pages.iter().find(|p| p.id == node.definition.id) {
            for port in &def.ports {
                if !node.definition.ports.iter().any(|p| p.id == port.id) {
                    node.definition.ports.push(port.clone());
                }
            }
        }
    }
}
pub fn for_export(project: &Project, plugins: &[Plugin]) -> Result<Vec<Value>> {
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for link in &project.workspace.links {
        let Some(target) = project.workspace.pages.iter().find(|n| n.id == link.target) else {
            continue;
        };
        if !["builtin:edit", "builtin:export"].contains(&target.definition.renderer.as_str())
            || link.data_type != "workstation.subtitles@1"
            || !crate::commands::link_compatible(&project.workspace, link)
        {
            continue;
        }
        let Some(source) = project.workspace.pages.iter().find(|n| n.id == link.source) else {
            continue;
        };
        if !plugins.iter().any(|p| {
            p.enabled
                && p.manifest.id == source.plugin_id
                && p.manifest.version == source.plugin_version
        }) {
            continue;
        }
        if !seen.insert((link.source.clone(), link.source_port.clone())) {
            continue;
        }
        if let Some(value) = source
            .private_state
            .get("outputs")
            .and_then(|o| o.get(&link.source_port))
        {
            validate(value)?;
            result.push(json!({"nodeId":source.id,"document":value}));
        }
    }
    Ok(result)
}

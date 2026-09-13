use crate::{
    commands::{apply, text},
    model::*,
    store::Result,
};
use serde_json::{json, Value};

pub fn apply_action(project: &mut Project, command: &Value, plugins: &[Plugin]) -> Result<bool> {
    let kind = text(command, "type")?;
    match kind {
        "timeline.rippleRemove" => {
            let t = project.timeline.as_ref().ok_or("没有时间线")?;
            let clip = t
                .clips
                .iter()
                .find(|c| c.id == command["clipId"])
                .ok_or("片段不存在")?
                .clone();
            let peers: Vec<_> = t
                .clips
                .iter()
                .filter(|c| {
                    c.id == clip.id
                        || (command["linked"] != false
                            && clip.link_group.is_some()
                            && c.link_group == clip.link_group)
                })
                .cloned()
                .collect();
            apply(
                project,
                &json!({"type":"timeline.remove","clipId":clip.id,"linked":command["linked"]}),
                plugins,
            )?;
            let t = project.timeline.as_mut().unwrap();
            for removed in peers {
                for c in &mut t.clips {
                    if c.track_id == removed.track_id
                        && c.start_ticks >= removed.start_ticks + removed.duration_ticks
                    {
                        c.start_ticks -= removed.duration_ticks;
                    }
                }
            }
        }
        "timeline.moveToTrack" => {
            let t = project.timeline.as_ref().ok_or("没有时间线")?;
            let clip = t
                .clips
                .iter()
                .find(|c| c.id == command["clipId"])
                .ok_or("片段不存在")?
                .clone();
            let media_kind = t
                .tracks
                .iter()
                .find(|t| t.id == clip.track_id)
                .ok_or("轨道不存在")?
                .kind
                .clone();
            let target = if command["newTrack"] == true {
                apply(
                    project,
                    &json!({"type":"timeline.trackAdd","kind":media_kind}),
                    plugins,
                )?;
                let tracks = &project.timeline.as_ref().unwrap().tracks;
                if media_kind == "video" {
                    tracks[0].id.clone()
                } else {
                    tracks.last().unwrap().id.clone()
                }
            } else {
                text(command, "trackId")?.into()
            };
            let t = project.timeline.as_ref().unwrap();
            let target_track = t
                .tracks
                .iter()
                .find(|t| t.id == target && t.kind == media_kind)
                .ok_or("轨道类型不匹配")?
                .clone();
            let peers: Vec<_> = t
                .clips
                .iter()
                .filter(|c| {
                    c.id == clip.id
                        || (command["linked"] != false
                            && clip.link_group.is_some()
                            && c.link_group == clip.link_group)
                })
                .cloned()
                .collect();
            for peer in peers {
                let destination = if peer.id == clip.id {
                    target.clone()
                } else {
                    let peer_kind = project
                        .timeline
                        .as_ref()
                        .unwrap()
                        .tracks
                        .iter()
                        .find(|t| t.id == peer.track_id)
                        .unwrap()
                        .kind
                        .clone();
                    let prefix = if peer_kind == "audio" { "A" } else { "V" };
                    let name = format!(
                        "{prefix}{}",
                        target_track.name.trim_start_matches(['V', 'A'])
                    );
                    if let Some(tr) = project
                        .timeline
                        .as_ref()
                        .unwrap()
                        .tracks
                        .iter()
                        .find(|t| t.kind == peer_kind && t.name == name)
                    {
                        tr.id.clone()
                    } else {
                        apply(
                            project,
                            &json!({"type":"timeline.trackAdd","kind":peer_kind,"name":name}),
                            plugins,
                        )?;
                        project
                            .timeline
                            .as_ref()
                            .unwrap()
                            .tracks
                            .iter()
                            .find(|t| t.name == name)
                            .ok_or("无法创建关联轨道")?
                            .id
                            .clone()
                    }
                };
                let delta =
                    command["startTicks"].as_i64().unwrap_or(clip.start_ticks) - clip.start_ticks;
                apply(
                    project,
                    &json!({"type":"timeline.update","clipId":peer.id,"trackId":destination,"startTicks":peer.start_ticks+delta,"linked":false}),
                    plugins,
                )?;
            }
        }
        "timeline.trackMove" => {
            let t = project.timeline.as_mut().ok_or("没有时间线")?;
            let index = t
                .tracks
                .iter()
                .position(|t| t.id == command["trackId"])
                .ok_or("轨道不存在")?;
            let target = if command["direction"] == "up" {
                index.checked_sub(1)
            } else {
                Some(index + 1)
            };
            if let Some(target) = target.filter(|i| *i < t.tracks.len()) {
                if t.tracks[index].kind == t.tracks[target].kind {
                    t.tracks.swap(index, target);
                }
            }
        }
        "timeline.trackRemove" | "timeline.removeEmptyTracks" => {
            let t = project.timeline.as_mut().ok_or("没有时间线")?;
            let targets: Vec<_> = t
                .tracks
                .iter()
                .filter(|tr| {
                    if kind == "timeline.trackRemove" {
                        tr.id == command["trackId"]
                    } else {
                        !tr.locked && !t.clips.iter().any(|c| c.track_id == tr.id)
                    }
                })
                .cloned()
                .collect();
            if targets.iter().any(|t| t.locked) {
                return Err("轨道已锁定".into());
            }
            let mut removed = Vec::new();
            for tr in targets {
                let clips: Vec<_> = t
                    .clips
                    .iter()
                    .filter(|c| c.track_id == tr.id)
                    .cloned()
                    .collect();
                t.clips.retain(|c| c.track_id != tr.id);
                t.tracks.retain(|x| x.id != tr.id);
                removed.push((tr, clips));
            }
            for (tr, clips) in removed {
                archive(
                    project,
                    "track",
                    tr.name.clone(),
                    json!({"track":tr,"clips":clips}),
                );
            }
        }
        "timeline.paste" => {
            let mut clips: Vec<Clip> =
                serde_json::from_value(command["clips"].clone()).map_err(|e| e.to_string())?;
            let origin = clips
                .iter()
                .map(|c| c.start_ticks)
                .min()
                .ok_or("剪贴板为空")?;
            let at = command["atTicks"].as_i64().ok_or("缺少粘贴位置")?;
            let group = id();
            for clip in &mut clips {
                clip.id = id();
                clip.start_ticks += at - origin;
                if clip.link_group.is_some() {
                    clip.link_group = Some(group.clone());
                }
            }
            let t = project.timeline.as_mut().ok_or("没有时间线")?;
            for clip in &clips {
                if !t.tracks.iter().any(|t| t.id == clip.track_id && !t.locked) {
                    return Err("粘贴目标轨道不存在或已锁定".into());
                }
            }
            let mut covered = Vec::new();
            for clip in clips {
                let id = clip.id.clone();
                t.clips.push(clip);
                covered.extend(crate::timeline_edit::overwrite(t, &id)?);
            }
            for clip in covered {
                archive(project, "clip", clip.name.clone(), json!(clip));
            }
        }
        _ => return Ok(false),
    }
    Ok(true)
}

use crate::model::{id, Clip, Timeline};
use crate::store::Result;

/// Overwrite one track, retaining only the source intervals outside the new clip.
/// Returned covered intervals belong in the archive, not hidden beneath the edit.
pub fn overwrite(timeline: &mut Timeline, clip_id: &str) -> Result<Vec<Clip>> {
    let index = timeline
        .clips
        .iter()
        .position(|c| c.id == clip_id)
        .ok_or("片段不存在")?;
    let incoming = timeline.clips[index].clone();
    let start = incoming.start_ticks;
    let end = start
        .checked_add(incoming.duration_ticks)
        .ok_or("时间范围溢出")?;
    if start < 0 || incoming.duration_ticks <= 0 || incoming.in_ticks < 0 {
        return Err("片段时间范围无效".into());
    }
    let mut retained = Vec::new();
    let mut covered = Vec::new();
    for old in &timeline.clips {
        if old.id == incoming.id {
            continue;
        }
        let old_end = old
            .start_ticks
            .checked_add(old.duration_ticks)
            .ok_or("时间范围溢出")?;
        if old.track_id != incoming.track_id || old_end <= start || old.start_ticks >= end {
            retained.push(old.clone());
            continue;
        }
        let cut_start = old.start_ticks.max(start);
        let cut_end = old_end.min(end);
        let has_left = old.start_ticks < start;
        let has_right = old_end > end;
        let mut removed = old.clone();
        if has_left || has_right {
            removed.id = id();
        }
        removed.start_ticks = cut_start;
        removed.in_ticks += cut_start - old.start_ticks;
        removed.duration_ticks = cut_end - cut_start;
        removed.link_group = None;
        covered.push(removed);
        if has_left {
            let mut left = old.clone();
            left.duration_ticks = start - old.start_ticks;
            left.link_group = old
                .link_group
                .as_ref()
                .map(|g| format!("{g}:{}:{start}", old.start_ticks));
            retained.push(left);
        }
        if has_right {
            let mut right = old.clone();
            if has_left {
                right.id = id();
            }
            right.start_ticks = end;
            right.in_ticks += end - old.start_ticks;
            right.duration_ticks = old_end - end;
            right.link_group = old
                .link_group
                .as_ref()
                .map(|g| format!("{g}:{end}:{old_end}"));
            retained.push(right);
        }
    }
    retained.push(incoming);
    timeline.clips = retained;
    Ok(covered)
}

/// Explicit migration for legacy timelines: later list entries win, matching drawing order.
pub fn resolve_overlaps(timeline: &mut Timeline) -> Result<Vec<Clip>> {
    let old = std::mem::take(&mut timeline.clips);
    let mut covered = Vec::new();
    for clip in old {
        let id = clip.id.clone();
        timeline.clips.push(clip);
        covered.extend(overwrite(timeline, &id)?);
    }
    Ok(covered)
}

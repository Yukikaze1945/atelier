use crate::media::MediaManager;
use crate::model::{Asset, ProjectView};
use crate::store::Result;
use serde_json::{json, Value};
use std::path::Path;

pub fn duration(metadata: &Value) -> Option<f64> {
    metadata
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
}
pub fn timed(kind: &str) -> bool {
    matches!(kind, "video" | "audio")
}
pub fn kind(path: &Path) -> &'static str {
    match path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" => "video",
        "wav" | "mp3" | "flac" | "aac" | "m4a" | "ogg" => "audio",
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tiff" => "image",
        "srt" | "ass" | "vtt" => "subtitle",
        _ => "document",
    }
}
pub fn uri(project: &ProjectView, asset: &Asset) -> Result<String> {
    if let Some(relative) = &asset.project_path {
        url::Url::from_file_path(Path::new(&project.directory).join(relative))
            .map(|u| u.to_string())
            .map_err(|_| "项目素材路径无效".into())
    } else {
        Ok(asset.source_uri.clone())
    }
}
pub fn inspect(media: &MediaManager, uri: &str, current: &Value) -> Result<Value> {
    let result = media.inspect(uri)?;
    let seconds = duration(&result).ok_or("媒体执行器没有返回有效的源时长")?;
    let mut metadata = if current.is_object() {
        current.clone()
    } else {
        json!({})
    };
    metadata["duration"] = json!(seconds);
    if let Some(streams) = result["streams"].as_array() {
        metadata["streams"] = json!(streams);
        if let Some(video) = streams.iter().find(|s| s["type"] == "video") {
            for key in ["width", "height", "frameRate"] {
                if let Some(value) = video.get(key) {
                    metadata[key] = value.clone();
                }
            }
        }
    }
    metadata["probeSource"] = json!("gstreamer");
    metadata["probeStatus"] = json!("ready");
    metadata.as_object_mut().unwrap().remove("probeError");
    Ok(metadata)
}

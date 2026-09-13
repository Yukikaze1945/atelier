use crate::model::{FrameRate, Timeline};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSettings {
    pub width: u32,
    pub height: u32,
    pub frame_rate: FrameRate,
}

impl VideoSettings {
    pub fn validate(&mut self) -> Result<(), String> {
        if self.width == 0 || self.height == 0 || self.width > 32768 || self.height > 32768 {
            return Err("画面宽高应为 1–32768 的整数".into());
        }
        let rate = &mut self.frame_rate;
        if rate.numerator == 0
            || rate.denominator == 0
            || rate.numerator > i32::MAX as u32
            || rate.denominator > i32::MAX as u32
        {
            return Err("帧率分子和分母必须是有效的正整数".into());
        }
        let (mut a, mut b) = (rate.numerator, rate.denominator);
        while b != 0 {
            (a, b) = (b, a % b);
        }
        rate.numerator /= a;
        rate.denominator /= a;
        Ok(())
    }
}

pub fn configure(timeline: &mut Timeline, value: &Value) -> Result<(), String> {
    let mut settings: VideoSettings =
        serde_json::from_value(value.clone()).map_err(|e| format!("视频设置无效：{e}"))?;
    settings.validate()?;
    timeline.width = settings.width;
    timeline.height = settings.height;
    timeline.frame_rate = settings.frame_rate;
    // Changing output fps must not retime existing clips or alter their source in-points.
    Ok(())
}

pub fn presets() -> Value {
    json!([
        {"id":"hd-30","name":"720p · 30 fps","width":1280,"height":720,"frameRate":{"numerator":30,"denominator":1}},
        {"id":"fhd-24","name":"1080p · 24 fps","width":1920,"height":1080,"frameRate":{"numerator":24,"denominator":1}},
        {"id":"fhd-25","name":"1080p · 25 fps","width":1920,"height":1080,"frameRate":{"numerator":25,"denominator":1}},
        {"id":"fhd-2997","name":"1080p · 29.97 fps","width":1920,"height":1080,"frameRate":{"numerator":30000,"denominator":1001}},
        {"id":"fhd-30","name":"1080p · 30 fps","width":1920,"height":1080,"frameRate":{"numerator":30,"denominator":1}},
        {"id":"fhd-60","name":"1080p · 60 fps","width":1920,"height":1080,"frameRate":{"numerator":60,"denominator":1}},
        {"id":"portrait-30","name":"竖屏 1080×1920 · 30 fps","width":1080,"height":1920,"frameRate":{"numerator":30,"denominator":1}},
        {"id":"uhd-23976","name":"4K UHD · 23.976 fps","width":3840,"height":2160,"frameRate":{"numerator":24000,"denominator":1001}},
        {"id":"uhd-30","name":"4K UHD · 30 fps","width":3840,"height":2160,"frameRate":{"numerator":30,"denominator":1}},
        {"id":"uhd-5994","name":"4K UHD · 59.94 fps","width":3840,"height":2160,"frameRate":{"numerator":60000,"denominator":1001}},
        {"id":"uhd-60","name":"4K UHD · 60 fps","width":3840,"height":2160,"frameRate":{"numerator":60,"denominator":1}}
    ])
}

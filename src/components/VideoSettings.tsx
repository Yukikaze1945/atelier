import { useEffect, useState } from "react";
import { host } from "../host";
import { useProject } from "../context";
import { Button, Modal } from "./ui";

export interface VideoSettings {
  width: number;
  height: number;
  frameRate: { numerator: number; denominator: number };
}
interface VideoPreset extends VideoSettings {
  id: string;
  name: string;
}
export const defaultVideoSettings: VideoSettings = {
  width: 1920,
  height: 1080,
  frameRate: { numerator: 24, denominator: 1 },
};

export function VideoSettingsFields({
  value,
  onChange,
}: {
  value: VideoSettings;
  onChange: (value: VideoSettings) => void;
}) {
  const [presets, setPresets] = useState<VideoPreset[]>([]);
  useEffect(() => {
    void host
      .request<VideoPreset[]>("system.videoPresets")
      .then(setPresets)
      .catch(() => {});
  }, []);
  const preset = presets.find(
    (p) =>
      p.width === value.width &&
      p.height === value.height &&
      p.frameRate.numerator * value.frameRate.denominator ===
        value.frameRate.numerator * p.frameRate.denominator,
  );
  return (
    <div className="video-settings-fields" style={{ display: "grid", gap: 14 }}>
      <label>
        视频预设
        <select
          aria-label="视频预设"
          value={preset?.id || "custom"}
          onChange={(e) => {
            const next = presets.find((p) => p.id === e.target.value);
            if (next)
              onChange({
                width: next.width,
                height: next.height,
                frameRate: next.frameRate,
              });
          }}
        >
          <option value="custom">自定义</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label>
          宽度
          <input
            aria-label="视频宽度"
            type="number"
            min={1}
            max={32768}
            value={value.width}
            onChange={(e) =>
              onChange({ ...value, width: Number(e.target.value) })
            }
          />
        </label>
        <label>
          高度
          <input
            aria-label="视频高度"
            type="number"
            min={1}
            max={32768}
            value={value.height}
            onChange={(e) =>
              onChange({ ...value, height: Number(e.target.value) })
            }
          />
        </label>
        <label>
          帧率分子
          <input
            aria-label="帧率分子"
            type="number"
            min={1}
            value={value.frameRate.numerator}
            onChange={(e) =>
              onChange({
                ...value,
                frameRate: {
                  ...value.frameRate,
                  numerator: Number(e.target.value),
                },
              })
            }
          />
        </label>
        <label>
          帧率分母
          <input
            aria-label="帧率分母"
            type="number"
            min={1}
            value={value.frameRate.denominator}
            onChange={(e) =>
              onChange({
                ...value,
                frameRate: {
                  ...value.frameRate,
                  denominator: Number(e.target.value),
                },
              })
            }
          />
        </label>
      </div>
      <small className="muted">
        {value.frameRate.denominator > 0
          ? (value.frameRate.numerator / value.frameRate.denominator).toFixed(3)
          : "—"}{" "}
        fps · 29.97 使用 30000/1001，59.94 使用 60000/1001。
      </small>
    </div>
  );
}

export function VideoSettingsDialog({ onClose }: { onClose: () => void }) {
  const { project, command } = useProject();
  const [value, setValue] = useState<VideoSettings>(
    project.timeline
      ? {
          width: project.timeline.width,
          height: project.timeline.height,
          frameRate: project.timeline.frameRate,
        }
      : defaultVideoSettings,
  );
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="时间线视频设置"
      subtitle="修改画面规格和输出帧率，保留已有片段的时间位置与时长。"
      onClose={onClose}
    >
      <div className="modal-body">
        <VideoSettingsFields value={value} onChange={setValue} />
      </div>
      <footer className="modal-footer">
        <Button onClick={onClose}>取消</Button>
        <Button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await command({
              type: "timeline.settings",
              settings: value,
            });
            setBusy(false);
            if (result) onClose();
          }}
        >
          保存设置
        </Button>
      </footer>
    </Modal>
  );
}

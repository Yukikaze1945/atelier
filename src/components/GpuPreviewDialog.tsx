import { useEffect, useState } from "react";
import { desktop, host } from "../host";
import { useProject } from "../context";
import { Button, Modal } from "./ui";
export function GpuPreviewDialog({
  assetId,
  onClose,
}: {
  assetId?: string;
  onClose: () => void;
}) {
  const { project } = useProject();
  const [status, setStatus] = useState("正在准备 WebGPU…");
  const [frames, setFrames] = useState(0);
  useEffect(() => {
    let alive = true;
    const off = desktop.onGpuStatus((event) => {
      if (!alive) return;
      if (event.event === "presented") {
        setFrames((n) => n + 1);
        setStatus(
          `D3D11Memory → 共享纹理 → WebGPU · CPU 回读 ${event.cpuReadbacks} · 桥接复制 ${event.bridgeGpuCopies}`,
        );
      } else if (event.event === "error") setStatus(String(event.message));
    });
    desktop
      .prepareGpuPreview()
      .then(() => {
        if (alive)
          return host.request("media.gpu.start", {
            projectId: project.id,
            assetId,
            testPattern: !assetId,
          });
      })
      .catch((e) => {
        if (alive) setStatus(String(e));
      });
    return () => {
      alive = false;
      off();
      void host.request("media.gpu.stop").catch(() => {});
    };
  }, [project.id, assetId]);
  return (
    <Modal
      title="原生 GPU 预览验证"
      subtitle={
        assetId
          ? "当前视频源的静音 GPU 路径；GES 多轨合成仍单独验证。"
          : "GPU 测试图案验证，不代表硬件解码链路。"
      }
      onClose={onClose}
      wide
    >
      <div className="modal-body">
        <canvas
          id="native-gpu-preview"
          style={{
            display: "block",
            width: "100%",
            maxHeight: 420,
            aspectRatio: "16/9",
            background: "#000",
            objectFit: "contain",
          }}
        />
        <p role="status" style={{ marginTop: 15 }}>
          {status}
        </p>
        <small>已呈现 {frames} 帧</small>
      </div>
      <footer className="modal-footer">
        <Button onClick={onClose}>关闭预览</Button>
      </footer>
    </Modal>
  );
}

import { sharedTexture } from "electron";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { root } from "./core-client.mjs";

export class GpuPreview {
  constructor(window) {
    this.window = window;
    this.active = null;
  }
  stop() {
    const session = this.active;
    this.active = null;
    if (
      session &&
      !session.child.stdin.destroyed &&
      !session.child.stdin.writableEnded
    )
      session.child.stdin.end("stop\n");
    return { stopped: true };
  }
  start(uri) {
    this.stop();
    if (process.platform !== "win32")
      throw new Error("当前 GPU 共享纹理验证器只支持 Windows");
    const runtime =
      process.env.WORKSTATION_GSTREAMER_ROOT ||
      path.join(root, ".deps/gstreamer");
    const child = spawn(
      path.join(root, "native/build/Release/workstation-gpu-preview.exe"),
      [uri, String(process.pid)],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          PATH: `${path.join(runtime, "bin")}${path.delimiter}${process.env.PATH || ""}`,
          GST_PLUGIN_SYSTEM_PATH_1_0: path.join(runtime, "lib/gstreamer-1.0"),
        },
      },
    );
    const session = { id: randomUUID(), child };
    this.active = session;
    const report = (data) => {
      if (!this.window.isDestroyed())
        this.window.webContents.send("host:gpu-status", {
          sessionId: session.id,
          ...data,
        });
    };
    child.stderr.on("data", (data) => process.stderr.write(data));
    child.on("error", (error) =>
      report({ event: "error", message: error.message }),
    );
    child.stdin.on("error", () => {});
    child.on("exit", (code) => {
      if (this.active === session) this.active = null;
      report({ event: "exit", code });
    });
    createInterface({ input: child.stdout }).on("line", async (line) => {
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      if (frame.event !== "frame") {
        report(frame);
        return;
      }
      let acknowledged = false;
      const release = () => {
        if (acknowledged) return;
        acknowledged = true;
        if (!child.stdin.destroyed && !child.stdin.writableEnded)
          child.stdin.write("release\n");
      };
      let imported;
      try {
        const handle = Buffer.alloc(8);
        handle.writeBigUInt64LE(BigInt(frame.handle));
        imported = sharedTexture.importSharedTexture({
          textureInfo: {
            handle: { ntHandle: handle },
            codedSize: { width: frame.width, height: frame.height },
            pixelFormat: "bgra",
            timestamp: frame.timestamp,
          },
          allReferencesReleased: release,
        });
        if (this.active === session && !this.window.isDestroyed())
          await sharedTexture.sendSharedTexture(
            {
              frame: this.window.webContents.mainFrame,
              importedSharedTexture: imported,
            },
            { ...frame, sessionId: session.id },
          );
      } catch (error) {
        report({ event: "error", message: String(error) });
        if (!imported) release();
      } finally {
        imported?.release();
      }
    });
    return { sessionId: session.id };
  }
}

import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const run = promisify(execFile);
test("D3D11 shared textures are presented through Electron and WebGPU with release backpressure", async ({}, info) => {
  test.skip(
    process.platform !== "win32" ||
      !existsSync(
        path.join(root, "native/build/Release/workstation-gpu-preview.exe"),
      ),
    "Requires the native D3D11 preview worker.",
  );
  const directory = await mkdtemp(path.join(os.tmpdir(), "workstation-gpu-"));
  const env = {
    ...process.env,
    WORKSTATION_DATA_DIR: path.join(directory, "state"),
    WORKSTATION_TEST: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root], cwd: root, env });
  let logs = "";
  app.process().stderr?.on("data", (data) => {
    logs += String(data);
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.id = "native-gpu-preview";
      Object.assign(canvas.style, {
        position: "fixed",
        inset: "0",
        width: "640px",
        height: "480px",
        zIndex: "1000",
        background: "#000",
      });
      document.body.append(canvas);
      (window as any).gpuEvents = [];
      window.workstation.onGpuStatus((event) =>
        (window as any).gpuEvents.push(event),
      );
    });
    const prepared = await page.evaluate(() =>
      window.workstation.prepareGpuPreview(),
    );
    expect(prepared.available).toBe(true);
    await page.evaluate(() =>
      window.workstation.request("media.gpu.start", { testPattern: true }),
    );
    await expect
      .poll(
        async () => {
          const events = await page.evaluate(() => (window as any).gpuEvents);
          const error = events.find((e: any) => e.event === "error");
          if (error) throw new Error(error.message);
          return events.filter((e: any) => e.event === "presented").length;
        },
        { timeout: 30000, intervals: [250, 500] },
      )
      .toBeGreaterThanOrEqual(4);
    await page.screenshot({ path: info.outputPath("gpu-pattern.png") });
    const pattern = await page.evaluate(() =>
      (window as any).gpuEvents.filter((e: any) => e.event === "presented"),
    );
    expect(
      pattern.every(
        (e: any) =>
          e.cpuReadbacks === 0 &&
          e.bridgeGpuCopies === 0 &&
          e.memory === "D3D11Memory",
      ),
    ).toBe(true);
    await page.evaluate(() => window.workstation.request("media.gpu.stop"));

    const source = path.join(directory, "gpu-video.mp4");
    await run(
      path.join(root, ".deps/gstreamer/bin/gst-launch-1.0.exe"),
      [
        "-q",
        "videotestsrc",
        "num-buffers=30",
        "pattern=smpte",
        "!",
        "video/x-raw,format=I420,width=320,height=180,framerate=30/1",
        "!",
        "x264enc",
        "tune=zerolatency",
        "!",
        "h264parse",
        "!",
        "mp4mux",
        "!",
        "filesink",
        `location="${source.replaceAll("\\", "/")}"`,
      ],
      { windowsHide: true, timeout: 30000 },
    );
    await page.evaluate(
      async ({ directory, source }) => {
        let project = await window.workstation.request<any>("project.create", {
          name: "GPU test",
          parentDirectory: directory,
        });
        project = await window.workstation.request<any>("asset.import", {
          projectId: project.id,
          expectedRevision: project.revision,
          mode: "link",
          files: [{ path: source }],
        });
        (window as any).gpuEvents = [];
        await window.workstation.request("media.gpu.start", {
          projectId: project.id,
          assetId: project.assets[0].id,
        });
      },
      { directory, source },
    );
    await expect
      .poll(
        async () => {
          const events = await page.evaluate(() => (window as any).gpuEvents);
          const error = events.find((e: any) => e.event === "error");
          if (error) throw new Error(error.message);
          return events.filter(
            (e: any) => e.event === "presented" && !e.testPattern,
          ).length;
        },
        { timeout: 30000, intervals: [250, 500] },
      )
      .toBeGreaterThanOrEqual(4);
    await page.screenshot({ path: info.outputPath("gpu-decoded-video.png") });
    await info.attach("gpu-frames", {
      body: JSON.stringify(
        await page.evaluate(() => (window as any).gpuEvents),
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await info.attach("native-gpu-log", {
      body: logs,
      contentType: "text/plain",
    });
    await app.close();
  }
});

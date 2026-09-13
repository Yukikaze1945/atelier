import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const run = promisify(execFile);

test("MKV drag uses full duration and timeline video really plays, pauses and seeks", async () => {
  test.skip(
    !existsSync(
      path.join(root, "native/build/Release/workstation-media-worker.exe"),
    ),
    "Requires media discovery runtime.",
  );
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "workstation-playback-"),
  );
  let source = process.env.WORKSTATION_TEST_MEDIA;
  if (!source) {
    source = path.join(directory, "九秒测试视频.mkv");
    await run(
      path.join(root, ".deps/gstreamer/bin/gst-launch-1.0.exe"),
      [
        "-q",
        "videotestsrc",
        "num-buffers=270",
        "pattern=ball",
        "!",
        "video/x-raw,format=I420,width=640,height=360,framerate=30/1",
        "!",
        "x264enc",
        "tune=zerolatency",
        "speed-preset=ultrafast",
        "!",
        "h264parse",
        "!",
        "matroskamux",
        "!",
        "filesink",
        `location="${source.replaceAll("\\", "/")}"`,
      ],
      { windowsHide: true, timeout: 30000 },
    );
  }
  const env = {
    ...process.env,
    WORKSTATION_DATA_DIR: path.join(directory, "state"),
    WORKSTATION_TEST: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root], cwd: root, env });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const inspected = await page.evaluate(
      (uri) => window.workstation.request<any>("media.inspect", { uri }),
      pathToFileURL(source).href,
    );
    expect(inspected.duration).toBeGreaterThan(8);
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByLabel("项目名称", { exact: true }).fill("视频播放验收");
    await page.getByLabel("项目保存位置", { exact: true }).fill(directory);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [file],
      })) as typeof dialog.showOpenDialog;
    }, source);
    await page.getByRole("button", { name: "导入素材", exact: true }).click();
    await expect(page.locator(".asset-card")).toHaveCount(1);
    const snapshot = () =>
      page.evaluate(async () => {
        const list = await window.workstation.request<any[]>("project.list");
        return window.workstation.request<any>("project.get", {
          projectId: list[0].id,
        });
      });
    let project = await snapshot();
    expect(project.assets[0].metadata.duration).toBeCloseTo(
      inspected.duration,
      2,
    );
    await page
      .getByRole("navigation", { name: "项目页面条" })
      .getByRole("button", { name: "剪辑", exact: true })
      .click();
    await page.locator(".edit-asset-name").click();
    const sourceVideo = page.locator(".source-monitor video");
    await expect(sourceVideo).toBeVisible();
    await expect
      .poll(() => sourceVideo.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(2);
    const canvas = page.getByTestId("timeline-canvas");
    await page.locator(".edit-asset").dragTo(canvas, {
      sourcePosition: { x: 24, y: 22 },
      targetPosition: { x: 278, y: 140 },
    });
    await expect
      .poll(async () => (await snapshot()).timeline.clips.length)
      .toBe(1);
    project = await snapshot();
    let clip = project.timeline.clips[0];
    const start = clip.startTicks / project.timeline.timebase;
    expect(start).toBeGreaterThan(1);
    expect(clip.durationTicks / project.timeline.timebase).toBeCloseTo(
      inspected.duration,
      2,
    );
    const video = page.getByTestId("timeline-video");
    await expect(video).toBeVisible();
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(2);
    await video.evaluate((v: HTMLVideoElement) => {
      v.muted = true;
    });
    const before = await video.evaluate(
      (v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames,
    );
    await page.getByRole("button", { name: "播放时间线", exact: true }).click();
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(0.75);
    await expect
      .poll(() =>
        video.evaluate(
          (v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames,
        ),
      )
      .toBeGreaterThan(before + 3);
    await page.getByRole("button", { name: "暂停时间线", exact: true }).click();
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
      .toBe(true);
    const paused = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    await expect(video).toHaveJSProperty("paused", true);
    expect(
      await video.evaluate((v: HTMLVideoElement) => v.currentTime),
    ).toBeCloseTo(paused, 1);
    await canvas.click({ position: { x: 148 + (start + 3) * 65, y: 15 } });
    await expect
      .poll(() =>
        video.evaluate((v: HTMLVideoElement) => Math.abs(v.currentTime - 3)),
      )
      .toBeLessThan(0.15);
    await expect
      .poll(() =>
        video.evaluate(
          (v: HTMLVideoElement) => !v.seeking && v.readyState >= 2,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        video.evaluate((v: HTMLVideoElement) =>
          v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0,
        ),
      )
      .toBeGreaterThan(inspected.duration - 0.1);
    // Existing five-second clips are repaired only by an explicit undoable action.
    await canvas.click({ position: { x: 278, y: 140 } });
    expect(
      await video.evaluate((v: HTMLVideoElement) => v.currentTime),
    ).toBeCloseTo(3, 1);
    await page.getByLabel("持续时间", { exact: true }).fill("5");
    await page.getByLabel("时间线起点", { exact: true }).click();
    await expect
      .poll(async () => (await snapshot()).timeline.clips[0].durationTicks)
      .toBe(1200000);
    await page
      .getByRole("button", { name: "恢复完整源时长", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await snapshot()).timeline.clips[0].durationTicks /
          project.timeline.timebase,
      )
      .toBeCloseTo(inspected.duration, 2);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect
      .poll(async () => (await snapshot()).timeline.clips[0].durationTicks)
      .toBe(1200000);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

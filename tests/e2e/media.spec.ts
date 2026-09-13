import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { CoreClient } from "../../electron/core-client.mjs";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const run = promisify(execFile);
test("native GES exports actual configured media, reports errors and cancels without damaging outputs", async () => {
  test.skip(
    !existsSync(
      path.join(root, "native/build/Release/workstation-media-worker.exe"),
    ),
    "Build the optional native GES worker first.",
  );
  const directory = await mkdtemp(path.join(os.tmpdir(), "workstation-ges-"));
  const client = new CoreClient({ dataDir: path.join(directory, "state") });
  try {
    const capabilities = await client.request("media.capabilities");
    expect(capabilities.renderAvailable).toBe(true);
    // Generate deterministic real source material with GStreamer, not through a mocked worker.
    const source = path.join(directory, "源视频 test.webm");
    await run(
      path.join(root, ".deps/gstreamer/bin/gst-launch-1.0.exe"),
      [
        "-q",
        "videotestsrc",
        "num-buffers=30",
        "pattern=smpte",
        "!",
        "video/x-raw,width=320,height=180,framerate=30/1",
        "!",
        "vp8enc",
        "deadline=1",
        "!",
        "webmmux",
        "!",
        "filesink",
        `location="${source.replaceAll("\\", "/")}"`,
      ],
      { windowsHide: true, timeout: 30000 },
    );
    let project = await client.request("project.create", {
      name: "GES 验证",
      parentDirectory: directory,
      timelineSettings: {
        width: 640,
        height: 360,
        frameRate: { numerator: 30000, denominator: 1001 },
      },
    });
    const uri = pathToFileURL(source).href;
    const inspected = await client.request("media.inspect", { uri });
    expect(inspected.streams.some((s: any) => s.width === 320)).toBe(true);
    project = await client.request("asset.import", {
      projectId: project.id,
      expectedRevision: project.revision,
      mode: "link",
      files: [{ path: source, metadata: { duration: inspected.duration } }],
    });
    project = await client.request("project.command", {
      projectId: project.id,
      expectedRevision: project.revision,
      command: {
        type: "timeline.add",
        assetId: project.assets[0].id,
        trackId: "v1",
        durationTicks: 120000,
      },
    });
    project = await client.request("project.command", {
      projectId: project.id,
      expectedRevision: project.revision,
      command: {
        type: "timeline.add",
        assetId: project.assets[0].id,
        trackId: "v2",
        durationTicks: 120000,
      },
    });
    const output = path.join(directory, "输出 成片.mp4");
    const task = await client.request("media.export", {
      projectId: project.id,
      expectedRevision: project.revision,
      outputPath: output,
      profile: "mp4-h264",
    });
    let job: any;
    await expect
      .poll(
        async () => {
          job = (
            await client.request("media.jobs", { projectId: project.id })
          ).find((j: any) => j.id === task.id);
          return ["completed", "failed", "cancelled"].includes(job.status);
        },
        { timeout: 60000, intervals: [250, 500] },
      )
      .toBe(true);
    if (job.status !== "completed")
      throw new Error(`${job.error}\n${await readFile(job.logPath, "utf8")}`);
    expect(job.pipelineAudit.snapshotComplete).toBe(true);
    expect(job.pipelineAudit.usesSystemMemoryCompositor).toBe(true);
    expect(
      job.pipelineAudit.elements.some(
        (element: any) =>
          element.compositor && element.factory === "compositor",
      ),
    ).toBe(true);
    console.log(
      "GES composition audit:",
      JSON.stringify(
        job.pipelineAudit.elements.filter((element: any) => element.compositor),
      ),
    );
    const result = await client.request("media.inspect", {
      uri: pathToFileURL(output).href,
    });
    const video = result.streams.find((s: any) => s.type === "video");
    expect(video.width).toBe(640);
    expect(video.height).toBe(360);
    expect(video.frameRate).toEqual({ numerator: 30000, denominator: 1001 });
    expect(result.duration).toBeGreaterThan(0.4);
    expect(result.duration).toBeLessThan(0.65);
    await expect(
      client.request("media.export", {
        projectId: project.id,
        expectedRevision: project.revision,
        outputPath: output,
        profile: "mp4-h264",
      }),
    ).rejects.toThrow("已存在");
    const cancelled = await client.request("media.export", {
      projectId: project.id,
      expectedRevision: project.revision,
      outputPath: path.join(directory, "取消.mp4"),
      profile: "mp4-h264",
    });
    await client.request("media.cancel", { jobId: cancelled.id });
    await expect
      .poll(
        async () =>
          (await client.request("media.jobs", { projectId: project.id })).find(
            (j: any) => j.id === cancelled.id,
          ).status,
        { timeout: 20000 },
      )
      .toBe("cancelled");
    expect(existsSync(path.join(directory, "取消.mp4"))).toBe(false);
    expect((await readFile(output)).length).toBeGreaterThan(100);
    expect(
      (await client.request("project.get", { projectId: project.id })).revision,
    ).toBe(project.revision);
  } finally {
    client.close();
  }
});

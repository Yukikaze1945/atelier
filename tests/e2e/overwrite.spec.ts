import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("same-track drag overwrites, selection leaves playhead, upper tracks remain layers", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "workstation-overwrite-"),
  );
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
    const files: string[] = [];
    for (const color of ["red", "blue"]) {
      const png = await page.evaluate((color) => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 320, 180);
        return canvas.toDataURL();
      }, color);
      const file = path.join(directory, `${color}.png`);
      await writeFile(file, Buffer.from(png.split(",")[1], "base64"));
      files.push(file);
    }
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByLabel("项目名称", { exact: true }).fill("覆盖剪辑验收");
    await page.getByLabel("项目保存位置", { exact: true }).fill(directory);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: files,
      })) as typeof dialog.showOpenDialog;
    }, files);
    await page.getByRole("button", { name: "导入素材", exact: true }).click();
    await expect(page.locator(".asset-card")).toHaveCount(2);
    const snapshot = () =>
      page.evaluate(async () => {
        const list = await window.workstation.request<any[]>("project.list");
        return window.workstation.request<any>("project.get", {
          projectId: list[0].id,
        });
      });
    await page
      .getByRole("navigation", { name: "项目页面条" })
      .getByRole("button", { name: "剪辑", exact: true })
      .click();
    const canvas = page.getByTestId("timeline-canvas");
    const drag = (name: string, seconds: number, y = 140) =>
      page
        .locator(".edit-asset")
        .filter({ hasText: name })
        .dragTo(canvas, {
          sourcePosition: { x: 24, y: 22 },
          targetPosition: { x: 148 + seconds * 65, y },
        });
    await drag("red.png", 0);
    await expect(page.getByLabel("持续时间", { exact: true })).toBeVisible();
    await page.getByLabel("持续时间", { exact: true }).fill("12");
    await page.getByLabel("时间线起点", { exact: true }).click();
    await expect
      .poll(async () => (await snapshot()).timeline.clips[0].durationTicks)
      .toBe(12 * 240000);
    await drag("blue.png", 3);
    await expect
      .poll(async () => (await snapshot()).timeline.clips.length)
      .toBe(3);
    const state = await snapshot();
    const red = state.assets.find((a: any) => a.name === "red.png").id;
    expect(
      state.timeline.clips
        .filter((c: any) => c.assetId === red)
        .map((c: any) => [
          c.startTicks / 240000,
          c.durationTicks / 240000,
          c.inTicks / 240000,
        ]),
    ).toEqual([
      [0, 3, 0],
      [8, 4, 8],
    ]);
    const monitor = page.locator(".timeline-screen");
    await expect(monitor.getByAltText("blue.png")).toBeVisible();
    // Scrub to the tail, then select blue: selection must not change what is displayed.
    await canvas.click({ position: { x: 148 + 9 * 65, y: 15 } });
    await expect(monitor.getByAltText("red.png")).toBeVisible();
    await canvas.click({ position: { x: 148 + 4 * 65, y: 140 } });
    await expect(monitor.getByAltText("red.png")).toBeVisible();
    // Playback must change from red to blue at the actual overwrite boundary.
    await canvas.click({ position: { x: 148 + 2.8 * 65, y: 15 } });
    await page.getByRole("button", { name: "播放时间线", exact: true }).click();
    await expect(monitor.getByAltText("blue.png")).toBeVisible();
    await page.getByRole("button", { name: "暂停时间线", exact: true }).click();
    await canvas.click({ position: { x: 148 + 4 * 65, y: 140 } });
    await page
      .getByRole("button", { name: "移除片段并归档", exact: true })
      .click();
    await expect(monitor.getByText("空白区间", { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await snapshot()).timeline.clips.length)
      .toBe(2);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(monitor.getByAltText("blue.png")).toBeVisible();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect
      .poll(async () => (await snapshot()).timeline.clips.length)
      .toBe(1);
    // Different tracks are intentionally non-destructive layers.
    await drag("blue.png", 3, 65);
    await expect
      .poll(async () => (await snapshot()).timeline.clips.length)
      .toBe(2);
    await expect(monitor.getByAltText("blue.png")).toBeVisible();
    await page
      .getByRole("button", { name: "移除片段并归档", exact: true })
      .click();
    await expect(monitor.getByAltText("red.png")).toBeVisible();
  } finally {
    await app.close();
  }
});

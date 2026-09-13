import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
test("neutral project manager and dual monitors match the reference layout", async ({}, info) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "workstation-appearance-"),
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
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (let i = 1; i <= 6; i++) {
      const uri = await page.evaluate((index) => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d")!;
        const skies = [
          "#b2c8dc",
          "#a0bfca",
          "#b8b0c6",
          "#d0bd9f",
          "#a5bbc3",
          "#b5cdd5",
        ];
        const ground = [
          "#687663",
          "#527d72",
          "#655c73",
          "#93846c",
          "#566c7d",
          "#7f926d",
        ];
        ctx.fillStyle = skies[index - 1];
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = ground[index - 1];
        ctx.beginPath();
        ctx.moveTo(0, 220);
        ctx.lineTo(200, 125 + index * 10);
        ctx.lineTo(370, 245);
        ctx.lineTo(520, 175);
        ctx.lineTo(640, 220);
        ctx.lineTo(640, 360);
        ctx.lineTo(0, 360);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "18px sans-serif";
        ctx.fillText(`UI TEST FRAME 0${index}`, 28, 325);
        return canvas.toDataURL("image/png");
      }, i);
      const file = path.join(directory, `测试画面 0${i}.png`);
      await writeFile(file, Buffer.from(uri.split(",")[1], "base64"));
      await page.evaluate(
        async ({ directory, file, index }) => {
          let project = await window.workstation.request<any>(
            "project.create",
            { name: `界面验收 0${index}`, parentDirectory: directory },
          );
          project = await window.workstation.request<any>("asset.import", {
            projectId: project.id,
            expectedRevision: project.revision,
            mode: "link",
            files: [{ path: file }],
          });
          await window.workstation.request("project.command", {
            projectId: project.id,
            expectedRevision: project.revision,
            command: {
              type: "timeline.add",
              assetId: project.assets[0].id,
              trackId: "v1",
              durationTicks: 2400000,
            },
          });
        },
        { directory, file, index: i },
      );
    }
    const samples = 48000 * 8;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48000, 24);
    wav.writeUInt32LE(96000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(samples * 2, 40);
    const audioFile = path.join(directory, "界面验收音轨.wav");
    await writeFile(audioFile, wav);
    await page.evaluate(async (audioFile) => {
      const list = await window.workstation.request<any[]>("project.list");
      let project = await window.workstation.request<any>("project.get", {
        projectId: list.find((p) => p.name === "界面验收 06").id,
      });
      project = await window.workstation.request<any>("asset.import", {
        projectId: project.id,
        expectedRevision: project.revision,
        mode: "link",
        files: [{ path: audioFile, metadata: { duration: 8 } }],
      });
      await window.workstation.request("project.command", {
        projectId: project.id,
        expectedRevision: project.revision,
        command: {
          type: "timeline.add",
          assetId: project.assets.find((a: any) => a.mediaType === "audio").id,
          trackId: "a1",
          startTicks: 480000,
          durationTicks: 1920000,
        },
      });
    }, audioFile);
    await page.reload();
    await expect(page.locator(".project-card")).toHaveCount(6);
    await expect(page.locator(".project-art img")).toHaveCount(6);
    await expect
      .poll(() =>
        page
          .locator(".project-art img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await expect(page.locator(".center-shell")).toHaveCSS(
      "background-color",
      "rgb(32, 32, 36)",
    );
    await expect(page.locator(".center-header")).toHaveCSS("height", "52px");
    const selected = page
      .locator(".project-card")
      .filter({ hasText: "界面验收 06" });
    await selected.click();
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("navigation", { name: "项目页面条" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("reference-project-center.png"),
    });
    await page.getByRole("button", { name: "列表视图", exact: true }).click();
    await expect(page.locator(".project-list")).toBeVisible();
    await page.screenshot({
      path: info.outputPath("reference-project-list.png"),
    });
    await page.getByRole("button", { name: "打开", exact: true }).click();
    await page
      .getByRole("navigation", { name: "项目页面条" })
      .getByRole("button", { name: "剪辑", exact: true })
      .click();
    await expect(page.getByRole("region", { name: "源监看器" })).toBeVisible();
    await page
      .getByRole("button", { name: "测试画面 06.png", exact: true })
      .click();
    await expect(page.locator(".source-monitor img")).toBeVisible();
    await page.screenshot({
      path: info.outputPath("reference-edit-panels.png"),
    });
    await page.getByRole("button", { name: "媒体池", exact: true }).click();
    await page.getByRole("button", { name: "检查器", exact: true }).click();
    await expect(page.locator(".edit-bin")).toHaveCount(0);
    await expect(page.locator(".clip-inspector")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("reference-edit-dual.png") });
    await page.getByRole("button", { name: "双监看器", exact: true }).click();
    await expect(page.locator(".source-monitor")).toHaveCount(0);
    await page.getByRole("button", { name: "双监看器", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1100, 800),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: info.outputPath("reference-edit-compact.png"),
    });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
async function launch(dataDirectory: string) {
  const env = {
    ...process.env,
    WORKSTATION_DATA_DIR: dataDirectory,
    WORKSTATION_TEST: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root], cwd: root, env });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const p = await window.workstation.request<any[]>("project.list");
    return window.workstation.request<any>("project.get", {
      projectId: p[0].id,
    });
  });
}

test("desktop: projects, plugins, media, timeline, graph, templates and reopening", async ({}, info) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "workstation-e2e-"));
  const dataDirectory = path.join(temp, "state");
  const { app, page } = await launch(dataDirectory);
  let reopened: ElectronApplication | undefined;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await expect(
      page.getByRole("heading", { name: "项目", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("01-project-center.png") });
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByLabel("项目名称", { exact: true }).fill("桌面验收项目");
    await page.getByLabel("项目保存位置", { exact: true }).fill(temp);
    await page.getByText("高级选项", { exact: true }).first().click();
    await page.getByLabel("默认导入方式").selectOption("copy");
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await expect(
      page.getByRole("navigation", { name: "项目页面条" }),
    ).toBeVisible();
    let state = await snapshot(page);
    expect(state.workspace.pages.map((p: any) => p.definition.id)).toEqual([
      "media",
      "edit",
      "export",
    ]);
    expect(state.workspace.pages[0].config.importMode).toBe("copy");

    // A real small PNG file is supplied through the native picker.
    const mediaFile = path.join(temp, "测试 镜头.png");
    await writeFile(
      mediaFile,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await app.evaluate(({ dialog }, mediaFile) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [mediaFile],
      })) as typeof dialog.showOpenDialog;
    }, mediaFile);
    await page.getByRole("button", { name: "导入素材", exact: true }).click();
    await expect(page.locator(".asset-card")).toHaveCount(1);
    await page.locator(".asset-card").click();
    await expect(page.locator(".source-image")).toBeVisible();
    await expect
      .poll(async () =>
        page
          .locator(".source-image")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(1);
    await page.screenshot({ path: info.outputPath("02-media-page.png") });
    await page
      .getByRole("button", { name: "添加到时间线", exact: true })
      .click();
    await expect(page.getByTestId("timeline-canvas")).toBeVisible();
    await expect
      .poll(async () => (await snapshot(page)).timeline.clips.length)
      .toBe(1);
    const canvas = page.getByTestId("timeline-canvas");
    await canvas.click({ position: { x: 160, y: 140 } });
    await expect(page.getByLabel("持续时间", { exact: true })).toBeVisible();
    await page.getByLabel("持续时间", { exact: true }).fill("8");
    await page.getByLabel("时间线起点", { exact: true }).click();
    await expect
      .poll(async () => (await snapshot(page)).timeline.clips[0].durationTicks)
      .toBe(8 * 240000);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect
      .poll(async () => (await snapshot(page)).timeline.clips[0].durationTicks)
      .toBe(5 * 240000);
    await page
      .getByRole("button", { name: "时间线视频设置", exact: true })
      .click();
    await page.getByLabel("视频预设", { exact: true }).selectOption("uhd-5994");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect
      .poll(async () => (await snapshot(page)).timeline.width)
      .toBe(3840);
    expect((await snapshot(page)).timeline.frameRate).toEqual({
      numerator: 60000,
      denominator: 1001,
    });
    expect((await snapshot(page)).timeline.clips[0].durationTicks).toBe(
      5 * 240000,
    );
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect
      .poll(async () => (await snapshot(page)).timeline.width)
      .toBe(1920);
    await page.screenshot({ path: info.outputPath("03-edit-page.png") });

    await page.getByRole("button", { name: "页面节点", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "页面节点画布" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "展开素材节点", exact: true })
      .click();
    await expect(
      page.getByTestId("page-node-media").getByLabel("默认导入方式"),
    ).toHaveValue("copy");
    await page.screenshot({ path: info.outputPath("04a-expanded-graph.png") });
    const preview = page.getByRole("button", {
      name: "预览素材页面",
      exact: true,
    });
    await preview.hover();
    await expect(
      page.getByRole("region", { name: "插件页面预览" }),
    ).toBeVisible();
    await preview.click();
    await page.getByRole("button", { name: "保存为模板", exact: true }).hover();
    await expect(page.getByText("已固定", { exact: true })).toBeVisible();
    await preview.click();
    await expect(
      page.getByRole("region", { name: "插件页面预览" }),
    ).toHaveCount(0);
    await page.getByTestId("page-node-media").click({ button: "right" });
    await page.getByRole("menuitem", { name: "替换节点", exact: true }).click();
    await expect(
      page.getByRole("tab", { name: "同类型节点", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "同插件包节点", exact: true }).click();
    await page
      .locator(".picker-list")
      .getByRole("button")
      .filter({ hasText: "导出" })
      .click();
    await page.getByRole("button", { name: "确认替换", exact: true }).click();
    await expect
      .poll(async () => (await snapshot(page)).workspace.pages[0].definition.id)
      .toBe("export");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect
      .poll(async () => (await snapshot(page)).workspace.pages[0].definition.id)
      .toBe("media");
    await page.getByRole("button", { name: "信息连接", exact: true }).click();
    await page.screenshot({ path: info.outputPath("04-node-graph.png") });
    await page.getByRole("button", { name: "保存为模板", exact: true }).click();
    await page.getByLabel("模板名称").fill("桌面验收组合");
    await page.getByRole("button", { name: "保存模板", exact: true }).click();
    await page
      .getByRole("button", { name: "收起节点画布", exact: true })
      .click();
    await page
      .getByRole("button", { name: "返回项目中心", exact: true })
      .click();
    await page.getByRole("button", { name: "工作流模板", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "桌面验收组合", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "插件市场", exact: true }).click();
    const pluginDir = path.join(root, "examples", "plugins", "reference-board");
    await app.evaluate(({ dialog }, pluginDir) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [pluginDir],
      })) as typeof dialog.showOpenDialog;
    }, pluginDir);
    await page
      .getByRole("button", { name: "从本地安装插件", exact: true })
      .click();
    await page.getByRole("button", { name: "继续安装", exact: true }).click();
    await page.getByRole("tab", { name: /已安装/ }).click();
    await expect(
      page.getByRole("heading", { name: "参考素材板", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "本地项目", exact: true }).click();
    await page
      .locator(".project-card")
      .filter({ hasText: "桌面验收项目" })
      .dblclick();
    await page.getByRole("button", { name: "页面节点", exact: true }).click();
    await page
      .getByRole("button", { name: "替换素材节点", exact: true })
      .click();
    await page
      .locator(".picker-list")
      .getByRole("button")
      .filter({ hasText: "参考素材板" })
      .click();
    await page.getByRole("button", { name: "确认替换", exact: true }).click();
    await page
      .getByRole("button", { name: "收起节点画布", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "项目页面条" })
      .getByRole("button", { name: "参考素材板", exact: true })
      .click();
    const plugin = page.frameLocator('iframe[title="参考素材板"]');
    await expect(
      plugin.getByRole("heading", { name: "我的参考素材", exact: true }),
    ).toBeVisible();
    await expect(
      plugin.getByRole("heading", { name: "测试 镜头.png", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("05-third-party-page.png") });
    state = await snapshot(page);
    expect(state.timeline.clips.length).toBe(1);
    expect(state.assets.length).toBe(1);
    await app.close();
    const again = await launch(dataDirectory);
    reopened = again.app;
    await again.page
      .locator(".project-card")
      .filter({ hasText: "桌面验收项目" })
      .dblclick();
    await expect(
      again.page
        .frameLocator("iframe")
        .getByRole("heading", { name: "我的参考素材" }),
    ).toBeVisible();
    const loaded = await snapshot(again.page);
    expect(loaded.assets[0].id).toBe(state.assets[0].id);
    expect(loaded.timeline.clips[0].id).toBe(state.timeline.clips[0].id);
    expect(loaded.canUndo).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await reopened?.close().catch(() => {});
    await app.close().catch(() => {});
  }
});

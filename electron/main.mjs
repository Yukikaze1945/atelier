import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} from "electron";
import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { CoreClient, root, stateDirectory } from "./core-client.mjs";
import { GpuPreview } from "./gpu-preview.mjs";
import { mediaResponse } from "./media-response.mjs";
import { timelineWaveform, stopWaveforms } from "./waveform.mjs";

const run = promisify(execFile);
const mutating = new Set([
  "project.command",
  "project.undo",
  "project.redo",
  "asset.import",
  "asset.inspect",
  "plugin.install",
  "plugin.enable",
  "plugin.uninstall",
  "template.save",
  "project.create",
]);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "workstation-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    scheme: "workstation-plugin",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setName("AI 工作站");
if (process.env.WORKSTATION_DATA_DIR)
  app.setPath("userData", path.join(stateDirectory(), "electron"));
let core;
let mainWindow;
let gpuPreview;

async function pluginFile(requestUrl) {
  const url = new URL(requestUrl);
  const plugins = await core.request("plugin.list");
  const plugin = plugins.find(
    (p) => p.manifest.id === url.hostname && p.enabled && p.directory,
  );
  if (!plugin) throw new Error("插件不可用");
  const file = path.resolve(
    plugin.directory,
    `.${decodeURIComponent(url.pathname)}`,
  );
  const relative = path.relative(plugin.directory, file);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("无效插件资源路径");
  return file;
}

async function hostRequest(method, params) {
  if (method === "media.waveform") {
    const project = await core.request("project.get", {
      projectId: params.projectId,
    });
    if (
      params.expectedRevision !== undefined &&
      params.expectedRevision !== project.revision
    )
      throw Error("工程已改变，请重新获取波形");
    return timelineWaveform(project, root, stateDirectory());
  }
  if (method === "media.gpu.stop") return gpuPreview?.stop();
  if (method === "media.gpu.start") {
    if (params.testPattern === true) return gpuPreview.start("--pattern");
    const project = await core.request("project.get", {
      projectId: params.projectId,
    });
    const asset = project.assets.find(
      (a) => a.id === params.assetId && a.mediaType === "video",
    );
    if (!asset) throw new Error("请选择视频素材");
    const uri = asset.projectPath
      ? pathToFileURL(path.join(project.directory, asset.projectPath)).href
      : asset.sourceUri;
    return gpuPreview.start(uri);
  }
  if (method === "dialog.export") {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "保存导出视频",
      defaultPath: params.defaultPath || "export.mp4",
      filters: [
        {
          name: "视频",
          extensions: params.profile === "webm-vp8" ? ["webm"] : ["mp4"],
        },
      ],
    });
    return result.canceled ? null : result.filePath;
  }
  if (method === "dialog.directory") {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: params.title || "选择文件夹",
      defaultPath: params.defaultPath,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  }
  if (method === "dialog.files") {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择素材",
      properties: ["openFile", "multiSelections"],
    });
    return result.canceled ? [] : result.filePaths;
  }
  if (method === "files.roots") {
    if (process.platform !== "win32")
      return [
        { name: "主目录", path: os.homedir() },
        { name: "文件系统", path: "/" },
      ];
    const drives = await Promise.all(
      Array.from(
        { length: 26 },
        (_, i) => `${String.fromCharCode(65 + i)}:\\`,
      ).map(async (drive) => {
        try {
          await access(drive, constants.R_OK);
          return { name: drive, path: drive };
        } catch {
          return null;
        }
      }),
    );
    return drives.filter(Boolean);
  }
  if (method === "files.browse") {
    const directory = path.resolve(params.directory || os.homedir());
    const entries = await readdir(directory, { withFileTypes: true });
    const visible = entries
      .filter((e) => !e.name.startsWith("."))
      .sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name),
      );
    return {
      directory,
      parent: path.dirname(directory),
      truncated: visible.length > 2000,
      entries: visible.slice(0, 2000).map((e) => ({
        name: e.name,
        path: path.join(directory, e.name),
        directory: e.isDirectory(),
        size: 0,
      })),
    };
  }
  if (method === "files.defaultDirectory") return app.getPath("documents");
  if (method === "files.previewUrl") {
    const file = path.resolve(params.path);
    if (!(await stat(file)).isFile()) throw new Error("不是可预览的文件");
    return `workstation-media://local/?uri=${encodeURIComponent(pathToFileURL(file).href)}`;
  }
  if (method === "asset.previewUrl") {
    const project = await core.request("project.get", {
      projectId: params.projectId,
    });
    const asset = project.assets.find((a) => a.id === params.assetId);
    if (!asset) throw new Error("素材不存在");
    const uri = asset.projectPath
      ? pathToFileURL(path.join(project.directory, asset.projectPath)).href
      : asset.sourceUri;
    return `workstation-media://local/?uri=${encodeURIComponent(uri)}`;
  }
  if (method === "system.resources") {
    try {
      const { stdout } = await run(
        "nvidia-smi",
        [
          "--query-gpu=name,memory.used,memory.total",
          "--format=csv,noheader,nounits",
        ],
        { windowsHide: true, timeout: 3500 },
      );
      return {
        available: true,
        devices: stdout
          .trim()
          .split(/\r?\n/)
          .map((line) => {
            const parts = line.split(",").map((s) => s.trim());
            return {
              name: parts[0],
              used: Number(parts[1]),
              total: Number(parts[2]),
            };
          }),
      };
    } catch {
      return {
        available: false,
        devices: [],
        reason: "当前设备没有可用的显存监测接口",
      };
    }
  }
  if (method === "shell.openExternal") {
    const url = new URL(params.url);
    if (!["https:", "http:"].includes(url.protocol))
      throw new Error("仅支持网页链接");
    await shell.openExternal(url.href);
    return true;
  }
  if (method === "shell.showProject") {
    const project = await core.request("project.get", {
      projectId: params.projectId,
    });
    shell.showItemInFolder(path.join(project.directory, "project.sqlite"));
    return true;
  }
  const result = await core.request(method, params);
  if (mutating.has(method)) mainWindow?.webContents.send("host:changed");
  return result;
}

async function start() {
  await app.whenReady();
  core = new CoreClient();
  const availablePlugins = await core.request("plugin.list");
  const moy = availablePlugins.find(
    (p) => p.manifest.id === "org.workstation.moy-subtitles",
  );
  if (
    !moy ||
    !moy.manifest.pages.some((p) =>
      p.ports.some((port) => port.id === "assets"),
    )
  )
    await core.request("plugin.install", {
      directory: path.join(root, "plugins", "moy-subtitles"),
    });
  if (moy && !moy.enabled)
    await core.request("plugin.enable", {
      pluginId: moy.manifest.id,
      enabled: false,
    });
  protocol.handle("workstation-media", async (request) => {
    try {
      return await mediaResponse(request);
    } catch {
      return new Response("Media unavailable", { status: 404 });
    }
  });
  protocol.handle("workstation-plugin", async (request) => {
    try {
      return await net.fetch(pathToFileURL(await pluginFile(request.url)).href);
    } catch {
      return new Response("Plugin resource unavailable", { status: 404 });
    }
  });
  ipcMain.handle("host:request", (_event, { method, params = {} }) =>
    hostRequest(method, params),
  );
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 960,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: "#202024",
    title: "AI 工作站",
    show: process.env.WORKSTATION_TEST !== "1",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#171719", symbolColor: "#aaaaaf", height: 30 },
    webPreferences: {
      preload: path.join(root, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  gpuPreview = new GpuPreview(mainWindow);
  ipcMain.on("host:gpu-presented", (_event, data) => {
    if (!mainWindow.isDestroyed())
      mainWindow.webContents.send("host:gpu-status", {
        ...data,
        event: "presented",
      });
  });
  if (process.env.WORKSTATION_DEV_URL)
    await mainWindow.loadURL(process.env.WORKSTATION_DEV_URL);
  else await mainWindow.loadFile(path.join(root, "dist", "index.html"));
  app.on("before-quit", () => {
    stopWaveforms();
    gpuPreview.stop();
    core.close();
  });
  app.on("window-all-closed", () => app.quit());
}

void start().catch((error) => {
  console.error(error);
  app.exit(1);
});

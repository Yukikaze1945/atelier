import { test, expect } from "@playwright/test";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("normal startup creates a natively visible Windows window through the start script", async ({}, info) => {
  test.skip(
    process.platform !== "win32",
    "Uses Windows native visibility, not renderer visibility.",
  );
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "workstation-visible-start-"),
  );
  const env = { ...process.env, WORKSTATION_DATA_DIR: directory };
  delete env.WORKSTATION_TEST;
  delete env.WORKSTATION_DEV_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  // Hide only this console launcher. The GUI child must explicitly opt out of windowsHide.
  const launcher = spawn(
    process.execPath,
    [path.join(root, "scripts/start.mjs")],
    {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let logs = "";
  launcher.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  launcher.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });
  let windows: {
    processId: number;
    title: string;
    visible: boolean;
    minimized: boolean;
    width: number;
    height: number;
  }[] = [];
  try {
    await expect
      .poll(
        async () => {
          const { stdout } = await run(
            "powershell.exe",
            [
              "-NoProfile",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              path.join(root, "tests/e2e/window-state.ps1"),
              "-ParentProcessId",
              String(launcher.pid),
            ],
            { windowsHide: true, timeout: 10_000 },
          );
          windows = JSON.parse(stdout);
          return windows.some(
            (window) =>
              window.title === "AI 工作站" &&
              window.visible &&
              !window.minimized &&
              window.width > 0 &&
              window.height > 0,
          );
        },
        { timeout: 15_000, intervals: [500, 1000] },
      )
      .toBe(true);
  } finally {
    console.log('Native startup windows:', JSON.stringify(windows));
    await info.attach("native-windows", {
      body: JSON.stringify(windows, null, 2),
      contentType: "application/json",
    });
    await info.attach("launcher-log", {
      body: logs,
      contentType: "text/plain",
    });
    if (launcher.pid && launcher.exitCode === null) {
      await run("taskkill", ["/PID", String(launcher.pid), "/T", "/F"], {
        windowsHide: true,
      }).catch(() => {});
    }
  }
});

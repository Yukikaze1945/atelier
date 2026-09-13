import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import electron from "electron";
import { root } from "../electron/core-client.mjs";

try {
  await access(path.join(root, "dist", "index.html"));
  await access(
    path.join(
      root,
      "target",
      "debug",
      `workstation-core${process.platform === "win32" ? ".exe" : ""}`,
    ),
  );
} catch {
  console.error("请先在项目目录执行 npm run build。");
  process.exit(1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [root], {
  cwd: root,
  env,
  stdio: "inherit",
  // Electron is a GUI process. SW_HIDE here also hides its first BrowserWindow on Windows.
  windowsHide: false,
});
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => process.exit(code || 0));
process.on("SIGINT", () => child.kill());

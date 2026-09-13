import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";
import { root } from "../electron/core-client.mjs";
const build = spawn("cargo", ["build", "-p", "workstation-core"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
const code = await new Promise((resolve, reject) => {
  build.on("exit", resolve);
  build.on("error", reject);
});
if (code !== 0) process.exit(code || 1);
const server = await createServer();
await server.listen();
const childEnv = {
  ...process.env,
  WORKSTATION_DEV_URL: server.resolvedUrls.local[0],
};
delete childEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  cwd: root,
  stdio: "inherit",
  env: childEnv,
  // Hide background workers, not the Electron application's first native window.
  windowsHide: false,
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
}
child.on("exit", async (code) => {
  await close();
  process.exit(code || 0);
});
process.on("SIGINT", close);
process.on("SIGTERM", close);

import { spawn } from "node:child_process";
import { root } from "../electron/core-client.mjs";
for (const args of [
  ["-S", "native", "-B", "native/build"],
  ["--build", "native/build", "--config", "Release"],
]) {
  const child = spawn("cmake", args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  const code = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  if (code !== 0) process.exit(code || 1);
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { access } from "node:fs/promises";
import { root } from "../electron/core-client.mjs";
const run = promisify(execFile);
const binary =
  process.platform === "win32"
    ? path.join(
        root,
        "native",
        "build",
        "Release",
        "workstation-media-worker.exe",
      )
    : path.join(root, "native", "build", "workstation-media-worker");
try {
  await access(binary);
  const runtime =
    process.env.WORKSTATION_GSTREAMER_ROOT ||
    path.join(root, ".deps/gstreamer");
  const result = await run(binary, ["--probe"], {
    windowsHide: true,
    timeout: 30000,
    env: {
      ...process.env,
      PATH: `${path.join(runtime, "bin")}${path.delimiter}${process.env.PATH || ""}`,
    },
  });
  process.stdout.write(result.stdout);
} catch (error) {
  console.error(
    "Build the optional native probe with: cmake -S native -B native/build && cmake --build native/build --config Release",
  );
  console.error(error.message);
  process.exitCode = 1;
}

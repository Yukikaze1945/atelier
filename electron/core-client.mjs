import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export function stateDirectory() {
  if (process.env.WORKSTATION_DATA_DIR)
    return path.resolve(process.env.WORKSTATION_DATA_DIR);
  const parent =
    process.platform === "win32"
      ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : process.env.XDG_DATA_HOME ||
          path.join(os.homedir(), ".local", "share");
  return path.join(parent, "creative-workstation");
}

export class CoreClient {
  #pending = new Map();
  #nextId = 0;
  #closed = false;
  constructor({
    dataDir = stateDirectory(),
    binary = process.env.WORKSTATION_CORE_BINARY ||
      path.join(
        root,
        "target",
        "debug",
        `workstation-core${process.platform === "win32" ? ".exe" : ""}`,
      ),
  } = {}) {
    this.process = spawn(binary, ["--data-dir", dataDir], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process.stderr.on("data", (data) => process.stderr.write(data));
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        return;
      }
      const request = this.#pending.get(response.id);
      if (!request) return;
      this.#pending.delete(response.id);
      response.error
        ? request.reject(new Error(response.error.message))
        : request.resolve(response.result);
    });
    const fail = (error) => {
      this.#closed = true;
      for (const request of this.#pending.values()) request.reject(error);
      this.#pending.clear();
    };
    this.process.stdin.on("error", fail);
    this.process.on("error", (error) =>
      fail(
        new Error(
          `无法启动 Rust Core：${error.message}。请先运行 npm run build:core。`,
        ),
      ),
    );
    this.process.on("exit", (code) =>
      fail(new Error(`Core 已退出（${code}），请重新打开工作站。`)),
    );
  }
  request(method, params = {}) {
    if (this.#closed) return Promise.reject(new Error("Core 未连接"));
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.process.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        (error) => {
          if (error) {
            this.#pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }
  close() {
    if (!this.process.stdin.destroyed && !this.process.stdin.writableEnded)
      this.process.stdin.end();
  }
}

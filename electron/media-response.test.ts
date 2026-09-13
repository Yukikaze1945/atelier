import { afterAll, expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mediaResponse } from "./media-response.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "media-range-test-"));
const file = path.join(directory, "分段读取.mkv");
await writeFile(file, "0123456789");
const url = `workstation-media://local/?uri=${encodeURIComponent(pathToFileURL(file).href)}`;
afterAll(() => rm(directory, { recursive: true, force: true }));

test("full and HEAD responses expose length and random access", async () => {
  const response = await mediaResponse(new Request(url));
  expect(response.status).toBe(200);
  expect(response.headers.get("accept-ranges")).toBe("bytes");
  expect(response.headers.get("content-length")).toBe("10");
  expect(await response.text()).toBe("0123456789");
  const head = await mediaResponse(new Request(url, { method: "HEAD" }));
  expect(head.headers.get("content-length")).toBe("10");
  expect(await head.text()).toBe("");
});
test.each([
  ["bytes=2-4", "234", "bytes 2-4/10"],
  ["bytes=7-", "789", "bytes 7-9/10"],
  ["bytes=-3", "789", "bytes 7-9/10"],
  ["bytes=8-99", "89", "bytes 8-9/10"],
])("partial response %s", async (range, body, contentRange) => {
  const response = await mediaResponse(
    new Request(url, { headers: { Range: range } }),
  );
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe(contentRange);
  expect(response.headers.get("content-length")).toBe(String(body.length));
  expect(await response.text()).toBe(body);
});
test.each(["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=-", "bytes=0-1,3-4"])(
  "reject unsatisfiable range %s",
  async (range) => {
    const response = await mediaResponse(
      new Request(url, { headers: { Range: range } }),
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  },
);

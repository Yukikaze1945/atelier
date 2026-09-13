import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";

const types = {
  ".mkv": "video/x-matroska",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

// Chromium needs explicit byte-range responses to seek large local media.
// Stream only the requested bytes; never buffer a whole video in Electron.
export async function mediaResponse(request) {
  const uri = new URL(new URL(request.url).searchParams.get("uri"));
  if (uri.protocol !== "file:") return new Response(null, { status: 400 });
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const file = fileURLToPath(uri);
  const info = await stat(file);
  if (!info.isFile()) return new Response(null, { status: 404 });
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type":
      types[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Content-Length": String(info.size),
  };
  let start = 0,
    end = info.size - 1,
    status = 200;
  const range = request.headers.get("range");
  if (range && request.method === "GET") {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
    } else {
      start = Math.max(0, info.size - Number(match[2]));
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= info.size
    )
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    headers["Content-Length"] = String(end - start + 1);
  }
  if (request.method === "HEAD" || info.size === 0)
    return new Response(null, { status, headers });
  const stream = createReadStream(file, { start, end, signal: request.signal });
  return new Response(Readable.toWeb(stream), { status, headers });
}

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  writeFile,
  rename,
  unlink,
  rmdir,
  stat,
} from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const jobs = new Map(),
  children = new Set();
const RATE = 16000,
  PPS = 100,
  DIVISION = RATE / PPS;
export function stopWaveforms() {
  for (const child of children) child.kill();
}
function decode(executable, uri, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-q",
        "uridecodebin",
        `uri=${uri}`,
        "name=source",
        "source.",
        "!",
        "audioconvert",
        "!",
        "audioresample",
        "!",
        "audiorate",
        "!",
        "audio/x-raw,format=F32LE,channels=1,rate=16000,layout=interleaved",
        "!",
        "filesink",
        `location="${file.replaceAll("\\", "/")}"`,
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    children.add(child);
    let stderr = "",
      timedOut = false;
    child.stderr.on("data", (s) => {
      stderr = (stderr + s.toString()).slice(-4000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 600000);
    child.once("error", (e) => {
      clearTimeout(timer);
      children.delete(child);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      code === 0
        ? resolve()
        : reject(
            Error(
              timedOut ? "音频解码超时" : `音频解码失败：${stderr || code}`,
            ),
          );
    });
  });
}
function audibleRanges(t) {
  const enabled = t.clips.filter((c) => !c.disabled),
    solo = t.tracks.some((tr) => tr.kind === "audio" && tr.solo),
    ranges = [];
  const visual = (at) =>
    t.tracks
      .filter((tr) => tr.kind === "video" && !tr.disabled)
      .map((tr) =>
        enabled
          .filter(
            (c) =>
              c.trackId === tr.id &&
              c.startTicks <= at &&
              c.startTicks + c.durationTicks > at,
          )
          .at(-1),
      )
      .find(Boolean);
  for (const c of enabled) {
    const tr = t.tracks.find((tr) => tr.id === c.trackId);
    if (!tr || tr.disabled || tr.muted) continue;
    const start = c.startTicks / t.timebase,
      end = (c.startTicks + c.durationTicks) / t.timebase;
    if (tr.kind === "audio" && (!solo || tr.solo)) {
      ranges.push({ clip: c, start, end });
      continue;
    }
    if (tr.kind !== "video" || solo || c.linkGroup) continue;
    const edges = [
      start,
      end,
      ...enabled
        .flatMap((x) => [
          x.startTicks / t.timebase,
          (x.startTicks + x.durationTicks) / t.timebase,
        ])
        .filter((s) => s > start && s < end),
    ].sort((a, b) => a - b);
    for (let i = 1; i < edges.length; i++)
      if (
        edges[i] > edges[i - 1] &&
        visual(((edges[i] + edges[i - 1]) / 2) * t.timebase)?.id === c.id
      )
        ranges.push({ clip: c, start: edges[i - 1], end: edges[i] });
  }
  return ranges;
}
export async function timelineWaveform(project, root, stateDirectory) {
  const t = project.timeline;
  if (!t) throw Error("没有时间线");
  const duration = Math.max(
    0,
    ...t.clips.map((c) => (c.startTicks + c.durationTicks) / t.timebase),
  );
  if (!duration) throw Error("时间线为空");
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const ranges = audibleRanges(t).filter((r) => {
    const a = assets.get(r.clip.assetId);
    return (
      a &&
      a.mediaType !== "image" &&
      (a.mediaType === "audio" ||
        !Array.isArray(a.metadata?.streams) ||
        a.metadata.streams.some((s) => s.type === "audio"))
    );
  });
  const sources = [];
  for (const id of new Set(ranges.map((r) => r.clip.assetId))) {
    const a = assets.get(id),
      file = a.projectPath
        ? path.resolve(project.directory, a.projectPath)
        : fileURLToPath(a.sourceUri),
      info = await stat(file);
    sources.push({ id, file, size: info.size, mtime: info.mtimeMs });
  }
  const key = createHash("sha256")
    .update(JSON.stringify({ version: 2, timeline: t, sources, rate: RATE }))
    .digest("hex");
  const cache = path.join(stateDirectory, "waveforms");
  await mkdir(cache, { recursive: true });
  const target = path.join(cache, key + ".json");
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
  }
  if (jobs.has(key)) return jobs.get(key);
  const job = generate();
  jobs.set(key, job);
  try {
    return await job;
  } finally {
    jobs.delete(key);
  }
  async function generate() {
    const temporary = await mkdtemp(path.join(cache, "decode-")),
      owned = [],
      handles = new Map();
    try {
      const executable = path.join(
        root,
        ".deps",
        "gstreamer",
        "bin",
        process.platform === "win32" ? "gst-launch-1.0.exe" : "gst-launch-1.0",
      );
      for (const source of sources) {
        const pcm = path.join(
          temporary,
          source.id.replace(/[^a-zA-Z0-9_-]/g, "_") + ".pcm",
        );
        owned.push(pcm);
        await decode(executable, pathToFileURL(source.file).href, pcm);
        handles.set(source.id, await open(pcm, "r"));
      }
      const count = Math.ceil(duration * PPS),
        peaks = Buffer.alloc(count * 2),
        scratch = Buffer.alloc(RATE * 4);
      // Mix actual decoded samples a second at a time; no full-video or full-timeline PCM buffer.
      for (let block = 0; block < Math.ceil(duration); block++) {
        const length = Math.min(
            RATE,
            Math.ceil(duration * RATE) - block * RATE,
          ),
          mix = new Float32Array(length);
        for (const r of ranges) {
          const from = Math.max(block, r.start),
            to = Math.min(block + length / RATE, r.end);
          if (to <= from) continue;
          const begin = Math.max(0, Math.round((from - block) * RATE)),
            end = Math.min(length, Math.round((to - block) * RATE)),
            samples = end - begin;
          if (samples <= 0) continue;
          const sourceStart = Math.max(
            0,
            Math.round(
              (block +
                begin / RATE -
                r.clip.startTicks / t.timebase +
                r.clip.inTicks / t.timebase) *
                RATE,
            ),
          );
          const { bytesRead } = await handles
            .get(r.clip.assetId)
            .read(scratch, 0, samples * 4, sourceStart * 4);
          for (let i = 0; i < Math.floor(bytesRead / 4); i++) {
            const value = scratch.readFloatLE(i * 4);
            if (Number.isFinite(value)) mix[begin + i] += value;
          }
        }
        for (let offset = 0; offset < length; offset += DIVISION) {
          let low = Infinity,
            high = -Infinity;
          for (let i = offset; i < Math.min(length, offset + DIVISION); i++) {
            low = Math.min(low, mix[i]);
            high = Math.max(high, mix[i]);
          }
          const index = block * PPS + Math.floor(offset / DIVISION);
          peaks.writeInt8(
            Math.max(-127, Math.min(127, Math.round(low * 127))),
            index * 2,
          );
          peaks.writeInt8(
            Math.max(-127, Math.min(127, Math.round(high * 127))),
            index * 2 + 1,
          );
        }
      }
      const payload = {
        schema: "moy.asr.waveform.v1",
        encoding: "i8-minmax-base64",
        peaks_per_second: PPS,
        sample_rate: RATE,
        division: DIVISION,
        peak_count: count,
        duration_ms: Math.round(duration * 1000),
        data: peaks.toString("base64"),
        source: {
          kind: "workstation-timeline",
          key,
          audio_sources: sources.length,
        },
      };
      const partial = path.join(temporary, "result.json");
      owned.push(partial);
      await writeFile(partial, JSON.stringify(payload), "utf8");
      await rename(partial, target);
      return payload;
    } finally {
      for (const handle of handles.values())
        await handle.close().catch(() => {});
      for (const file of owned) await unlink(file).catch(() => {});
      await rmdir(temporary).catch(() => {});
    }
  }
}

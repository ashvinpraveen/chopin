import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { CACHE_DIR_NAME } from "./proxyTranscoder.js";

/**
 * Chopin: on-demand, segmented preview proxies for heavy sources (above 1080p).
 *
 * A whole-file proxy of an hour of 4K takes about an hour to make, so the
 * preview would play the original (or nothing) until then. Instead the proxy
 * is an HLS VOD playlist whose segments are encoded when first requested:
 * the browser asks for the segment under the playhead, it is encoded in a
 * couple of seconds, and the rest of the file is filled in ahead of the
 * playhead and then in idle time. Each segment is cached, so a section is
 * only ever encoded once.
 *
 * One encode runs per source device at a time: a spinning USB drive read in
 * several places at once spends its time seeking, not reading.
 *
 * Preview only. Renders always read the original file.
 */

export const HLS_PROXY_VARIANT = "hls";
export const HLS_SEGMENT_SECONDS = 6;
const HLS_DIR_NAME = "hls-v1";
/** Segments queued past the most recent request before idle fill takes over. */
const READ_AHEAD_SEGMENTS = 10;
const PROXY_MAX_WIDTH = 1280;
const PROXY_MAX_HEIGHT = 720;

interface SourceInfo {
  duration: number;
  width: number;
  height: number;
}

interface SourceState {
  sourcePath: string;
  dir: string;
  info: SourceInfo;
  segments: number;
  /** The segment most recently asked for; read-ahead and idle fill start here. */
  cursor: number;
  waiters: Map<number, Array<{ resolve: (path: string) => void; reject: (err: Error) => void }>>;
}

interface DeviceQueue {
  busy: boolean;
  /** Explicitly requested segments, newest first. */
  demanded: Array<{ state: SourceState; index: number }>;
  /** Sources on this device, for read-ahead and idle fill. */
  sources: Set<SourceState>;
}

const sources = new Map<string, Promise<SourceState>>();
const devices = new Map<number, DeviceQueue>();

function sourceKey(sourcePath: string): string {
  const stat = statSync(sourcePath);
  return createHash("sha256")
    .update(`${sourcePath}\0${stat.mtimeMs}\0${stat.size}\0${HLS_DIR_NAME}`)
    .digest("hex")
    .slice(0, 32);
}

function parseSourceInfo(stdout: string): SourceInfo {
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const width = parsed.streams?.[0]?.width ?? 0;
  const height = parsed.streams?.[0]?.height ?? 0;
  const duration = Number(parsed.format?.duration);
  if (width <= 0 || height <= 0 || !(duration > 0)) {
    throw new Error("source has no measurable video stream");
  }
  return { duration, width, height };
}

function probeSource(sourcePath: string): Promise<SourceInfo> {
  const ffprobe = findFfBinary("ffprobe", { configuredMustExist: true });
  if (!ffprobe) return Promise.reject(new Error("ffprobe unavailable"));
  return new Promise((resolve, reject) => {
    execFile(
      ffprobe,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height:format=duration",
        "-of",
        "json",
        sourcePath,
      ],
      { timeout: 30_000 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(parseSourceInfo(String(stdout)));
        } catch (parseErr) {
          reject(parseErr instanceof Error ? parseErr : new Error(String(parseErr)));
        }
      },
    );
  });
}

function loadSource(projectDir: string, sourcePath: string): Promise<SourceState> {
  const key = sourceKey(sourcePath);
  let pending = sources.get(key);
  if (!pending) {
    pending = probeSource(sourcePath).then((info) => {
      const dir = join(projectDir, CACHE_DIR_NAME, HLS_DIR_NAME, key);
      mkdirSync(dir, { recursive: true });
      return {
        sourcePath,
        dir,
        info,
        segments: Math.ceil(info.duration / HLS_SEGMENT_SECONDS),
        cursor: 0,
        waiters: new Map(),
      };
    });
    pending.catch(() => sources.delete(key));
    sources.set(key, pending);
  }
  return pending;
}

function segmentPath(state: SourceState, index: number): string {
  return join(state.dir, `${index}.ts`);
}

function segmentDuration(state: SourceState, index: number): number {
  return Math.min(HLS_SEGMENT_SECONDS, state.info.duration - index * HLS_SEGMENT_SECONDS);
}

/** Even output size that fits inside 1280x720 without upscaling. */
export function proxyDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, PROXY_MAX_WIDTH / width, PROXY_MAX_HEIGHT / height);
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

export function buildHlsPlaylist(duration: number, segmentUri: (index: number) => string): string {
  const count = Math.ceil(duration / HLS_SEGMENT_SECONDS);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${HLS_SEGMENT_SECONDS}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
  ];
  for (let i = 0; i < count; i++) {
    const length = Math.min(HLS_SEGMENT_SECONDS, duration - i * HLS_SEGMENT_SECONDS);
    lines.push(`#EXTINF:${length.toFixed(6)},`, segmentUri(i));
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

export function encodeArgs(
  sourcePath: string,
  start: number,
  duration: number,
  size: { width: number; height: number },
  outPath: string,
  hardware: boolean,
): string[] {
  const input = ["-ss", start.toFixed(3), "-i", sourcePath, "-t", duration.toFixed(3)];
  const video = hardware
    ? [
        "-vf",
        `scale_vt=w=${size.width}:h=${size.height}`,
        "-c:v",
        "h264_videotoolbox",
        "-b:v",
        "3M",
      ]
    : [
        "-vf",
        `scale=${size.width}:${size.height},format=yuv420p`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
      ];
  return [
    "-v",
    "error",
    "-y",
    ...(hardware ? ["-hwaccel", "videotoolbox", "-hwaccel_output_format", "videotoolbox_vld"] : []),
    ...input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    ...video,
    "-g",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    // Segment timestamps continue from the source, so the playlist plays as one timeline.
    "-output_ts_offset",
    start.toFixed(3),
    "-muxdelay",
    "0",
    "-f",
    "mpegts",
    outPath,
  ];
}

let hardwareWorks = process.platform === "darwin";

function runFfmpeg(args: string[]): Promise<void> {
  const ffmpeg = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (!ffmpeg) return Promise.reject(new Error("ffmpeg unavailable"));
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-500)}`));
    });
  });
}

async function encodeSegment(state: SourceState, index: number): Promise<string> {
  const out = segmentPath(state, index);
  if (existsSync(out)) return out;
  const temp = join(state.dir, `.tmp-${randomUUID()}.ts`);
  const size = proxyDimensions(state.info.width, state.info.height);
  const start = index * HLS_SEGMENT_SECONDS;
  const duration = segmentDuration(state, index);
  try {
    try {
      await runFfmpeg(encodeArgs(state.sourcePath, start, duration, size, temp, hardwareWorks));
    } catch (err) {
      if (!hardwareWorks) throw err;
      // No VideoToolbox (or it refused this source): fall back to software for good.
      hardwareWorks = false;
      await runFfmpeg(encodeArgs(state.sourcePath, start, duration, size, temp, false));
    }
    renameSync(temp, out);
    return out;
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function deviceFor(state: SourceState): DeviceQueue {
  const dev = statSync(state.sourcePath).dev;
  let queue = devices.get(dev);
  if (!queue) {
    queue = { busy: false, demanded: [], sources: new Set() };
    devices.set(dev, queue);
  }
  queue.sources.add(state);
  return queue;
}

/** First missing segment at or after the cursor (wrapping), or -1 when complete. */
function nextMissing(state: SourceState, limit = state.segments): number {
  for (let step = 0; step < Math.min(limit, state.segments); step++) {
    const index = (state.cursor + step) % state.segments;
    if (!existsSync(segmentPath(state, index))) return index;
  }
  return -1;
}

function pickWork(queue: DeviceQueue): { state: SourceState; index: number } | null {
  while (queue.demanded.length > 0) {
    const job = queue.demanded.shift()!;
    if (!existsSync(segmentPath(job.state, job.index))) return job;
    settle(job.state, job.index, segmentPath(job.state, job.index));
  }
  // Read ahead of the newest request first, then fill whatever is left.
  for (const limit of [READ_AHEAD_SEGMENTS, Infinity]) {
    for (const state of queue.sources) {
      const index = nextMissing(state, limit);
      if (index >= 0) return { state, index };
    }
  }
  return null;
}

function settle(state: SourceState, index: number, path: string | Error): void {
  const waiting = state.waiters.get(index);
  if (!waiting) return;
  state.waiters.delete(index);
  for (const waiter of waiting) {
    if (path instanceof Error) waiter.reject(path);
    else waiter.resolve(path);
  }
}

function pump(queue: DeviceQueue): void {
  if (queue.busy) return;
  const job = pickWork(queue);
  if (!job) return;
  queue.busy = true;
  encodeSegment(job.state, job.index)
    .then(
      (path) => settle(job.state, job.index, path),
      (err: unknown) =>
        settle(job.state, job.index, err instanceof Error ? err : new Error(String(err))),
    )
    .finally(() => {
      queue.busy = false;
      pump(queue);
    });
}

/**
 * The VOD playlist for `sourcePath`. Starts no encode by itself. `requestName`
 * is the last segment of the URL the browser asked for (a project may reach
 * the source through a symlink with a different name).
 */
export async function hlsPlaylist(
  projectDir: string,
  sourcePath: string,
  requestName: string,
): Promise<string> {
  const state = await loadSource(projectDir, sourcePath);
  const name = encodeURIComponent(requestName);
  return buildHlsPlaylist(
    state.info.duration,
    (i) => `${name}?hf-proxy=${HLS_PROXY_VARIANT}&seg=${i}`,
  );
}

/** Path of segment `index`, encoding it first (ahead of everything else) if needed. */
export async function hlsSegment(
  projectDir: string,
  sourcePath: string,
  index: number,
): Promise<string> {
  const state = await loadSource(projectDir, sourcePath);
  if (!Number.isInteger(index) || index < 0 || index >= state.segments) {
    throw new RangeError(`segment ${index} out of range`);
  }
  state.cursor = index;
  const ready = segmentPath(state, index);
  if (existsSync(ready)) {
    pump(deviceFor(state));
    return ready;
  }
  const result = new Promise<string>((resolve, reject) => {
    const waiting = state.waiters.get(index) ?? [];
    waiting.push({ resolve, reject });
    state.waiters.set(index, waiting);
  });
  const queue = deviceFor(state);
  queue.demanded.unshift({ state, index });
  pump(queue);
  return result;
}

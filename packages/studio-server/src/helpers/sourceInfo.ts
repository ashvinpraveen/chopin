import { statSync } from "node:fs";
import { extname } from "node:path";
import { runFfprobe } from "./hlsProxy.js";
import { BROWSER_HOSTILE_CODECS, isHeavySource } from "./mediaCodecMap.js";

/**
 * Chopin source viewer: what the studio needs to know about a media file
 * before it plays it — length, picture size, frame rate, whether it carries
 * sound, and whether the browser should get the segmented HLS proxy instead
 * of the file itself.
 */
export interface SourceMediaInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  /** Above 1080p: always previewed through the HLS proxy. */
  heavy: boolean;
  /** The browser cannot (or cannot reliably) decode the file as it is. */
  hostile: boolean;
  hasAudio: boolean;
  hasVideo: boolean;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  disposition?: { attached_pic?: number };
}

/** Containers Chrome does not demux, whatever the codec inside. */
const HOSTILE_CONTAINERS = new Set([".mxf", ".avi", ".mts", ".m2ts", ".mkv"]);

function parseRate(rate: string | undefined): number {
  const [num = 0, den = 1] = (rate ?? "").split("/").map(Number);
  const value = den ? num / den : 0;
  return Number.isFinite(value) && value > 0 && value < 1000 ? value : 0;
}

/** H.264 beyond 8-bit 4:2:0 (Sony XAVC S 10-bit 4:2:2, for one) does not decode in Chrome. */
function isHostileH264(stream: ProbeStream): boolean {
  if (stream.codec_name !== "h264") return false;
  const profile = stream.profile ?? "";
  return /4:2:2|4:4:4|high 10/i.test(profile) || /10le|10be|422|444/.test(stream.pix_fmt ?? "");
}

function isHostileVideo(stream: ProbeStream): boolean {
  const codec = stream.codec_name ?? "";
  return Object.hasOwn(BROWSER_HOSTILE_CODECS, codec) || isHostileH264(stream);
}

/** Pure: ffprobe JSON (streams + format) for `path` to the viewer's facts. */
export function parseSourceInfo(stdout: string, path: string): SourceMediaInfo {
  const parsed = JSON.parse(stdout) as { streams?: ProbeStream[]; format?: { duration?: string } };
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const duration = Number(parsed.format?.duration);
  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  const heavy = isHeavySource(width, height);
  const container = HOSTILE_CONTAINERS.has(extname(path).toLowerCase());
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    width,
    height,
    fps: parseRate(video?.avg_frame_rate) || parseRate(video?.r_frame_rate),
    heavy,
    hostile: video ? heavy || container || isHostileVideo(video) : false,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    hasVideo: Boolean(video),
  };
}

const PROBE_ARGS = [
  "-v",
  "error",
  "-show_entries",
  "stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,avg_frame_rate:stream_disposition=attached_pic:format=duration",
  "-of",
  "json",
  "--",
];

const cache = new Map<string, { stamp: string; info: SourceMediaInfo }>();
const MAX_CACHE = 256;

function remember(path: string, stamp: string, info: SourceMediaInfo): void {
  if (!cache.has(path) && cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(path, { stamp, info });
}

/** Probe `path` (a real, validated media file). Cached per path until mtime or size changes. */
export function probeSourceInfo(path: string): Promise<SourceMediaInfo> {
  const stat = statSync(path);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  const hit = cache.get(path);
  if (hit?.stamp === stamp) return Promise.resolve(hit.info);
  return runFfprobe([...PROBE_ARGS, path], (stdout) => {
    const info = parseSourceInfo(stdout, path);
    remember(path, stamp, info);
    return info;
  });
}

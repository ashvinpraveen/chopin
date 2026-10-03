import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { runFfmpeg } from "./hlsProxy.js";
import { CACHE_DIR_NAME } from "./proxyTranscoder.js";

/**
 * Chopin Media Storage: one small JPEG per external file, for the browsing grid.
 *
 * A video's frame is the keyframe at or before ~10% of its length, read with
 * inexact input seeking (the first decoded frame is that keyframe), so a 4K
 * HEVC file on a slow USB drive costs one short read rather than a decode run. One grab runs per
 * source device at a time (a spinning drive read in several places at once
 * spends its time seeking). Cached under the project's cache dir, keyed by
 * path, mtime, size and width.
 */

const THUMB_DIR_NAME = "source-thumbs-v1";
const SOURCE_THUMB_WIDTHS = [160, 240, 320, 480] as const;

/** The supported width nearest at or above `requested` (320 when absent or junk). */
export function thumbnailWidth(requested: string | undefined): number {
  const wanted = Number(requested);
  if (!Number.isFinite(wanted) || wanted <= 0) return 320;
  return SOURCE_THUMB_WIDTHS.find((w) => w >= wanted) ?? 480;
}

export function thumbnailArgs(
  source: string,
  out: string,
  width: number,
  seekSeconds: number | null,
): string[] {
  const seek = seekSeconds == null ? [] : ["-noaccurate_seek", "-ss", seekSeconds.toFixed(3)];
  return [
    "-v",
    "error",
    "-y",
    ...seek,
    "-i",
    source,
    "-frames:v",
    "1",
    "-vf",
    `scale=${width}:-2:flags=fast_bilinear,format=yuvj420p`,
    "-q:v",
    "5",
    "-f",
    "image2",
    out,
  ];
}

const devices = new Map<number, Promise<unknown>>();
const inflight = new Map<string, Promise<string>>();

/** Run `job` after every earlier job on the same device. */
function onDevice<T>(dev: number, job: () => Promise<T>): Promise<T> {
  const previous = devices.get(dev) ?? Promise.resolve();
  const next = previous.then(job, job);
  devices.set(
    dev,
    next.catch(() => undefined),
  );
  return next;
}

function cachePath(projectDir: string, source: string, width: number): string {
  const stat = statSync(source);
  const key = createHash("sha256")
    .update(`${source}\0${stat.mtimeMs}\0${stat.size}\0${width}`)
    .digest("hex")
    .slice(0, 32);
  return join(projectDir, CACHE_DIR_NAME, THUMB_DIR_NAME, `${key}.jpg`);
}

/**
 * Path of the cached thumbnail of `source` (a validated real media file),
 * made first if needed. `duration` is the video's length (null for a still).
 */
export function sourceThumbnail(
  projectDir: string,
  source: string,
  width: number,
  duration: number | null,
): Promise<string> {
  const out = cachePath(projectDir, source, width);
  if (existsSync(out)) return Promise.resolve(out);
  const pending = inflight.get(out);
  if (pending) return pending;
  const seek = duration == null ? null : Math.max(0, duration * 0.1);
  const made = onDevice(statSync(source).dev, async () => {
    if (existsSync(out)) return out;
    mkdirSync(join(out, ".."), { recursive: true });
    const temp = join(out, "..", `.tmp-${randomUUID()}.jpg`);
    try {
      await runFfmpeg(thumbnailArgs(source, temp, width, seek));
      renameSync(temp, out);
      return out;
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  }).finally(() => inflight.delete(out));
  inflight.set(out, made);
  return made;
}

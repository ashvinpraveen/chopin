import { spawn } from "node:child_process";
import {
  existsSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";

const SAMPLE_RATE = 4000;
/**
 * Peaks are sized to the file, not fixed: a fixed 4000 spread a 2-hour episode
 * at one bar per 1.8 s, too coarse to see a word, let alone cut on one. 100 per
 * second (10 ms) resolves syllables at the deepest timeline zoom. Short files
 * keep the old 4000 floor so a 5 s clip zoomed to frames still draws smoothly.
 */
const PEAKS_PER_SECOND = 100;
const MIN_PEAK_COUNT = 4000;
/** Streaming resolution: fine buckets collected while ffmpeg runs, reduced once at the end. */
const FINE_SAMPLES_PER_PEAK = 10;
const WAVEFORM_CACHE_VERSION = "v3";

/**
 * Cache filename for one asset's peaks, keyed on its content as well as its name.
 *
 * The path alone is not an identity. An asset rebuilt in place — a bed
 * re-encoded without its ducking, a plate swapped for the right one — keeps its
 * name and gets new samples, and a path-keyed entry then served the old peaks
 * for the rest of the project's life: the timeline drew a duck that was no
 * longer in the file, which reads as the render having done it. Size and mtime
 * are what a rebuild always changes, and both are already on the stat the route
 * takes to check the file exists.
 *
 * Without a fingerprint it falls back to the old path-only key, so a caller that
 * cannot stat still gets caching rather than an error.
 */
export function buildWaveformCacheKey(
  assetPath: string,
  fingerprint?: { size: number; mtimeMs: number },
): string {
  const name = assetPath.replace(/[/\\]/g, "_");
  if (!fingerprint) return `${WAVEFORM_CACHE_VERSION}_${name}.json`;
  const stamp = `${fingerprint.size}-${Math.round(fingerprint.mtimeMs)}`;
  return `${WAVEFORM_CACHE_VERSION}_${name}_${stamp}.json`;
}

/**
 * Peak count for a file of `fineCount` fine buckets: 100/s, at least 4000. A
 * file shorter than the floor repeats its fine buckets rather than drawing gaps.
 */
function targetPeakCount(fineCount: number): number {
  const seconds = (fineCount * FINE_SAMPLES_PER_PEAK) / SAMPLE_RATE;
  return Math.max(MIN_PEAK_COUNT, Math.ceil(seconds * PEAKS_PER_SECOND));
}

/** Max-reduce fine buckets to `count` peaks, normalized to the file's loudest, rounded for a compact payload. */
function reducePeaks(fine: ArrayLike<number>, count: number): number[] {
  const length = fine.length;
  const peaks: number[] = new Array(count);
  let maxPeak = 0.001;
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * length) / count));
    let max = 0;
    for (let j = start; j < end && j < length; j++) {
      const value = fine[j] ?? 0;
      if (value > max) max = value;
    }
    peaks[i] = max;
    if (max > maxPeak) maxPeak = max;
  }
  // Three decimals is below a pixel at any clip height and keeps an hour of
  // peaks near 2 MB of JSON instead of ~6.
  for (let i = 0; i < count; i++) peaks[i] = Math.round(((peaks[i] ?? 0) / maxPeak) * 1000) / 1000;
  return peaks;
}

/**
 * Collects max-abs fine buckets from a little-endian f32 stream without
 * buffering the PCM (a 2-hour file is ~115 MB of samples; its buckets ~11 MB).
 */
class FinePeakCollector {
  private buckets = new Float32Array(1 << 16);
  private count = 0;
  private current = 0;
  private inBucket = 0;
  private carry: Buffer | null = null;
  samples = 0;

  push(chunk: Buffer): void {
    let data = chunk;
    if (this.carry) {
      data = Buffer.concat([this.carry, chunk]);
      this.carry = null;
    }
    const whole = data.length - (data.length % 4);
    for (let offset = 0; offset < whole; offset += 4) {
      const abs = Math.abs(data.readFloatLE(offset));
      if (abs > this.current) this.current = abs;
      if (++this.inBucket === FINE_SAMPLES_PER_PEAK) this.flush();
    }
    this.samples += whole / 4;
    if (whole < data.length) this.carry = Buffer.from(data.subarray(whole));
  }

  finish(): Float32Array {
    if (this.inBucket > 0) this.flush();
    return this.buckets.subarray(0, this.count);
  }

  private flush(): void {
    if (this.count === this.buckets.length) {
      const grown = new Float32Array(this.buckets.length * 2);
      grown.set(this.buckets);
      this.buckets = grown;
    }
    this.buckets[this.count++] = this.current;
    this.current = 0;
    this.inBucket = 0;
  }
}

export function decodeAudioPeaks(audioPath: string): Promise<number[]> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(
      findFfBinary("ffmpeg") ?? "ffmpeg",
      [
        "-i",
        audioPath,
        "-af",
        "atrim=start_sample=1152",
        "-f",
        "f32le",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        "-vn",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );

    const collector = new FinePeakCollector();
    proc.stdout?.on("data", (chunk: Buffer) => collector.push(chunk));
    proc.on("close", (code) => {
      if (code !== 0 && collector.samples === 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }
      if (collector.samples === 0) {
        reject(new Error("ffmpeg produced no audio samples"));
        return;
      }
      const fine = collector.finish();
      resolvePromise(reducePeaks(fine, targetPeakCount(fine.length)));
    });
    proc.on("error", reject);
  });
}

export async function generateWaveformCache(projectDir: string, assetPath: string): Promise<void> {
  const audioPath = join(projectDir, assetPath);
  if (!existsSync(audioPath)) return;

  const stats = statSync(audioPath);
  const cacheDir = join(projectDir, ".waveform-cache");
  const cachePath = join(cacheDir, buildWaveformCacheKey(assetPath, stats));
  if (isWaveformCacheDirectory(cacheDir) && existsSync(cachePath)) return;

  const peaks = await decodeAudioPeaks(audioPath);
  writeWaveformCache(cachePath, peaks);
}

export function isWaveformCacheDirectory(cacheDir: string): boolean {
  return lstatSync(cacheDir, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** Publish complete peaks without following a replaced cache-file symlink. */
export function writeWaveformCache(cachePath: string, peaks: number[]): void {
  const cacheDir = dirname(cachePath);
  try {
    mkdirSync(cacheDir, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  if (!isWaveformCacheDirectory(cacheDir)) {
    throw new Error("Waveform cache must be a directory, not a symlink");
  }
  const stagingDir = mkdtempSync(join(cacheDir, ".waveform-"));
  try {
    const stagingPath = join(stagingDir, "peaks.json");
    writeFileSync(stagingPath, JSON.stringify(peaks), { flag: "wx" });
    renameSync(stagingPath, cachePath);
  } finally {
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // Cleanup must not mask a write error or fail an already published cache.
    }
  }
}

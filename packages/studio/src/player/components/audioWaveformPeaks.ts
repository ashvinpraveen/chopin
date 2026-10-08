/** Quietest bar that still clears the timeline contrast gate on the 70% pill. */
const LOUDNESS_OPACITY_FLOOR = 0.64;

const LOUDNESS_OPACITY_SPAN = 1 - LOUDNESS_OPACITY_FLOOR;

/** Peak is 0–1 against the file's own maximum. Hotter peaks paint more opaque. */
export function loudnessToOpacity(peak: number): number {
  if (!Number.isFinite(peak)) return LOUDNESS_OPACITY_FLOOR;
  const clamped = Math.min(1, Math.max(0, peak));
  return LOUDNESS_OPACITY_FLOOR + LOUDNESS_OPACITY_SPAN * clamped;
}

/**
 * Max-in-bucket over the trimmed peak window, one value per bar.
 * A point sample drops a transient that sits between bar columns.
 */
export function decimatePeaks(
  peaks: readonly number[],
  startFraction: number,
  endFraction: number,
  barCount: number,
): number[] {
  if (barCount <= 0 || peaks.length === 0) return [];
  const startFractionClamped = Math.min(1, Math.max(0, startFraction));
  const endFractionClamped = Math.min(1, Math.max(startFractionClamped, endFraction));
  const start = Math.floor(startFractionClamped * peaks.length);
  const endIndex = Math.ceil(endFractionClamped * peaks.length);
  const end = Math.max(start + 1, Math.min(peaks.length, endIndex));
  const span = end - start;
  const bars: number[] = [];
  for (let index = 0; index < barCount; index++) {
    let from = start + Math.floor((index * span) / barCount);
    let to = start + Math.floor(((index + 1) * span) / barCount);
    if (to <= from) {
      from = Math.min(from, end - 1);
      to = from + 1;
    }
    let max = 0;
    for (let cursor = from; cursor < to; cursor++) {
      const value = peaks[cursor] ?? 0;
      if (value > max) max = value;
    }
    bars.push(max);
  }
  return bars;
}

/** Halved max-pyramids per peak array, built once per array and dropped with it. */
const pyramids = new WeakMap<readonly number[], readonly (readonly number[])[]>();

function peakPyramid(peaks: readonly number[]): readonly (readonly number[])[] {
  const cached = pyramids.get(peaks);
  if (cached) return cached;
  const levels: (readonly number[])[] = [peaks];
  let level: readonly number[] = peaks;
  while (level.length > 2048) {
    const next: number[] = new Array(Math.ceil(level.length / 2));
    for (let index = 0; index < next.length; index++) {
      const a = level[index * 2] ?? 0;
      const b = level[index * 2 + 1] ?? 0;
      next[index] = a > b ? a : b;
    }
    levels.push(next);
    level = next;
  }
  pyramids.set(peaks, levels);
  return levels;
}

/**
 * `decimatePeaks` over the coarsest pyramid level that still holds at least two
 * peaks per bar. Long files carry ~100 peaks a second, so a zoomed-out 2-hour
 * clip would otherwise scan 720k values on every redraw; the max of maxes is
 * the same envelope.
 */
export function decimatePeaksFast(
  peaks: readonly number[],
  startFraction: number,
  endFraction: number,
  barCount: number,
): number[] {
  if (barCount <= 0 || peaks.length === 0) return [];
  const spanFraction = Math.max(0, Math.min(1, endFraction) - Math.max(0, startFraction));
  const levels = peakPyramid(peaks);
  let chosen = levels[0] ?? peaks;
  for (const level of levels) {
    if (level.length * spanFraction < barCount * 2) break;
    chosen = level;
  }
  return decimatePeaks(chosen, startFraction, endFraction, barCount);
}

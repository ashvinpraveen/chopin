/**
 * Source viewer in/out marks (Resolve semantics), pure.
 *
 * Setting an in point at or past the out point drops the out point, and the
 * other way round, so the marked range is never empty or inverted. An unset
 * mark means the clip's own edge.
 */
export interface SourceMarks {
  in: number | null;
  out: number | null;
}

export const NO_MARKS: SourceMarks = { in: null, out: null };

/** Seconds below which two times are the same frame for marking purposes. */
const MARK_EPSILON_S = 1e-3;

function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.min(Math.max(0, time), Math.max(0, duration));
}

export function markIn(marks: SourceMarks, time: number, duration: number): SourceMarks {
  const t = clampTime(time, duration);
  const keepOut = marks.out != null && marks.out - t > MARK_EPSILON_S;
  return { in: t, out: keepOut ? marks.out : null };
}

export function markOut(marks: SourceMarks, time: number, duration: number): SourceMarks {
  const t = clampTime(time, duration);
  const keepIn = marks.in != null && t - marks.in > MARK_EPSILON_S;
  return { in: keepIn ? marks.in : null, out: t };
}

/** The range an edit takes: the marks, or the clip's edges where unset. */
export function markedRange(
  marks: SourceMarks,
  duration: number,
): { start: number; end: number; duration: number } {
  const start = clampTime(marks.in ?? 0, duration);
  const rawEnd = clampTime(marks.out ?? duration, duration);
  const end = rawEnd > start ? rawEnd : duration;
  return { start, end, duration: Math.max(0, end - start) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `HH:MM:SS:FF` at `fps` (whole frames, non-drop). */
export function formatSourceTimecode(seconds: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps > 0 ? fps : 30));
  const totalFrames = Math.max(
    0,
    Math.floor((Number.isFinite(seconds) ? seconds : 0) * rate + 1e-6),
  );
  const frames = totalFrames % rate;
  const totalSeconds = Math.floor(totalFrames / rate);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
}

/** Time of the frame `delta` frames away from `time`, clamped to the clip. */
export function stepSourceFrame(
  time: number,
  delta: number,
  fps: number,
  duration: number,
): number {
  const rate = fps > 0 ? fps : 30;
  const frame = Math.round(time * rate) + delta;
  return clampTime(frame / rate, duration);
}

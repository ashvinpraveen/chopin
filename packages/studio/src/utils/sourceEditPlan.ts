/**
 * Placement math for editing a source-viewer range into the timeline, with
 * DaVinci Resolve semantics. Pure: clip times in, per-clip changes out.
 *
 * - insert:    at `at`, every clip on the destination track at or after `at`
 *              moves right by the range's length; a clip under `at` is split
 *              and its tail moves with them.
 * - overwrite: the range [at, at + length) is cleared on the destination
 *              track (clips inside are removed, clips across its edges are
 *              trimmed or split), nothing else moves.
 * - append:    at the end of the timeline; nothing is under it.
 */

export type SourceEditMode = "insert" | "overwrite" | "append";

export interface TrackClip {
  key: string;
  start: number;
  duration: number;
  /** Media in-point (data-media-start); 0 for clips without one. */
  mediaStart: number;
  /** Playback rate, for converting timeline time to media time. */
  rate: number;
  /** Video / audio: its media in-point moves when its head is trimmed. */
  media: boolean;
}

export interface ClipSpan {
  start: number;
  duration: number;
  mediaStart?: number;
}

export type ClipChange =
  | { key: string; type: "remove" }
  | { key: string; type: "set"; span: ClipSpan }
  | { key: string; type: "split"; head: ClipSpan; tail: ClipSpan };

export interface SourceEditPlan {
  /** Timeline start of the new clip. */
  start: number;
  changes: ClipChange[];
  /** Furthest clip end on the track after the edit, new clip included. */
  contentEnd: number;
}

const EPS = 1e-4;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function tailFrom(clip: TrackClip, cut: number, newStart: number): ClipSpan {
  const end = clip.start + clip.duration;
  const span: ClipSpan = { start: round(newStart), duration: round(end - cut) };
  if (clip.media) span.mediaStart = round(clip.mediaStart + (cut - clip.start) * clip.rate);
  return span;
}

function headTo(clip: TrackClip, cut: number): ClipSpan {
  return { start: clip.start, duration: round(cut - clip.start) };
}

function insertChange(clip: TrackClip, at: number, length: number): ClipChange | null {
  const end = clip.start + clip.duration;
  if (clip.start >= at - EPS) {
    return {
      key: clip.key,
      type: "set",
      span: { start: round(clip.start + length), duration: clip.duration },
    };
  }
  if (end > at + EPS) {
    return {
      key: clip.key,
      type: "split",
      head: headTo(clip, at),
      tail: tailFrom(clip, at, at + length),
    };
  }
  return null;
}

function overwriteChange(clip: TrackClip, at: number, until: number): ClipChange | null {
  const end = clip.start + clip.duration;
  if (end <= at + EPS || clip.start >= until - EPS) return null;
  const headSurvives = clip.start < at - EPS;
  const tailSurvives = end > until + EPS;
  if (headSurvives && tailSurvives) {
    return {
      key: clip.key,
      type: "split",
      head: headTo(clip, at),
      tail: tailFrom(clip, until, until),
    };
  }
  if (headSurvives) return { key: clip.key, type: "set", span: headTo(clip, at) };
  if (tailSurvives) return { key: clip.key, type: "set", span: tailFrom(clip, until, until) };
  return { key: clip.key, type: "remove" };
}

function spanEnd(change: ClipChange | null, clip: TrackClip): number {
  if (!change) return clip.start + clip.duration;
  if (change.type === "remove") return 0;
  const span = change.type === "set" ? change.span : change.tail;
  return span.start + span.duration;
}

export function planSourceEdit(
  clips: readonly TrackClip[],
  input: { mode: SourceEditMode; at: number; length: number },
): SourceEditPlan {
  const at = Math.max(0, input.at);
  const length = Math.max(0, input.length);
  const changes: ClipChange[] = [];
  let contentEnd = at + length;
  for (const clip of clips) {
    const change =
      input.mode === "insert"
        ? insertChange(clip, at, length)
        : input.mode === "overwrite"
          ? overwriteChange(clip, at, at + length)
          : null;
    if (change) changes.push(change);
    contentEnd = Math.max(contentEnd, spanEnd(change, clip));
  }
  return { start: round(at), changes, contentEnd: round(contentEnd) };
}

/** Where append puts a clip: the end of everything on the timeline. */
export function appendTime(clips: ReadonlyArray<{ start: number; duration: number }>): number {
  return round(clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0));
}

export interface TrackCandidate {
  /** Authored track index (data-track-index). */
  track: number;
  /** Display lane; lane 0 is the main track. */
  lane: number;
  audio: boolean;
}

/**
 * Resolve's destination track: the selected clip's track when it is the
 * right kind (audio for an audio-only source, picture otherwise), else the
 * topmost-shown track of that kind (the main track for picture), else a new
 * track after every existing one.
 */
export function pickDestinationTrack(
  clips: readonly TrackCandidate[],
  wantAudio: boolean,
  selected: TrackCandidate | null,
): number {
  if (selected && selected.audio === wantAudio) return selected.track;
  const sameKind = clips.filter((c) => c.audio === wantAudio);
  if (sameKind.length > 0) {
    return sameKind.reduce((best, c) => (c.lane < best.lane ? c : best)).track;
  }
  return clips.reduce((max, c) => Math.max(max, c.track + 1), 0);
}

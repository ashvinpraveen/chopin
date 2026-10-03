/**
 * Insert / Overwrite / Append the source viewer's marked range into the
 * active composition: one source rewrite (the new clip plus every move, trim,
 * removal and split it causes on the destination track), saved through the
 * editor's history so it is one undo step.
 */
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { toAuthoredStart } from "../player/store/timelineElement";
import { buildPatchTarget } from "../hooks/timelineEditingHelpers";
import { isAudioTimelineElement } from "./timelineInspector";
import {
  appendTime,
  pickDestinationTrack,
  planSourceEdit,
  type SourceEditMode,
  type SourceEditPlan,
  type TrackCandidate,
  type TrackClip,
} from "./sourceEditPlan";
import { applyClipChanges, type ClipTarget } from "./sourceEditApply";
import {
  buildTimelineAssetId,
  buildTimelineAssetInsertHtml,
  fitTimelineAssetGeometry,
  insertTimelineAssetIntoSource,
  resolveTimelineAssetCompositionSize,
  resolveTimelineAssetSrc,
  type TimelineAssetKind,
} from "./timelineAssetDrop";
import { extendRootDurationInSource } from "./rootDuration";
import { collectHtmlIds } from "./studioHelpers";
import { generateId } from "./generateId";
import { IMAGE_EXT } from "./mediaTypes";
import type { SourceMediaInfo } from "./sourceMediaApi";

const IMAGE_SECONDS = 3;

export interface SourceClipToEdit {
  /** Project path of the media (already linked for an outside file). */
  path: string;
  info: SourceMediaInfo | null;
  /** The marked range in the media; null for a still. */
  range: { start: number; duration: number } | null;
}

export function sourceClipKind(path: string, info: SourceMediaInfo | null): TimelineAssetKind {
  if (IMAGE_EXT.test(path)) return "image";
  return info && !info.hasVideo ? "audio" : "video";
}

const authoredTrack = (e: TimelineElement) => e.authoredTrack ?? e.track;
const keyOf = (e: TimelineElement) => e.key ?? e.id;

function candidate(e: TimelineElement): TrackCandidate {
  return { track: authoredTrack(e), lane: e.track, audio: isAudioTimelineElement(e) };
}

function trackClip(e: TimelineElement): TrackClip {
  const tag = e.tag.toLowerCase();
  return {
    key: keyOf(e),
    start: e.start,
    duration: e.duration,
    mediaStart: e.playbackStart ?? 0,
    rate: e.playbackRate ?? 1,
    media: tag === "video" || tag === "audio",
  };
}

function clipTarget(e: TimelineElement): ClipTarget | null {
  const target = buildPatchTarget(e);
  if (!target) return null;
  return {
    target,
    mediaAttr: e.playbackStartAttr ?? "media-start",
    offset: e.start - toAuthoredStart(e, e.start),
    label: e.domId ?? e.id,
  };
}

export interface PlannedSourceEdit {
  track: number;
  kind: TimelineAssetKind;
  duration: number;
  plan: SourceEditPlan;
  /** Clips on the destination track that the edit moves, trims, splits or removes. */
  touched: TimelineElement[];
  targets: Map<string, ClipTarget>;
}

/** Destination track and per-clip plan for `clip` against the file's current timeline clips. */
export function planSourceClipEdit(
  elements: readonly TimelineElement[],
  selected: TimelineElement | null,
  clip: SourceClipToEdit,
  mode: SourceEditMode,
  playhead: number,
): PlannedSourceEdit {
  const kind = sourceClipKind(clip.path, clip.info);
  const wantAudio = kind === "audio";
  const selectedCandidate = selected && elements.includes(selected) ? candidate(selected) : null;
  const track = pickDestinationTrack(elements.map(candidate), wantAudio, selectedCandidate);
  const onTrack = elements.filter(
    (e) => authoredTrack(e) === track && isAudioTimelineElement(e) === wantAudio,
  );
  const duration = clip.range?.duration ?? IMAGE_SECONDS;
  const at = mode === "append" ? appendTime(elements) : playhead;
  const plan = planSourceEdit(onTrack.map(trackClip), { mode, at, length: duration });
  const touchedKeys = new Set(plan.changes.map((c) => c.key));
  const touched = onTrack.filter((e) => touchedKeys.has(keyOf(e)));
  const targets = new Map<string, ClipTarget>();
  for (const e of touched) {
    const target = clipTarget(e);
    if (target) targets.set(keyOf(e), target);
  }
  return { track, kind, duration, plan, touched, targets };
}

/** The rewrite of `targetPath`'s source for a planned edit; `newId` receives the new clip's id. */
export function rewriteForSourceEdit(
  original: string,
  targetPath: string,
  clip: SourceClipToEdit,
  planned: PlannedSourceEdit,
  newId: { value: string },
): string {
  const ids = new Set(collectHtmlIds(original));
  let out = applyClipChanges(original, planned.plan.changes, {
    targets: planned.targets,
    ids,
    newHfId: () => `hf-${generateId()}`,
  });
  newId.value = buildTimelineAssetId(clip.path, ids);
  const natural = clip.info && clip.info.width > 0 ? clip.info : null;
  const html = buildTimelineAssetInsertHtml({
    id: newId.value,
    hfId: `hf-${generateId()}`,
    assetPath: resolveTimelineAssetSrc(targetPath, clip.path),
    kind: planned.kind,
    start: planned.plan.start,
    duration: Number(planned.duration.toFixed(3)),
    track: planned.track,
    zIndex: Math.max(1, ids.size + 1),
    hasAudio: planned.kind === "video" && clip.info?.hasAudio === true,
    mediaStart: clip.range?.start,
    geometry: fitTimelineAssetGeometry(natural, resolveTimelineAssetCompositionSize(original)),
  });
  out = insertTimelineAssetIntoSource(out, html);
  return extendRootDurationInSource(out, planned.plan.contentEnd);
}

/** The timeline clips of `targetPath`, the selected one among them, and the playhead. */
export function timelineSnapshot(targetPath: string, activeCompPath: string | null) {
  const state = usePlayerStore.getState();
  const elements = state.elements.filter(
    (e) => (e.sourceFile || activeCompPath || "index.html") === targetPath,
  );
  const selected = elements.find((e) => keyOf(e) === state.selectedElementId) ?? null;
  return { elements, selected, playhead: state.currentTime };
}

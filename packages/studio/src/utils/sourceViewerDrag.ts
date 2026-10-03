/**
 * Getting outside media and source-viewer ranges onto the timeline through the
 * Media Pool's own drag type, so a drop lands, snaps, opens tracks and undoes
 * exactly like a Media Pool drag. The payload's `path` is one of:
 *
 * - a project path (a Media Pool asset): unchanged;
 * - an absolute path (a Media Storage file): linked into media/ first;
 * - SOURCE_VIEWER_DRAG_PATH: the clip open in the source viewer, its marked range.
 */
import type { SourceEditMode } from "./sourceEditPlan";
import { TIMELINE_ASSET_MIME } from "./timelineAssetDrop";
import { marksFor, useAssetPreviewStore } from "./assetPreviewStore";
import { markedRange } from "./sourceMarks";
import { fetchSourceInfo, isAbsoluteMediaPath, linkExternalMedia } from "./sourceMediaApi";
import { IMAGE_EXT } from "./mediaTypes";

export const SOURCE_VIEWER_DRAG_PATH = "hf-source-viewer:marked-range";

/**
 * Hooks the source viewer and Media Storage reach the editor through, set by
 * whoever owns the editing dependencies (useSourceEditOps) and the Media Pool
 * refresh (MediaStoragePanel).
 */
export const sourceViewerBridge: {
  commit: ((mode: SourceEditMode) => Promise<void>) | null;
  onLinked: (() => void) | null;
} = { commit: null, onLinked: null };

export function writeMediaDrag(e: { dataTransfer: DataTransfer | null }, path: string): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData(TIMELINE_ASSET_MIME, JSON.stringify({ path }));
}

/** The project path of `path`, linking an outside file into the project first. */
export async function projectPathOf(projectId: string, path: string): Promise<string> {
  if (!isAbsoluteMediaPath(path)) return path;
  const linked = await linkExternalMedia(projectId, path);
  sourceViewerBridge.onLinked?.();
  return linked;
}

export interface ResolvedDropAsset {
  path: string;
  /** Media in-point for a source-viewer range. */
  mediaStart?: number;
  /** The range's length, overriding the probed one. */
  duration?: number;
}

/** The marked range of the clip open in the source viewer (whole clip when unmarked). */
export async function sourceViewerRange(
  projectId: string,
  clip: string,
): Promise<{ start: number; duration: number } | null> {
  if (IMAGE_EXT.test(clip)) return null;
  const info = await fetchSourceInfo(projectId, clip);
  if (!info || info.duration <= 0) return null;
  const range = markedRange(marksFor(clip), info.duration);
  return range.duration > 0 ? range : null;
}

/** What a dropped Media Pool / Media Storage / source viewer payload puts on the timeline. */
export async function resolveDropAsset(
  projectId: string,
  assetPath: string,
): Promise<ResolvedDropAsset> {
  const clip =
    assetPath === SOURCE_VIEWER_DRAG_PATH
      ? useAssetPreviewStore.getState().previewAsset
      : assetPath;
  if (!clip) throw new Error("The source viewer has nothing open to drop.");
  // A project asset keeps the drop's own duration probe; an outside file (whose container the
  // browser may not open) and a marked range bring theirs.
  const ranged = assetPath === SOURCE_VIEWER_DRAG_PATH || isAbsoluteMediaPath(clip);
  const range = ranged ? await sourceViewerRange(projectId, clip) : null;
  const path = await projectPathOf(projectId, clip);
  return range ? { path, mediaStart: range.start, duration: range.duration } : { path };
}

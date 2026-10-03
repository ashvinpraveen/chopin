/**
 * The source viewer (Resolve's single-viewer Source mode), rendered inside
 * PreviewPane over the timeline viewer.
 *
 * Opened by clicking a Media Pool asset that is NOT yet on the timeline, or a
 * media file in Media Storage (an outside file, previewed read-only through
 * the server's source route). Plays, shuttles and marks the clip, and edits
 * the marked range into the timeline — without touching the composition until
 * an edit is made.
 *
 * Dismiss: the close button, Escape, or any timeline playhead activity
 * (starting playback / seeking) — the timeline viewer comes back. Marks are
 * kept per clip for the session, so reopening a clip restores them.
 */
import { useEffect, useCallback } from "react";
import { useAssetPreviewStore } from "../../utils/assetPreviewStore";
import { usePlayerStore } from "../../player/store/playerStore";
import { shouldDismissAssetPreview } from "../../utils/assetPreviewDismiss";
import { SourceViewer } from "./sourceViewer/SourceViewer";

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function AssetPreviewOverlay() {
  const previewAsset = useAssetPreviewStore((s) => s.previewAsset);
  const previewProjectId = useAssetPreviewStore((s) => s.previewProjectId);
  const previewExternal = useAssetPreviewStore((s) => s.previewExternal);
  const clearPreviewAsset = useAssetPreviewStore((s) => s.clearPreviewAsset);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") clearPreviewAsset();
    },
    [clearPreviewAsset],
  );

  useEffect(() => {
    if (!previewAsset) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewAsset, handleKeyDown]);

  // The canvas refocuses on any playhead activity: starting playback or a
  // seek/scrub away from where the playhead sat when the preview opened
  // dismisses it. openedTime is captured per preview open (previewAsset dep),
  // so a stale render can never dismiss against the wrong reference time.
  useEffect(() => {
    if (!previewAsset) return;
    const opened = usePlayerStore.getState();
    const openedTime = opened.currentTime;
    // Level-triggered, not edge-triggered: a preview opened while playback is
    // ALREADY running (the RAF loop bypasses the store) or while a seek is
    // already in flight gets no store change to react to, so evaluate the
    // current state once, through the same shared predicate the subscription
    // uses. openedTime is this snapshot's own currentTime, so the
    // time-diverged branch can't false-positive at open — only the
    // isPlaying / requestedSeekTime branches can fire here.
    if (shouldDismissAssetPreview(openedTime, opened)) {
      clearPreviewAsset();
      return;
    }
    return usePlayerStore.subscribe((state) => {
      if (shouldDismissAssetPreview(openedTime, state)) clearPreviewAsset();
    });
  }, [previewAsset, clearPreviewAsset]);

  if (!previewAsset || !previewProjectId) return null;

  return (
    <div
      className="absolute inset-0 z-50"
      role="dialog"
      aria-label={`Source: ${basename(previewAsset)}`}
    >
      <SourceViewer
        key={previewAsset}
        projectId={previewProjectId}
        path={previewAsset}
        external={previewExternal}
        onClose={clearPreviewAsset}
      />
    </div>
  );
}

import { useCallback, useEffect, type MutableRefObject, type RefObject } from "react";
import type { TimelineElement } from "../player";
import { useAssetPreviewStore } from "../utils/assetPreviewStore";
import { saveProjectFilesWithHistory, type RecordEditInput } from "../utils/studioFileHistory";
import { readFileContent } from "./timelineTimingSync";
import { deriveTimelineStoreKeyForDomId } from "../player/lib/timelineElementHelpers";
import { selectAndRevealTimelineElement } from "../player/components/timelineDropReveal";
import type { SourceEditMode } from "../utils/sourceEditPlan";
import {
  planSourceClipEdit,
  rewriteForSourceEdit,
  timelineSnapshot,
  type SourceClipToEdit,
} from "../utils/sourceEditCommit";
import { fetchSourceInfo } from "../utils/sourceMediaApi";
import { projectPathOf, sourceViewerBridge, sourceViewerRange } from "../utils/sourceViewerDrag";

interface UseSourceEditOpsOptions {
  projectIdRef: MutableRefObject<string | null>;
  activeCompPath: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  reloadPreview: () => void;
  isRecordingRef?: RefObject<boolean>;
  forceReloadSdkSession?: () => void;
  checkEditable?: (targets: readonly TimelineElement[]) => boolean;
}

const LABELS: Record<SourceEditMode, string> = {
  insert: "Insert clip",
  overwrite: "Overwrite clip",
  append: "Append clip",
};

/** The clip open in the source viewer, linked into the project when it lives outside it. */
async function sourceClipToEdit(projectId: string): Promise<SourceClipToEdit | null> {
  const clip = useAssetPreviewStore.getState().previewAsset;
  if (!clip) return null;
  const [info, range] = await Promise.all([
    fetchSourceInfo(projectId, clip),
    sourceViewerRange(projectId, clip),
  ]);
  return { path: await projectPathOf(projectId, clip), info, range };
}

type EditDeps = Omit<UseSourceEditOpsOptions, "projectIdRef" | "isRecordingRef" | "showToast">;

/** The edit itself: plan against the current timeline, one history-backed write, refresh. */
async function runSourceEdit(pid: string, mode: SourceEditMode, deps: EditDeps): Promise<void> {
  const clip = await sourceClipToEdit(pid);
  if (!clip) return;
  const targetPath = deps.activeCompPath || "index.html";
  const { elements, selected, playhead } = timelineSnapshot(targetPath, deps.activeCompPath);
  const planned = planSourceClipEdit(elements, selected, clip, mode, playhead);
  if (deps.checkEditable && !deps.checkEditable(planned.touched)) return;
  const newId = { value: "" };
  await saveProjectFilesWithHistory({
    projectId: pid,
    label: LABELS[mode],
    files: {
      [targetPath]: (original: string) =>
        rewriteForSourceEdit(original, targetPath, clip, planned, newId),
    },
    readFile: (path) => readFileContent(pid, path),
    writeFile: deps.writeProjectFile,
    recordEdit: deps.recordEdit,
  });
  selectAndRevealTimelineElement(deriveTimelineStoreKeyForDomId(newId.value, targetPath));
  deps.forceReloadSdkSession?.();
  deps.reloadPreview();
}

/**
 * Registers the source viewer's Insert / Overwrite / Append (sourceViewerBridge.commit)
 * with the editor's write, history and refresh path.
 */
export function useSourceEditOps(options: UseSourceEditOpsOptions): void {
  const { projectIdRef, activeCompPath, showToast, writeProjectFile, recordEdit } = options;
  const { reloadPreview, isRecordingRef, forceReloadSdkSession, checkEditable } = options;

  const commit = useCallback(
    async (mode: SourceEditMode) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const deps = {
        activeCompPath,
        writeProjectFile,
        recordEdit,
        reloadPreview,
        forceReloadSdkSession,
        checkEditable,
      };
      await runSourceEdit(pid, mode, deps).catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : `${LABELS[mode]} failed`);
      });
    },
    [
      projectIdRef,
      activeCompPath,
      showToast,
      writeProjectFile,
      recordEdit,
      reloadPreview,
      isRecordingRef,
      forceReloadSdkSession,
      checkEditable,
    ],
  );

  useEffect(() => {
    sourceViewerBridge.commit = commit;
    return () => {
      if (sourceViewerBridge.commit === commit) sourceViewerBridge.commit = null;
    };
  }, [commit]);
}

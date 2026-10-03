/**
 * Tiny Zustand slice that carries the "asset preview overlay" state.
 *
 * When a user clicks an asset card that has NOT yet been added to the
 * timeline the overlay fires up: a dark scrim + centered media element
 * (img / video / audio) + filename label rendered inside PreviewPane.
 *
 * State lives here so AssetsTab (sidebar) and PreviewPane (preview column)
 * can communicate without prop-drilling through the multi-layer EditorShell
 * tree. The store is project-scoped: NLEProvider (NLEContext.tsx) clears it
 * whenever `projectId` changes, so a preview opened in one project can't
 * bleed into another (the overlay itself stays mounted across project
 * switches — EditorShell isn't keyed by projectId).
 */
import { create } from "zustand";
import { NO_MARKS, type SourceMarks } from "./sourceMarks";

interface AssetPreviewState {
  /** Asset being previewed: project-relative, or an absolute path when `previewExternal`. */
  previewAsset: string | null;
  /** True when `previewAsset` is a file outside the project (opened from Media Storage). */
  previewExternal: boolean;
  /** projectId for which the preview was opened (used to build the serve URL). */
  previewProjectId: string | null;
  /** Source viewer in/out marks per previewed path, kept for the session. */
  marks: Record<string, SourceMarks>;
  /** Open a media preview for the given project asset. */
  setPreviewAsset: (asset: string, projectId: string) => void;
  /** Open a file outside the project (absolute path) in the source viewer. */
  setPreviewExternal: (absolutePath: string, projectId: string) => void;
  setMarks: (path: string, marks: SourceMarks) => void;
  /** Close the preview overlay. Marks are kept. */
  clearPreviewAsset: () => void;
}

export const useAssetPreviewStore = create<AssetPreviewState>((set) => ({
  previewAsset: null,
  previewExternal: false,
  previewProjectId: null,
  marks: {},
  setPreviewAsset: (asset, projectId) =>
    set({ previewAsset: asset, previewExternal: false, previewProjectId: projectId }),
  setPreviewExternal: (absolutePath, projectId) =>
    set({ previewAsset: absolutePath, previewExternal: true, previewProjectId: projectId }),
  setMarks: (path, marks) => set((state) => ({ marks: { ...state.marks, [path]: marks } })),
  clearPreviewAsset: () =>
    set({ previewAsset: null, previewExternal: false, previewProjectId: null }),
}));

/** Marks of `path`, or none. */
export function marksFor(path: string | null): SourceMarks {
  return (path && useAssetPreviewStore.getState().marks[path]) || NO_MARKS;
}

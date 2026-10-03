import { useCallback, useEffect, useRef, useState } from "react";
import { MusicNote, X } from "@phosphor-icons/react";
import { useAssetPreviewStore } from "../../../utils/assetPreviewStore";
import { markIn, markOut, NO_MARKS, type SourceMarks } from "../../../utils/sourceMarks";
import {
  EDIT_ACTIONS,
  sourceKeyAction,
  type SourceKeyAction,
} from "../../../utils/sourceViewerKeys";
import type { SourceEditMode } from "../../../utils/sourceEditPlan";
import {
  SOURCE_VIEWER_DRAG_PATH,
  sourceViewerBridge,
  writeMediaDrag,
} from "../../../utils/sourceViewerDrag";
import { isTypingTarget } from "../../../utils/typingTarget";
import { flatIdle } from "../../timelineToolbarStyles";
import { useSourceMedia, type SourceMediaKind } from "./useSourceMedia";
import { useSourceTransport, type SourceTransport } from "./useSourceTransport";
import { SourceScrubBar } from "./SourceScrubBar";
import { SourceControls } from "./SourceControls";

interface SourceViewerProps {
  projectId: string;
  path: string;
  external: boolean;
  onClose: () => void;
}

const basename = (path: string) => path.split("/").pop() ?? path;

function SourceMediaElement(props: {
  kind: SourceMediaKind;
  url: string | null;
  name: string;
  onMedia: (el: HTMLMediaElement | null) => void;
}) {
  if (!props.url) return <span className="text-[11px] text-neutral-600">Loading…</span>;
  if (props.kind === "image") {
    return (
      <img src={props.url} alt={props.name} className="max-h-full max-w-full object-contain" />
    );
  }
  if (props.kind === "audio") {
    return (
      <div className="flex flex-col items-center gap-2 text-neutral-600">
        <MusicNote size={40} weight="light" />
        <audio ref={props.onMedia} src={props.url} preload="auto" />
      </div>
    );
  }
  return (
    <video
      ref={props.onMedia}
      src={props.url}
      preload="auto"
      playsInline
      className="max-h-full max-w-full object-contain"
    />
  );
}

type ActionHandlers = Record<SourceKeyAction, (e: { shiftKey: boolean }) => void>;

function useActionHandlers(
  transport: SourceTransport,
  duration: number,
  marks: SourceMarks,
  setMarks: (marks: SourceMarks) => void,
  edit: (mode: SourceEditMode) => void,
  onClose: () => void,
): ActionHandlers {
  return {
    togglePlay: transport.togglePlay,
    shuttleForward: () => transport.shuttle("forward"),
    shuttleBackward: () => transport.shuttle("backward"),
    stop: transport.stop,
    stepBack: (e) => transport.step(e.shiftKey ? -10 : -1),
    stepForward: (e) => transport.step(e.shiftKey ? 10 : 1),
    markIn: () => setMarks(markIn(marks, transport.time, duration)),
    markOut: () => setMarks(markOut(marks, transport.time, duration)),
    clearIn: () => setMarks({ ...marks, in: null }),
    clearOut: () => setMarks({ ...marks, out: null }),
    clearBoth: () => setMarks(NO_MARKS),
    goIn: () => transport.seek(marks.in ?? 0),
    goOut: () => transport.seek(marks.out ?? duration),
    insert: () => edit("insert"),
    overwrite: () => edit("overwrite"),
    append: () => edit("append"),
    close: onClose,
  };
}

/**
 * Resolve's source viewer, shown over the Viewer while a clip is open: play
 * and shuttle the clip, mark a range, and edit it into the timeline.
 */
export function SourceViewer({ projectId, path, external, onClose }: SourceViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [media, setMedia] = useState<HTMLMediaElement | null>(null);
  const source = useSourceMedia(projectId, path, external);
  const [mediaDuration, setMediaDuration] = useState(0);
  const duration = source.info?.duration || mediaDuration;
  const fps = source.info?.fps || 30;
  const transport = useSourceTransport(media, fps, duration);
  const marks = useAssetPreviewStore((s) => s.marks[path]) ?? NO_MARKS;
  const setStoreMarks = useAssetPreviewStore((s) => s.setMarks);
  const setMarks = useCallback(
    (next: SourceMarks) => setStoreMarks(path, next),
    [path, setStoreMarks],
  );
  const edit = useCallback(
    (mode: SourceEditMode) => {
      transport.stop();
      void sourceViewerBridge.commit?.(mode);
    },
    [transport],
  );
  const handlers = useActionHandlers(transport, duration, marks, setMarks, edit, onClose);
  const hasTransport = source.kind !== "image";

  useEffect(() => rootRef.current?.focus({ preventScroll: true }), [path]);
  useEffect(() => {
    if (!media) return;
    const read = () => setMediaDuration(Number.isFinite(media.duration) ? media.duration : 0);
    media.addEventListener("durationchange", read);
    return () => media.removeEventListener("durationchange", read);
  }, [media]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    const action = sourceKeyAction(e);
    if (!action || (!hasTransport && !EDIT_ACTIONS.has(action) && action !== "close")) return;
    e.preventDefault();
    e.stopPropagation();
    handlers[action](e);
  };

  // Edits answer F9 / F10 / Shift+F12 from anywhere while the viewer is open, as in Resolve.
  const editRef = useRef(edit);
  editRef.current = edit;
  useEffect(() => {
    const onWindowKey = (e: KeyboardEvent) => {
      const action = sourceKeyAction(e);
      if (!action || !EDIT_ACTIONS.has(action) || isTypingTarget(e.target)) return;
      if (rootRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      editRef.current(action as SourceEditMode);
    };
    window.addEventListener("keydown", onWindowKey);
    return () => window.removeEventListener("keydown", onWindowKey);
  }, []);

  const name = basename(path);
  return (
    <div
      ref={rootRef}
      data-source-viewer=""
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute inset-0 flex flex-col bg-[var(--studio-preview-bg,var(--color-neutral-950))] outline-hidden"
    >
      <div className="flex h-7 shrink-0 items-center gap-1.5 pl-2.5 pr-1 text-[11px]">
        <span className="text-neutral-500">Source</span>
        <span className="text-neutral-700">·</span>
        <span className="min-w-0 truncate text-neutral-300" title={path}>
          {name}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close source viewer (Esc)"
          onClick={onClose}
          className={flatIdle}
        >
          <X size={13} />
        </button>
      </div>
      <div
        draggable
        onDragStart={(e) => writeMediaDrag(e, SOURCE_VIEWER_DRAG_PATH)}
        onClick={() => rootRef.current?.focus({ preventScroll: true })}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2"
      >
        <SourceMediaElement kind={source.kind} url={source.url} name={name} onMedia={setMedia} />
      </div>
      {hasTransport && (
        <div className="shrink-0 px-2.5 pt-1">
          <SourceScrubBar
            duration={duration}
            time={transport.time}
            marks={marks}
            onSeek={transport.seek}
            onScrubStart={transport.stop}
          />
        </div>
      )}
      <SourceControls
        hasTransport={hasTransport}
        time={transport.time}
        duration={duration}
        fps={fps}
        marks={marks}
        speed={transport.speed}
        onTogglePlay={transport.togglePlay}
        onStep={transport.step}
        onMarkIn={() => handlers.markIn({ shiftKey: false })}
        onMarkOut={() => handlers.markOut({ shiftKey: false })}
        onEdit={edit}
        onDragStart={(e) => writeMediaDrag(e, SOURCE_VIEWER_DRAG_PATH)}
      />
    </div>
  );
}

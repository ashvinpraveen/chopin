import type { ReactNode } from "react";
import { CaretLeft, CaretRight, DotsSixVertical, Pause, Play } from "@phosphor-icons/react";
import { Tooltip } from "../../ui/Tooltip";
import { flatIdle, flatModeOn } from "../../timelineToolbarStyles";
import { formatSourceTimecode, markedRange, type SourceMarks } from "../../../utils/sourceMarks";
import type { SourceEditMode } from "../../../utils/sourceEditPlan";

interface SourceControlsProps {
  hasTransport: boolean;
  time: number;
  duration: number;
  fps: number;
  marks: SourceMarks;
  speed: number;
  onTogglePlay: () => void;
  onStep: (frames: number) => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onEdit: (mode: SourceEditMode) => void;
  onDragStart: (e: React.DragEvent) => void;
}

function IconButton(props: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip label={props.label}>
      <button
        type="button"
        aria-label={props.label}
        onClick={props.onClick}
        className={props.active ? flatModeOn : flatIdle}
      >
        {props.children}
      </button>
    </Tooltip>
  );
}

/** Resolve-style edit glyphs, drawn on a 16px grid in the current colour. */
const EDIT_GLYPHS: Record<SourceEditMode, ReactNode> = {
  insert: <path d="M1.5 9.5h4v4h-4zM10.5 9.5h4v4h-4zM8 2v6M5.5 5.5 8 8l2.5-2.5" />,
  overwrite: <path d="M2.5 9.5h11v4h-11zM8 1.5v5.5M5.5 4.5 8 7l2.5-2.5" />,
  append: <path d="M1.5 9.5h6v4h-6zM9.5 11.5h5M12.5 9.5l2 2-2 2" />,
};

function EditGlyph({ mode }: { mode: SourceEditMode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {EDIT_GLYPHS[mode]}
    </svg>
  );
}

function MarkGlyph({ side }: { side: "in" | "out" }) {
  const d = side === "in" ? "M10 3H6v10h4" : "M6 3h4v10H6";
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const EDIT_BUTTONS: Array<{ mode: SourceEditMode; label: string }> = [
  { mode: "insert", label: "Insert at playhead (F10)" },
  { mode: "overwrite", label: "Overwrite at playhead (F9)" },
  { mode: "append", label: "Append to end (Shift+F12)" },
];

function Timecode({ label, value, fps }: { label: string; value: number | null; fps: number }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-neutral-600">{label}</span>
      <span className={value == null ? "text-neutral-600" : "text-neutral-400"}>
        {value == null ? "--:--:--:--" : formatSourceTimecode(value, fps)}
      </span>
    </span>
  );
}

/** The source viewer's bottom row: timecodes, transport, marks, edit buttons and drag handle. */
export function SourceControls(props: SourceControlsProps) {
  const { time, duration, fps, marks, speed } = props;
  const range = markedRange(marks, duration);
  return (
    <div className="flex shrink-0 items-center gap-2 px-2 pb-1.5 font-mono text-[11px] tabular-nums">
      <span className="w-[84px] shrink-0 text-neutral-200" aria-label="Source timecode">
        {formatSourceTimecode(props.hasTransport ? time : 0, fps)}
      </span>
      {props.hasTransport && (
        <div className="flex items-center">
          <IconButton label="Mark in (I)" onClick={props.onMarkIn} active={marks.in != null}>
            <MarkGlyph side="in" />
          </IconButton>
          <IconButton label="Previous frame (←)" onClick={() => props.onStep(-1)}>
            <CaretLeft size={14} />
          </IconButton>
          <IconButton
            label={speed !== 0 ? "Stop (K)" : "Play (Space / L)"}
            onClick={props.onTogglePlay}
          >
            {speed !== 0 ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
          </IconButton>
          <IconButton label="Next frame (→)" onClick={() => props.onStep(1)}>
            <CaretRight size={14} />
          </IconButton>
          <IconButton label="Mark out (O)" onClick={props.onMarkOut} active={marks.out != null}>
            <MarkGlyph side="out" />
          </IconButton>
          {Math.abs(speed) > 1 && <span className="px-1 text-neutral-500">{speed}x</span>}
        </div>
      )}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-3 overflow-hidden whitespace-nowrap">
        {props.hasTransport && (
          <>
            <Timecode label="In" value={marks.in} fps={fps} />
            <Timecode label="Out" value={marks.out} fps={fps} />
            <Timecode label="Dur" value={range.duration} fps={fps} />
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        {EDIT_BUTTONS.map(({ mode, label }) => (
          <IconButton key={mode} label={label} onClick={() => props.onEdit(mode)}>
            <EditGlyph mode={mode} />
          </IconButton>
        ))}
        <Tooltip label="Drag the marked range to the timeline">
          <div
            draggable
            onDragStart={props.onDragStart}
            aria-label="Drag to timeline"
            className="flex h-7 w-5 cursor-grab items-center justify-center text-neutral-600 hover:text-neutral-300"
          >
            <DotsSixVertical size={14} />
          </div>
        </Tooltip>
      </div>
    </div>
  );
}

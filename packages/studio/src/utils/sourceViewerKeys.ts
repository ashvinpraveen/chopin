/**
 * Source viewer keyboard map (Resolve's), pure. Letters match on `code` so
 * Alt+I (which types "ˆ" on a Mac) still reads as I.
 */
export type SourceKeyAction =
  | "togglePlay"
  | "shuttleForward"
  | "shuttleBackward"
  | "stop"
  | "stepBack"
  | "stepForward"
  | "markIn"
  | "markOut"
  | "clearIn"
  | "clearOut"
  | "clearBoth"
  | "goIn"
  | "goOut"
  | "insert"
  | "overwrite"
  | "append"
  | "close";

export interface SourceKeyEvent {
  key: string;
  code: string;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

const PLAIN: Record<string, SourceKeyAction> = {
  Space: "togglePlay",
  KeyL: "shuttleForward",
  KeyJ: "shuttleBackward",
  KeyK: "stop",
  ArrowLeft: "stepBack",
  ArrowRight: "stepForward",
  KeyI: "markIn",
  KeyO: "markOut",
  F9: "overwrite",
  F10: "insert",
  Escape: "close",
};

const ALT: Record<string, SourceKeyAction> = {
  KeyI: "clearIn",
  KeyO: "clearOut",
  KeyX: "clearBoth",
};

const SHIFT: Record<string, SourceKeyAction> = {
  KeyI: "goIn",
  KeyO: "goOut",
  F12: "append",
  ArrowLeft: "stepBack",
  ArrowRight: "stepForward",
};

/** Keys that edit into the timeline, honoured while the viewer is open even when it lacks focus. */
export const EDIT_ACTIONS: ReadonlySet<SourceKeyAction> = new Set([
  "insert",
  "overwrite",
  "append",
]);

export function sourceKeyAction(e: SourceKeyEvent): SourceKeyAction | null {
  if (e.metaKey || e.ctrlKey) return null;
  const code = e.code || (e.key === " " ? "Space" : e.key);
  if (e.altKey) return e.shiftKey ? null : (ALT[code] ?? null);
  if (e.shiftKey) return SHIFT[code] ?? null;
  return PLAIN[code] ?? null;
}

/** Shuttle speeds, J/L pressed repeatedly. */
export const SOURCE_SHUTTLE_SPEEDS = [1, 2, 4, 8] as const;

/** Next shuttle speed index: faster in the same direction, back to 1x on a change. */
export function nextShuttleIndex(
  current: { direction: "forward" | "backward" | null; index: number },
  direction: "forward" | "backward",
): number {
  if (current.direction !== direction) return 0;
  return Math.min(current.index + 1, SOURCE_SHUTTLE_SPEEDS.length - 1);
}

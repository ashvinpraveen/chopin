// Resolve-quiet icon buttons: a transparent 28px hit area, no fills. State is
// carried by the icon colour alone.
export const flatBtn = "flex h-7 w-7 items-center justify-center rounded-md transition-colors";
/** A plain action button (undo, split, add). */
export const flatIdle = `${flatBtn} text-text-2 hover:text-text-0 active:scale-[0.98]`;
/** A toggle that is off: dim, so on and off read apart at a glance. */
export const flatOff = `${flatBtn} text-text-off hover:text-text-2 active:scale-[0.98]`;
/** A panel or visibility toggle that is on. */
export const flatActive = `${flatBtn} text-text-0 active:scale-[0.98]`;
/** An editing-mode toggle (snapping, ripple, linked selection) that is on. */
export const flatModeOn = `${flatBtn} text-studio-accent active:scale-[0.98]`;
export const flatDisabled = `${flatBtn} text-text-off cursor-not-allowed`;

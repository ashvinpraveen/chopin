// Resolve-quiet icon buttons: a transparent 28px hit area, no fills. State is
// carried by the icon colour alone: mid grey when off, near-white when on.
export const flatBtn = "flex h-7 w-7 items-center justify-center rounded-md transition-colors";
export const flatIdle = `${flatBtn} text-text-2 hover:text-text-1 active:scale-[0.98]`;
export const flatActive = `${flatBtn} text-text-0 active:scale-[0.98]`;
export const flatDisabled = `${flatBtn} text-text-off cursor-not-allowed`;

/**
 * The one owner of a context menu's spacing. A hovered row fills its whole row: the panel pads nothing around its
 * rows and a divider carries no margin, so the highlight reaches the panel's edge and the divider. A menu that adds
 * `py-*` to its panel or `my-*` to a divider brings the dark bands back; menuStyle.test.ts holds every `role="menu"`
 * to this module.
 */

const PANEL = "rounded-md border border-neutral-700 bg-neutral-900 shadow-lg";

/** Clips its first and last row to the panel's rounded corners. */
export const MENU_PANEL = `${PANEL} overflow-hidden`;

/** For a panel whose submenu opens outside it, which a clip would cut off; its rows reach the corners square. */
export const MENU_PANEL_OPEN = PANEL;

/** A group of rows ending in a divider; an empty group takes no room. */
export const MENU_GROUP = "empty:hidden border-b border-neutral-700/60";

/** A line between two rows. */
export const MENU_DIVIDER = "border-t border-neutral-700/60";

/** A row's size and shape; tone, layout (`flex`, `justify-between`) and focus come from the caller. */
export const MENU_ROW = "w-full px-3 py-1.5 text-left text-xs outline-hidden";

export const MENU_ROW_ENABLED =
  "text-neutral-300 hover:bg-neutral-800 focus-visible:bg-neutral-800 cursor-pointer";

export const MENU_ROW_DANGER =
  "text-danger-ink hover:bg-danger/25 focus-visible:bg-danger/25 cursor-pointer";

export const MENU_ROW_DISABLED = "text-neutral-600 cursor-not-allowed";

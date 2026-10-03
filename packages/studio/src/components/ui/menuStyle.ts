/**
 * The one owner of a context menu's spacing and shape. A hovered row fills its whole row: the panel pads nothing
 * around its rows and a divider carries no margin, so the highlight reaches the panel's edge and the divider; the
 * panel clips its rows to its own rounded corners, so a highlight never pokes out past the border. A menu that adds
 * `py-*` to its panel or `my-*` to a divider brings the dark bands back, and a menu that clips nothing lets a square
 * highlight out of its corner; menuStyle.test.ts holds every hand-built menu panel to this module.
 */
export const menuClasses = {
  /** The panel: fill, border, shadow and radius on one element, clipped to that radius. A submenu inside it is
   * `position: fixed` so the clip does not cut it off. */
  panel:
    "overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-lg",
  /** A group of rows ending in a divider; an empty group takes no room. */
  group: "empty:hidden border-b border-neutral-700/60",
  /** A line between two rows. */
  divider: "border-t border-neutral-700/60",
  /** A row's size and shape; tone, layout (`flex`, `justify-between`) and focus come from the caller. */
  row: "w-full px-3 py-1.5 text-left text-xs outline-hidden",
  rowEnabled:
    "text-neutral-300 hover:bg-neutral-800 focus-visible:bg-neutral-800 cursor-pointer",
  rowDanger:
    "text-danger-ink hover:bg-danger/25 focus-visible:bg-danger/25 cursor-pointer",
  rowDisabled: "text-neutral-600 cursor-not-allowed",
} as const;

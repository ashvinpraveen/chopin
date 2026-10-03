import { useCallback, useEffect, useRef, useState } from "react";
import { type MediaCategory, CATEGORY_LABELS, FILTER_ORDER } from "./assetHelpers";
import type { UsageFilter } from "./AssetsTab";

export const ICON_BUTTON =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-panel-text-3 transition-colors enabled:hover:bg-panel-input enabled:hover:text-panel-text-1 disabled:opacity-60";

function MenuItem({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition-colors hover:bg-panel-input ${
        selected ? "text-panel-text-1" : "text-panel-text-3"
      }`}
    >
      <span className="w-3 shrink-0" aria-hidden="true">
        {selected && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12l5 5L20 7" />
          </svg>
        )}
      </span>
      <span className="flex-1">{children}</span>
    </button>
  );
}

const MENU_SECTION = "px-2 pt-1.5 pb-0.5 text-[10px] text-panel-text-5";

/** Closes a popover on a pointer-down outside `ref` or on Escape. */
function useDismissOnOutside(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

function KindAndUsageItems({
  activeFilter,
  onFilter,
  counts,
  usageFilter,
  onUsageFilter,
  usageCounts,
}: {
  activeFilter: MediaCategory | "all";
  onFilter: (f: MediaCategory | "all") => void;
  counts: Record<string, number>;
  usageFilter: UsageFilter;
  onUsageFilter: (f: UsageFilter) => void;
  usageCounts: { used: number; unused: number };
}) {
  return (
    <>
      <div className={MENU_SECTION}>Kind</div>
      <MenuItem selected={activeFilter === "all"} onClick={() => onFilter("all")}>
        All {counts.all}
      </MenuItem>
      {FILTER_ORDER.map((cat) =>
        counts[cat] > 0 ? (
          <MenuItem key={cat} selected={activeFilter === cat} onClick={() => onFilter(cat)}>
            {CATEGORY_LABELS[cat]} {counts[cat]}
          </MenuItem>
        ) : null,
      )}
      {usageCounts.used > 0 && usageCounts.unused > 0 && (
        <>
          <div className={MENU_SECTION}>Usage</div>
          <MenuItem selected={usageFilter === "all"} onClick={() => onUsageFilter("all")}>
            Any
          </MenuItem>
          <MenuItem selected={usageFilter === "used"} onClick={() => onUsageFilter("used")}>
            In use {usageCounts.used}
          </MenuItem>
          <MenuItem selected={usageFilter === "unused"} onClick={() => onUsageFilter("unused")}>
            Unused {usageCounts.unused}
          </MenuItem>
        </>
      )}
    </>
  );
}

/** Filter menu: kind filters, usage filters and the project scope behind one funnel. */
export function FilterMenu({
  viewMode,
  onViewMode,
  activeFilter,
  onFilter,
  counts,
  usageFilter,
  onUsageFilter,
  usageCounts,
  showKinds,
}: {
  viewMode: "local" | "global";
  onViewMode: (m: "local" | "global") => void;
  activeFilter: MediaCategory | "all";
  onFilter: (f: MediaCategory | "all") => void;
  counts: Record<string, number>;
  usageFilter: UsageFilter;
  onUsageFilter: (f: UsageFilter) => void;
  usageCounts: { used: number; unused: number };
  showKinds: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutside(open, rootRef, close);
  const filtered = viewMode !== "local" || activeFilter !== "all" || usageFilter !== "all";
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="Filter"
        title="Filter"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${ICON_BUTTON} ${filtered || open ? "text-panel-text-1" : ""}`}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Filter assets"
          className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md bg-raised p-1 shadow-lg"
        >
          {viewMode === "local" && showKinds && (
            <KindAndUsageItems
              activeFilter={activeFilter}
              onFilter={onFilter}
              counts={counts}
              usageFilter={usageFilter}
              onUsageFilter={onUsageFilter}
              usageCounts={usageCounts}
            />
          )}
          <div className={MENU_SECTION}>Scope</div>
          <MenuItem selected={viewMode === "local"} onClick={() => onViewMode("local")}>
            This project
          </MenuItem>
          <MenuItem selected={viewMode === "global"} onClick={() => onViewMode("global")}>
            All projects
          </MenuItem>
        </div>
      )}
    </div>
  );
}

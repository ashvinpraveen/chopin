import { memo, useEffect, useRef, useState } from "react";
import { MusicNote } from "@phosphor-icons/react";
import { fetchSourceInfo, sourceThumbnailUrl } from "../../utils/sourceMediaApi";
import { writeMediaDrag } from "../../utils/sourceViewerDrag";
import { formatDuration, truncateMiddle } from "./assetHelpers";
import type { StorageEntry } from "./mediaStorageEntries";

/** True once the element has come near the scroll viewport (and stays true). */
function useNearView(ref: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) setNear(true);
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, near]);
  return near;
}

function useDurationLabel(projectId: string, entry: StorageEntry, near: boolean): string {
  const [label, setLabel] = useState("");
  const timed = entry.kind === "video" || entry.kind === "audio";
  useEffect(() => {
    if (!near || !timed) return;
    let cancelled = false;
    void fetchSourceInfo(projectId, entry.path).then((info) => {
      if (!cancelled && info?.duration) setLabel(formatDuration(info.duration));
    });
    return () => {
      cancelled = true;
    };
  }, [near, timed, projectId, entry.path]);
  return label;
}

interface StorageCardProps {
  projectId: string;
  entry: StorageEntry;
  selected: boolean;
  onSelect: (entry: StorageEntry) => void;
  onLink: (entry: StorageEntry) => void;
}

const StorageCard = memo(function StorageCard({
  projectId,
  entry,
  selected,
  onSelect,
  onLink,
}: StorageCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearView(ref);
  const duration = useDurationLabel(projectId, entry, near);
  const [failed, setFailed] = useState(false);
  const picture = entry.kind !== "audio" && near && !failed;
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      draggable
      data-kind={entry.kind}
      title={entry.path}
      onClick={() => onSelect(entry)}
      onDoubleClick={() => onLink(entry)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onLink(entry);
      }}
      onDragStart={(e) => writeMediaDrag(e, entry.path)}
      className={`flex cursor-pointer select-none flex-col gap-1 rounded-md p-1 outline-hidden transition-colors ${
        selected ? "bg-neutral-800/70" : "hover:bg-neutral-800/40 focus-visible:bg-neutral-800/50"
      }`}
    >
      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-sm bg-neutral-900">
        {picture && (
          <img
            src={sourceThumbnailUrl(projectId, entry.path, 240)}
            alt=""
            draggable={false}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        )}
        {entry.kind === "audio" && (
          <MusicNote size={22} weight="light" className="text-neutral-600" />
        )}
        {duration && (
          <span className="absolute right-1 top-1 rounded-sm bg-neutral-950/80 px-1.5 py-[3px] text-[9px] font-medium leading-none tabular-nums text-panel-text-2">
            {duration}
          </span>
        )}
      </div>
      <span className="text-center text-[10px] leading-tight text-panel-text-4">
        {truncateMiddle(entry.name, 22)}
      </span>
    </div>
  );
});

interface MediaStorageGridProps {
  projectId: string;
  entries: StorageEntry[];
  selected: string | null;
  onSelect: (entry: StorageEntry) => void;
  onLink: (entry: StorageEntry) => void;
}

/** Media files of the open folder as Media Pool–style cards, thumbnails loaded as they scroll in. */
export function MediaStorageGrid({
  projectId,
  entries,
  selected,
  onSelect,
  onLink,
}: MediaStorageGridProps) {
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1 px-1 pb-1 pt-1">
      {entries.map((entry) => (
        <StorageCard
          key={entry.path}
          projectId={projectId}
          entry={entry}
          selected={entry.path === selected}
          onSelect={onSelect}
          onLink={onLink}
        />
      ))}
    </div>
  );
}

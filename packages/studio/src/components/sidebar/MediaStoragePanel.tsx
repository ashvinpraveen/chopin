import { memo, useCallback, useEffect, useState } from "react";
import { File, FilmStrip, Folder, Image, MusicNote, Plus, type Icon } from "@phosphor-icons/react";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";
import { buildProjectApiPath } from "../../utils/projectRouting";

type StorageEntryKind = "dir" | "video" | "audio" | "image" | "other";

interface StorageEntry {
  name: string;
  path: string;
  kind: StorageEntryKind;
  size: number;
  mtime: number;
}

interface StorageRoot {
  name: string;
  path: string;
}

const KIND_ICONS: Record<StorageEntryKind, Icon> = {
  dir: Folder,
  video: FilmStrip,
  audio: MusicNote,
  image: Image,
  other: File,
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Breadcrumb segments for an absolute path: each with the path it navigates to. */
export function breadcrumbs(path: string): { name: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  const crumbs = [{ name: "/", path: "/" }];
  parts.forEach((name, i) => crumbs.push({ name, path: `/${parts.slice(0, i + 1).join("/")}` }));
  return crumbs;
}

function isMedia(entry: StorageEntry): boolean {
  return entry.kind === "video" || entry.kind === "audio" || entry.kind === "image";
}

interface MediaStoragePanelProps {
  projectId: string;
  /** Called after a file is linked into the project, with its project-relative path. */
  onLinked?: (path: string) => void | Promise<void>;
}

// fallow-ignore-next-line complexity
export const MediaStoragePanel = memo(function MediaStoragePanel({
  projectId,
  onLinked,
}: MediaStoragePanelProps) {
  const [roots, setRoots] = useState<StorageRoot[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fs/roots")
      .then((res) => (res.ok ? res.json() : { roots: [] }))
      .then((data: { roots?: StorageRoot[] }) => {
        if (cancelled) return;
        const list = data.roots ?? [];
        setRoots(list);
        setPath((current) => current ?? list[0]?.path ?? null);
      })
      .catch(() => !cancelled && setStatus("Could not load locations"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setSelected(null);
    fetch(`/api/fs/list?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        const data = (await res.json()) as {
          error?: string;
          entries?: StorageEntry[];
          truncated?: boolean;
        };
        if (cancelled) return;
        if (!res.ok) {
          setEntries([]);
          setStatus(data.error ?? `Could not open folder (${res.status})`);
          return;
        }
        setEntries(data.entries ?? []);
        setTruncated(Boolean(data.truncated));
        setStatus(null);
      })
      .catch(() => !cancelled && setStatus("Could not open folder"));
    return () => {
      cancelled = true;
    };
  }, [path]);

  const link = useCallback(
    async (entry: StorageEntry) => {
      if (!isMedia(entry) || linking) return;
      setLinking(true);
      try {
        const res = await fetch(buildProjectApiPath(projectId, "media/link"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: entry.path }),
        });
        const data = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!res.ok || !data.path) {
          setStatus(data.error ?? `Could not add ${entry.name}`);
          return;
        }
        setStatus(`Linked ${entry.name} as ${data.path}`);
        await onLinked?.(data.path);
      } catch {
        setStatus(`Could not add ${entry.name}`);
      } finally {
        setLinking(false);
      }
    },
    [linking, onLinked, projectId],
  );

  const open = (entry: StorageEntry) => {
    if (entry.kind === "dir") setPath(entry.path);
    else void link(entry);
  };

  const selectedEntry = entries.find((e) => e.path === selected) ?? null;
  const rootValue =
    roots.find((r) => path === r.path || path?.startsWith(`${r.path}/`))?.path ?? "";

  return (
    <div className="flex h-full min-h-0 flex-col" data-media-storage>
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        <Select
          label="Location"
          value={rootValue}
          options={roots.map((r) => ({ label: r.name, value: r.path }))}
          onCommit={setPath}
          className="w-28 shrink-0"
        />
        <nav
          aria-label="Path"
          className="flex min-w-0 flex-1 items-center overflow-hidden text-[11px] text-neutral-500"
        >
          {path &&
            breadcrumbs(path).map((crumb, i, all) => (
              <span key={crumb.path} className="flex min-w-0 items-center">
                {i > 1 && <span className="px-0.5 text-neutral-700">/</span>}
                <button
                  type="button"
                  onClick={() => setPath(crumb.path)}
                  className={`truncate rounded-sm px-0.5 transition-colors hover:text-neutral-200 ${
                    i === all.length - 1 ? "text-neutral-300" : ""
                  }`}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
        </nav>
        <Tooltip label="Add to Media Pool">
          <button
            type="button"
            aria-label="Add to Media Pool"
            disabled={!selectedEntry || !isMedia(selectedEntry) || linking}
            onClick={() => selectedEntry && void link(selectedEntry)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-neutral-500 transition-colors hover:bg-neutral-800/60 hover:text-neutral-200 disabled:pointer-events-none disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1" role="listbox" aria-label="Files">
        {entries.map((entry) => {
          const KindIcon = KIND_ICONS[entry.kind];
          const active = entry.path === selected;
          return (
            <div
              key={entry.path}
              role="option"
              aria-selected={active}
              tabIndex={0}
              data-kind={entry.kind}
              onClick={() => setSelected(entry.path)}
              onDoubleClick={() => open(entry)}
              onKeyDown={(e) => {
                if (e.key === "Enter") open(entry);
              }}
              title={entry.path}
              className={`group flex cursor-default select-none items-center gap-2 rounded-sm px-1.5 py-1 text-[11px] outline-hidden transition-colors ${
                active
                  ? "bg-neutral-800/70 text-neutral-100"
                  : "text-neutral-400 hover:bg-neutral-800/40 focus-visible:bg-neutral-800/50"
              }`}
            >
              <KindIcon
                size={14}
                className={`shrink-0 transition-colors ${
                  active ? "text-neutral-300" : "text-neutral-600 group-hover:text-neutral-400"
                }`}
              />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.kind !== "dir" && (
                <span className="shrink-0 tabular-nums text-neutral-600">
                  {formatBytes(entry.size)}
                </span>
              )}
            </div>
          );
        })}
        {path && entries.length === 0 && !status && (
          <p className="px-2 py-4 text-center text-[11px] text-neutral-600">Empty folder</p>
        )}
      </div>
      {(status || truncated) && (
        <p className="shrink-0 truncate px-2 py-1 text-[10px] text-neutral-500" role="status">
          {status ?? "Showing the first 5000 items"}
        </p>
      )}
    </div>
  );
});

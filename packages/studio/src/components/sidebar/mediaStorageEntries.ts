export type StorageEntryKind = "dir" | "video" | "audio" | "image" | "other";

export interface StorageEntry {
  name: string;
  path: string;
  kind: StorageEntryKind;
  size: number;
  mtime: number;
}

export function isMediaEntry(entry: Pick<StorageEntry, "kind">): boolean {
  return entry.kind === "video" || entry.kind === "audio" || entry.kind === "image";
}

/**
 * Media Storage's mixed layout: folders (and, with "Show all files", the
 * non-media files such as camera XML sidecars) as list rows, media as a
 * thumbnail grid below them.
 */
export function partitionStorageEntries(
  entries: readonly StorageEntry[],
  showAll: boolean,
): { rows: StorageEntry[]; media: StorageEntry[] } {
  const rows = entries.filter((e) => e.kind === "dir" || (showAll && e.kind === "other"));
  return { rows, media: entries.filter(isMediaEntry) };
}

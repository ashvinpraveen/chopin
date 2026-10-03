/**
 * Client side of the source viewer endpoints (studio-server routes/sourceMedia.ts)
 * and Media Storage's link endpoint.
 */
import { buildProjectApiPath } from "./projectRouting";
import { resolveMediaPreviewUrl } from "../player/components/thumbnailUtils";

export interface SourceMediaInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  heavy: boolean;
  hostile: boolean;
  hasAudio: boolean;
  hasVideo: boolean;
}

const pathQuery = (path: string) => `path=${encodeURIComponent(path)}`;

function sourceInfoUrl(projectId: string, path: string): string {
  return `${buildProjectApiPath(projectId, "source/info")}?${pathQuery(path)}`;
}

export function sourceThumbnailUrl(projectId: string, absolutePath: string, width = 320): string {
  return `${buildProjectApiPath(projectId, "source/thumbnail")}?${pathQuery(absolutePath)}&w=${width}`;
}

/**
 * What the viewer's media element plays: a project asset through the preview
 * route, an outside file through the source route; either through the
 * segmented HLS proxy when the file is too big or not decodable as it is.
 */
export function sourcePlaybackUrl(
  projectId: string,
  path: string,
  external: boolean,
  info: Pick<SourceMediaInfo, "heavy" | "hostile" | "hasVideo"> | null,
): string {
  const proxied = Boolean(info?.hasVideo && (info.heavy || info.hostile));
  // The source route takes a project-relative path too, and proxies any video (the
  // preview route's HLS only serves heavy sources).
  if (!external && !proxied) return resolveMediaPreviewUrl(path, projectId);
  const base = `${buildProjectApiPath(projectId, "source")}?${pathQuery(path)}`;
  return proxied ? `${base}&hf-proxy=hls` : base;
}

const infoCache = new Map<string, Promise<SourceMediaInfo | null>>();

/** Cached per project + path; null when the file cannot be probed. */
export function fetchSourceInfo(projectId: string, path: string): Promise<SourceMediaInfo | null> {
  const key = `${projectId}\0${path}`;
  let pending = infoCache.get(key);
  if (!pending) {
    pending = fetch(sourceInfoUrl(projectId, path))
      .then((res) => (res.ok ? (res.json() as Promise<SourceMediaInfo>) : null))
      .catch(() => null);
    pending.then((info) => info ?? infoCache.delete(key));
    infoCache.set(key, pending);
  }
  return pending;
}

/** Symlink an outside file into the project's media/; resolves to its project path. */
export async function linkExternalMedia(projectId: string, absolutePath: string): Promise<string> {
  const res = await fetch(buildProjectApiPath(projectId, "media/link"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: absolutePath }),
  });
  const data = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? `Could not link ${absolutePath}`);
  return data.path;
}

/** An absolute filesystem path, as Media Storage hands out (never a project path). */
export function isAbsoluteMediaPath(path: string): boolean {
  return path.startsWith("/");
}

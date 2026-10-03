import {
  type Dirent,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { mkdirWithinProject, resolveWithinProject } from "../helpers/safePath.js";

// Media Storage: a read-only browser over the local filesystem, plus one explicit write — linking
// a media file into the project as a symlink, so multi-GB sources are referenced, never copied.
// The studio servers bind 127.0.0.1 and send no CORS headers, so other origins cannot read these
// responses; the link POST additionally requires a JSON content type (forces a CORS preflight).
// Nothing here reads file contents, and nothing writes or deletes outside the project's media/.

export type FsEntryKind = "dir" | "video" | "audio" | "image" | "other";

export interface FsEntry {
  name: string;
  path: string;
  kind: FsEntryKind;
  size: number;
  mtime: number;
}

export interface FsRoot {
  name: string;
  path: string;
}

const MAX_FS_ENTRIES = 5000;
const LINK_DIR = "media";

const VIDEO = new Set(["mp4", "webm", "mov", "m4v", "mkv", "avi", "mxf", "mts", "m2ts"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "aif", "aiff"]);
const IMAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "tif", "tiff", "heic"]);
const HIDDEN = new Set(["$RECYCLE.BIN", "System Volume Information", "Thumbs.db", "desktop.ini"]);

function kindOfFile(name: string): FsEntryKind {
  const ext = extname(name).slice(1).toLowerCase();
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  if (IMAGE.has(ext)) return "image";
  return "other";
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".") || HIDDEN.has(name);
}

export function listRoots(home = homedir(), volumesDir = "/Volumes"): FsRoot[] {
  const roots: FsRoot[] = [{ name: basename(home) || home, path: home }];
  let volumes: Dirent[] = [];
  try {
    volumes = readdirSync(volumesDir, { withFileTypes: true });
  } catch {
    // no /Volumes (Linux, sandbox): home only
  }
  for (const v of volumes) {
    if (isHiddenName(v.name)) continue;
    const path = join(volumesDir, v.name);
    try {
      if (!statSync(path).isDirectory()) continue;
    } catch {
      continue;
    }
    roots.push({ name: v.name, path });
  }
  return roots;
}

export type ListResult =
  | { ok: true; path: string; entries: FsEntry[]; truncated: boolean }
  | { ok: false; status: 400 | 403 | 404; error: string };

type Failure<S extends number> = { ok: false; status: S; error: string };

function fail<S extends number>(status: S, error: string): Failure<S> {
  return { ok: false, status, error };
}

function isUsableAbsolute(path: string): boolean {
  return Boolean(path) && !path.includes("\0") && isAbsolute(path);
}

function realDirectory(rawPath: string): string | Failure<400 | 404> {
  try {
    const dir = realpathSync(resolve(rawPath));
    return statSync(dir).isDirectory() ? dir : fail(400, "not a directory");
  } catch {
    return fail(404, "not found");
  }
}

/** One listing row; null for anything that is neither a file nor a folder, or a dangling link. */
function toEntry(dir: string, name: string): FsEntry | null {
  const path = join(dir, name);
  try {
    // stat follows links: a link to a folder lists as a folder.
    const st = statSync(path);
    if (st.isDirectory()) return { name, path, kind: "dir", size: 0, mtime: st.mtimeMs };
    if (!st.isFile()) return null;
    return { name, path, kind: kindOfFile(name), size: st.size, mtime: st.mtimeMs };
  } catch {
    return null;
  }
}

function compareEntries(a: FsEntry, b: FsEntry): number {
  const aDir = a.kind === "dir";
  if (aDir !== (b.kind === "dir")) return aDir ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

function collectEntries(dir: string, names: string[], max: number) {
  const entries: FsEntry[] = [];
  const visible = names.filter((name) => !isHiddenName(name));
  for (const name of visible) {
    if (entries.length >= max) return { entries, truncated: true };
    const entry = toEntry(dir, name);
    if (entry) entries.push(entry);
  }
  return { entries, truncated: false };
}

/** List one directory. The path must be absolute; symlinks are resolved before anything is read. */
export function listDirectory(rawPath: string, max = MAX_FS_ENTRIES): ListResult {
  if (!isUsableAbsolute(rawPath)) return fail(400, "absolute path required");
  const dir = realDirectory(rawPath);
  if (typeof dir !== "string") return dir;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return fail(403, "cannot read directory");
  }
  const { entries, truncated } = collectEntries(dir, names, max);
  entries.sort(compareEntries);
  return { ok: true, path: dir, entries, truncated };
}

export function sanitizeLinkName(name: string): string {
  const ext = extname(name).toLowerCase();
  const stem = name
    .slice(0, name.length - extname(name).length)
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${stem || "media"}${ext.replace(/[^\w.]/g, "")}`;
}

type LinkResult = { ok: true; path: string; existing: boolean } | Failure<400 | 403 | 404 | 409>;

/** The source's real path when it is an existing media file. */
function realMediaSource(source: string): string | Failure<400 | 404> {
  if (!isUsableAbsolute(source)) return fail(400, "absolute source path required");
  let real: string;
  try {
    real = realpathSync(source);
    if (!statSync(real).isFile()) return fail(400, "source is not a file");
  } catch {
    return fail(404, "source not found");
  }
  const media = kindOfFile(real) !== "other" && kindOfFile(source) !== "other";
  return media ? real : fail(400, "source is not a media file");
}

/** `<projectDir>/media`, created if needed; refused when it resolves outside or is itself a link. */
function linkFolder(projectDir: string): string | Failure<403> {
  const targetDir = resolveWithinProject(projectDir, LINK_DIR);
  if (!targetDir) return fail(403, "forbidden");
  if (lstatSync(targetDir, { throwIfNoEntry: false })?.isSymbolicLink()) {
    return fail(403, "media folder is a link");
  }
  mkdirWithinProject(projectDir, targetDir);
  return targetDir;
}

function candidateNames(source: string): string[] {
  const name = sanitizeLinkName(basename(source));
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  return Array.from({ length: 999 }, (_, i) => (i === 0 ? name : `${stem}-${i + 1}${ext}`));
}

/** "linked" / "existing" when this name now points at `real`, "taken" when it holds something else. */
function tryLinkAs(real: string, dest: string): "linked" | "existing" | "taken" {
  const present = lstatSync(dest, { throwIfNoEntry: false });
  if (present) {
    return present.isSymbolicLink() && linkTarget(dest) === real ? "existing" : "taken";
  }
  try {
    symlinkSync(real, dest);
    return "linked";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return "taken";
    throw err;
  }
}

/** Symlink `source` into `<projectDir>/media/`. Reuses a link already pointing at the same file. */
export function linkMediaIntoProject(projectDir: string, source: string): LinkResult {
  const real = realMediaSource(source);
  if (typeof real !== "string") return real;
  const targetDir = linkFolder(projectDir);
  if (typeof targetDir !== "string") return targetDir;
  for (const candidate of candidateNames(source)) {
    const outcome = tryLinkAs(real, join(targetDir, candidate));
    if (outcome !== "taken") {
      return { ok: true, path: `${LINK_DIR}/${candidate}`, existing: outcome === "existing" };
    }
  }
  return fail(409, "too many files with this name");
}

function linkTarget(link: string): string | null {
  try {
    return realpathSync(resolve(join(link, ".."), readlinkSync(link)));
  } catch {
    return null;
  }
}

export function registerFsBrowseRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/fs/roots", (c) => c.json({ roots: listRoots() }));

  api.get("/fs/list", (c) => {
    const result = listDirectory(c.req.query("path") ?? "");
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ path: result.path, entries: result.entries, truncated: result.truncated });
  });

  api.post("/projects/:id/media/link", async (c) => {
    const json = (c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json");
    if (!json) return c.json({ error: "application/json required" }, 415);
    const [project, source] = await Promise.all([
      adapter.resolveProject(c.req.param("id")),
      c.req.json().then(sourceOf, () => ""),
    ]);
    const result = project ? linkMediaIntoProject(project.dir, source) : fail(404, "not found");
    return result.ok
      ? c.json({ path: result.path, existing: result.existing })
      : c.json({ error: result.error }, result.status);
  });
}

function sourceOf(body: unknown): string {
  const source = (body as { source?: unknown } | null)?.source;
  return typeof source === "string" ? source : "";
}

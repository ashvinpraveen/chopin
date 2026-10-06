import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { decodeUrlPathVariants } from "./composition.js";

/** The subset of `node:path` that `isWithinProjectRoot` needs to run under
 * an injected platform (tests pass `path.win32` / `path.posix`). */
interface PathModuleLike {
  resolve: (...segments: string[]) => string;
  relative: (from: string, to: string) => string;
  isAbsolute: (path: string) => boolean;
}

/**
 * Shared local-asset resolution helpers for every package that maps
 * composition asset URLs to files on disk (lint project rules, the HEVC
 * preview check, studio-server's media codec scan). Import via the
 * `@hyperframes/parsers/asset-resolution` subpath.
 */

export function isRemoteOrInlineUrl(url: string): boolean {
  return /^(https?:|data:|blob:|\/\/|#)/i.test(url);
}

/**
 * True when a URL still contains an unresolved templating placeholder —
 * `<<token>>`, `{{ token }}`, or `${token}` — that a build or templating step
 * substitutes before render. The static linter runs before that substitution,
 * so it cannot resolve such a value to a file on disk and must not report it as
 * a missing asset. Check the RAW url, before any `cleanAssetUrl()` step: that
 * splits on `?`/`#`, which also chops inside a `${...}` expression. (The `__UPPER__`
 * placeholder shape is combined with this in `isUnresolvedAssetPlaceholder` below, the
 * shared predicate asset-src sites skip on.)
 */
export function hasUnresolvedTemplatingToken(url: string): boolean {
  return /<<[^<>]+>>|\{\{[^{}]+\}\}|\$\{[^{}]+\}/.test(url);
}

/**
 * True when an asset src is a build-time placeholder rather than a resolvable path:
 * the `__UPPER__` shape (e.g. `__DURATION__`) or an unresolved templating token
 * (`<<...>>`, `{{...}}`, `${...}`). Pass the RAW src, before any `cleanAssetUrl()` step —
 * cleanAssetUrl splits on `?`/`#`, which would chop inside a `${...}` expression and defeat
 * the token match. Remote/inline URL handling is deliberately NOT folded in: call sites
 * differ (e.g. audio uses a narrower http/data/blob check), so each keeps its own.
 *
 * This is the single skip predicate every asset-src lint / codec / compile site should
 * route through, so the placeholder rules can't drift apart across call sites.
 */
export function isUnresolvedAssetPlaceholder(rawSrc: string): boolean {
  return /^__[A-Z_]+__$/.test(rawSrc.trim()) || hasUnresolvedTemplatingToken(rawSrc);
}

/** `data-composition-src="..."`, matched within a single already-delimited tag. */
const COMPOSITION_SRC_ATTR = /\bdata-composition-src\s*=\s*["']([^"']+)["']/i;

/**
 * Every `data-composition-src` reference in one composition file's raw text, in
 * document order, deduped. The single owner of "which sub-compositions does
 * this file mount", so lint, telemetry, and any future scanner cannot drift
 * apart on the answer.
 *
 * Text-scanning rather than DOM-walking, and that is the load-bearing choice.
 * Every sub-composition except the render entry is authored inside a
 * `<template>` (the root index.html is forbidden from using that wrapper;
 * everything else prefers it). Template content is inert: it lives under
 * `template.content`, not the live document, so `document.querySelectorAll`
 * on a raw sub-composition file finds nothing and every nested reference
 * disappears. The renderer only gets away with a DOM scan because it recurses
 * on COMPILED html, where the wrapper is already gone.
 *
 * Callers must resolve each value against the PROJECT ROOT, never the
 * referencing file's directory: `data-composition-src` is root-relative at
 * every nesting level (see `parseSubCompositions` in htmlCompiler.ts).
 *
 * Comments, `<style>`, and `<script>` bodies are masked first so a
 * commented-out mount is not counted as a real one. Build-time placeholders and
 * remote or inline URLs are dropped: neither names a file on disk, and every
 * caller resolves what comes back against the project root.
 *
 * The scan walks tag by tag with `indexOf` rather than running one regex with
 * two open-ended `[^>]*` spans across the whole file. That shape is quadratic:
 * on input full of `<` with no `>`, every `<` starts a scan to end-of-string
 * that then backtracks, measured at 41ms / 165ms / 660ms / 2640ms for 10k /
 * 20k / 40k / 80k characters. This function runs on every render (via the
 * render plan), so a truncated download or a blob full of stray `<` would hang
 * the plan step before any video is produced. Bounding each regex to one
 * already-delimited tag makes the whole scan linear.
 */
export function collectSubCompositionSrcs(html: string): string[] {
  const scannable = maskNonScannableRanges(html);
  const srcs: string[] = [];
  const seen = new Set<string>();

  let cursor = 0;
  while (cursor < scannable.length) {
    const open = scannable.indexOf("<", cursor);
    if (open === -1) break;
    const close = scannable.indexOf(">", open + 1);
    // An unterminated final tag is not a tag. The previous whole-file regex
    // also required a closing `>`, so this drops nothing it used to find.
    if (close === -1) break;
    cursor = close + 1;

    const match = COMPOSITION_SRC_ATTR.exec(scannable.slice(open, cursor));
    if (!match) continue;
    const src = (match[1] ?? "").trim();
    if (!src || seen.has(src)) continue;
    // __UPPER__ placeholder or late-bound templating token — not a real reference.
    if (isUnresolvedAssetPlaceholder(src)) continue;
    // A remote or inline mount names no file on disk. Every caller resolves
    // these against the project root, so letting one through produces a
    // nonsense path (`<projectDir>/https:/host/a.html`) that then reads as a
    // missing local file: a false "does not exist" for lint, and a wasted
    // visit against the telemetry walk's file budget.
    if (isRemoteOrInlineUrl(src)) continue;
    seen.add(src);
    srcs.push(src);
  }
  return srcs;
}

export function cleanAssetUrl(url: string): string {
  return url.trim().split(/[?#]/, 1)[0] ?? "";
}

/**
 * `pathModule` defaults to the host's native `node:path`, so every existing
 * caller gets its actual OS's separator and drive-letter rules unchanged.
 * Tests inject `path.win32` / `path.posix` to exercise both platforms' rules
 * from a single OS (same pattern as producer/fileServer.ts's `isPathInside`).
 */
export function isWithinProjectRoot(
  projectDir: string,
  candidate: string,
  pathModule: PathModuleLike = { resolve, relative, isAbsolute },
): boolean {
  const projectRoot = pathModule.resolve(projectDir);
  const relativePath = pathModule.relative(projectRoot, candidate);
  return (
    relativePath === "" || (!relativePath.startsWith("..") && !pathModule.isAbsolute(relativePath))
  );
}

/**
 * Media mounts: `hyperframes.json` → `"media": { "mounts": { "footage": "../../Exports" } }`.
 * A project-relative URL whose first segment names a mount (`footage/A CAM.mov`)
 * resolves under `<projectDir>/<mountPath>/` instead of the project root. This is
 * how a project on a filesystem without symlinks (exFAT) references footage that
 * lives elsewhere on the drive. With no mounts configured every helper below
 * behaves exactly like plain project-root resolution.
 */
export interface MediaMount {
  name: string;
  /** Absolute, resolved mount root. */
  root: string;
}

const mountCache = new Map<string, { stamp: string; mounts: MediaMount[] }>();

function isValidMountName(name: string): boolean {
  return (
    name !== "" && name !== "." && name !== ".." && !/[\\/]/.test(name) && !name.includes("\0")
  );
}

function objectField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseMounts(projectRoot: string, text: string): MediaMount[] {
  const raw = objectField(objectField(parseJson(text), "media"), "mounts");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .filter(
      (entry): entry is [string, string] =>
        isValidMountName(entry[0]) && typeof entry[1] === "string" && entry[1].trim() !== "",
    )
    .map(([name, target]) => ({ name, root: resolve(projectRoot, target) }));
}

/** The project's media mounts, re-read whenever hyperframes.json's mtime or size changes. */
export function readMediaMounts(projectDir: string): MediaMount[] {
  const projectRoot = resolve(projectDir);
  const configPath = join(projectRoot, "hyperframes.json");
  let stat: ReturnType<typeof statSync> | undefined;
  try {
    stat = statSync(configPath);
  } catch {
    stat = undefined;
  }
  if (!stat?.isFile()) {
    mountCache.delete(projectRoot);
    return [];
  }
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  const cached = mountCache.get(projectRoot);
  if (cached?.stamp === stamp) return cached.mounts;
  let mounts: MediaMount[] = [];
  try {
    mounts = parseMounts(projectRoot, readFileSync(configPath, "utf-8"));
  } catch {
    mounts = [];
  }
  mountCache.set(projectRoot, { stamp, mounts });
  return mounts;
}

/** Test hook: forget every cached hyperframes.json read. */
export function clearMediaMountCache(): void {
  mountCache.clear();
}

/**
 * Resolves a project-relative URL path through a media mount. Returns null when
 * the first segment names no mount, or when the remainder would escape the
 * mount root. The path is normalised first, so `footage/../index.html` is an
 * ordinary project path, not a mount path.
 */
export function resolveMountedAssetPath(
  projectDir: string,
  relUrl: string,
): { path: string; mount: MediaMount } | null {
  const mounts = readMediaMounts(projectDir);
  if (mounts.length === 0) return null;
  const normalized = posix.normalize(relUrl.replace(/\\/g, "/").replace(/^\/+/, ""));
  const slash = normalized.indexOf("/");
  const first = slash === -1 ? normalized : normalized.slice(0, slash);
  const mount = mounts.find((m) => m.name === first);
  if (!mount) return null;
  const rest = slash === -1 ? "" : normalized.slice(slash + 1);
  const candidate = resolve(mount.root, rest);
  if (!isWithinProjectRoot(mount.root, candidate)) return null;
  return { path: candidate, mount };
}

/**
 * The file a project-relative URL path names: through a media mount when its
 * first segment is one, otherwise under the project root. Null when the path
 * escapes both.
 */
export function resolveProjectAssetPath(projectDir: string, relUrl: string): string | null {
  const mounted = resolveMountedAssetPath(projectDir, relUrl);
  if (mounted) return mounted.path;
  const projectRoot = resolve(projectDir);
  const candidate = resolve(projectRoot, relUrl.replace(/^[\\/]+/, ""));
  return isWithinProjectRoot(projectRoot, candidate) ? candidate : null;
}

/** `isWithinProjectRoot`, also accepting any path inside one of the project's media mounts. */
export function isWithinProjectOrMount(projectDir: string, candidate: string): boolean {
  if (isWithinProjectRoot(projectDir, candidate)) return true;
  return readMediaMounts(projectDir).some((m) => isWithinProjectRoot(m.root, candidate));
}

/**
 * The root-relative URL path (no leading slash, `/` separators) that serves an
 * absolute file: its project-relative path, or `<mount>/<rest>` for mounted
 * media. Null when the file is in neither.
 */
export function projectUrlPathForFile(projectDir: string, absPath: string): string | null {
  const projectRoot = resolve(projectDir);
  const candidate = resolve(absPath);
  if (isWithinProjectRoot(projectRoot, candidate)) {
    return relative(projectRoot, candidate).split(sep).join("/");
  }
  for (const mount of readMediaMounts(projectRoot)) {
    if (!isWithinProjectRoot(mount.root, candidate)) continue;
    const rest = relative(mount.root, candidate).split(sep).join("/");
    return rest ? `${mount.name}/${rest}` : mount.name;
  }
  return null;
}

function addCandidate(candidates: string[], candidate: string): void {
  if (!candidates.includes(candidate)) candidates.push(candidate);
}

export function resolveLocalAssetCandidates(projectDir: string, url: string): string[] {
  const cleanUrl = cleanAssetUrl(url);
  const projectRoot = resolve(projectDir);
  const candidates: string[] = [];

  for (const variant of decodeUrlPathVariants(cleanUrl)) {
    const projectRelative = variant.startsWith("/") ? variant.slice(1) : variant;
    const mounted = resolveMountedAssetPath(projectRoot, projectRelative);
    if (mounted) {
      addCandidate(candidates, mounted.path);
      continue;
    }
    const resolved = resolve(projectRoot, projectRelative);
    if (isWithinProjectRoot(projectRoot, resolved)) {
      addCandidate(candidates, resolved);
      continue;
    }

    const normalized = posix.normalize(projectRelative.replace(/\\/g, "/"));
    const clamped = normalized.replace(/^(\.\.\/)+/, "");
    if (clamped && !clamped.startsWith("..")) {
      addCandidate(candidates, resolve(projectRoot, clamped));
    }
  }

  return candidates;
}

export function resolveExistingLocalAsset(
  projectDir: string,
  url: string,
): { resolved: string; rootRelativePath: string } | null {
  const projectRoot = resolve(projectDir);
  const resolved = resolveLocalAssetCandidates(projectRoot, url).find(existsSync);
  if (!resolved) return null;
  const urlPath = projectUrlPathForFile(projectRoot, resolved);
  return {
    resolved,
    rootRelativePath:
      urlPath !== null && !isWithinProjectRoot(projectRoot, resolved)
        ? urlPath
        : relative(projectRoot, resolved),
  };
}

// Candidates for a variant whose join escaped the project root, re-anchored at the root.
function reanchoredCandidates(variant: string, baseDir: string, compiledDir?: string): string[] {
  const baseAbs = resolve(baseDir);
  const joinedAbs = resolve(join(baseDir, variant));
  if (joinedAbs === baseAbs || joinedAbs.startsWith(baseAbs + sep)) return [];
  // Normalize before stripping, or `assets/../../assets/foo` becomes `assets/assets/foo`.
  const stripped = posix.normalize(variant.replace(/\\/g, "/")).replace(/^(\.\.\/)+/, "");
  if (!stripped || stripped === variant || stripped.startsWith("..")) return [];
  return compiledDir
    ? [join(compiledDir, stripped), join(baseDir, stripped)]
    : [join(baseDir, stripped)];
}

/** Resolves a media `src` like a browser URL (`..` clamps at the project root); a miss returns the base-dir join. */
export function resolveProjectRelativeSrc(
  src: string,
  baseDir: string,
  compiledDir?: string,
): string {
  const cleanSrc = cleanAssetUrl(src);

  // A leading slash is an origin-root URL served from the project root, unless the absolute path exists.
  if (isAbsolute(cleanSrc) && existsSync(cleanSrc)) return cleanSrc;

  const candidates = new Set<string>();
  for (const variant of decodeUrlPathVariants(cleanSrc)) {
    const mounted = resolveMountedAssetPath(baseDir, variant);
    if (mounted) candidates.add(mounted.path);
    for (const candidate of reanchoredCandidates(variant, baseDir, compiledDir)) {
      candidates.add(candidate);
    }
    if (compiledDir) candidates.add(join(compiledDir, variant));
    candidates.add(join(baseDir, variant));
  }
  return [...candidates].find(existsSync) ?? join(baseDir, cleanSrc);
}

function maskRange(src: string, pattern: RegExp): string {
  return src.replace(pattern, (m) => " ".repeat(m.length));
}

function maskHtmlComments(src: string): string {
  const chunks: string[] = [];
  let cursor = 0;

  while (true) {
    const start = src.indexOf("<!--", cursor);
    if (start === -1) break;
    const end = src.indexOf("-->", start + 4);
    if (end === -1) break;
    const afterComment = end + 3;
    chunks.push(src.slice(cursor, start), " ".repeat(afterComment - start));
    cursor = afterComment;
  }

  return chunks.length === 0 ? src : chunks.join("") + src.slice(cursor);
}

/** Blanks out comments, `<style>`, and `<script>` bodies so tag-scanning
 * regexes don't false-positive on commented-out or scripted markup. */
export function maskNonScannableRanges(html: string): string {
  let out = maskHtmlComments(html);
  out = maskRange(out, /<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi);
  out = maskRange(out, /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi);
  return out;
}

export type ProjectFileRead =
  | { kind: "file"; text: string }
  | { kind: "folder" }
  | { kind: "missing" };

/** Reads through one descriptor, so the file-type check and the read see the same file. */
export function readProjectFile(path: string): ProjectFileRead {
  let fd: number;
  try {
    // Non-blocking so a named pipe is reported, not waited on; the mode never applies (no O_CREAT).
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0), 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (["EISDIR", "ENXIO"].includes(code)) return { kind: "folder" };
    if (["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG"].includes(code)) return { kind: "missing" };
    throw error;
  }
  try {
    if (!fstatSync(fd).isFile()) return { kind: "folder" };
    return { kind: "file", text: readFileSync(fd, "utf-8") };
  } finally {
    closeSync(fd);
  }
}

import { createReadStream, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";
import type { Context, Hono } from "hono";
import { resolveProjectAssetPath } from "@hyperframes/parsers/asset-resolution";
import type { StudioApiAdapter } from "../types.js";
import { getMimeType } from "../helpers/mime.js";
import { HLS_PROXY_VARIANT } from "../helpers/hlsProxy.js";
import { respondHls } from "../helpers/hlsProxyRoute.js";
import { probeSourceInfo, type SourceMediaInfo } from "../helpers/sourceInfo.js";
import { sourceThumbnail, thumbnailWidth } from "../helpers/sourceThumbnail.js";
import { kindOfFile, realMediaSource } from "./fsBrowse.js";

// Chopin source viewer: preview a media file that is not in the project yet, by absolute path.
// Read-only, and only ever a media file (by extension, on both the given path and its real
// target). The studio binds 127.0.0.1 and sends no CORS headers; a cross-site request (a page on
// another origin embedding the URL) is refused outright via Sec-Fetch-Site.

type Resolved = { ok: true; file: string } | { ok: false; status: 400 | 403 | 404; error: string };

function isCrossSite(c: Context): boolean {
  return (c.req.header("sec-fetch-site") ?? "").toLowerCase() === "cross-site";
}

/** An absolute path goes through Media Storage's validation; a relative one must stay in the project or a media mount. */
export function resolveSourcePath(projectDir: string, raw: string): Resolved {
  if (raw && !raw.includes("\0") && !isAbsolute(raw)) {
    const candidate = resolveProjectAssetPath(projectDir, raw);
    if (!candidate || kindOfFile(candidate) === "other") {
      return { ok: false, status: 404, error: "not found" };
    }
    try {
      const real = realpathSync(candidate);
      if (statSync(real).isFile()) return { ok: true, file: real };
    } catch {
      // fall through
    }
    return { ok: false, status: 404, error: "not found" };
  }
  const real = realMediaSource(raw);
  return typeof real === "string" ? { ok: true, file: real } : real;
}

/** Stream `file` with byte-range support so the browser can seek. */
function rangeFileResponse(file: string, rangeHeader: string | undefined): Response {
  const size = statSync(file).size;
  const headers = {
    "Content-Type": getMimeType(file),
    "Cache-Control": "private, no-cache",
    "Accept-Ranges": "bytes",
  };
  const body = (start: number, end: number) =>
    // Node's web stream type and the DOM one do not overlap for tsc; the cast is the bridge.
    Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
  const match = rangeHeader ? /bytes=(\d+)-(\d*)/.exec(rangeHeader) : null;
  if (!match) {
    return new Response(size > 0 ? body(0, size - 1) : null, {
      headers: { ...headers, "Content-Length": String(size) },
    });
  }
  const start = Number(match[1]);
  const end = Math.min(match[2] ? Number(match[2]) : size - 1, size - 1);
  if (start > end) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${size}` },
    });
  }
  return new Response(body(start, end), {
    status: 206,
    headers: {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

const STILL: SourceMediaInfo = {
  duration: 0,
  width: 0,
  height: 0,
  fps: 0,
  heavy: false,
  hostile: false,
  hasAudio: false,
  hasVideo: false,
};

async function sourceInfo(file: string): Promise<SourceMediaInfo> {
  if (kindOfFile(file) === "image") return STILL;
  return probeSourceInfo(file);
}

function segmentUriFor(raw: string): (index: number) => string {
  const path = encodeURIComponent(raw);
  return (i) => `source?path=${path}&hf-proxy=${HLS_PROXY_VARIANT}&seg=${i}`;
}

function serveSourceHls(c: Context, projectDir: string, file: string, raw: string) {
  if (kindOfFile(file) !== "video") return c.text("not a video", 422);
  return respondHls(c, projectDir, file, segmentUriFor(raw));
}

async function serveSourceThumbnail(c: Context, projectDir: string, file: string) {
  const kind = kindOfFile(file);
  if (kind !== "video" && kind !== "image") return c.text("no picture", 422);
  try {
    const duration = kind === "video" ? (await probeSourceInfo(file)).duration : null;
    const thumb = await sourceThumbnail(
      projectDir,
      file,
      thumbnailWidth(c.req.query("w")),
      duration,
    );
    return new Response(new Uint8Array(await readFile(thumb)), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    return c.text(err instanceof Error ? err.message : "thumbnail failed", 502);
  }
}

export function registerSourceMediaRoutes(api: Hono, adapter: StudioApiAdapter): void {
  const resolveRequest = async (c: Context) => {
    if (isCrossSite(c)) return { error: c.json({ error: "forbidden" }, 403) };
    const project = await adapter.resolveProject(c.req.param("id") ?? "");
    if (!project) return { error: c.json({ error: "not found" }, 404) };
    const raw = c.req.query("path") ?? "";
    const resolved = resolveSourcePath(project.dir, raw);
    if (!resolved.ok) return { error: c.json({ error: resolved.error }, resolved.status) };
    return { projectDir: project.dir, file: resolved.file, raw };
  };

  api.get("/projects/:id/source/info", async (c) => {
    const req = await resolveRequest(c);
    if ("error" in req) return req.error;
    try {
      return c.json(await sourceInfo(req.file));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "probe failed" }, 502);
    }
  });

  api.get("/projects/:id/source/thumbnail", async (c) => {
    const req = await resolveRequest(c);
    return "error" in req ? req.error : serveSourceThumbnail(c, req.projectDir, req.file);
  });

  api.get("/projects/:id/source", async (c) => {
    const req = await resolveRequest(c);
    if ("error" in req) return req.error;
    if (c.req.query("hf-proxy") === HLS_PROXY_VARIANT) {
      return serveSourceHls(c, req.projectDir, req.file, req.raw);
    }
    return rangeFileResponse(req.file, c.req.header("Range"));
  });
}

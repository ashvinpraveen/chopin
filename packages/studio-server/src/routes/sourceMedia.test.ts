// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StudioApiAdapter } from "../types";

vi.mock("../helpers/hlsProxy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../helpers/hlsProxy.js")>();
  return {
    ...actual,
    hlsPlaylist: async (_dir: string, _src: string, uri: string | ((i: number) => string)) =>
      actual.buildHlsPlaylist(13, typeof uri === "string" ? (i) => `${uri}#${i}` : uri),
  };
});

const { registerSourceMediaRoutes, resolveSourcePath } = await import("./sourceMedia");

let root: string;
let projectDir: string;
let clip: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "hf-source-media-")));
  projectDir = join(root, "project");
  mkdirSync(join(projectDir, "media"), { recursive: true });
  mkdirSync(join(root, "card"));
  clip = join(root, "card", "C0001.MP4");
  writeFileSync(clip, "0123456789");
  writeFileSync(join(root, "card", "C0001M01.XML"), "<xml/>");
  writeFileSync(join(root, "card", "still.png"), "png");
  writeFileSync(join(projectDir, "media", "local.mov"), "local");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function app(): Hono {
  const api = new Hono();
  const resolveProject = (id: string) => (id === "p" ? { id, dir: projectDir } : null);
  registerSourceMediaRoutes(api, { resolveProject } as unknown as StudioApiAdapter);
  return api;
}

const url = (path: string, extra = "") =>
  `http://localhost/projects/p/source?path=${encodeURIComponent(path)}${extra}`;

describe("resolveSourcePath", () => {
  it("accepts an absolute media file and resolves symlinks", () => {
    const link = join(root, "link.mp4");
    symlinkSync(clip, link);
    expect(resolveSourcePath(projectDir, link)).toEqual({ ok: true, file: clip });
  });
  it("refuses non-media, missing files and directories", () => {
    expect(resolveSourcePath(projectDir, join(root, "card", "C0001M01.XML")).ok).toBe(false);
    expect(resolveSourcePath(projectDir, join(root, "card", "nope.mp4")).ok).toBe(false);
    mkdirSync(join(root, "dir.mp4"));
    expect(resolveSourcePath(projectDir, join(root, "dir.mp4")).ok).toBe(false);
    expect(resolveSourcePath(projectDir, "").ok).toBe(false);
  });
  it("resolves a relative path through a media mount, but not out of it", () => {
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { mounts: { card: "../card" } } }),
    );
    expect(resolveSourcePath(projectDir, "card/C0001.MP4")).toEqual({ ok: true, file: clip });
    expect(resolveSourcePath(projectDir, "card/../../outside.mp4")).toMatchObject({ ok: false });
    expect(resolveSourcePath(projectDir, "card/C0001M01.XML")).toMatchObject({ ok: false });
  });
  it("resolves a relative path inside the project only", () => {
    expect(resolveSourcePath(projectDir, "media/local.mov")).toEqual({
      ok: true,
      file: join(projectDir, "media", "local.mov"),
    });
    expect(resolveSourcePath(projectDir, "../card/C0001.MP4").ok).toBe(false);
  });
});

describe("GET /projects/:id/source", () => {
  it("streams the whole file and byte ranges", async () => {
    const whole = await app().request(url(clip));
    expect(whole.status).toBe(200);
    expect(await whole.text()).toBe("0123456789");
    const part = await app().request(url(clip), { headers: { Range: "bytes=2-4" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 2-4/10");
    expect(await part.text()).toBe("234");
    const bad = await app().request(url(clip), { headers: { Range: "bytes=20-" } });
    expect(bad.status).toBe(416);
  });
  it("refuses cross-site requests, unknown projects and non-media", async () => {
    const cross = await app().request(url(clip), { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(cross.status).toBe(403);
    expect((await app().request(url(clip).replace("/p/", "/q/"))).status).toBe(404);
    expect((await app().request(url(join(root, "card", "C0001M01.XML")))).status).toBe(400);
    expect((await app().request(url("relative.mp4"))).status).toBe(404);
  });
  it("serves an HLS playlist whose segments point back at this endpoint", async () => {
    const res = await app().request(url(clip, "&hf-proxy=hls"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.apple.mpegurl");
    const body = await res.text();
    expect(body).toContain(`source?path=${encodeURIComponent(clip)}&hf-proxy=hls&seg=2`);
    expect(body.match(/#EXTINF/g)).toHaveLength(3);
  });
  it("only proxies video", async () => {
    const res = await app().request(url(join(root, "card", "still.png"), "&hf-proxy=hls"));
    expect(res.status).toBe(422);
  });
});

describe("GET /projects/:id/source/info", () => {
  it("answers a still without probing", async () => {
    const res = await app().request(
      `http://localhost/projects/p/source/info?path=${encodeURIComponent(join(root, "card", "still.png"))}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duration: 0, heavy: false, hostile: false });
  });
});

describe("GET /projects/:id/source/thumbnail", () => {
  it("has no picture for audio and validates like the stream", async () => {
    writeFileSync(join(root, "card", "song.wav"), "a");
    const audio = await app().request(
      `http://localhost/projects/p/source/thumbnail?path=${encodeURIComponent(join(root, "card", "song.wav"))}`,
    );
    expect(audio.status).toBe(422);
    const xml = await app().request(
      `http://localhost/projects/p/source/thumbnail?path=${encodeURIComponent(join(root, "card", "C0001M01.XML"))}`,
    );
    expect(xml.status).toBe(400);
  });
});

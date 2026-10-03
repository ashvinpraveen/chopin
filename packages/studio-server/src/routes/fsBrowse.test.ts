import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  linkMediaIntoProject,
  listDirectory,
  listRoots,
  registerFsBrowseRoutes,
  sanitizeLinkName,
} from "./fsBrowse";
import type { StudioApiAdapter } from "../types";

let root: string;
let projectDir: string;
let src: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "hf-fs-browse-")));
  projectDir = join(root, "project");
  src = join(root, "src");
  mkdirSync(projectDir);
  mkdirSync(join(src, "Footage"), { recursive: true });
  writeFileSync(join(src, "b-roll.mov"), "v");
  writeFileSync(join(src, "song.wav"), "a");
  writeFileSync(join(src, "notes.txt"), "t");
  writeFileSync(join(src, ".DS_Store"), "x");
  writeFileSync(join(src, "._b-roll.mov"), "x");
  mkdirSync(join(src, "$RECYCLE.BIN"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function app(): Hono {
  const api = new Hono();
  const adapter = {
    resolveProject: (id: string) => (id === "p" ? { id, dir: projectDir } : null),
  } as unknown as StudioApiAdapter;
  registerFsBrowseRoutes(api, adapter);
  return api;
}

describe("listDirectory", () => {
  it("lists folders first, classifies media, hides dotfiles and cruft", () => {
    const r = listDirectory(src);
    if (!r.ok) throw new Error(r.error);
    expect(r.entries.map((e) => [e.name, e.kind])).toEqual([
      ["Footage", "dir"],
      ["b-roll.mov", "video"],
      ["notes.txt", "other"],
      ["song.wav", "audio"],
    ]);
    expect(r.entries[1]?.size).toBe(1);
  });

  it("rejects relative, missing and non-directory paths", () => {
    expect(listDirectory("relative/path")).toMatchObject({ ok: false, status: 400 });
    expect(listDirectory(join(src, "nope"))).toMatchObject({ ok: false, status: 404 });
    expect(listDirectory(join(src, "song.wav"))).toMatchObject({ ok: false, status: 400 });
  });

  it("resolves a symlinked directory to its real path and skips dangling links", () => {
    symlinkSync(src, join(root, "alias"));
    symlinkSync(join(root, "missing"), join(src, "dangling.mp4"));
    const r = listDirectory(join(root, "alias"));
    if (!r.ok) throw new Error(r.error);
    expect(r.path).toBe(src);
    expect(r.entries.some((e) => e.name === "dangling.mp4")).toBe(false);
  });

  it("caps entries", () => {
    const r = listDirectory(src, 2);
    expect(r).toMatchObject({ ok: true, truncated: true });
    if (r.ok) expect(r.entries).toHaveLength(2);
  });
});

describe("listRoots", () => {
  it("returns home plus visible volumes", () => {
    const vols = join(root, "Volumes");
    mkdirSync(join(vols, "Drive"), { recursive: true });
    mkdirSync(join(vols, ".hidden"));
    expect(listRoots(src, vols)).toEqual([
      { name: "src", path: src },
      { name: "Drive", path: join(vols, "Drive") },
    ]);
  });
});

describe("linkMediaIntoProject", () => {
  it("symlinks into media/ without copying, reuses same-target links, suffixes collisions", () => {
    const first = linkMediaIntoProject(projectDir, join(src, "b-roll.mov"));
    expect(first).toEqual({ ok: true, path: "media/b-roll.mov", existing: false });
    const dest = join(projectDir, "media", "b-roll.mov");
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(readlinkSync(dest)).toBe(join(src, "b-roll.mov"));

    expect(linkMediaIntoProject(projectDir, join(src, "b-roll.mov"))).toEqual({
      ok: true,
      path: "media/b-roll.mov",
      existing: true,
    });

    writeFileSync(join(src, "Footage", "b-roll.mov"), "other");
    expect(linkMediaIntoProject(projectDir, join(src, "Footage", "b-roll.mov"))).toEqual({
      ok: true,
      path: "media/b-roll-2.mov",
      existing: false,
    });
  });

  it("refuses non-media, missing, relative and directory sources", () => {
    expect(linkMediaIntoProject(projectDir, join(src, "notes.txt"))).toMatchObject({ status: 400 });
    expect(linkMediaIntoProject(projectDir, join(src, "x.mp4"))).toMatchObject({ status: 404 });
    expect(linkMediaIntoProject(projectDir, "b-roll.mov")).toMatchObject({ status: 400 });
    expect(linkMediaIntoProject(projectDir, join(src, "Footage"))).toMatchObject({ status: 400 });
  });

  it("refuses a media folder that is itself a link", () => {
    symlinkSync(src, join(projectDir, "media"));
    expect(linkMediaIntoProject(projectDir, join(src, "song.wav"))).toMatchObject({ status: 403 });
  });

  it("sanitizes names", () => {
    expect(sanitizeLinkName("My Clip (final)!.MOV")).toBe("My-Clip-final.mov");
    expect(sanitizeLinkName("...mp4")).toBe("media.mp4");
  });
});

describe("routes", () => {
  it("serves roots and listings", async () => {
    const roots = await app().request("/fs/roots");
    expect(roots.status).toBe(200);
    const list = await app().request(`/fs/list?path=${encodeURIComponent(src)}`);
    expect(((await list.json()) as { entries: unknown[] }).entries).toHaveLength(4);
    expect((await app().request("/fs/list?path=rel")).status).toBe(400);
  });

  it("links via POST only with a JSON body", async () => {
    const body = JSON.stringify({ source: join(src, "song.wav") });
    const plain = await app().request("/projects/p/media/link", { method: "POST", body });
    expect(plain.status).toBe(415);
    const res = await app().request("/projects/p/media/link", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });
    expect(await res.json()).toEqual({ path: "media/song.wav", existing: false });
    const missing = await app().request("/projects/zz/media/link", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });
    expect(missing.status).toBe(404);
  });
});

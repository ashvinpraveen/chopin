import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import {
  clearMediaMountCache,
  collectSubCompositionSrcs,
  isUnresolvedAssetPlaceholder,
  isWithinProjectOrMount,
  isWithinProjectRoot,
  maskNonScannableRanges,
  projectUrlPathForFile,
  readMediaMounts,
  readProjectFile,
  resolveExistingLocalAsset,
  resolveLocalAssetCandidates,
  resolveProjectAssetPath,
  resolveProjectRelativeSrc,
} from "./assetResolution.js";

describe("maskNonScannableRanges", () => {
  it("masks complete comments without changing offsets", () => {
    const html = '<video src="before.mp4"><!-- <video src="hidden.mp4"> --><video src="after.mp4">';
    const masked = maskNonScannableRanges(html);

    expect(masked).toHaveLength(html.length);
    expect(masked).toContain('<video src="before.mp4">');
    expect(masked).not.toContain("hidden.mp4");
    expect(masked).toContain('<video src="after.mp4">');
  });

  it("handles many comment openers in linear scans", () => {
    const html = `prefix${"<!--".repeat(10_000)}-->suffix`;
    const masked = maskNonScannableRanges(html);

    expect(masked).toHaveLength(html.length);
    expect(masked).toBe(`prefix${" ".repeat(html.length - 12)}suffix`);
  });
});

describe("isUnresolvedAssetPlaceholder", () => {
  it("is true for __UPPER__ placeholders (raw or padded)", () => {
    for (const src of ["__DURATION__", "  __DURATION__  ", "__X__"]) {
      expect(isUnresolvedAssetPlaceholder(src)).toBe(true);
    }
  });

  it("is true for unresolved templating tokens, including ?/# inside ${...}", () => {
    for (const src of [
      "<<tts_x>>",
      "{{ videoUrl }}",
      "${audioUrl}",
      "${asset?.url}", // cleanAssetUrl would chop this to `${asset` — must match on the raw value
      "${a ?? b}",
      "${u}?v=1",
      "audio/${name}.mp3", // embedded token in an otherwise path-shaped value
    ]) {
      expect(isUnresolvedAssetPlaceholder(src)).toBe(true);
    }
  });

  it("is false for real paths and remote URLs (remote handling is left to each caller)", () => {
    for (const src of [
      "audio/clip.mp3",
      "clip.mp4?v=1",
      "https://cdn.example.com/a.mp3",
      "//host/a.png",
      "",
      "   ",
    ]) {
      expect(isUnresolvedAssetPlaceholder(src)).toBe(false);
    }
  });
});

describe("collectSubCompositionSrcs", () => {
  it("finds mounts inside a template, which a DOM query cannot see", () => {
    const html =
      '<!doctype html><html><body><div data-composition-src="compositions/a.html"></div>' +
      '<template id="t"><div data-composition-src="compositions/b.html"></div></template></body></html>';
    expect(collectSubCompositionSrcs(html)).toEqual(["compositions/a.html", "compositions/b.html"]);
  });

  it("skips commented-out, scripted, and styled mounts", () => {
    const html =
      '<!-- <div data-composition-src="commented.html"></div> -->' +
      "<script>const s = '<div data-composition-src=\"scripted.html\"></div>';</script>" +
      '<style>/* <div data-composition-src="styled.html"></div> */</style>' +
      '<div data-composition-src="real.html"></div>';
    expect(collectSubCompositionSrcs(html)).toEqual(["real.html"]);
  });

  it("skips build-time placeholders and dedupes repeats", () => {
    const html =
      '<div data-composition-src="__SCENE__"></div>' +
      '<div data-composition-src="{{scene}}"></div>' +
      '<div data-composition-src="a.html"></div><div data-composition-src="a.html"></div>';
    expect(collectSubCompositionSrcs(html)).toEqual(["a.html"]);
  });

  // A remote mount names no file on disk, and every caller resolves what comes
  // back against the project root. Letting one through yields a nonsense path
  // (`<projectDir>/https:/host/a.html`): a false "does not exist" for lint, and
  // a wasted slot against the telemetry walk's file budget.
  it("drops remote and inline mounts, keeping local ones", () => {
    const html =
      '<div data-composition-src="https://host/remote.html"></div>' +
      '<div data-composition-src="//host/protocol-relative.html"></div>' +
      '<div data-composition-src="data:text/html,inline"></div>' +
      '<div data-composition-src="compositions/local.html"></div>';
    expect(collectSubCompositionSrcs(html)).toEqual(["compositions/local.html"]);
  });

  it("ignores an unterminated final tag and an attribute outside any tag", () => {
    expect(collectSubCompositionSrcs('<div data-composition-src="a.html"')).toEqual([]);
    expect(collectSubCompositionSrcs('data-composition-src="a.html"')).toEqual([]);
  });

  // Regression guard, and it needs no timing assertion to bite: the previous
  // whole-file regex had two open-ended `[^>]*` spans, which is quadratic on
  // input full of `<` with no `>`. At 1MB that ran for minutes, so this case
  // failed on the suite timeout. This scan walks tag by tag and is linear.
  // The function is on the render-plan path, so a truncated download or a blob
  // of stray `<` must not be able to hang a render before it starts.
  it("stays fast on a megabyte of unterminated tag openings", () => {
    expect(collectSubCompositionSrcs("<".repeat(1024 * 1024))).toEqual([]);
  });
});

// The browser clamps `..` at the origin root; path.join does not. One resolver must serve lint and render.
describe("resolveProjectRelativeSrc — the one src resolver for lint and render", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "hf-resolver-"));
    mkdirSync(join(tmp, "project", "assets"), { recursive: true });
    writeFileSync(join(tmp, "project", "assets", "foo.mp4"), "");
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns the literal join when the file exists at projectDir/src", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("resolves a browser root-absolute URL from the project root", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("/assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("clamps a leading `../` so `../assets/foo.mp4` resolves to assets/foo.mp4", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("../assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("clamps multiple leading `../../../` segments", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("../../../assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("clamps mid-path traversal that escapes baseDir (not just leading `..`)", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("assets/../../assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("returns the (non-existent) base-dir path on miss so callers get a stable error message", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("../assets/missing.mp4", projectDir)).toBe(
      join(projectDir, "../assets/missing.mp4"),
    );
  });

  it("prefers compiled-dir over base-dir when the file exists in both", () => {
    const projectDir = join(tmp, "project");
    const compiledDir = join(tmp, "compiled");
    mkdirSync(join(compiledDir, "assets"), { recursive: true });
    writeFileSync(join(compiledDir, "assets", "foo.mp4"), "");
    expect(resolveProjectRelativeSrc("assets/foo.mp4", projectDir, compiledDir)).toBe(
      join(compiledDir, "assets/foo.mp4"),
    );
  });

  it("resolves percent-encoded non-Latin filenames across scripts", () => {
    const projectDir = join(tmp, "project");
    const cases = [
      "%D9%87%D9%86%D8%A7-%D9%85%D8%B1%D9%88%D8%A7.mp4",
      "%E6%97%A5%E6%9C%AC%E8%AA%9E.mp4",
      "%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82.mp4",
      "%ED%95%9C%EA%B8%80.mp4",
    ];

    for (const encodedFilename of cases) {
      const filename = decodeURIComponent(encodedFilename);
      writeFileSync(join(projectDir, "assets", filename), "");

      expect(resolveProjectRelativeSrc(`assets/${encodedFilename}`, projectDir)).toBe(
        join(projectDir, "assets", filename),
      );
    }
  });

  it("falls back to literal filenames when percent sequences are malformed", () => {
    const projectDir = join(tmp, "project");
    const filename = "100%-discount.mp4";
    writeFileSync(join(projectDir, "assets", filename), "");

    expect(resolveProjectRelativeSrc(`assets/${filename}`, projectDir)).toBe(
      join(projectDir, "assets", filename),
    );
  });

  it("ignores a query string or media fragment when locating the file", () => {
    const projectDir = join(tmp, "project");
    for (const src of ["assets/foo.mp4?v=2", "assets/foo.mp4#t=5", " assets/foo.mp4 "]) {
      expect(resolveProjectRelativeSrc(src, projectDir)).toBe(join(projectDir, "assets/foo.mp4"));
    }
  });
});

// A CI runner is one OS. Injecting path.win32/path.posix exercises both
// platforms' separator and drive-letter rules from here, so a regression in
// either fails this suite regardless of which OS actually runs it.
describe("isWithinProjectRoot", () => {
  it("rejects a backslash traversal under path.win32", () => {
    const root = "C:\\project";
    const candidate = win32.join(root, "..\\secret.txt");
    expect(isWithinProjectRoot(root, candidate, win32)).toBe(false);
  });

  it("rejects a mixed backslash/forward-slash traversal under path.win32", () => {
    const root = "C:\\project";
    const candidate = win32.join(root, "..\\../secret.txt");
    expect(isWithinProjectRoot(root, candidate, win32)).toBe(false);
  });

  it("rejects a drive-letter path outside the root under path.win32", () => {
    const root = "C:\\project";
    const candidate = "D:\\secret.txt";
    expect(isWithinProjectRoot(root, candidate, win32)).toBe(false);
  });

  it("allows a nested asset under path.win32", () => {
    const root = "C:\\project";
    const candidate = win32.join(root, "assets\\a.png");
    expect(isWithinProjectRoot(root, candidate, win32)).toBe(true);
  });

  it("rejects a forward-slash traversal under path.posix", () => {
    const root = "/project";
    const candidate = posix.join(root, "../secret.txt");
    expect(isWithinProjectRoot(root, candidate, posix)).toBe(false);
  });

  it("allows a nested asset under path.posix", () => {
    const root = "/project";
    const candidate = posix.join(root, "assets/a.png");
    expect(isWithinProjectRoot(root, candidate, posix)).toBe(true);
  });

  it("allows the root itself", () => {
    expect(isWithinProjectRoot("/project", "/project", posix)).toBe(true);
  });
});

describe("readProjectFile", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-read-project-file-"));
    writeFileSync(join(dir, "scene.html"), "<div></div>");
    mkdirSync(join(dir, "intro"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a file's text", () => {
    expect(readProjectFile(join(dir, "scene.html"))).toEqual({ kind: "file", text: "<div></div>" });
  });

  it("names a folder instead of throwing EISDIR", () => {
    expect(readProjectFile(join(dir, "intro"))).toEqual({ kind: "folder" });
  });

  it("reports a missing path, including one under a file", () => {
    expect(readProjectFile(join(dir, "gone.html"))).toEqual({ kind: "missing" });
    expect(readProjectFile(join(dir, "scene.html", "inner.html"))).toEqual({ kind: "missing" });
  });

  it("reports a name too long or a symlink loop as missing, as existsSync did", () => {
    expect(readProjectFile(join(dir, `${"a".repeat(300)}.html`))).toEqual({ kind: "missing" });
    symlinkSync(join(dir, "loop.html"), join(dir, "loop.html"));
    expect(readProjectFile(join(dir, "loop.html"))).toEqual({ kind: "missing" });
  });

  it.skipIf(process.platform === "win32")("reports a named pipe without blocking on it", () => {
    execFileSync("mkfifo", [join(dir, "pipe.html")]);
    expect(readProjectFile(join(dir, "pipe.html"))).toEqual({ kind: "folder" });
  });
});

describe("media mounts", () => {
  let root: string;
  let projectDir: string;
  let exportsDir: string;

  const writeConfig = (mounts: unknown) =>
    writeFileSync(join(projectDir, "hyperframes.json"), JSON.stringify({ media: { mounts } }));

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hf-media-mounts-"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  beforeEach(() => {
    clearMediaMountCache();
    const id = Math.random().toString(36).slice(2);
    exportsDir = join(root, id, "Exports");
    projectDir = join(root, id, "Edit", "Chopin", "proj");
    mkdirSync(exportsDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(exportsDir, "MAI Podcast #3 A CAM.mov"), "a");
    writeFileSync(join(root, id, "secret.txt"), "secret");
    writeFileSync(join(projectDir, "index.html"), "<html></html>");
    writeConfig({ footage: "../../../Exports" });
  });

  it("resolves a URL whose first segment names a mount under the mount path", () => {
    expect(resolveProjectAssetPath(projectDir, "footage/MAI Podcast #3 A CAM.mov")).toBe(
      join(exportsDir, "MAI Podcast #3 A CAM.mov"),
    );
    expect(resolveProjectAssetPath(projectDir, "/footage/sub/clip.mov")).toBe(
      join(exportsDir, "sub", "clip.mov"),
    );
    expect(
      resolveExistingLocalAsset(projectDir, "footage/MAI%20Podcast%20%233%20A%20CAM.mov"),
    ).toEqual({
      resolved: join(exportsDir, "MAI Podcast #3 A CAM.mov"),
      rootRelativePath: "footage/MAI Podcast #3 A CAM.mov",
    });
    expect(resolveProjectRelativeSrc("footage/MAI Podcast %233 A CAM.mov", projectDir)).toBe(
      join(exportsDir, "MAI Podcast #3 A CAM.mov"),
    );
  });

  it("rejects traversal out of the mount and treats normalised-away mounts as project paths", () => {
    expect(resolveProjectAssetPath(projectDir, "footage/../../../../secret.txt")).toBeNull();
    expect(resolveProjectAssetPath(projectDir, "footage/../index.html")).toBe(
      join(projectDir, "index.html"),
    );
    expect(resolveProjectAssetPath(projectDir, "../secret.txt")).toBeNull();
    expect(isWithinProjectOrMount(projectDir, join(exportsDir, "x.mov"))).toBe(true);
    expect(isWithinProjectOrMount(projectDir, join(exportsDir, "..", "secret.txt"))).toBe(false);
    for (const candidate of resolveLocalAssetCandidates(projectDir, "footage/%2e%2e/%2e%2e/x")) {
      expect(isWithinProjectOrMount(projectDir, candidate)).toBe(true);
    }
  });

  it("leaves an unknown first segment as a plain project path", () => {
    expect(resolveProjectAssetPath(projectDir, "media/a.mov")).toBe(
      join(projectDir, "media", "a.mov"),
    );
    expect(projectUrlPathForFile(projectDir, join(root, "elsewhere.mov"))).toBeNull();
    expect(projectUrlPathForFile(projectDir, join(exportsDir, "a b.mov"))).toBe("footage/a b.mov");
  });

  it("ignores invalid mount names, non-string targets and corrupt config", () => {
    writeConfig({ "a/b": "../x", "..": "../x", ok: 3 });
    expect(readMediaMounts(projectDir)).toEqual([]);
    writeFileSync(join(projectDir, "hyperframes.json"), "{not json");
    expect(readMediaMounts(projectDir)).toEqual([]);
    rmSync(join(projectDir, "hyperframes.json"));
    expect(readMediaMounts(projectDir)).toEqual([]);
    expect(resolveProjectAssetPath(projectDir, "footage/x.mov")).toBe(
      join(projectDir, "footage", "x.mov"),
    );
  });

  it("re-reads hyperframes.json when it changes", () => {
    expect(readMediaMounts(projectDir).map((m) => m.name)).toEqual(["footage"]);
    writeConfig({ exports: "../../../Exports" });
    // Same-size rewrite within one mtime tick would hide the change; pin a new mtime.
    const later = new Date(Date.now() + 5_000);
    utimesSync(join(projectDir, "hyperframes.json"), later, later);
    expect(readMediaMounts(projectDir).map((m) => m.name)).toEqual(["exports"]);
    expect(resolveProjectAssetPath(projectDir, "footage/x.mov")).toBe(
      join(projectDir, "footage", "x.mov"),
    );
    expect(resolveProjectAssetPath(projectDir, "exports/x.mov")).toBe(join(exportsDir, "x.mov"));
  });
});

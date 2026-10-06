import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const linkError = vi.hoisted(() => ({ code: undefined as string | undefined }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    linkSync: (existing: string, target: string) => {
      if (linkError.code) {
        throw Object.assign(new Error(`${linkError.code}: link not supported`), {
          code: linkError.code,
        });
      }
      return actual.linkSync(existing, target);
    },
  };
});

const { writeNewFileSync } = await import("./writeNewFile.js");

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-write-new-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  linkError.code = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("writeNewFileSync", () => {
  it("publishes through a hard link and leaves no staging directory", () => {
    const dir = tmp();
    writeNewFileSync(join(dir, "a.json"), "{}");
    expect(readFileSync(join(dir, "a.json"), "utf-8")).toBe("{}");
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });

  it.each(["ENOTSUP", "EPERM", "EXDEV", "ENOSYS"])(
    "falls back to an exclusive write when linkSync fails with %s (exFAT)",
    (code) => {
      linkError.code = code;
      const dir = tmp();
      writeNewFileSync(join(dir, "a.json"), '{"ok":true}');
      expect(readFileSync(join(dir, "a.json"), "utf-8")).toBe('{"ok":true}');
      expect(readdirSync(dir)).toEqual(["a.json"]);
    },
  );

  it("never overwrites an existing file on the fallback path", () => {
    linkError.code = "ENOTSUP";
    const dir = tmp();
    writeFileSync(join(dir, "a.json"), "original");
    writeNewFileSync(join(dir, "a.json"), "replacement");
    expect(readFileSync(join(dir, "a.json"), "utf-8")).toBe("original");
  });

  it("rethrows other link errors", () => {
    linkError.code = "EACCES";
    const dir = tmp();
    expect(() => writeNewFileSync(join(dir, "a.json"), "{}")).toThrow("EACCES");
    expect(readdirSync(dir)).toEqual([]);
  });
});

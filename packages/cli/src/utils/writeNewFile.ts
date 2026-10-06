import { linkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Publish complete content without replacing or following an existing destination entry. */
export function writeNewFileSync(filePath: string, content: string): void {
  const stagingDir = mkdtempSync(join(dirname(filePath), ".hf-create-"));
  try {
    const stagedPath = join(stagingDir, "content");
    writeFileSync(stagedPath, content, { encoding: "utf-8", flag: "wx" });
    try {
      linkSync(stagedPath, filePath);
    } catch (err) {
      const code = err instanceof Error && "code" in err ? err.code : undefined;
      if (code === "EEXIST") return;
      // Filesystems without hard links (exFAT, FAT32, some network shares) reject linkSync.
      // An exclusive-create write keeps the same never-overwrite guarantee.
      if (code !== "ENOTSUP" && code !== "EPERM" && code !== "EXDEV" && code !== "ENOSYS")
        throw err;
      try {
        writeFileSync(filePath, content, { encoding: "utf-8", flag: "wx" });
      } catch (writeErr) {
        if (!(writeErr instanceof Error && "code" in writeErr && writeErr.code === "EEXIST"))
          throw writeErr;
      }
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

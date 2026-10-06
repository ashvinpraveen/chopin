import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createFileServer, type FileServerHandle } from "./fileServer.js";

/**
 * The server derives each request path from the URL and joins it onto
 * compiledDir/projectDir. Hono decodes percent escapes when routing, so an
 * encoded separator or dot segment in the request must never walk out of the
 * served roots — Chrome never requests those shapes, but anything that can
 * reach the port (LAN bind, other local processes) can. On Windows an encoded
 * backslash (%5c) decodes to a real separator, so `..%5c..%5c` escapes even
 * though `..%2f` is normalized away by join(). These tests pin containment
 * at the handler.
 */
describe("fileServer path containment", () => {
  let root: string;
  let projectDir: string;
  let outsideFile: string;
  let server: FileServerHandle;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(tmpdir(), "hf-fileserver-containment-"));
    projectDir = path.join(root, "project");
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, "index.html"), "<html></html>");
    outsideFile = path.join(root, "outside-secret.txt");
    fs.writeFileSync(outsideFile, "OUTSIDE");
    server = await createFileServer({
      headScripts: [],
      bodyScripts: [],
      projectDir,
    });
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const escapeAttempts = [
    // Encoded separators: %2f collapses with a leading dot-segment only via a
    // nested hop, %5c is a live separator on Windows.
    "/..%2foutside-secret.txt",
    "/%2e%2e%2foutside-secret.txt",
    "/nested%2f..%2f..%2foutside-secret.txt",
    "/..%5coutside-secret.txt",
    "/..%5c..%5coutside-secret.txt",
  ];

  it.each(escapeAttempts)("rejects encoded traversal %s", async (requestPath) => {
    const response = await fetch(`${server.url}${requestPath}`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("OUTSIDE");
  });

  it("still serves files inside the project", async () => {
    const response = await fetch(`${server.url}/index.html`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<html>");
  });
});

describe("fileServer media mounts", () => {
  let root: string;
  let server: FileServerHandle;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(tmpdir(), "hf-fileserver-mounts-"));
    const projectDir = path.join(root, "project");
    fs.mkdirSync(projectDir);
    fs.mkdirSync(path.join(root, "Exports"));
    fs.writeFileSync(path.join(projectDir, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(root, "Exports", "A CAM.txt"), "MOUNTED");
    fs.writeFileSync(path.join(root, "outside-secret.txt"), "OUTSIDE");
    fs.writeFileSync(
      path.join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { mounts: { footage: "../Exports" } } }),
    );
    server = await createFileServer({ headScripts: [], bodyScripts: [], projectDir });
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("serves a file through a mount", async () => {
    const response = await fetch(`${server.url}/footage/A%20CAM.txt`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("MOUNTED");
  });

  it.each(["/footage/..%2f..%2foutside-secret.txt", "/footage/..%5c..%5coutside-secret.txt"])(
    "rejects traversal out of the mount %s",
    async (requestPath) => {
      const response = await fetch(`${server.url}${requestPath}`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("OUTSIDE");
    },
  );
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerPeakRoutes } from "./peaks";
import type { StudioApiAdapter } from "../types";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(decode: (path: string) => Promise<number[]>) {
  const dir = mkdtempSync(join(tmpdir(), "hf-peaks-route-"));
  dirs.push(dir);
  writeFileSync(join(dir, "talk.mp4"), "video");
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({ id: "j", status: "rendering", progress: 0, outputPath: "/tmp/o.mp4" }),
  };
  const app = new Hono();
  registerPeakRoutes(app, adapter, decode);
  return app;
}

describe("GET /projects/:id/peaks/*", () => {
  it("answers absolute bins once per file and serves the cache after", async () => {
    const decode = vi.fn(async () => [0.2, 0.99]);
    const app = setup(decode);
    for (let i = 0; i < 2; i++) {
      const res = await app.request("http://localhost/projects/p/peaks/talk.mp4");
      expect(await res.json()).toEqual({ binSeconds: 0.05, bins: [0.2, 0.99] });
    }
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("decodes a file once when several clips ask at the same time", async () => {
    let finish: (bins: number[]) => void = () => {};
    const decode = vi.fn(() => new Promise<number[]>((resolve) => (finish = resolve)));
    const app = setup(decode);
    const both = Promise.all([
      app.request("http://localhost/projects/p/peaks/talk.mp4"),
      app.request("http://localhost/projects/p/peaks/talk.mp4"),
    ]);
    await vi.waitFor(() => expect(decode).toHaveBeenCalled());
    finish([0.5]);
    for (const res of await both) expect((await res.json()).bins).toEqual([0.5]);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("404s a missing file and a path outside the project", async () => {
    const app = setup(async () => []);
    expect((await app.request("http://localhost/projects/p/peaks/nope.mp4")).status).toBe(404);
    expect(
      (await app.request("http://localhost/projects/p/peaks/..%2F..%2Fetc%2Fpasswd")).status,
    ).toBe(404);
  });

  it("decodes a file reached through a media mount, and 404s traversal out of it", async () => {
    const decode = vi.fn(async (_path: string) => [0.3]);
    const dir = mkdtempSync(join(tmpdir(), "hf-peaks-mount-"));
    dirs.push(dir);
    const projectDir = join(dir, "project");
    mkdirSync(projectDir);
    mkdirSync(join(dir, "Exports"));
    writeFileSync(join(dir, "Exports", "A CAM.mov"), "video");
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { mounts: { footage: "../Exports" } } }),
    );
    const mounted = new Hono();
    registerPeakRoutes(
      mounted,
      {
        resolveProject: async (id: string) => ({ id, dir: projectDir }),
      } as unknown as StudioApiAdapter,
      decode,
    );
    const res = await mounted.request("http://localhost/projects/p/peaks/footage/A%20CAM.mov");
    expect((await res.json()).bins).toEqual([0.3]);
    expect(decode).toHaveBeenCalledWith(join(dir, "Exports", "A CAM.mov"));
    expect(
      (await mounted.request("http://localhost/projects/p/peaks/footage/..%2F..%2Ftalk.mp4"))
        .status,
    ).toBe(404);
  });
});

// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupMounted, mountHost } from "../ui/mountHost.testHelpers";
import { breadcrumbs, formatBytes, MediaStoragePanel } from "./MediaStoragePanel";
import { useAssetPreviewStore } from "../../utils/assetPreviewStore";

afterEach(() => {
  cleanupMounted();
  vi.unstubAllGlobals();
});

const LISTINGS: Record<string, unknown[]> = {
  "/Users/me": [{ name: "Footage", path: "/Users/me/Footage", kind: "dir", size: 0, mtime: 0 }],
  "/Users/me/Footage": [
    { name: "a.mov", path: "/Users/me/Footage/a.mov", kind: "video", size: 2048, mtime: 0 },
    { name: "aM01.XML", path: "/Users/me/Footage/aM01.XML", kind: "other", size: 10, mtime: 0 },
  ],
};

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe("MediaStoragePanel", () => {
  it("lists, navigates into folders on double-click, and links media", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/fs/roots") return json({ roots: [{ name: "me", path: "/Users/me" }] });
      if (url.startsWith("/api/fs/list")) {
        const path = new URL(url, "http://x").searchParams.get("path") ?? "";
        return json({ path, entries: LISTINGS[path] ?? [], truncated: false });
      }
      if (url.endsWith("/media/link") && init?.method === "POST") {
        return json({ path: "media/a.mov", existing: false });
      }
      return json({ error: "nope" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onLinked = vi.fn();
    const host = mountHost(<MediaStoragePanel projectId="p" onLinked={onLinked} />);
    await flush();
    await flush();

    const rows = () => [...host.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(rows().map((r) => r.textContent)).toEqual(["Footage"]);

    act(() => rows()[0]?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    await flush();
    await flush();
    // The XML sidecar is hidden until "Show all files"; the clip is a grid card.
    expect(rows().map((r) => r.textContent)).toEqual(["a.mov"]);
    expect(rows()[0]?.dataset.kind).toBe("video");
    act(() => host.querySelector<HTMLElement>('[aria-label="Show all files"]')?.click());
    expect(rows().map((r) => r.textContent)).toEqual(["aM01.XML10 B", "a.mov"]);

    // A single click opens the clip in the source viewer.
    act(() => rows()[1]?.click());
    expect(useAssetPreviewStore.getState()).toMatchObject({
      previewAsset: "/Users/me/Footage/a.mov",
      previewExternal: true,
    });
    act(() => rows()[0]?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(fetchMock.mock.calls.some(([u]) => u.endsWith("/media/link"))).toBe(false);

    act(() => rows()[1]?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    await flush();
    await flush();
    const linkCall = fetchMock.mock.calls.find(([u]) => u.endsWith("/media/link"));
    expect(JSON.parse(String(linkCall?.[1]?.body))).toEqual({ source: "/Users/me/Footage/a.mov" });
    expect(onLinked).toHaveBeenCalledWith("media/a.mov");
  });
});

describe("helpers", () => {
  it("formats sizes and breadcrumbs", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
    expect(breadcrumbs("/Volumes/Drive").map((c) => c.path)).toEqual([
      "/",
      "/Volumes",
      "/Volumes/Drive",
    ]);
  });
});

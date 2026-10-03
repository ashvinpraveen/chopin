// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAssetPreviewStore } from "./assetPreviewStore";
import { resolveDropAsset, SOURCE_VIEWER_DRAG_PATH, sourceViewerBridge } from "./sourceViewerDrag";

afterEach(() => {
  vi.unstubAllGlobals();
  useAssetPreviewStore.setState({ previewAsset: null, previewExternal: false, marks: {} });
  sourceViewerBridge.onLinked = null;
});

function stubServer(duration: number) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/source/info")) {
      return new Response(JSON.stringify({ duration, hasVideo: true, width: 0, height: 0 }));
    }
    if (url.endsWith("/media/link")) return new Response(JSON.stringify({ path: "media/C1.MP4" }));
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("resolveDropAsset", () => {
  it("passes a project asset through untouched", async () => {
    const fetchMock = stubServer(10);
    expect(await resolveDropAsset("p1", "assets/a.mp4")).toEqual({ path: "assets/a.mp4" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links an outside file first and brings its probed length", async () => {
    stubServer(42);
    const onLinked = vi.fn();
    sourceViewerBridge.onLinked = onLinked;
    expect(await resolveDropAsset("p2", "/Volumes/CARD/C1.MP4")).toEqual({
      path: "media/C1.MP4",
      mediaStart: 0,
      duration: 42,
    });
    expect(onLinked).toHaveBeenCalled();
  });

  it("drops the source viewer's marked range", async () => {
    stubServer(30);
    useAssetPreviewStore.getState().setPreviewExternal("/Volumes/CARD/C1.MP4", "p3");
    useAssetPreviewStore.getState().setMarks("/Volumes/CARD/C1.MP4", { in: 5, out: 9 });
    expect(await resolveDropAsset("p3", SOURCE_VIEWER_DRAG_PATH)).toEqual({
      path: "media/C1.MP4",
      mediaStart: 5,
      duration: 4,
    });
  });
});

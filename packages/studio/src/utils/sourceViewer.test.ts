// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  formatSourceTimecode,
  markedRange,
  markIn,
  markOut,
  NO_MARKS,
  stepSourceFrame,
} from "./sourceMarks";
import { nextShuttleIndex, sourceKeyAction, type SourceKeyEvent } from "./sourceViewerKeys";
import { sourcePlaybackUrl } from "./sourceMediaApi";
import { ownsPlainKeys } from "./typingTarget";
import { partitionStorageEntries } from "../components/sidebar/mediaStorageEntries";

describe("source marks", () => {
  it("sets in and out, dropping the other when they would cross", () => {
    let marks = markIn(NO_MARKS, 2, 10);
    marks = markOut(marks, 6, 10);
    expect(marks).toEqual({ in: 2, out: 6 });
    expect(markIn(marks, 7, 10)).toEqual({ in: 7, out: null });
    expect(markOut(marks, 1, 10)).toEqual({ in: null, out: 1 });
    expect(markOut(marks, 2, 10)).toEqual({ in: null, out: 2 });
  });
  it("clamps marks to the clip", () => {
    expect(markIn(NO_MARKS, -3, 10).in).toBe(0);
    expect(markOut(NO_MARKS, 30, 10).out).toBe(10);
  });
  it("defaults the range to the whole clip", () => {
    expect(markedRange(NO_MARKS, 8)).toEqual({ start: 0, end: 8, duration: 8 });
    expect(markedRange({ in: 3, out: null }, 8)).toEqual({ start: 3, end: 8, duration: 5 });
    expect(markedRange({ in: null, out: 2 }, 8)).toEqual({ start: 0, end: 2, duration: 2 });
  });
  it("formats timecode and steps frames", () => {
    expect(formatSourceTimecode(3661.5, 25)).toBe("01:01:01:12");
    expect(formatSourceTimecode(0, 0)).toBe("00:00:00:00");
    expect(formatSourceTimecode(1 / 30, 29.97)).toBe("00:00:00:01");
    expect(stepSourceFrame(1, 1, 25, 10)).toBeCloseTo(1.04);
    expect(stepSourceFrame(0, -1, 25, 10)).toBe(0);
    expect(stepSourceFrame(9.99, 10, 25, 10)).toBe(10);
  });
});

const key = (code: string, mods: Partial<SourceKeyEvent> = {}): SourceKeyEvent => ({
  key: code,
  code,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...mods,
});

describe("source viewer keys", () => {
  it("maps Resolve's keys", () => {
    expect(sourceKeyAction(key("Space"))).toBe("togglePlay");
    expect(sourceKeyAction(key("KeyJ"))).toBe("shuttleBackward");
    expect(sourceKeyAction(key("KeyK"))).toBe("stop");
    expect(sourceKeyAction(key("KeyL"))).toBe("shuttleForward");
    expect(sourceKeyAction(key("KeyI"))).toBe("markIn");
    expect(sourceKeyAction(key("KeyO"))).toBe("markOut");
    expect(sourceKeyAction(key("KeyI", { altKey: true, key: "ˆ" }))).toBe("clearIn");
    expect(sourceKeyAction(key("KeyO", { altKey: true }))).toBe("clearOut");
    expect(sourceKeyAction(key("KeyX", { altKey: true }))).toBe("clearBoth");
    expect(sourceKeyAction(key("F10"))).toBe("insert");
    expect(sourceKeyAction(key("F9"))).toBe("overwrite");
    expect(sourceKeyAction(key("F12", { shiftKey: true }))).toBe("append");
    expect(sourceKeyAction(key("F12"))).toBeNull();
    expect(sourceKeyAction(key("KeyI", { metaKey: true }))).toBeNull();
  });
  it("speeds up a repeated shuttle and resets on a direction change", () => {
    expect(nextShuttleIndex({ direction: null, index: 0 }, "forward")).toBe(0);
    expect(nextShuttleIndex({ direction: "forward", index: 0 }, "forward")).toBe(1);
    expect(nextShuttleIndex({ direction: "forward", index: 3 }, "forward")).toBe(3);
    expect(nextShuttleIndex({ direction: "forward", index: 2 }, "backward")).toBe(0);
  });
  it("keeps the app's plain-key shortcuts out of the viewer", () => {
    const root = document.createElement("div");
    root.setAttribute("data-source-viewer", "");
    const button = document.createElement("button");
    root.append(button);
    expect(ownsPlainKeys(button)).toBe(true);
    expect(ownsPlainKeys(document.createElement("button"))).toBe(false);
  });
});

describe("sourcePlaybackUrl", () => {
  const safe = { heavy: false, hostile: false, hasVideo: true };
  const heavy = { heavy: true, hostile: true, hasVideo: true };
  it("plays project assets through the preview route unless they need the proxy", () => {
    expect(sourcePlaybackUrl("p", "media/a.mp4", false, safe)).toBe(
      "/api/projects/p/preview/media/a.mp4",
    );
    expect(sourcePlaybackUrl("p", "media/a.mp4", false, heavy)).toBe(
      "/api/projects/p/source?path=media%2Fa.mp4&hf-proxy=hls",
    );
  });
  it("plays outside files through the source route, HLS when heavy or hostile", () => {
    expect(sourcePlaybackUrl("p", "/Vol/C1.MP4", true, safe)).toBe(
      "/api/projects/p/source?path=%2FVol%2FC1.MP4",
    );
    expect(sourcePlaybackUrl("p", "/Vol/C1.MP4", true, heavy)).toMatch(/&hf-proxy=hls$/);
    expect(sourcePlaybackUrl("p", "/Vol/a.wav", true, { ...heavy, hasVideo: false })).not.toMatch(
      /hf-proxy/,
    );
  });
});

describe("partitionStorageEntries", () => {
  const entry = (name: string, kind: "dir" | "video" | "image" | "other") => ({
    name,
    path: `/c/${name}`,
    kind,
    size: 1,
    mtime: 0,
  });
  const entries = [entry("CLIP", "dir"), entry("C1.MP4", "video"), entry("C1M01.XML", "other")];
  it("hides non-media files unless asked, and grids the media", () => {
    expect(partitionStorageEntries(entries, false).rows.map((e) => e.name)).toEqual(["CLIP"]);
    expect(partitionStorageEntries(entries, true).rows.map((e) => e.name)).toEqual([
      "CLIP",
      "C1M01.XML",
    ]);
    expect(partitionStorageEntries(entries, true).media.map((e) => e.name)).toEqual(["C1.MP4"]);
  });
});

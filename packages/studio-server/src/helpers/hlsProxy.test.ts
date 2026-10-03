import { describe, expect, it } from "vitest";
import { buildHlsPlaylist, encodeArgs, HLS_SEGMENT_SECONDS, proxyDimensions } from "./hlsProxy.js";

describe("buildHlsPlaylist", () => {
  it("lists every segment of a VOD playlist, the last one short", () => {
    const playlist = buildHlsPlaylist(HLS_SEGMENT_SECONDS * 2 + 1.5, (i) => `clip.mov?seg=${i}`);
    expect(playlist).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    expect(playlist).toContain("#EXT-X-ENDLIST");
    expect(playlist.match(/#EXTINF/g)).toHaveLength(3);
    expect(playlist).toContain("#EXTINF:1.500000,\nclip.mov?seg=2");
  });
});

describe("proxyDimensions", () => {
  it("fits 4K inside 720p", () => {
    expect(proxyDimensions(3840, 2160)).toEqual({ width: 1280, height: 720 });
  });
  it("fits a vertical source by height", () => {
    expect(proxyDimensions(2160, 3840)).toEqual({ width: 406, height: 720 });
  });
  it("never upscales", () => {
    expect(proxyDimensions(640, 360)).toEqual({ width: 640, height: 360 });
  });
});

describe("encodeArgs", () => {
  const size = { width: 1280, height: 720 };
  it("seeks the input and offsets timestamps so segments form one timeline", () => {
    const args = encodeArgs("/src.mov", 12, 6, size, "/out.ts", true);
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual(["-ss", "12.000"]);
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args).toContain("h264_videotoolbox");
    expect(args[args.indexOf("-output_ts_offset") + 1]).toBe("12.000");
  });
  it("falls back to software encoding", () => {
    const args = encodeArgs("/src.mov", 0, 6, size, "/out.ts", false);
    expect(args).toContain("libx264");
    expect(args).not.toContain("-hwaccel");
  });
});

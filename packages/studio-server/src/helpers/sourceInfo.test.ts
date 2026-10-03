import { describe, expect, it } from "vitest";
import { parseSourceInfo } from "./sourceInfo.js";
import { thumbnailArgs, thumbnailWidth } from "./sourceThumbnail.js";

const probe = (streams: object[], duration = "12.5") =>
  JSON.stringify({ streams, format: { duration } });

describe("parseSourceInfo", () => {
  it("reads a 4K 10-bit Sony H.264 clip as heavy and hostile", () => {
    const info = parseSourceInfo(
      probe([
        {
          codec_type: "video",
          codec_name: "h264",
          profile: "High 4:2:2",
          pix_fmt: "yuv422p10le",
          width: 3840,
          height: 2160,
          avg_frame_rate: "25/1",
          r_frame_rate: "25/1",
        },
        { codec_type: "audio", codec_name: "pcm_s16be" },
      ]),
      "/Volumes/CARD/C0001.MP4",
    );
    expect(info).toEqual({
      duration: 12.5,
      width: 3840,
      height: 2160,
      fps: 25,
      heavy: true,
      hostile: true,
      hasAudio: true,
      hasVideo: true,
    });
  });

  it("keeps a 1080p 8-bit H.264 mp4 browser-safe, with an NTSC rate", () => {
    const info = parseSourceInfo(
      probe([
        {
          codec_type: "video",
          codec_name: "h264",
          profile: "High",
          pix_fmt: "yuv420p",
          width: 1920,
          height: 1080,
          avg_frame_rate: "30000/1001",
        },
      ]),
      "/a/b.mp4",
    );
    expect(info.heavy).toBe(false);
    expect(info.hostile).toBe(false);
    expect(info.hasAudio).toBe(false);
    expect(info.fps).toBeCloseTo(29.97, 2);
  });

  it("marks HEVC and MXF containers hostile, and audio-only files not", () => {
    const hevc = { codec_type: "video", codec_name: "hevc", width: 1280, height: 720 };
    expect(parseSourceInfo(probe([hevc]), "/a.mov").hostile).toBe(true);
    const h264 = { codec_type: "video", codec_name: "h264", width: 1280, height: 720 };
    expect(parseSourceInfo(probe([h264]), "/a.MXF").hostile).toBe(true);
    const audio = parseSourceInfo(probe([{ codec_type: "audio" }]), "/a.wav");
    expect(audio).toMatchObject({ hostile: false, hasVideo: false, hasAudio: true, fps: 0 });
  });

  it("ignores cover art and a missing duration", () => {
    const art = { codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } };
    const info = parseSourceInfo(probe([art, { codec_type: "audio" }], "N/A"), "/a.m4a");
    expect(info).toMatchObject({ duration: 0, hasVideo: false, width: 0 });
  });
});

describe("source thumbnails", () => {
  it("snaps widths to a small set", () => {
    expect(thumbnailWidth(undefined)).toBe(320);
    expect(thumbnailWidth("100")).toBe(160);
    expect(thumbnailWidth("300")).toBe(320);
    expect(thumbnailWidth("4000")).toBe(480);
  });
  it("input-seeks to the keyframe for video, not for stills", () => {
    const video = thumbnailArgs("/src.mp4", "/out.jpg", 320, 4.2);
    expect(video.slice(0, video.indexOf("-i"))).toEqual(
      expect.arrayContaining(["-noaccurate_seek", "-ss", "4.200"]),
    );
    expect(video).toContain("scale=320:-2:flags=fast_bilinear,format=yuvj420p");
    expect(thumbnailArgs("/a.png", "/o.jpg", 160, null)).not.toContain("-ss");
  });
});

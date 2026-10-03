// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../player";
import { appendTime, pickDestinationTrack, planSourceEdit, type TrackClip } from "./sourceEditPlan";
import { applyClipChanges, mediaElementExtent } from "./sourceEditApply";
import { planSourceClipEdit, rewriteForSourceEdit, sourceClipKind } from "./sourceEditCommit";

const clip = (key: string, start: number, duration: number, mediaStart = 0): TrackClip => ({
  key,
  start,
  duration,
  mediaStart,
  rate: 1,
  media: true,
});

describe("planSourceEdit", () => {
  const track = [clip("a", 0, 4), clip("b", 4, 4, 10), clip("c", 10, 2)];

  it("insert pushes later clips right and splits the clip under the playhead", () => {
    const plan = planSourceEdit(track, { mode: "insert", at: 6, length: 3 });
    expect(plan.start).toBe(6);
    expect(plan.changes).toEqual([
      {
        key: "b",
        type: "split",
        head: { start: 4, duration: 2 },
        tail: { start: 9, duration: 2, mediaStart: 12 },
      },
      { key: "c", type: "set", span: { start: 13, duration: 2 } },
    ]);
    expect(plan.contentEnd).toBe(15);
  });

  it("insert on a cut moves everything from the cut, splitting nothing", () => {
    const plan = planSourceEdit(track, { mode: "insert", at: 4, length: 1 });
    expect(plan.changes.map((c) => [c.key, c.type])).toEqual([
      ["b", "set"],
      ["c", "set"],
    ]);
  });

  it("overwrite trims, removes and splits what is under the range, moving nothing else", () => {
    const plan = planSourceEdit(track, { mode: "overwrite", at: 3, length: 6 });
    expect(plan.changes).toEqual([
      { key: "a", type: "set", span: { start: 0, duration: 3 } },
      { key: "b", type: "remove" },
    ]);
    const inside = planSourceEdit([clip("x", 0, 10, 2)], { mode: "overwrite", at: 3, length: 2 });
    expect(inside.changes).toEqual([
      {
        key: "x",
        type: "split",
        head: { start: 0, duration: 3 },
        tail: { start: 5, duration: 5, mediaStart: 7 },
      },
    ]);
    const head = planSourceEdit([clip("y", 4, 4, 1)], { mode: "overwrite", at: 2, length: 3 });
    expect(head.changes).toEqual([
      { key: "y", type: "set", span: { start: 5, duration: 3, mediaStart: 2 } },
    ]);
  });

  it("does not shift an image's media in-point", () => {
    const still = { ...clip("s", 0, 6), media: false };
    const plan = planSourceEdit([still], { mode: "overwrite", at: 0, length: 2 });
    expect(plan.changes).toEqual([{ key: "s", type: "set", span: { start: 2, duration: 4 } }]);
  });

  it("append goes after everything and touches nothing", () => {
    const at = appendTime(track);
    expect(at).toBe(12);
    expect(planSourceEdit(track, { mode: "append", at, length: 5 })).toEqual({
      start: 12,
      changes: [],
      contentEnd: 17,
    });
  });
});

describe("pickDestinationTrack", () => {
  const clips = [
    { track: 3, lane: 1, audio: false },
    { track: 1, lane: 0, audio: false },
    { track: 5, lane: 2, audio: true },
  ];
  it("uses the selected clip's track when it is the right kind", () => {
    expect(pickDestinationTrack(clips, false, clips[0]!)).toBe(3);
    expect(pickDestinationTrack(clips, true, clips[0]!)).toBe(5);
  });
  it("defaults to the main track for picture and the first audio track for sound", () => {
    expect(pickDestinationTrack(clips, false, null)).toBe(1);
    expect(pickDestinationTrack(clips, true, null)).toBe(5);
  });
  it("opens a new track when there is none of the kind", () => {
    expect(pickDestinationTrack(clips.slice(0, 2), true, null)).toBe(4);
    expect(pickDestinationTrack([], false, null)).toBe(0);
  });
});

const SOURCE = `<div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="12">
  <video id="a" data-hf-id="hf-a" class="clip" src="a.mp4" data-start="0" data-duration="4" data-track-index="0" muted></video>
  <video id="b" data-hf-id="hf-b" class="clip" src="b.mp4" data-start="4" data-duration="4" data-media-start="10" data-track-index="0" muted></video>
  <img id="logo" data-hf-id="hf-l" class="clip" src="l.png" data-start="0" data-duration="12" data-track-index="2" />
  <div id="title" class="clip" data-start="8" data-duration="4" data-track-index="0"><h1>Hi</h1></div>
</div>`;

const el = (id: string, tag: string, start: number, duration: number, extra = {}) =>
  ({
    id,
    domId: id,
    hfId: `hf-${id}`,
    tag,
    start,
    duration,
    track: 0,
    ...extra,
  }) as TimelineElement;

describe("applyClipChanges", () => {
  const targets = new Map(
    ["a", "b", "logo", "title"].map((id) => [
      id,
      { target: { id }, mediaAttr: "media-start" as const, offset: 0, label: id },
    ]),
  );
  const ctx = () => ({
    targets,
    ids: new Set(["root", "a", "b", "logo", "title"]),
    newHfId: () => "hf-new",
  });

  it("finds whole media elements and refuses others", () => {
    const b = mediaElementExtent(SOURCE, { id: "b" });
    expect(SOURCE.slice(b!.start, b!.end)).toMatch(/^<video id="b".*<\/video>$/);
    const logo = mediaElementExtent(SOURCE, { id: "logo" });
    expect(SOURCE.slice(logo!.start, logo!.end)).toMatch(/^<img .*\/>$/);
    expect(mediaElementExtent(SOURCE, { id: "title" })).toBeNull();
  });

  it("patches, removes and splits in one pass", () => {
    const out = applyClipChanges(
      SOURCE,
      [
        { key: "a", type: "set", span: { start: 0, duration: 3 } },
        {
          key: "b",
          type: "split",
          head: { start: 4, duration: 1 },
          tail: { start: 7, duration: 3, mediaStart: 11 },
        },
        { key: "logo", type: "remove" },
      ],
      ctx(),
    );
    expect(out).toContain(
      'id="a" data-hf-id="hf-a" class="clip" src="a.mp4" data-start="0" data-duration="3"',
    );
    expect(out).toContain(
      'id="b" data-hf-id="hf-b" class="clip" src="b.mp4" data-start="4" data-duration="1" data-media-start="10"',
    );
    expect(out).toContain(
      '<video id="b_2" data-hf-id="hf-new" class="clip" src="b.mp4" data-start="7" data-duration="3" data-media-start="11" data-track-index="0" muted></video>',
    );
    expect(out).not.toContain("logo");
    expect(out).toContain("<h1>Hi</h1>");
  });

  it("refuses to remove a clip that is not a plain media tag", () => {
    expect(() => applyClipChanges(SOURCE, [{ key: "title", type: "remove" }], ctx())).toThrow(
      /not a plain media clip/,
    );
  });
});

describe("source clip edit end to end (pure)", () => {
  const elements = [el("a", "video", 0, 4), el("b", "video", 4, 4, { playbackStart: 10 })];
  const info = {
    duration: 20,
    width: 3840,
    height: 2160,
    fps: 25,
    heavy: true,
    hostile: true,
    hasAudio: true,
    hasVideo: true,
  };
  const source = { path: "media/C0001.MP4", info, range: { start: 2, duration: 3 } };

  it("classifies the clip kind", () => {
    expect(sourceClipKind("media/x.png", null)).toBe("image");
    expect(sourceClipKind("media/x.wav", { ...info, hasVideo: false })).toBe("audio");
    expect(sourceClipKind("media/x.mxf", info)).toBe("video");
  });

  it("inserts the marked range at the playhead, splitting and pushing the main track", () => {
    const planned = planSourceClipEdit(elements, null, source, "insert", 6);
    expect(planned.track).toBe(0);
    expect(planned.touched.map((e) => e.id)).toEqual(["b"]);
    const newId = { value: "" };
    const out = rewriteForSourceEdit(SOURCE, "index.html", source, planned, newId);
    expect(newId.value).toBe("c0001");
    expect(out).toMatch(
      /<video id="c0001" data-hf-id="hf-[^"]+" class="clip" src="media\/C0001.MP4" data-start="6" data-duration="3" data-media-start="2" data-track-index="0" data-has-audio="true"/,
    );
    expect(out).toContain(
      'id="b" data-hf-id="hf-b" class="clip" src="b.mp4" data-start="4" data-duration="2"',
    );
    expect(out).toMatch(
      /<video id="b_2" [^>]*data-start="9" data-duration="2" data-media-start="12"/,
    );
    expect(out).toContain(
      'data-composition-id="main" data-width="1920" data-height="1080" data-duration="12"',
    );
  });

  it("appends at the end of the timeline and grows the composition", () => {
    const planned = planSourceClipEdit(elements, null, source, "append", 0);
    const out = rewriteForSourceEdit(SOURCE, "index.html", source, planned, { value: "" });
    expect(planned.plan.start).toBe(8);
    expect(out).toMatch(/data-start="8" data-duration="3"/);
    expect(planned.touched).toEqual([]);
  });
});

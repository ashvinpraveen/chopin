import { describe, expect, it } from "vitest";
import { computeClipSpan, FULL_CANVAS_MAX_WIDTH, SPAN_MAX_WIDTH } from "./useVisibleClipSpan";

describe("computeClipSpan", () => {
  it("paints narrow clips whole", () => {
    expect(computeClipSpan(0, FULL_CANVAS_MAX_WIDTH, 0, 1000)).toBeNull();
  });

  it("windows a wide clip around the viewport, overscanning to the window budget", () => {
    // A 2-hour clip at 100 px/s is 720k px wide; the viewport sits 300k px in.
    const span = computeClipSpan(-300_000, 720_000, 0, 1000);
    expect(span).toEqual({ start: 296_404, end: 304_596, total: 720_000 });
    expect((span?.end ?? 0) - (span?.start ?? 0)).toBe(SPAN_MAX_WIDTH);
  });

  it("clamps to the clip edges and never exceeds the canvas budget", () => {
    expect(computeClipSpan(0, 720_000, 0, 1000)).toEqual({ start: 0, end: 4596, total: 720_000 });
    const wide = computeClipSpan(-50_000, 720_000, 0, 6000);
    expect(wide).not.toBeNull();
    expect((wide?.end ?? 0) - (wide?.start ?? 0)).toBeLessThanOrEqual(SPAN_MAX_WIDTH);
  });
});

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { createClipGestureHandlers, type ClipGestureDeps } from "./timelineClipGestureHandlers";
import { MAX_HAND_MOVE_CLIPS } from "./timelineEditing";

afterEach(() => usePlayerStore.getState().reset());

const clips: TimelineElement[] = Array.from({ length: 6 }, (_, i) => ({
  id: `clip-${i}`,
  tag: "div",
  start: i,
  duration: 1,
  track: i,
}));
const capabilities = { canMove: true, canTrimStart: true, canTrimEnd: true, readOnly: false };

function pressFirstClipWithSelection(count: number) {
  const store = usePlayerStore.getState();
  store.setElements(clips);
  store.setSelectedElementIds(new Set(clips.slice(0, count).map((c) => c.id)));
  const setDraggedClip = vi.fn();
  const blockedClipRef = { current: null as { intent: string } | null };
  const deps = {
    pps: 100,
    onMoveElement: vi.fn(),
    blockedClipRef,
    suppressClickRef: { current: false },
    scrollRef: { current: null },
    setShowPopover: vi.fn(),
    setRangeSelection: vi.fn(),
    setResizingClip: vi.fn(),
    setDraggedClip,
    setSelectedElementId: vi.fn(),
  } as unknown as ClipGestureDeps;
  const { onPointerDown } = createClipGestureHandlers(
    clips[0],
    clips[0].id,
    clips[0],
    capabilities,
    deps,
  );
  onPointerDown({
    button: 0,
    clientX: 50,
    clientY: 5,
    pointerId: 1,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) },
  } as unknown as ReactPointerEvent);
  return { setDraggedClip, blockedClipRef };
}

describe("hand-moving a multi-selection", () => {
  it("moves up to the limit by hand", () => {
    const { setDraggedClip, blockedClipRef } = pressFirstClipWithSelection(MAX_HAND_MOVE_CLIPS);
    expect(setDraggedClip).toHaveBeenCalledOnce();
    expect(blockedClipRef.current).toBeNull();
  });

  it("refuses to start a drag above the limit and asks for the toast", () => {
    const { setDraggedClip, blockedClipRef } = pressFirstClipWithSelection(MAX_HAND_MOVE_CLIPS + 1);
    expect(setDraggedClip).not.toHaveBeenCalled();
    expect(blockedClipRef.current?.intent).toBe("move-many");
  });
});

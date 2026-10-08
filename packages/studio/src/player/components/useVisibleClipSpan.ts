import { useEffect, useState, type RefObject } from "react";

/** A horizontal window of a clip, in CSS px from the clip's left edge. */
export interface ClipSpan {
  start: number;
  end: number;
  /** The clip's full width. */
  total: number;
}

/**
 * Clips at most this wide draw one canvas across the whole clip. Wider ones
 * draw only around the viewport: browsers cap a canvas near 32k device px per
 * side (16k CSS px on a 2x display), so a long episode zoomed in to frames
 * painted nothing at all, and even under the cap the backing store was mostly
 * off-screen pixels.
 */
export const FULL_CANVAS_MAX_WIDTH = 4096;

/** Widest painted window, in CSS px: 3x devicePixelRatio still sits under the cap. */
export const SPAN_MAX_WIDTH = 8192;

function findHorizontalScroller(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowX = getComputedStyle(node).overflowX;
    if (overflowX === "auto" || overflowX === "scroll") return node;
  }
  return null;
}

/**
 * The window, extended one viewport either side so ordinary scrolling stays
 * inside the painted area. Null when the clip is narrow enough to paint whole.
 */
export function computeClipSpan(
  clipLeft: number,
  clipWidth: number,
  viewportLeft: number,
  viewportWidth: number,
): ClipSpan | null {
  if (clipWidth <= FULL_CANVAS_MAX_WIDTH) return null;
  // Overscan as far as the window allows, so a scroll repaints rarely.
  const overscan = (SPAN_MAX_WIDTH - viewportWidth) / 2;
  const visibleStart = viewportLeft - clipLeft;
  const start = Math.max(0, Math.floor(visibleStart - Math.max(0, overscan)));
  const end = Math.min(
    clipWidth,
    Math.ceil(visibleStart + viewportWidth + Math.max(0, overscan)),
    start + SPAN_MAX_WIDTH,
  );
  return { start, end: Math.max(start + 1, end), total: clipWidth };
}

function covers(span: ClipSpan, next: ClipSpan, visibleStart: number, visibleEnd: number) {
  return (
    span.total === next.total &&
    span.start <= Math.max(0, visibleStart) &&
    span.end >= Math.min(next.total, visibleEnd)
  );
}

/**
 * Tracks which slice of a (possibly very wide) clip needs painting. Re-renders
 * only when the visible part leaves the painted window, never per scroll frame.
 */
export function useVisibleClipSpan(rootRef: RefObject<HTMLElement | null>): ClipSpan | null {
  const [span, setSpan] = useState<ClipSpan | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scroller = findHorizontalScroller(root);
    let frame = 0;
    // The clip's left edge in the scroller's content, measured only when layout
    // can have moved it. Scroll frames then read scrollLeft alone instead of
    // forcing a layout per waveform per frame.
    let clipOffset: number | null = null;
    const measureOffset = () => {
      const rootRect = root.getBoundingClientRect();
      const viewLeft = scroller?.getBoundingClientRect().left ?? 0;
      clipOffset = rootRect.left - viewLeft + (scroller?.scrollLeft ?? 0);
    };
    const measure = () => {
      frame = 0;
      const clipWidth = root.clientWidth;
      if (clipWidth <= FULL_CANVAS_MAX_WIDTH) {
        setSpan((current) => (current === null ? current : null));
        return;
      }
      if (clipOffset === null) measureOffset();
      const scrollLeft = scroller?.scrollLeft ?? 0;
      const viewWidth = scroller?.clientWidth ?? window.innerWidth;
      const clipLeft = (clipOffset ?? 0) - scrollLeft;
      const next = computeClipSpan(clipLeft, clipWidth, 0, viewWidth);
      if (!next) return;
      const visibleStart = -clipLeft;
      const visibleEnd = visibleStart + viewWidth;
      setSpan((current) =>
        current && covers(current, next, visibleStart, visibleEnd) ? current : next,
      );
    };
    const remeasure = () => {
      clipOffset = null;
      schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const resize = new ResizeObserver(remeasure);
    resize.observe(root);
    if (scroller) resize.observe(scroller);
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure);
    // A clip moved by a drag or a ripple edit keeps its size, so neither
    // observer fires; re-check when the gesture or keystroke that moved it ends.
    window.addEventListener("pointerup", remeasure);
    window.addEventListener("keyup", remeasure);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("pointerup", remeasure);
      window.removeEventListener("keyup", remeasure);
    };
  }, [rootRef]);

  return span;
}

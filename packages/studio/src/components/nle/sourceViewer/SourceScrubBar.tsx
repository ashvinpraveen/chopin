import { useCallback, useRef } from "react";
import type { SourceMarks } from "../../../utils/sourceMarks";

interface SourceScrubBarProps {
  duration: number;
  time: number;
  marks: SourceMarks;
  onSeek: (time: number) => void;
  /** Called once when a scrub starts (to stop playback). */
  onScrubStart?: () => void;
}

const pct = (t: number, duration: number) =>
  `${duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0}%`;

/** Source viewer scrub bar: the in–out range shaded, small in/out ticks, the playhead. */
export function SourceScrubBar({
  duration,
  time,
  marks,
  onSeek,
  onScrubStart,
}: SourceScrubBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const timeAt = useCallback(
    (clientX: number) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return 0;
      return ((clientX - rect.left) / rect.width) * duration;
    },
    [duration],
  );
  const marked = marks.in != null || marks.out != null;
  const rangeStart = marks.in ?? 0;
  const rangeEnd = marks.out ?? duration;

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={-1}
      aria-label="Source position"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={time}
      className="relative h-4 w-full cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onScrubStart?.();
        onSeek(timeAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(timeAt(e.clientX));
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-neutral-800" />
      {marked && (
        <div
          data-testid="source-range"
          className="absolute top-1/2 h-[7px] -translate-y-1/2 bg-white/15"
          style={{
            left: pct(rangeStart, duration),
            right: `calc(100% - ${pct(rangeEnd, duration)})`,
          }}
        />
      )}
      {marks.in != null && (
        <div
          data-testid="source-mark-in"
          className="absolute top-1/2 h-2.5 w-[2px] -translate-y-1/2 bg-neutral-300"
          style={{ left: pct(marks.in, duration) }}
        />
      )}
      {marks.out != null && (
        <div
          data-testid="source-mark-out"
          className="absolute top-1/2 h-2.5 w-[2px] -translate-x-full -translate-y-1/2 bg-neutral-300"
          style={{ left: pct(marks.out, duration) }}
        />
      )}
      <div
        className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-white"
        style={{ left: pct(time, duration) }}
      />
    </div>
  );
}

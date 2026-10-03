import { useCallback, useEffect, useRef, useState } from "react";
import { nextShuttleIndex, SOURCE_SHUTTLE_SPEEDS } from "../../../utils/sourceViewerKeys";
import { stepSourceFrame } from "../../../utils/sourceMarks";

type Direction = "forward" | "backward";

export interface SourceTransport {
  time: number;
  playing: boolean;
  /** Signed shuttle speed while shuttling or playing, 0 when stopped. */
  speed: number;
  togglePlay: () => void;
  shuttle: (direction: Direction) => void;
  stop: () => void;
  step: (frames: number) => void;
  seek: (time: number) => void;
}

/**
 * Transport for the source viewer's media element. Forward play and shuttle
 * use `playbackRate`; reverse (J) is emulated by moving `currentTime` back on
 * every animation frame, since Chrome does not play media backwards.
 */
export function useSourceTransport(
  media: HTMLMediaElement | null,
  fps: number,
  duration: number,
): SourceTransport {
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(0);
  const shuttleRef = useRef<{ direction: Direction | null; index: number }>({
    direction: null,
    index: 0,
  });
  const reverseRef = useRef<{ raf: number; last: number; rate: number } | null>(null);

  const stopReverse = useCallback(() => {
    if (reverseRef.current) cancelAnimationFrame(reverseRef.current.raf);
    reverseRef.current = null;
  }, []);

  const stop = useCallback(() => {
    stopReverse();
    mediaRef.current?.pause();
    shuttleRef.current = { direction: null, index: 0 };
    setSpeed(0);
  }, [mediaRef, stopReverse]);

  const reverseFrame = useCallback(
    (now: number) => {
      const media = mediaRef.current;
      const state = reverseRef.current;
      if (!media || !state) return;
      const next = media.currentTime - ((now - state.last) / 1000) * state.rate;
      state.last = now;
      media.currentTime = Math.max(0, next);
      setTime(media.currentTime);
      if (next <= 0) return stop();
      state.raf = requestAnimationFrame(reverseFrame);
    },
    [mediaRef, stop],
  );

  const shuttle = useCallback(
    (direction: Direction) => {
      const media = mediaRef.current;
      if (!media) return;
      const index = nextShuttleIndex(shuttleRef.current, direction);
      shuttleRef.current = { direction, index };
      const rate = SOURCE_SHUTTLE_SPEEDS[index];
      setSpeed(direction === "forward" ? rate : -rate);
      if (direction === "forward") {
        stopReverse();
        media.playbackRate = rate;
        void media.play().catch(() => setSpeed(0));
        return;
      }
      media.pause();
      if (reverseRef.current) reverseRef.current.rate = rate;
      else {
        const last = performance.now();
        reverseRef.current = { raf: requestAnimationFrame(reverseFrame), last, rate };
      }
    },
    [mediaRef, reverseFrame, stopReverse],
  );

  const togglePlay = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (speed !== 0) return stop();
    shuttleRef.current = { direction: null, index: 0 };
    shuttle("forward");
  }, [mediaRef, shuttle, speed, stop]);

  const seek = useCallback(
    (to: number) => {
      const media = mediaRef.current;
      if (!media) return;
      media.currentTime = Math.min(Math.max(0, to), duration || media.duration || 0);
      setTime(media.currentTime);
    },
    [mediaRef, duration],
  );

  const step = useCallback(
    (frames: number) => {
      stop();
      const media = mediaRef.current;
      if (media) seek(stepSourceFrame(media.currentTime, frames, fps, duration || media.duration));
    },
    [fps, duration, mediaRef, seek, stop],
  );

  useSyncTime(media, setTime, setSpeed);
  useEffect(() => stopReverse, [stopReverse]);

  return { time, playing: speed !== 0, speed, togglePlay, shuttle, stop, step, seek };
}

/** Follow the element's clock while it plays, and its pauses and ends. */
function useSyncTime(
  media: HTMLMediaElement | null,
  setTime: (t: number) => void,
  setSpeed: (s: number) => void,
): void {
  useEffect(() => {
    if (!media) return;
    let raf = 0;
    const tick = () => {
      setTime(media.currentTime);
      raf = media.paused ? 0 : requestAnimationFrame(tick);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onSettle = () => setTime(media.currentTime);
    const onEnded = () => setSpeed(0);
    media.addEventListener("play", onPlay);
    media.addEventListener("seeked", onSettle);
    media.addEventListener("pause", onSettle);
    media.addEventListener("loadedmetadata", onSettle);
    media.addEventListener("ended", onEnded);
    return () => {
      cancelAnimationFrame(raf);
      media.removeEventListener("play", onPlay);
      media.removeEventListener("seeked", onSettle);
      media.removeEventListener("pause", onSettle);
      media.removeEventListener("loadedmetadata", onSettle);
      media.removeEventListener("ended", onEnded);
    };
  }, [media, setTime, setSpeed]);
}

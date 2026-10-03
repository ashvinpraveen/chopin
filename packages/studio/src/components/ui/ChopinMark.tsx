import type { SVGProps } from "react";

/**
 * Chopin's mark: a ring cut at the playhead. The half already played is drawn
 * in `currentColor`, the half still to come in the accent, and the playhead
 * runs through the cut. No container, so it stands on its own in dark and light.
 */
export function ChopinMark({ viewBox = "0 0 100 100", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d="M45 14.4 A36 36 0 0 0 45 85.6" stroke="currentColor" strokeWidth="10" />
      <path d="M55 14.4 A36 36 0 0 1 55 85.6" stroke="var(--color-accent)" strokeWidth="10" />
      <line
        x1="50"
        y1="5"
        x2="50"
        y2="95"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

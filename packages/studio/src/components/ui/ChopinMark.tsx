import type { SVGProps } from "react";

/**
 * Chopin's mark: an open ring with a solid note-head resting inside it. Built
 * only from circles and drawn in `currentColor` (the dot in the accent), so it
 * stands on its own in dark and light with no container behind it.
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
      <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="8" />
      <circle cx="61" cy="61" r="15" fill="var(--color-accent)" />
    </svg>
  );
}

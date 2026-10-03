import { useId, type SVGProps } from "react";

export function ChopinMark({ viewBox = "0 0 100 100", ...props }: SVGProps<SVGSVGElement>) {
  const gradientId = useId();
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="100"
          y2="100"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--color-brand-gradient-from)" />
          <stop offset="1" stopColor="var(--color-brand-gradient-to)" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="84" height="84" rx="18" fill={`url(#${gradientId})`} />
      <rect x="27" y="43" width="11" height="30" rx="5.5" fill="var(--color-bg-0)" />
      <rect x="44.5" y="27" width="11" height="46" rx="5.5" fill="var(--color-bg-0)" />
      <rect x="62" y="50" width="11" height="23" rx="5.5" fill="var(--color-bg-0)" />
    </svg>
  );
}

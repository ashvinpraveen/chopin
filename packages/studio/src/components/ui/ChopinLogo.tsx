export function ChopinLogo() {
  return (
    <span className="flex items-center gap-2 text-text-0" aria-label="Chopin">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <defs>
          <linearGradient
            id="chopin-mark"
            x1="0"
            y1="0"
            x2="22"
            y2="22"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--color-brand-gradient-from)" />
            <stop offset="1" stopColor="var(--color-brand-gradient-to)" />
          </linearGradient>
        </defs>
        <rect width="22" height="22" rx="4" fill="url(#chopin-mark)" />
        <rect x="5" y="9" width="2.5" height="8" rx="1.25" fill="var(--color-bg-0)" />
        <rect x="9.75" y="5" width="2.5" height="12" rx="1.25" fill="var(--color-bg-0)" />
        <rect x="14.5" y="11" width="2.5" height="6" rx="1.25" fill="var(--color-bg-0)" />
      </svg>
      <span className="text-step-15 font-semibold tracking-tight">Chopin</span>
    </span>
  );
}

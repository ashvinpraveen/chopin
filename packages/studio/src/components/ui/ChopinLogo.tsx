import { ChopinMark } from "./ChopinMark";

export function ChopinLogo() {
  return (
    <span className="flex items-center gap-2 text-text-0" aria-label="Chopin">
      <ChopinMark width={18} height={18} />
      <span className="text-step-15 font-semibold tracking-tight">Chopin</span>
    </span>
  );
}

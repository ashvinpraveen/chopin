import type { Example } from "./_examples.js";
import { createInspectCommand } from "./layout.js";

export const examples: Example[] = [
  ["Inspect visual layout across the current composition", "chopin inspect"],
  ["Inspect a specific project", "chopin inspect ./my-video"],
  ["Output agent-readable JSON", "chopin inspect --json"],
  ["Use explicit hero-frame timestamps", "chopin inspect --at 1.5,4.0,7.25"],
  [
    "Also sample at tween boundaries to catch transient overlaps",
    "chopin inspect --at-transitions",
  ],
  [
    "Verify motion intent (add a *.motion.json sidecar next to the composition)",
    "chopin inspect --json",
  ],
  ["Run the compatibility alias", "chopin layout --json"],
];

export default createInspectCommand("inspect");

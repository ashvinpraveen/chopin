// fallow-ignore-file unused-file
import { writeFileSync } from "node:fs";
import { registerRootExitRequester } from "../utils/commandResult.js";
import { ensureBrowser } from "./manager.js";
import { launchManagedBrowser } from "./launch.js";

const [profileDir, readyPath] = process.argv.slice(2);
if (!profileDir || !readyPath) throw new Error("Missing fixture arguments");

// Stand-in for cli.ts: records the requested exit code, then ends the process.
registerRootExitRequester((exitCode) => {
  writeFileSync(`${readyPath}.exit`, String(exitCode));
  process.kill(process.pid, "SIGKILL");
});
const { executablePath } = await ensureBrowser();
const puppeteer = await import("puppeteer-core");
writeFileSync(readyPath, "launching");
const browser = await launchManagedBrowser(puppeteer.default, {
  headless: true,
  executablePath,
  args: ["--no-sandbox", `--user-data-dir=${profileDir}`],
});
writeFileSync(readyPath, "ready");
await browser.pages();
setInterval(() => undefined, 1_000);

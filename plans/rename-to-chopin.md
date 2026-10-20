# Renaming HyperFrames → Chopin

Status: phase 1 is done (branch `claude/rename-to-chopin-df51bd`). Phases 2–4 are proposals, not started.

Chopin is Ash's fork of HeyGen's open-source HyperFrames (`upstream` = `heygen-com/hyperframes`).
The goal: people and agents see "Chopin", while the fork keeps merging upstream cheaply and nothing
that's already installed breaks. "Built on HeyGen's HyperFrames" stays as credit in `README.md`,
`CREDITS.md`, and the root `--help` footer.

## Where the name lives

| Group           | Examples                                                                                                                                                                                                                                                                                                | Scale                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. User-facing  | CLI bin + help/examples, CLI messages, studio UI strings, README/CREDITS, the docs site                                                                                                                                                                                                                 | ~250 CLI example strings, ~20 studio strings, the whole `docs/` tree          |
| 2. Agent-facing | `skills/hyperframes*`, `skills-manifest.json`, `plugin.json`, `gemini-extension.json`, `.claude-plugin/`, CLAUDE.md/AGENTS.md, the `init` project templates                                                                                                                                             | 9 `hyperframes-*` skills, plus every skill body that says `npx hyperframes …` |
| 3. Internal     | `@hyperframes/*` package names (14 packages), `~/.cache/hyperframes/*`, `.hyperframes/` project dir, `hyperframes.json`, `data-hyperframes-*` attrs, `<hyperframes-player>`, `window.__hf*` / `__HYPERFRAMES_DEBUG`, ~80 `HYPERFRAMES_*` env vars, `X-Hyperframes-Write-Token`, `/__hyperframes_config` | ~1,000 occurrences in `packages/cli/src` alone                                |

## Phase 1: done

- `packages/cli/package.json` has a `chopin` bin. `hyperframes` stays as a second bin pointing at the
  same entry, `bin/hyperframes.mjs`.
- citty's root `meta.name` is `chopin`, so `USAGE` lines read `chopin render …`. The root help header,
  usage line, examples and footer say `chopin`, and the footer adds that `hyperframes` is an alias
  and Chopin is built on HyperFrames.
- Each command's `examples` array uses `chopin …`. Only the strings inside `export const examples`
  were rewritten, by a scoped script, so runtime behavior is unchanged.
- Product-name strings now say Chopin: the Node version error, `init` intro, `doctor` unzip hint,
  `clean` description, `play`/`grade-compare` page titles, the "Studio unavailable" page, the studio
  console banner, and the WebMCP tool descriptions ("Chopin Studio").
- README opens with a Chopin section that credits HyperFrames. CREDITS has a "Built on HeyGen's
  HyperFrames" section.

Deliberately left alone in phase 1:

- **Runtime hints that print `hyperframes …` / `npx hyperframes …`** (e.g. "Run: npx hyperframes
  skills update"). `npx hyperframes` resolves to _upstream's_ npm package, not this fork, so
  `npx chopin` would 404 until something is published. Plain `hyperframes <cmd>` hints are harmless
  because the alias works. Sweep them once `chopin` is on PATH by default (see phase 2).
- **Feedback/NPS prompts** ("recommend HyperFrames?", "Send feedback to the HyperFrames team"): the
  responses still go to HeyGen's telemetry, so the wording is accurate. Revisit if Chopin gets its
  own telemetry sink, or turn telemetry off in the fork.
- **Agent prompts** built by the studio ("## HyperFrames element edit request v1", "Edit the
  following HyperFrames composition", LintModal's "Fix these HyperFrames lint issues"). These tell
  the agent which _framework_ the file follows, and they line up with the `hyperframes-*` skills.
  Rename them alongside the skills in phase 3.
- **Format/product nouns**: "HyperFrames compositions", "HyperFrames Registry", "HyperFrames
  color-grading JSON", `cloud` ("render HyperFrames compositions on HeyGen's cloud"). These name the
  upstream format or service, which really is HyperFrames.
- **`docs/`**: the Mintlify site mirrors hyperframes.heygen.com. Rebranding it guarantees conflicts
  on every upstream merge, and its links point at upstream anyway. Fork-specific docs belong in new
  files, not in rewrites of upstream pages.

## Trade-offs that shape the rest

1. **Upstream merges.** Every renamed line is a potential conflict on `git merge upstream/main`.
   Small user-facing edits (phase 1) are cheap. A global `@hyperframes/` → `@chopin/` rewrite
   touches thousands of lines and import paths, and every upstream PR would conflict. Rule: rename at
   the _edges_ (bins, display strings, new aliases), not in the core.
2. **Existing installs.** Projects on disk already have `hyperframes.json`, `.hyperframes/`,
   `data-hyperframes-*` attributes, and `window.__timelines`. Rendered output and the
   `<hyperframes-player>` embed depend on these. They are a file format, so they never get renamed,
   only aliased if ever.
3. **Global skills in `~/.claude/skills`.** Ash has copies (not symlinks) of all 9 `hyperframes*`
   skills there, and content-os notes and other agents trigger on `/hyperframes`, `hyperframes-core`,
   and so on. Renaming the skill dirs strands those copies, and `chopin skills update` would install
   new names next to the old ones, so two routers would compete for the same prompts.
4. **Cache dir.** `~/.cache/hyperframes/{chrome,optional,tts,whisper,background-removal,history}`
   holds GBs of downloads (Chrome, Whisper models, TTS models) plus project history. A naive rename
   re-downloads all of it, or loses history.

## Phase 2: make `chopin` real on this machine (small, do next)

- `cd packages/cli && bun link` (or `npm link`) so `chopin` is on PATH. Then content-os's `chopin
<cmd>` notes work literally. Verify with `chopin --version`.
- After that, sweep runtime hints that print bare `hyperframes <cmd>` to `chopin <cmd>`. Leave
  `npx hyperframes …` until a `chopin` package exists on npm (or point them at the linked binary).
- Optional: add `CHOPIN_*` env-var aliases read before `HYPERFRAMES_*`, through one helper (no mass
  rename).

## Phase 3: agent-facing (needs a decision)

Recommended: **add Chopin-named entry points; don't rename the `hyperframes-*` skills.**

- Add a thin `skills/chopin/SKILL.md` router that says "Chopin = this fork of HyperFrames; the domain
  skills keep their `hyperframes-*` names", then hands off to `/hyperframes`. Agents asked about
  "chopin" find it, and every existing trigger keeps working.
- `plugin.json` / `gemini-extension.json` / `.claude-plugin`: changing `name` changes the install
  identity (`hyperframes@hyperframes`). Only switch it if the fork's plugin is installed from
  `ashvinpraveen/chopin` instead of upstream. Updating `description` to mention Chopin is safe.
  Then regenerate `skills-manifest.json` (`bun run --cwd packages/cli gen:skills-manifest`).
- CLAUDE.md / AGENTS.md / the `init` templates: add one line ("this repo is Chopin; the CLI is
  `chopin`, `hyperframes` is an alias") instead of rewriting every entry. Keep the two template
  files byte-identical.
- A full skill rename (`chopin-core`, …) only makes sense if the fork stops tracking upstream skill
  changes. If it ever happens: ship new names alongside the old ones for a release, turn the old ones
  into stubs that point at the new names, and delete the stale copies from `~/.claude/skills`
  explicitly.

## Phase 4: internal (mostly: don't)

- **`@hyperframes/*` packages:** keep. They aren't published from the fork, users never type them,
  and renaming breaks every upstream merge. If the fork ever publishes to npm, publish under a new
  scope through package aliases (`"@chopin/cli": "npm:…"`) or a thin re-export package, rather than
  rewriting imports.
- **Cache dir:** keep `~/.cache/hyperframes` as the source of truth for now. If a rename is wanted:
  resolve a `cacheRoot()` helper once (today `homedir()/.cache/hyperframes` is repeated in about 8
  modules: browser, optionalPackages, tts, whisper, background-removal, history). Prefer
  `~/.cache/chopin` when it exists, fall back to `~/.cache/hyperframes`, and on first run move the
  old dir with a single `rename()` on the same filesystem, never a copy. `chopin clean` should list
  both. Do this only together with upstream, or the helper conflicts.
- **`data-*` attrs, `window.__hf*`, `<hyperframes-player>`, `hyperframes.json`, `.hyperframes/`,
  write-token header, `/__hyperframes_config`:** never rename. They're the composition file format
  and wire protocol. Existing projects, rendered embeds and other HyperFrames instances (the studio
  server probes `/__hyperframes_config` to reuse instances) depend on them.

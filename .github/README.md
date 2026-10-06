# Chopin

**Cut footage like a native editor. Make graphics like the web.**

Chopin is a video editor that sits between two worlds. On one side are native editors such as
DaVinci Resolve and CapCut: a timeline, a viewer, a media pool, real camera footage, proxies. On
the other are HTML graphics tools: anything a browser can draw, animated with code and edited by
you or an AI agent. Chopin keeps the feel of the first and the freedom of the second, and it is
built on [HyperFrames](https://github.com/heygen-com/hyperframes).

> **Status: early personal project.** Chopin is a fork of HyperFrames used for real episodes, but
> it is not production software yet. Expect rough edges.

---

## The idea

Native editors are fast and familiar, but their graphics live behind effect panels, templates and
plug-ins. HTML graphics tools can make any title, chart, caption or layout you can imagine, but
they don't know what an A-cam is, and they choke on a 25 GB ProRes file.

Chopin takes a side on each question:

| Question                      | Native editor                | HTML graphics tool           | Chopin                                           |
| ----------------------------- | ---------------------------- | ---------------------------- | ------------------------------------------------ |
| How do you cut?               | Timeline, in/out, drag clips | Edit code                    | **Timeline, in/out, drag clips**                 |
| What are graphics made of?    | Effect presets and plug-ins  | HTML, CSS and animation code | **HTML, CSS and animation code**                 |
| Who can edit the project?     | You, in the app              | You or an agent, as text     | **Both: the project is plain files**             |
| How is heavy footage handled? | Proxies, hardware decode     | Not at all                   | **Automatic proxies, footage stays where it is** |
| Is the output repeatable?     | Mostly                       | Depends                      | **Same frames every render**                     |

The rule of thumb: **footage is treated like an editor treats it, graphics like the web treats
them.** Your camera files are never copied or rewritten. Everything layered on top is a text file
you, Claude Code or any coding agent can read and change, and the viewer updates as soon as the
file is saved.

## What you can do today

**Edit like an editor**

- A Resolve-style layout: Viewer, Media Pool, Timelines, Inspector, Edit Index, Render Queue.
- A source viewer with in and out points. Mark a range on a clip and drag it onto the timeline.
- Media storage: browse footage anywhere on your drives in a grid and drag it straight in.
- Clips coloured by kind and labelled with their file names, and PAL frame rates (24, 25, 30,
  50, 60).
- A project switcher in the header.

**Work with heavy footage**

- Any source above 1080p gets a 720p proxy for preview automatically. Renders always use the
  originals.
- Long sources get segmented proxies, made on demand in short pieces, so you can start working
  without waiting for a whole file to convert.
- **Media mounts** let a project use footage stored elsewhere on the drive without copying it.
  This works on exFAT drives, which can't hold symlinks:

  ```jsonc
  // hyperframes.json
  { "media": { "mounts": { "exports": "../../../Exports" } } }
  ```

  ```html
  <video src="exports/MAI%20Podcast%20%233%20A%20CAM.mov"></video>
  ```

  The mount path is relative to the project, so the drive still works when you plug it into
  another Mac.

**Make graphics like the web**

- Titles, lower-thirds, captions, charts and transitions are HTML and CSS, animated with GSAP or
  any of the other animation runtimes HyperFrames supports.
- The whole HyperFrames catalog of blocks and effects, plus its agent skills, so an agent can build
  scenes for you.
- Frame-exact rendering to MP4 (or transparent video), deterministic from one render to the next.

## How it works

```
 your drive                         Chopin
 ──────────                         ──────
 Exports/A CAM.mov ──(mount)──▶  footage layer ──▶ proxies for preview, originals for render
                                       │
 project/index.html ───────────▶ graphics layer (HTML · CSS · GSAP)
                                       │
                                       ▼
                     Studio viewer + timeline  ──▶  render ──▶ MP4
```

A project is a folder: an `index.html` that describes the timeline, optional sub-compositions,
and a `hyperframes.json` for settings such as media mounts. Studio reads and writes those files.
Edits you make in the timeline and edits an agent makes in the code are the same edits.

## Quick start (macOS)

You need [Bun](https://bun.sh), Node.js 22 or newer, FFmpeg, and [Git LFS](https://git-lfs.com)
(`brew install git-lfs`). The repository keeps test media in LFS; you don't need those files to
run the editor, so `GIT_LFS_SKIP_SMUDGE=1` skips them.

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/ashvinpraveen/chopin.git
cd chopin
bun install
bun run --filter '@hyperframes/{parsers,lint,studio-server}' build
bun run --filter @hyperframes/core build
bun run --filter @hyperframes/player build
```

Open a project in Studio:

```bash
bun packages/cli/src/cli.ts preview /path/to/your/project
```

To start a new project, run `npx hyperframes init my-project` and see the
[HyperFrames documentation](https://hyperframes.heygen.com/introduction).

## Where it's going

1. **Share it.** One command to install, under Chopin's own name.
2. **A desktop app.** A double-click Mac app instead of a terminal and a browser tab.
3. **Faster with 4K.** Hand footage decoding and encoding to the Mac's video hardware, and leave
   the browser to draw only the graphics.
4. **Hand-offs.** Open in DaVinci Resolve (FCPXML plus SRT) or CapCut, and import and export
   FCPXML, EDL and OTIO timelines.
5. **Better colour.** Per-clip LUTs from a shared folder, applied before the grade.

## Privacy

Analytics and the feedback card inherited from HyperFrames are switched off in Chopin, in Studio
and in the CLI, until Chopin has its own analytics project.

## Relationship to HyperFrames

Chopin is a fork of [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) and tracks
it through the `upstream` remote, so improvements there can be merged in. Package names such as
`@hyperframes/studio` are unchanged for now. The original HyperFrames README is in the repository
root as [`README.md`](../README.md).

## License and credits

Licensed under the [Apache License 2.0](../LICENSE), the same as HyperFrames. Chopin is built on
the work of HeyGen and the HyperFrames contributors, and on the prior art listed in
[`CREDITS.md`](../CREDITS.md).

Chopin is an independent project. It is not affiliated with, endorsed by, or sponsored by HeyGen,
Blackmagic Design or ByteDance. HyperFrames and HeyGen are trademarks of HeyGen. DaVinci Resolve
is a trademark of Blackmagic Design and CapCut a trademark of ByteDance, named here only to
describe the kind of editor Chopin is inspired by.

## Contributing

Use Bun (not npm or pnpm) and Conventional Commits (`feat(studio): ...`). Git hooks lint, format
and type-check on commit. Run a package's tests with `bunx vitest run` inside it.

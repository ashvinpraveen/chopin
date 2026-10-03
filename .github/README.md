# Chopin

**An AI-native video editor with a DaVinci Resolve-style layout, built on [HyperFrames](https://github.com/heygen-com/hyperframes).**

You describe a video as HTML. Claude Code (or any coding agent) edits the files, and the preview updates
instantly. You cut, trim and tweak in a timeline that feels like an NLE, then render.

> **Status: early personal project.** Chopin is a fork of HyperFrames with a new look and a few
> editor changes. It is not production software, and most of the roadmap below is not built yet.

## What Chopin is

HyperFrames turns HTML, CSS, media and seekable animations into deterministic video. It already ships
a browser-based editor called Studio, with a live preview, a timeline, an inspector and a render
queue. Chopin takes that editor and moves it toward the workflow of a traditional editor, for people
who cut real camera footage and layer AI-generated motion graphics and animated subtitles on top.

## What is different from HyperFrames today

- **Brand and theme.** A Chopin logo, favicon and title. A dark neutral gray theme with a muted
  orange accent, a red playhead, blue video clips and green audio clips, flat panels with thin
  dividers, compact tab strips, and smaller, grayer text.
- **Resolve-style panel names.** Panels use Resolve terms, with the Media Pool first.
- **File names on clips.** Video, audio and image clips in the timeline show their file name, as in
  Resolve, unless you set an explicit label.
- **PAL frame rates.** The render dialog offers 24, 25, 30, 50 and 60 fps (HyperFrames only offered
  24, 30 and 60 there).

| HyperFrames Studio             | Chopin       |
| ------------------------------ | ------------ |
| Preview                        | Viewer       |
| Assets                         | Media Pool   |
| Compositions                   | Timelines    |
| Catalog                        | Effects      |
| Code                           | Code         |
| Design                         | Inspector    |
| Layers                         | Edit Index   |
| Renders                        | Render Queue |
| Timeline, Variables, Slideshow | unchanged    |

`Cmd+1` opens the Media Pool and `Cmd+2` opens Timelines.

## Roadmap (planned, not built)

- Play original footage directly by default. Add optional proxies for heavy multi-camera 4K, as in
  Resolve: generate proxy media per clip or folder, a "use proxies" toggle, and a suggestion when
  playback drops frames. Renders always use the originals, and color stays on the clip rather than
  being baked into a proxy.
- Better LUT handling, as in Resolve: pick a LUT per clip from a shared LUT folder with thumbnails
  (Studio today loads a `.cube` file into the project), apply it as an input transform before the
  grade, and support 65-point cubes (HyperFrames reads up to 64).
- Handoff buttons: **Open in DaVinci Resolve** (an FCPXML plus an SRT) and **Open in CapCut**
  (a flattened cut plus subtitles).
- Import and export of timeline formats such as FCPXML, EDL and OTIO, and JSON.
- A project folder tree, and more of the Resolve Edit-page layout (timecode ruler, viewer
  header, collapsible inspector sections).

## Quick start (macOS)

Requirements: [Bun](https://bun.sh), Node.js 22 or newer, FFmpeg, and [Git LFS](https://git-lfs.com)
(`brew install git-lfs`). The repo stores test media in LFS and a clone fails without it. You do not
need those files to run the editor, so `GIT_LFS_SKIP_SMUDGE=1` skips downloading them.

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/ashvinpraveen/chopin.git
cd chopin
bun install
bun run --filter '@hyperframes/{parsers,lint,studio-server}' build
bun run --filter @hyperframes/core build

# Link a HyperFrames project into Studio's dev project folder
mkdir -p packages/studio/data/projects
ln -s /path/to/your/project packages/studio/data/projects/my-project

cd packages/studio
bun run dev
```

Then open `http://127.0.0.1:5190/#project/my-project`. If the panels are in an old order, use
**Window > Reset layout**.

To create a project, use the HyperFrames CLI (`npx hyperframes init my-project`) and see the
[HyperFrames documentation](https://hyperframes.heygen.com/introduction). The original HyperFrames
README is still in the repository root as [`README.md`](../README.md).

### Frame rate

Set `data-fps="25"` on the composition root to make 25 fps the default for command-line renders.
Studio's render dialog lets you pick 24, 25, 30, 50 or 60.

## Telemetry and feedback

This fork still contains HyperFrames' browser analytics and its "send feedback" card, both wired to
HeyGen's services. Development builds (`bun run dev`) do not send analytics. If you build and ship
Chopin, point these at your own services or remove them first. You can opt out of the CLI's
telemetry with `HYPERFRAMES_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`.

## Relationship to HyperFrames

Chopin is a fork of [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) and tracks
it through the `upstream` remote, so improvements there can be merged here. Chopin's changes are
visible in this repository's commit history. Package names such as `@hyperframes/studio` are
unchanged for now.

## License and credits

Licensed under the [Apache License 2.0](../LICENSE), the same as HyperFrames. Chopin is built on the
work of HeyGen and the HyperFrames contributors, and on the prior art listed in
[`CREDITS.md`](../CREDITS.md).

Chopin is an independent project. It is not affiliated with, endorsed by, or sponsored by HeyGen
or Blackmagic Design. HyperFrames and HeyGen are trademarks of HeyGen. DaVinci Resolve is a
trademark of Blackmagic Design, mentioned here only to describe the layout Chopin is inspired by.

## Contributing

Use Bun (not npm or pnpm) and Conventional Commits (`feat(studio): ...`). The repository installs
Git hooks that lint, format and type-check on commit. Run the Studio tests with
`cd packages/studio && bunx vitest run`.

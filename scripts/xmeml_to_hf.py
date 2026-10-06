#!/usr/bin/env python3
"""Convert an FCP7 xmeml sequence (+ optional SRT) into a HyperFrames composition.

Usage: xmeml_to_hf.py SEQ.xml OUT_DIR [--srt CAPTIONS.srt] [--media-dir media]
Source files are referenced through symlinks in OUT_DIR/<media-dir>, never copied.
"""
import argparse, html, json, os, re, xml.etree.ElementTree as ET
from urllib.parse import unquote, urlparse

ap = argparse.ArgumentParser()
ap.add_argument("xml"); ap.add_argument("out")
ap.add_argument("--srt"); ap.add_argument("--media-dir", default="media")
a = ap.parse_args()

seq = ET.parse(a.xml).getroot().find("sequence")
fps = int(seq.findtext("rate/timebase"))
dur = int(seq.findtext("duration")) / fps
fmt = seq.find("media/video/format/samplecharacteristics")
files = {}  # file id -> local relative src

def src_for(clip):
    f = clip.find("file"); fid = f.get("id")
    if fid not in files:
        p = unquote(urlparse(f.findtext("pathurl")).path)
        name = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.basename(p)).strip("-").lower()
        os.makedirs(os.path.join(a.out, a.media_dir), exist_ok=True)
        link = os.path.join(a.out, a.media_dir, name)
        if not os.path.lexists(link): os.symlink(p, link)
        files[fid] = f"./{a.media_dir}/{name}"
    return files[fid]

def clips(kind):
    out = []
    for ti, tr in enumerate(seq.findall(f"media/{kind}/track")):
        for c in tr.findall("clipitem"):
            s, e, i = (int(c.findtext(k)) for k in ("start", "end", "in"))
            out.append(dict(track=ti, name=c.findtext("name"), src=src_for(c), start=s / fps, dur=(e - s) / fps, inp=i / fps))
    return out

def merge(cs):  # join butt-ended clips that continue the same source
    m = []
    for c in sorted(cs, key=lambda c: c["start"]):
        p = m[-1] if m else None
        if p and p["src"] == c["src"] and abs(p["start"] + p["dur"] - c["start"]) < 1e-6 and abs(p["inp"] + p["dur"] - c["inp"]) < 1e-6:
            p["dur"] += c["dur"]
        else: m.append(dict(c))
    return m

video = clips("video")
audio = merge([c for c in clips("audio") if c["track"] == 0])  # track 1 is the other stereo channel
f = lambda x: f"{x:.4f}".rstrip("0").rstrip(".")
W, H = 1920, 1080

# One clip per cut, one lane per camera (like a multicam sequence), so every cut
# is visible and trimmable on the timeline.
srcs = list(dict.fromkeys(c["src"] for c in video))
lane = {src: n for n, src in enumerate(srcs)}
rows = []
for n, c in enumerate(sorted(video, key=lambda c: c["start"])):
    rows.append(f'      <video id="v{n}" class="clip cam" src="{c["src"]}" muted playsinline data-label="{html.escape(c["name"])}" '
                f'data-start="{f(c["start"])}" data-duration="{f(c["dur"])}" data-media-start="{f(c["inp"])}" data-track-index="{lane[c["src"]]}"></video>')
for n, c in enumerate(audio):
    rows.append(f'      <audio id="a{n}" src="{c["src"]}" data-label="{html.escape(c["name"])}" '
                f'data-start="{f(c["start"])}" data-duration="{f(c["dur"])}" data-media-start="{f(c["inp"])}" data-track-index="5"></audio>')

caps = []
if a.srt:
    def t(x):
        h, m, r = x.strip().split(":"); sec, ms = r.split(",")
        return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000
    for blk in re.split(r"\n\s*\n", open(a.srt, encoding="utf-8").read().strip()):
        ln = blk.splitlines(); t0, t1 = (t(x) for x in ln[1].split("-->"))
        caps.append((t0, t1, " ".join(ln[2:])))
    for n, (t0, t1, txt) in enumerate(caps):
        rows.append(f'      <div id="c{n}" class="clip cap" data-label="{html.escape(txt[:40])}" data-start="{f(t0)}" '
                    f'data-duration="{f(t1 - t0)}" data-track-index="3">{html.escape(txt)}</div>')

doc = f"""<!DOCTYPE html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width={W}, height={H}">
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ width: {W}px; height: {H}px; overflow: hidden; background: #000; }}
      #root {{ position: relative; width: {W}px; height: {H}px; overflow: hidden; background: #000; }}
      .cam {{ position: absolute; inset: 0; width: {W}px; height: {H}px; object-fit: cover; }}
      .cap {{ position: absolute; left: 160px; right: 160px; bottom: 90px; z-index: 10; text-align: center;
        font: 600 52px/1.25 system-ui, sans-serif; color: #fff; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8); }}
    </style>
  </head>
  <body>
    <!-- Imported from {html.escape(os.path.basename(a.xml))}: {len(video)} cuts, {fmt.findtext("width")}x{fmt.findtext("height")} @ {fps} fps -->
    <div id="root" data-composition-id="main" data-start="0" data-duration="{f(dur)}" data-fps="{fps}" data-width="{W}" data-height="{H}">
{chr(10).join(rows)}
    </div>
    <script>
      const tl = gsap.timeline({{ paused: true }});
      tl.set({{}}, {{}}, {f(dur)});
      window.__timelines = window.__timelines || {{}};
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
"""
os.makedirs(a.out, exist_ok=True)
open(os.path.join(a.out, "index.html"), "w").write(doc)
print(f"{len(video)} cut clips on {len(srcs)} lanes, {len(audio)} audio, {len(caps)} captions, {dur:.1f}s @ {fps}fps")

/**
 * Apply a source-edit plan (sourceEditPlan.ts) to composition HTML, as text:
 * the file keeps its formatting, and the whole edit is one write.
 *
 * Timing changes patch `data-start` / `data-duration` / the media in-point on
 * the clip's opening tag. Removing or splitting a clip needs the whole
 * element, which is only read for plain media tags (`<video>`, `<audio>`,
 * `<img>`); anything richer is refused with a message rather than guessed at.
 */
import type { ClipChange, ClipSpan } from "./sourceEditPlan";
import { applyPatchByTarget, findTagByTarget, type PatchTarget } from "./sourcePatcher";
import {
  formatTimelineAttributeNumber,
  formatTimelineMediaOffset,
} from "../player/components/timelineEditing";

export interface ClipTarget {
  target: PatchTarget;
  /** `media-start` or `playback-start`: the attribute the clip's in-point lives in. */
  mediaAttr: "media-start" | "playback-start";
  /** Master time minus authored time for this clip (0 at the root). */
  offset: number;
  label: string;
}

export interface ApplyContext {
  targets: ReadonlyMap<string, ClipTarget>;
  /** Ids already in the file; split tails take fresh ones and are added here. */
  ids: Set<string>;
  newHfId: () => string;
}

function patchAttr(source: string, target: PatchTarget, property: string, value: string): string {
  return applyPatchByTarget(source, target, { type: "attribute", property, value });
}

function patchSpan(source: string, clip: ClipTarget, span: ClipSpan): string {
  let out = patchAttr(
    source,
    clip.target,
    "start",
    formatTimelineAttributeNumber(Math.max(0, span.start - clip.offset)),
  );
  out = patchAttr(out, clip.target, "duration", formatTimelineAttributeNumber(span.duration));
  if (span.mediaStart != null) {
    out = patchAttr(out, clip.target, clip.mediaAttr, formatTimelineMediaOffset(span.mediaStart));
  }
  return out;
}

const VOID_MEDIA = new Set(["img"]);
const PAIRED_MEDIA = new Set(["video", "audio"]);

/** [start, end) of the whole element `target` names, or null when it is not a plain media tag. */
export function mediaElementExtent(
  source: string,
  target: PatchTarget,
): { start: number; end: number; openEnd: number } | null {
  const match = findTagByTarget(source, target);
  if (!match) return null;
  const name = /^<([a-zA-Z][\w-]*)/.exec(match.tag)?.[1]?.toLowerCase() ?? "";
  const openEnd = match.end + 1;
  if (VOID_MEDIA.has(name) || (PAIRED_MEDIA.has(name) && match.tag.trimEnd().endsWith("/"))) {
    return { start: match.start, end: openEnd, openEnd };
  }
  if (!PAIRED_MEDIA.has(name)) return null;
  const close = source.toLowerCase().indexOf(`</${name}>`, openEnd);
  return close < 0 ? null : { start: match.start, end: close + name.length + 3, openEnd };
}

function requireStructural(source: string, clip: ClipTarget) {
  const stable = Boolean(clip.target.id || clip.target.hfId);
  const extent = stable ? mediaElementExtent(source, clip.target) : null;
  if (!extent) {
    throw new Error(
      `"${clip.label}" is in the way and is not a plain media clip; split or move it first.`,
    );
  }
  return extent;
}

function freshId(base: string, ids: Set<string>): string {
  let n = 2;
  while (ids.has(`${base}_${n}`)) n += 1;
  const id = `${base}_${n}`;
  ids.add(id);
  return id;
}

function setOpeningAttr(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${name}=)(["'])[^"']*\\2`);
  if (pattern.test(tag)) return tag.replace(pattern, `$1"${value}"`);
  return tag.replace(/(\s*\/?>)$/, ` ${name}="${value}"$1`);
}

function cloneAsTail(source: string, clip: ClipTarget, tail: ClipSpan, ctx: ApplyContext): string {
  const extent = requireStructural(source, clip);
  let open = source.slice(extent.start, extent.openEnd);
  const rest = source.slice(extent.openEnd, extent.end);
  const baseId = /\sid=(["'])([^"']*)\1/.exec(open)?.[2] || "clip";
  open = setOpeningAttr(open, "id", freshId(baseId, ctx.ids));
  open = setOpeningAttr(open, "data-hf-id", ctx.newHfId());
  open = setOpeningAttr(
    open,
    "data-start",
    formatTimelineAttributeNumber(tail.start - clip.offset),
  );
  open = setOpeningAttr(open, "data-duration", formatTimelineAttributeNumber(tail.duration));
  if (tail.mediaStart != null) {
    open = setOpeningAttr(
      open,
      `data-${clip.mediaAttr}`,
      formatTimelineMediaOffset(tail.mediaStart),
    );
  }
  const lineStart = source.lastIndexOf("\n", extent.start);
  const indent = /^[ \t]*/.exec(source.slice(lineStart + 1, extent.start))?.[0] ?? "";
  return `${source.slice(0, extent.end)}\n${indent}${open}${rest}${source.slice(extent.end)}`;
}

function removeElement(source: string, clip: ClipTarget): string {
  const extent = requireStructural(source, clip);
  const lineStart = source.lastIndexOf("\n", extent.start);
  const onOwnLine = /^[ \t]*$/.test(source.slice(lineStart + 1, extent.start));
  const from = onOwnLine && lineStart >= 0 ? lineStart : extent.start;
  return source.slice(0, from) + source.slice(extent.end);
}

function targetOf(ctx: ApplyContext, key: string): ClipTarget {
  const clip = ctx.targets.get(key);
  if (!clip) throw new Error("A clip on the destination track has no patchable target.");
  return clip;
}

/**
 * Timing patches first (they may address clips by selector index, which a
 * removal or a new sibling would shift), then removals and split tails, which
 * only ever address clips by id or data-hf-id.
 */
export function applyClipChanges(
  source: string,
  changes: readonly ClipChange[],
  ctx: ApplyContext,
): string {
  let out = source;
  for (const change of changes) {
    if (change.type === "set") out = patchSpan(out, targetOf(ctx, change.key), change.span);
    if (change.type === "split") out = patchSpan(out, targetOf(ctx, change.key), change.head);
  }
  for (const change of changes) {
    if (change.type === "remove") out = removeElement(out, targetOf(ctx, change.key));
    if (change.type === "split")
      out = cloneAsTail(out, targetOf(ctx, change.key), change.tail, ctx);
  }
  return out;
}

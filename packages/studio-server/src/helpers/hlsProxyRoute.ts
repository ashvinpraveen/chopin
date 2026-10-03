import type { Context } from "hono";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { HLS_PROXY_VARIANT, hlsPlaylist, hlsSegment } from "./hlsProxy.js";
import { probeAssetCodec, type MediaCodecProbeCache } from "./mediaCodecMap.js";
import { isAutoProxyEnabled, type PreviewApiAdapter } from "./mediaProxyPreview.js";

export { HLS_PROXY_VARIANT };

/**
 * `?hf-proxy=hls` serves the segmented preview proxy of a heavy source: the
 * playlist on its own, a segment with `&seg=N`. Kept out of `routes/preview.ts`
 * for the repo's file-size cap.
 */
export async function serveHlsProxy(
  c: Context,
  adapter: PreviewApiAdapter,
  projectDir: string,
  file: string,
  subPath: string,
  contentType: string,
  probeCache: MediaCodecProbeCache,
): Promise<Response> {
  if (!contentType.startsWith("video/") || !isAutoProxyEnabled(adapter)) {
    return c.text("not found", 404);
  }
  const facts = await probeAssetCodec(file, undefined, probeCache);
  if (!facts?.heavy) return c.text("media proxy unavailable: not a heavy source", 422);

  const seg = c.req.query("seg");
  try {
    if (seg === undefined) {
      const playlist = await hlsPlaylist(projectDir, file, basename(subPath));
      return new Response(playlist, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
        },
      });
    }
    const body = await readFile(await hlsSegment(projectDir, file, Number(seg)));
    return segmentResponse(c.req.header("Range"), body);
  } catch (err) {
    if (err instanceof RangeError) return c.text(err.message, 404);
    return c.text(err instanceof Error ? err.message : "segment encode failed", 502);
  }
}

function segmentResponse(rangeHeader: string | undefined, body: Buffer): Response {
  const headers = {
    "Content-Type": "video/mp2t",
    "Cache-Control": "private, no-cache",
    "Accept-Ranges": "bytes",
  };
  const match = rangeHeader ? /bytes=(\d+)-(\d*)/.exec(rangeHeader) : null;
  if (!match) {
    return new Response(new Uint8Array(body), {
      headers: { ...headers, "Content-Length": String(body.length) },
    });
  }
  const start = Number(match[1]);
  const end = Math.min(match[2] ? Number(match[2]) : body.length - 1, body.length - 1);
  if (start > end) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${body.length}` },
    });
  }
  return new Response(new Uint8Array(body.subarray(start, end + 1)), {
    status: 206,
    headers: {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${body.length}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

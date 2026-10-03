import { useEffect, useState } from "react";
import {
  fetchSourceInfo,
  sourcePlaybackUrl,
  type SourceMediaInfo,
} from "../../../utils/sourceMediaApi";
import { AUDIO_EXT, IMAGE_EXT } from "../../../utils/mediaTypes";

export type SourceMediaKind = "video" | "audio" | "image";

export interface SourceMedia {
  kind: SourceMediaKind;
  info: SourceMediaInfo | null;
  /** Null until the probe answers (it decides between the file and its HLS proxy). */
  url: string | null;
}

function kindOf(path: string, info: SourceMediaInfo | null): SourceMediaKind {
  if (IMAGE_EXT.test(path)) return "image";
  if (info) return info.hasVideo ? "video" : "audio";
  return AUDIO_EXT.test(path) ? "audio" : "video";
}

/** Probe the clip, then pick what the viewer plays: the file, or its segmented proxy. */
export function useSourceMedia(projectId: string, path: string, external: boolean): SourceMedia {
  const [probed, setProbed] = useState<{ path: string; info: SourceMediaInfo | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchSourceInfo(projectId, path).then((info) => {
      if (!cancelled) setProbed({ path, info });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, path]);
  const info = probed?.path === path ? probed.info : null;
  const ready = probed?.path === path;
  return {
    kind: kindOf(path, info),
    info,
    url: ready ? sourcePlaybackUrl(projectId, path, external, info) : null,
  };
}

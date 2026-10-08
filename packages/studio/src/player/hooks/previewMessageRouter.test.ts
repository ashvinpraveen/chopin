// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewMessageHandler, TIMELINE_MESSAGE_COALESCE_MS } from "./previewMessageRouter";
import { usePlayerStore } from "../store/playerStore";

function setup() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const processed: unknown[] = [];
  const deps = {
    iframeRef: { current: iframe as HTMLIFrameElement | null },
    processTimelineMessageRef: { current: (data: unknown) => processed.push(data) },
    enrichMissingCompositionsRef: { current: () => {} },
    lastTimelineMessageRef: { current: 0 },
    getAdapter: () => null,
    syncTimelineElements: () => {},
  };
  const handle = createPreviewMessageHandler(deps as never);
  const send = (tag: string) =>
    handle({
      source: iframe.contentWindow,
      data: { source: "hf-preview", type: "timeline", clips: [{ id: tag }], durationInFrames: 30 },
    } as unknown as MessageEvent);
  return { deps, processed, send };
}

describe("createPreviewMessageHandler timeline bursts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlayerStore.setState({
      elements: [{ id: "x", tag: "div", start: 0, duration: 1, track: 0 }],
    });
  });
  afterEach(() => vi.useRealTimers());

  it("applies the first manifest at once and only the newest of a burst after it", () => {
    const { processed, send } = setup();
    send("a");
    expect(processed).toHaveLength(1);
    send("b");
    send("c");
    send("d");
    expect(processed).toHaveLength(1);
    vi.advanceTimersByTime(TIMELINE_MESSAGE_COALESCE_MS);
    expect(processed).toHaveLength(2);
    expect((processed[1] as { clips: { id: string }[] }).clips[0]?.id).toBe("d");
    vi.advanceTimersByTime(TIMELINE_MESSAGE_COALESCE_MS * 4);
    expect(processed).toHaveLength(2);
    send("e");
    expect(processed).toHaveLength(3);
  });

  it("drops a queued manifest when the preview reloaded before it applied", () => {
    const { deps, processed, send } = setup();
    send("a");
    send("b");
    deps.iframeRef.current = document.createElement("iframe");
    vi.advanceTimersByTime(TIMELINE_MESSAGE_COALESCE_MS);
    expect(processed).toHaveLength(1);
  });
});

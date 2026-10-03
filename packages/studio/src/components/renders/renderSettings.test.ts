// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  RENDER_FPS_VALUES,
  getPersistedRenderSettings,
  persistRenderSettings,
} from "./renderSettings";

const KEY = "hf-studio-render-settings";

describe("render settings frame rate", () => {
  beforeEach(() => localStorage.clear());

  it("offers PAL 25 and 50 alongside 24, 30 and 60", () => {
    expect([...RENDER_FPS_VALUES]).toEqual([24, 25, 30, 50, 60]);
  });

  it.each([[25], [50]])("keeps a saved %i fps choice", (fps) => {
    persistRenderSettings("mp4", "standard", fps as 25 | 50);
    expect(getPersistedRenderSettings().fps).toBe(fps);
  });

  it("falls back to 30 for an unsupported saved rate", () => {
    localStorage.setItem(KEY, JSON.stringify({ format: "mp4", quality: "standard", fps: 27 }));
    expect(getPersistedRenderSettings().fps).toBe(30);
  });
});

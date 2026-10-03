/**
 * Factory for the shader-transition loading overlay DOM tree.
 *
 * Kept in its own module so the ~100-line DOM construction stays out of the
 * web component class body. The returned `ShaderLoaderElements` bag gives the
 * component direct handles to the nodes it needs to update without querying
 * the shadow DOM on every state change.
 */

import { SHADER_LOADING_PHRASES } from "./shader-options.js";

export interface ShaderLoaderElements {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  title: HTMLSpanElement;
  detail: HTMLDivElement;
  transitionValue: HTMLSpanElement;
  transitionRow: HTMLDivElement;
  frameLabel: HTMLSpanElement;
  frameValue: HTMLSpanElement;
  frameRow: HTMLDivElement;
}

export function createShaderLoader(): ShaderLoaderElements {
  const root = document.createElement("div");
  root.className = "hfp-shader-loader";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-label", "Preparing scene transitions");
  root.setAttribute("data-hyperframes-ignore", "");
  root.draggable = false;

  const blockOverlayInteraction = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  for (const eventName of [
    "selectstart",
    "dragstart",
    "pointerdown",
    "mousedown",
    "click",
    "dblclick",
    "contextmenu",
    "touchstart",
  ]) {
    root.addEventListener(eventName, blockOverlayInteraction, { capture: true });
  }

  const panel = document.createElement("div");
  panel.className = "hfp-shader-loader-panel";
  panel.draggable = false;

  const markFrame = document.createElement("div");
  markFrame.className = "hfp-shader-loader-mark";
  markFrame.draggable = false;
  markFrame.innerHTML = [
    '<svg width="24" height="24" viewBox="0 0 100 100" fill="none" aria-hidden="true" draggable="false">',
    '<path d="M45 14.4 A36 36 0 0 0 45 85.6" stroke="currentColor" stroke-width="10"/>',
    '<path d="M55 14.4 A36 36 0 0 1 55 85.6" stroke="currentColor" stroke-opacity="0.55" stroke-width="10"/>',
    '<line x1="50" y1="5" x2="50" y2="95" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>',
    "</svg>",
  ].join("");

  const titleContainer = document.createElement("div");
  titleContainer.className = "hfp-shader-loader-title";
  const titleText = document.createElement("span");
  titleText.className = "hfp-shader-loader-title-text";
  titleText.textContent = SHADER_LOADING_PHRASES[0] || "Preparing scene transitions";
  titleContainer.appendChild(titleText);

  const detail = document.createElement("div");
  detail.className = "hfp-shader-loader-detail";
  detail.textContent = "Rendering animated scene samples for shader transitions.";

  const track = document.createElement("div");
  track.className = "hfp-shader-loader-track";
  track.setAttribute("aria-hidden", "true");
  const fill = document.createElement("div");
  fill.className = "hfp-shader-loader-fill";
  track.appendChild(fill);

  const progress = document.createElement("div");
  progress.className = "hfp-shader-loader-progress";
  const createProgressRow = (labelText: string) => {
    const row = document.createElement("div");
    row.className = "hfp-shader-loader-row";
    const label = document.createElement("span");
    label.className = "hfp-shader-loader-label";
    label.textContent = labelText;
    const value = document.createElement("span");
    value.className = "hfp-shader-loader-value";
    row.appendChild(label);
    row.appendChild(value);
    progress.appendChild(row);
    return { row, label, value };
  };
  const transitionStatus = createProgressRow("transition");
  const frameStatus = createProgressRow("transition frame");

  panel.appendChild(markFrame);
  panel.appendChild(titleContainer);
  panel.appendChild(detail);
  panel.appendChild(track);
  panel.appendChild(progress);
  root.appendChild(panel);

  return {
    root,
    fill,
    title: titleText,
    detail,
    transitionValue: transitionStatus.value,
    transitionRow: transitionStatus.row,
    frameLabel: frameStatus.label,
    frameValue: frameStatus.value,
    frameRow: frameStatus.row,
  };
}

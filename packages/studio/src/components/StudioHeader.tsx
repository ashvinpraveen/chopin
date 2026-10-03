import { memo, useContext, type MouseEvent } from "react";
import { Camera } from "../icons/SystemIcons";
import { useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { Button, cn, Tooltip } from "./ui";
import { Dock } from "./dock/Dock";
import { InspectorIcon } from "./icons/InspectorIcon";
import { ChopinLogo } from "./ui/ChopinLogo";
import { ShowThemeToggle, ThemeToggle } from "./ThemeToggle";

/** Quiet icon-only header control: no fill or border, state lives in the icon colour. */
const headerIconBtn =
  "flex h-7 w-7 items-center justify-center rounded-md transition-colors active:scale-[0.98] outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

interface StudioHeaderProps {
  captureFrameHref: string;
  captureFrameFilename: string;
  handleCaptureFrameClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  refreshCaptureFrameTime: () => void;
  capturing?: boolean;
  inspectorButtonActive: boolean;
  inspectorPanelActive: boolean;
  onExport?: () => void;
}

/**
 * Does the header's Inspector button open the panel, or close it?
 *
 * The dock has no separate "railed by window width" state (it shrinks panels,
 * never auto-hides the group), so `rightCollapsed` here is already the state
 * that decides whether the panel is actually showing.
 */
export function shouldOpenInspector(
  rightCollapsed: boolean,
  inspectorPanelActive: boolean,
): boolean {
  return rightCollapsed || !inspectorPanelActive;
}

// fallow-ignore-next-line complexity
export const StudioHeader = memo(function StudioHeader({
  captureFrameHref,
  captureFrameFilename,
  handleCaptureFrameClick,
  refreshCaptureFrameTime,
  capturing,
  inspectorButtonActive,
  inspectorPanelActive,
  onExport,
}: StudioHeaderProps) {
  const showThemeToggle = useContext(ShowThemeToggle);
  const { projectId, renderQueue } = useStudioShellContext();
  const { rightCollapsed, setRightCollapsed, setRightPanelTab } = usePanelLayoutContext();
  const isRendering = renderQueue.isRendering;
  const ffmpegMissing = renderQueue.ffmpegMissing;

  return (
    <div className="relative flex items-center justify-between h-8 px-2 bg-bg-0 border-b border-border-strong shrink-0">
      {/* Left: logo + project name */}
      <div className="flex items-center gap-3">
        <ChopinLogo />
      </div>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-step-12 font-medium text-text-2 select-none">
        {projectId}
      </span>
      {/* Right: toolbar buttons */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <Tooltip label={capturing ? "Capturing frame…" : "Capture current frame"} side="bottom">
            {/* A real download link: `download` on an <a> is what saves the frame,
              and no <button> can do that. */}
            <a
              href={captureFrameHref}
              download={captureFrameFilename}
              onClick={(e) => {
                if (capturing) {
                  e.preventDefault();
                  return;
                }
                trackStudioEvent("toolbar_action", { action: "capture_frame" });
                handleCaptureFrameClick(e);
              }}
              onFocus={refreshCaptureFrameTime}
              onPointerDown={refreshCaptureFrameTime}
              aria-disabled={capturing || undefined}
              className={cn(
                headerIconBtn,
                capturing ? "text-text-4 cursor-default" : "text-text-2 hover:text-text-1",
              )}
              aria-label={capturing ? "Capturing frame" : "Capture current frame"}
            >
              {capturing ? (
                <svg
                  className="animate-spin motion-reduce:animate-none h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : (
                <Camera size={14} />
              )}
            </a>
          </Tooltip>
          <Tooltip label="Inspector" side="bottom">
            <button
              type="button"
              aria-label="Inspector"
              aria-pressed={inspectorButtonActive}
              className={cn(
                headerIconBtn,
                inspectorButtonActive ? "text-text-0" : "text-text-2 hover:text-text-1",
              )}
              onClick={() => {
                if (shouldOpenInspector(rightCollapsed, inspectorPanelActive)) {
                  trackStudioEvent("panel_toggle", { panel: "inspector", collapsed: false });
                  setRightPanelTab("design");
                  setRightCollapsed(false);
                  return;
                }
                trackStudioEvent("panel_toggle", { panel: "inspector", collapsed: true });
                // Keep the current selection when collapsing the Inspector — closing
                // the panel shouldn't deselect the element.
                setRightCollapsed(true);
              }}
            >
              <InspectorIcon size={16} />
            </button>
          </Tooltip>
        </div>
        {showThemeToggle && <ThemeToggle />}
        <Dock.WindowMenu />
        <Tooltip
          label={
            ffmpegMissing
              ? "FFmpeg is not installed. Opens the Render Queue panel with the install command."
              : isRendering
                ? "A render is already in progress"
                : "Render and export this composition"
          }
          side="bottom"
        >
          <Button
            variant="primary"
            data-testid="header-export"
            disabled={isRendering}
            onClick={() => {
              if (isRendering) return;
              setRightPanelTab("renders");
              setRightCollapsed(false);
              // Without an encoder this render cannot finish, so the click
              // delivers the user to the prompt that fixes it instead of
              // queueing a job that exists only to fail. Disabling the button
              // would leave them staring at a dead control with no route to
              // the explanation.
              if (ffmpegMissing) return;
              onExport?.();
            }}
          >
            {isRendering ? "Rendering…" : "Export"}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
});

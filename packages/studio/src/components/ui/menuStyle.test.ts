import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import * as menuStyle from "./menuStyle";

const spacing = /(^| )-?(p|py|pt|pb|m|my|mt|mb)-\d/;

/** Panels that are not a column of rows: a preset card and a bare speed list. */
const NOT_ROW_MENUS = new Set(["components/editor/EaseCurveSection.tsx", "player/components/SpeedMenu.tsx"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("menu style", () => {
  it("adds no padding or margin around a menu's rows", () => {
    for (const key of ["MENU_PANEL", "MENU_PANEL_OPEN", "MENU_GROUP", "MENU_DIVIDER"] as const)
      expect(menuStyle[key], key).not.toMatch(spacing);
  });

  it("is the panel of every role=menu, so a new menu cannot bring the bands back", () => {
    const root = join(__dirname, "../..");
    const unowned = sources(root)
      .filter((file) => readFileSync(file, "utf8").includes('role="menu"'))
      .filter((file) => !readFileSync(file, "utf8").includes("MENU_PANEL"))
      .map((file) => relative(root, file))
      .filter((file) => !NOT_ROW_MENUS.has(file) && !file.endsWith("ui/Menu.tsx"));
    expect(unowned).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { parseProjectList } from "./ProjectSwitcher";

describe("parseProjectList", () => {
  it("keeps entries with a string id", () => {
    expect(
      parseProjectList({ projects: [{ id: "a", title: "A" }, { id: 2 }, null, { title: "x" }] }),
    ).toEqual([{ id: "a", title: "A" }]);
  });

  it("returns an empty list for a malformed body", () => {
    expect(parseProjectList(null)).toEqual([]);
    expect(parseProjectList({ error: "nope" })).toEqual([]);
    expect(parseProjectList({ projects: "a" })).toEqual([]);
  });
});

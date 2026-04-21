import { describe, expect, it } from "vitest";
import { createPathNode, serializePathNodes } from "../generators/cinenerdle2/hash";
import {
  getExcludedBoostSharedConnectionLookupKey,
  getImmediateSelectedParentTarget,
} from "../selected_path";

describe("selected path helpers", () => {
  it("returns the immediate selected parent for a normal path", () => {
    const hash = serializePathNodes([
      createPathNode("cinenerdle", "cinenerdle"),
      createPathNode("movie", "Heat", "1995"),
      createPathNode("person", "Al Pacino", "", 1158),
      createPathNode("movie", "Scarface", "1983"),
    ]);

    expect(getImmediateSelectedParentTarget(hash)).toEqual({
      kind: "person",
      name: "Al Pacino",
      tmdbId: null,
      year: "",
    });
    expect(getExcludedBoostSharedConnectionLookupKey(hash)).toBe("al pacino");
  });

  it("ignores break nodes when finding the immediate selected parent", () => {
    const hash = serializePathNodes([
      createPathNode("cinenerdle", "cinenerdle"),
      createPathNode("movie", "Heat", "1995"),
      createPathNode("person", "Al Pacino", "", 1158),
      createPathNode("break"),
      createPathNode("movie", "Scarface", "1983"),
    ]);

    expect(getImmediateSelectedParentTarget(hash)).toEqual({
      kind: "person",
      name: "Al Pacino",
      tmdbId: null,
      year: "",
    });
    expect(getExcludedBoostSharedConnectionLookupKey(hash)).toBe("al pacino");
  });

  it("returns null when there is no immediate selected parent", () => {
    const hash = serializePathNodes([
      createPathNode("movie", "Heat", "1995"),
    ]);

    expect(getImmediateSelectedParentTarget(hash)).toBeNull();
    expect(getExcludedBoostSharedConnectionLookupKey(hash)).toBeNull();
  });
});

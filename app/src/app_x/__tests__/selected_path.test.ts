import { describe, expect, it } from "vitest";
import { createPathNode, serializePathNodes } from "../generators/cinenerdle2/hash";
import {
  getExcludedBoostSharedConnectionLookupKeys,
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
    expect(getExcludedBoostSharedConnectionLookupKeys(hash)).toEqual([
      "heat (1995)",
      "al pacino",
      "scarface (1983)",
    ]);
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
    expect(getExcludedBoostSharedConnectionLookupKeys(hash)).toEqual([
      "heat (1995)",
      "al pacino",
      "scarface (1983)",
    ]);
  });

  it("dedupes selected-path boost exclusions and skips cinenerdle and break nodes", () => {
    const hash = serializePathNodes([
      createPathNode("cinenerdle", "cinenerdle"),
      createPathNode("movie", "Heat", "1995"),
      createPathNode("break"),
      createPathNode("person", "Al Pacino", "", 1158),
      createPathNode("movie", "Heat", "1995"),
    ]);

    expect(getExcludedBoostSharedConnectionLookupKeys(hash)).toEqual([
      "heat (1995)",
      "al pacino",
    ]);
  });

  it("returns no excluded boost connectors when the selected path has no movie or person", () => {
    const hash = serializePathNodes([
      createPathNode("cinenerdle", "cinenerdle"),
    ]);

    expect(getExcludedBoostSharedConnectionLookupKeys(hash)).toEqual([]);
  });

  it("returns null when there is no immediate selected parent", () => {
    const hash = serializePathNodes([
      createPathNode("movie", "Heat", "1995"),
    ]);

    expect(getImmediateSelectedParentTarget(hash)).toBeNull();
    expect(getExcludedBoostSharedConnectionLookupKeys(hash)).toEqual(["heat (1995)"]);
  });
});

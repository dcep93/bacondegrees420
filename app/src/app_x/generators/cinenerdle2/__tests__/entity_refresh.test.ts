import { describe, expect, it } from "vitest";
import type { GeneratorNode } from "../../../types/generator";
import { isEntityRefreshRequestVisibleInTree } from "../entity_refresh";
import type { CinenerdleCard } from "../view_types";
import { makeFilmRecord, makePersonRecord } from "./factories";

function makeMovieNode(
  overrides: Partial<Extract<CinenerdleCard, { kind: "movie" }>> = {},
): GeneratorNode<CinenerdleCard> {
  return {
    selected: false,
    data: {
      key: "movie:321",
      kind: "movie",
      name: "Heat",
      year: "1995",
      popularity: 66,
      popularitySource: null,
      imageUrl: null,
      subtitle: "1995",
      subtitleDetail: "",
      connectionCount: 1,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: makeFilmRecord({
        id: 321,
        tmdbId: 321,
        title: "Heat",
        year: "1995",
      }),
      ...overrides,
    },
  };
}

function makePersonNode(
  overrides: Partial<Extract<CinenerdleCard, { kind: "person" }>> = {},
): GeneratorNode<CinenerdleCard> {
  return {
    selected: false,
    data: {
      key: "person:6384",
      kind: "person",
      name: "Keanu Charles Reeves",
      popularity: 77,
      popularitySource: null,
      imageUrl: null,
      subtitle: "",
      subtitleDetail: "",
      connectionCount: 1,
      sources: [],
      status: null,
      record: makePersonRecord({
        id: 6384,
        tmdbId: 6384,
        name: "Keanu Charles Reeves",
        movieConnectionKeys: ["the matrix (1999)"],
      }),
      ...overrides,
    },
  };
}

describe("isEntityRefreshRequestVisibleInTree", () => {
  it("matches person refreshes by tmdb id even when the visible card name is stale", () => {
    expect(isEntityRefreshRequestVisibleInTree(
      [[makePersonNode()]],
      {
        kind: "person",
        name: "Keanu Reeves",
        reason: "prefetch",
        requestKey: "person:tmdb:6384:prefetch:1",
        tmdbId: 6384,
      },
    )).toBe(true);
  });

  it("matches movie refreshes by tmdb id", () => {
    expect(isEntityRefreshRequestVisibleInTree(
      [[makeMovieNode()]],
      {
        kind: "movie",
        name: "Heat",
        year: "1995",
        reason: "prefetch",
        requestKey: "movie:tmdb:321:prefetch:1",
        tmdbId: 321,
      },
    )).toBe(true);
  });

  it("ignores prefetch refreshes for entities that are not on the current tree", () => {
    expect(isEntityRefreshRequestVisibleInTree(
      [[makeMovieNode()]],
      {
        kind: "person",
        name: "Keanu Reeves",
        reason: "prefetch",
        requestKey: "person:tmdb:6384:prefetch:1",
        tmdbId: 6384,
      },
    )).toBe(false);
  });
});

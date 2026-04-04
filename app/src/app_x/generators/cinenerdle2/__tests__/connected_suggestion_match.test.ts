import { describe, expect, it } from "vitest";
import { findConnectedSuggestionCardIndex, matchesConnectedSuggestionTarget } from "../connected_suggestion_match";
import type { CinenerdleCard } from "../view_types";
import type { GeneratorNode } from "../../../types/generator";

function makeMovieNode(params: {
  id: number | null;
  key?: string;
  name: string;
  year: string;
}): GeneratorNode<CinenerdleCard> {
  return {
    data: {
      kind: "movie",
      key: params.key ?? `movie:${params.id ?? `${params.name}:${params.year}`}`,
      name: params.name,
      year: params.year,
      record: params.id === null ? null : { id: params.id, tmdbId: params.id },
    } as Extract<CinenerdleCard, { kind: "movie" }>,
    selected: false,
  };
}

function makePersonNode(params: {
  id: number | null;
  key?: string;
  name: string;
}): GeneratorNode<CinenerdleCard> {
  return {
    data: {
      kind: "person",
      key: params.key ?? `person:${params.id ?? params.name}`,
      name: params.name,
      record: params.id === null ? null : { id: params.id, tmdbId: params.id },
    } as Extract<CinenerdleCard, { kind: "person" }>,
    selected: false,
  };
}

describe("connected suggestion matching", () => {
  it("matches movie cards by tmdb id when the suggestion key uses title-year format", () => {
    const row = [
      makeMovieNode({ id: 11077, key: "movie:11077", name: "Scandalous John", year: "1971" }),
    ];

    expect(findConnectedSuggestionCardIndex(row, {
      bucket: "movie",
      id: 11077,
    })).toBe(0);
  });

  it("does not match movie cards without a tmdb id match", () => {
    expect(matchesConnectedSuggestionTarget(
      makeMovieNode({ id: null, name: "Bad Santa", year: "2003" }).data,
      {
        bucket: "movie",
        id: 123,
      },
    )).toBe(false);
  });

  it("matches person cards by tmdb id", () => {
    const row = [
      makePersonNode({ id: 5293, name: "Willem Dafoe" }),
    ];

    expect(findConnectedSuggestionCardIndex(row, {
      bucket: "person",
      id: 5293,
    })).toBe(0);
  });
});

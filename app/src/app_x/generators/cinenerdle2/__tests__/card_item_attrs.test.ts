import { describe, expect, it } from "vitest";
import { enrichCinenerdleTreeWithItemAttrs } from "../card_item_attrs";
import { makeFilmRecord, makePersonRecord } from "./factories";
import type { CinenerdleCard } from "../view_types";

function makeCinenerdleRootCard(): Extract<CinenerdleCard, { kind: "cinenerdle" }> {
  return {
    key: "cinenerdle",
    kind: "cinenerdle",
    name: "cinenerdle",
    popularity: 0,
    popularitySource: null,
    imageUrl: null,
    subtitle: "",
    subtitleDetail: "Open today’s board",
    connectionCount: 1,
    sources: [],
    status: null,
    record: null,
  };
}

function makePersonCard(
  overrides: Partial<Extract<CinenerdleCard, { kind: "person" }>> = {},
): Extract<CinenerdleCard, { kind: "person" }> {
  return {
    key: "person:60",
    kind: "person",
    name: "Al Pacino",
    popularity: 77,
    popularitySource: null,
    imageUrl: null,
    subtitle: "",
    subtitleDetail: "",
    connectionCount: 1,
    sources: [],
    status: null,
    record: makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)"],
    }),
    ...overrides,
  };
}

function makeMovieCard(
  overrides: Partial<Extract<CinenerdleCard, { kind: "movie" }>> = {},
): Extract<CinenerdleCard, { kind: "movie" }> {
  return {
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
      personConnectionKeys: ["al pacino"],
    }),
    ...overrides,
  };
}

describe("card item attrs enrichment", () => {
  it("preserves existing row references when appending a new row with unchanged attrs", () => {
    const itemAttrsSnapshot = {
      film: {
        "321": ["🔥"],
      },
      person: {
        "60": ["🎭"],
      },
    };
    const initialTree = enrichCinenerdleTreeWithItemAttrs(
      [
        [{ data: makeCinenerdleRootCard(), selected: true }],
        [{ data: makePersonCard(), selected: true }],
      ],
      itemAttrsSnapshot,
    );
    const appendedTree = enrichCinenerdleTreeWithItemAttrs(
      [
        ...initialTree,
        [{ data: makeMovieCard(), selected: false }],
      ],
      itemAttrsSnapshot,
    );

    expect(appendedTree[0]).toBe(initialTree[0]);
    expect(appendedTree[0]?.[0]).toBe(initialTree[0]?.[0]);
    expect(appendedTree[1]).toBe(initialTree[1]);
    expect(appendedTree[1]?.[0]).toBe(initialTree[1]?.[0]);
    expect(appendedTree[2]?.[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        itemAttrs: ["🔥"],
      }),
    }));
  });
});

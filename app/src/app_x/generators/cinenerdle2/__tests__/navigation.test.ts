import { describe, expect, it } from "vitest";
import {
  areYoungestSelectedCardsEqual,
  getCardTmdbEntityId,
  getYoungestSelectedCard,
} from "../navigation";
import type { GeneratorTree } from "../../../types/generator";
import type { CinenerdleCard } from "../view_types";

function createMovieCard(
  overrides: Partial<Extract<CinenerdleCard, { kind: "movie" }>> = {},
): Extract<CinenerdleCard, { kind: "movie" }> {
  return {
    key: "movie:heat:1995",
    kind: "movie",
    name: "Heat",
    year: "1995",
    popularity: 0,
    popularitySource: null,
    imageUrl: null,
    subtitle: "",
    subtitleDetail: "",
    connectionCount: null,
    sources: [],
    status: null,
    voteAverage: null,
    voteCount: null,
    record: null,
    ...overrides,
  };
}

function createPersonCard(
  overrides: Partial<Extract<CinenerdleCard, { kind: "person" }>> = {},
): Extract<CinenerdleCard, { kind: "person" }> {
  return {
    key: "person:60",
    kind: "person",
    name: "Al Pacino",
    popularity: 0,
    popularitySource: null,
    imageUrl: null,
    subtitle: "",
    subtitleDetail: "",
    connectionCount: null,
    sources: [],
    status: null,
    record: null,
    ...overrides,
  };
}

describe("cinenerdle navigation helpers", () => {
  it("finds the youngest selected content card and compares it by identity", () => {
    const tree: GeneratorTree<CinenerdleCard> = [
      [{ selected: true, data: createMovieCard() }],
      [{ selected: true, data: createPersonCard() }],
    ];

    expect(getYoungestSelectedCard(tree)?.kind).toBe("person");
    expect(areYoungestSelectedCardsEqual(
      createPersonCard({ record: { id: 60, tmdbId: 60 } as Extract<CinenerdleCard, { kind: "person" }>["record"] }),
      createPersonCard({ name: "AL PACINO", record: { id: 60, tmdbId: 60 } as Extract<CinenerdleCard, { kind: "person" }>["record"] }),
    )).toBe(true);
  });

  it("reads card tmdb ids from cached records", () => {
    expect(getCardTmdbEntityId(createMovieCard({
      record: {
        id: 949,
        tmdbId: 949,
      } as Extract<CinenerdleCard, { kind: "movie" }>["record"],
    }))).toBe(949);
  });
});

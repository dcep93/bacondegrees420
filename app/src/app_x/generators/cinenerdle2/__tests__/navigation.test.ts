import { describe, expect, it } from "vitest";
import {
  areYoungestSelectedCardsEqual,
  getCardTmdbEntityId,
  getYoungestSelectedCard,
  matchesHighlightedConnectionEntity,
  serializeSelectedTreePath,
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
  it("matches movies by normalized title and year or tmdb id", () => {
    expect(matchesHighlightedConnectionEntity(
      createMovieCard(),
      {
        key: "movie:heat:1995",
        kind: "movie",
        name: "heat",
        year: "1995",
        tmdbId: null,
        label: "Heat (1995)",
        connectionCount: 1,
        hasCachedTmdbSource: false,
      },
    )).toBe(true);

    expect(matchesHighlightedConnectionEntity(
      createMovieCard({
        record: {
          id: 949,
          tmdbId: 949,
        } as Extract<CinenerdleCard, { kind: "movie" }>["record"],
      }),
      {
        key: "movie:heat:1995",
        kind: "movie",
        name: "Different",
        year: "2000",
        tmdbId: 949,
        label: "Different (2000)",
        connectionCount: 1,
        hasCachedTmdbSource: false,
      },
    )).toBe(true);
  });

  it("serializes selected tree paths including break rows and person tmdb ids", () => {
    const tree: GeneratorTree<CinenerdleCard> = [
      [{ selected: true, data: { key: "cinenerdle", kind: "cinenerdle", name: "cinenerdle", popularity: 0, popularitySource: null, imageUrl: null, subtitle: "", subtitleDetail: "", connectionCount: null, sources: [], status: null, record: null } }],
      [{ selected: true, data: createMovieCard() }],
      [{ selected: true, data: { key: "break", kind: "break", name: "ESCAPE", popularity: 0, popularitySource: null, imageUrl: null, subtitle: "", subtitleDetail: "", connectionCount: null, sources: [], status: null, record: null } }],
      [{ selected: true, data: createPersonCard({ record: { id: 60, tmdbId: 60 } as Extract<CinenerdleCard, { kind: "person" }>["record"] }) }],
    ];

    expect(serializeSelectedTreePath(tree)).toBe("#cinenerdle|Heat+(1995)||Al+Pacino");
  });

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

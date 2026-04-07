import { beforeEach, describe, expect, it, vi } from "vitest";

const indexedDbMock = vi.hoisted(() => ({
  getFilmRecordById: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordByName: vi.fn(),
}));

vi.mock("../generators/cinenerdle2/indexed_db", async () => {
  const actual = await vi.importActual("../generators/cinenerdle2/indexed_db");
  return {
    ...actual,
    ...indexedDbMock,
  };
});

import { buildBookmarkRowData } from "../bookmark_rows";
import { createPathNode, serializePathNodes } from "../generators/cinenerdle2/hash";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
} from "../generators/cinenerdle2/__tests__/factories";

describe("buildBookmarkRowData", () => {
  beforeEach(() => {
    indexedDbMock.getFilmRecordById.mockReset();
    indexedDbMock.getFilmRecordByTitleAndYear.mockReset();
    indexedDbMock.getPersonRecordById.mockReset();
    indexedDbMock.getPersonRecordByName.mockReset();

    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
  });

  it("rebuilds person-to-movie bookmarks as association cards with role text and rank", async () => {
    const fetchedAt = "2026-03-29T20:03:24.000Z";
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      popularity: 66,
      personConnectionKeys: [60, 95],
    });
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: [321],
      fetchTimestamp: fetchedAt,
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 88,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 66,
            character: "Neil McCauley",
          }),
        ],
        crew: [],
      },
    });
    const valKilmerRecord = makePersonRecord({
      id: 95,
      tmdbId: 95,
      name: "Val Kilmer",
      movieConnectionKeys: [321],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 95,
        name: "Val Kilmer",
        popularity: 44,
      }),
    });

    indexedDbMock.getPersonRecordById.mockImplementation(async (tmdbId: number | string) =>
      Number(tmdbId) === 60 ? pacinoRecord : null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) => {
      if (personName === "al pacino") {
        return pacinoRecord;
      }

      if (personName === "val kilmer") {
        return valKilmerRecord;
      }

      return null;
    });
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "Heat" && year === "1995" ? heatRecord : null,
    );
    indexedDbMock.getFilmRecordById.mockImplementation(async (tmdbId: number | string) =>
      Number(tmdbId) === 321 ? heatRecord : null,
    );

    const bookmarkRow = await buildBookmarkRowData(serializePathNodes([
      createPathNode("person", "Al Pacino", "", 60),
      createPathNode("movie", "Heat", "1995"),
    ]));
    const cards = bookmarkRow.cards
      .filter((card): card is Extract<typeof card, { kind: "card" }> => card.kind === "card")
      .map((card) => card.card);

    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({
      kind: "movie",
      subtitle: "1995 • Cast as",
      subtitleDetail: "Neil McCauley",
      connectionCount: 2,
      connectionOrder: 1,
      connectionParentLabel: "Al Pacino",
      connectionRank: 1,
      tmdbTooltipText: `Data connected ${new Date(fetchedAt).toLocaleString()}.\nClick to refetch.`,
    });
  });

  it("rebuilds movie-to-person bookmarks as association cards with role text and rank", async () => {
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      popularity: 66,
      personConnectionKeys: [60],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        popularity: 66,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 60,
            name: "Al Pacino",
            popularity: 88,
            character: "Lt. Vincent Hanna",
          }),
        ],
        crew: [],
      },
    });
    const scarfaceRecord = makeFilmRecord({
      id: 111,
      tmdbId: 111,
      title: "Scarface",
      year: "1983",
      popularity: 99,
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 111,
        title: "Scarface",
        release_date: "1983-12-09",
        popularity: 99,
      }),
    });
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: [321, 111],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 88,
      }),
    });

    indexedDbMock.getPersonRecordById.mockImplementation(async (tmdbId: number | string) =>
      Number(tmdbId) === 60 ? pacinoRecord : null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "al pacino" ? pacinoRecord : null,
    );
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) => {
      if (title.toLowerCase() === "heat" && year === "1995") {
        return heatRecord;
      }

      if (title.toLowerCase() === "scarface" && year === "1983") {
        return scarfaceRecord;
      }

      return null;
    });
    indexedDbMock.getFilmRecordById.mockImplementation(async (tmdbId: number | string) => {
      if (Number(tmdbId) === 321) {
        return heatRecord;
      }

      if (Number(tmdbId) === 111) {
        return scarfaceRecord;
      }

      return null;
    });

    const bookmarkRow = await buildBookmarkRowData(serializePathNodes([
      createPathNode("movie", "Heat", "1995"),
      createPathNode("person", "Al Pacino", "", 60),
    ]));
    const cards = bookmarkRow.cards
      .filter((card): card is Extract<typeof card, { kind: "card" }> => card.kind === "card")
      .map((card) => card.card);

    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({
      kind: "person",
      subtitle: "Cast as",
      subtitleDetail: "Lt. Vincent Hanna",
      connectionCount: 2,
      connectionOrder: 1,
      connectionParentLabel: "Heat (1995)",
      connectionRank: 2,
    });
  });

  it("resets bookmark association role and rank after an escape break", async () => {
    const fetchedAt = "2026-03-29T20:03:24.000Z";
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      popularity: 66,
      personConnectionKeys: ["al pacino"],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        popularity: 66,
      }),
    });
    const scarfaceRecord = makeFilmRecord({
      id: 111,
      tmdbId: 111,
      title: "Scarface",
      year: "1983",
      popularity: 99,
      personConnectionKeys: ["al pacino"],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 111,
        title: "Scarface",
        release_date: "1983-12-09",
        popularity: 99,
      }),
    });
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)", "scarface (1983)"],
      fetchTimestamp: fetchedAt,
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 88,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 66,
            character: "Neil McCauley",
          }),
        ],
        crew: [],
      },
    });

    indexedDbMock.getPersonRecordById.mockImplementation(async (tmdbId: number | string) =>
      Number(tmdbId) === 60 ? pacinoRecord : null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "al pacino" ? pacinoRecord : null,
    );
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) => {
      if (title.toLowerCase() === "heat" && year === "1995") {
        return heatRecord;
      }

      if (title.toLowerCase() === "scarface" && year === "1983") {
        return scarfaceRecord;
      }

      return null;
    });

    const bookmarkRow = await buildBookmarkRowData(serializePathNodes([
      createPathNode("person", "Al Pacino", "", 60),
      createPathNode("movie", "Heat", "1995"),
      createPathNode("break"),
      createPathNode("movie", "Scarface", "1983"),
    ]));
    const scarfaceCard = bookmarkRow.cards[3];

    expect(scarfaceCard).toMatchObject({
      kind: "card",
      card: expect.objectContaining({
        kind: "movie",
        subtitle: "1983",
        subtitleDetail: "",
        connectionParentLabel: null,
        connectionRank: null,
        tmdbTooltipText: "Not fetched from TMDb yet.\nClick to fetch.",
      }),
    });
  });

  it("sets uncached root bookmark cards to the standard unfetched tmdb tooltip text", async () => {
    const bookmarkRow = await buildBookmarkRowData(serializePathNodes([
      createPathNode("movie", "Heat", "1995"),
    ]));
    const heatCard = bookmarkRow.cards[0];

    expect(heatCard).toMatchObject({
      kind: "card",
      card: expect.objectContaining({
        kind: "movie",
        tmdbTooltipText: "Not fetched from TMDb yet.\nClick to fetch.",
      }),
    });
  });
});

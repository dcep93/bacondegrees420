import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeTmdbPersonSearchResult,
} from "./factories";

const indexedDbMock = vi.hoisted(() => ({
  getAllSearchableConnectionEntities: vi.fn(),
  getFilmRecordCountsByPersonConnectionKeys: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getFilmRecordsByIds: vi.fn(),
  getFilmRecordsByPersonConnectionKey: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordCountsByMovieKeys: vi.fn(),
  getPersonRecordByName: vi.fn(),
  getPersonRecordsByMovieKey: vi.fn(),
}));

const tmdbMock = vi.hoisted(() => ({
  fetchCinenerdleDailyStarterMovies: vi.fn(),
  hydrateCinenerdleDailyStarterMovies: vi.fn(),
  prepareSelectedMovie: vi.fn(),
  prepareSelectedPerson: vi.fn(),
}));

vi.mock("../indexed_db", async () => {
  const actual = await vi.importActual("../indexed_db");
  return {
    ...actual,
    ...indexedDbMock,
  };
});

vi.mock("../tmdb", async () => {
  const actual = await vi.importActual("../tmdb");
  return {
    ...actual,
    ...tmdbMock,
  };
});

import { buildBookmarkPreviewCardsFromHash, buildTreeFromHash } from "../controller";
import { ESCAPE_LABEL } from "../constants";

describe("buildBookmarkPreviewCardsFromHash", () => {
  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    Object.values(tmdbMock).forEach((mock) => mock.mockReset());

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([]);
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordsByMovieKey.mockResolvedValue([]);
    tmdbMock.fetchCinenerdleDailyStarterMovies.mockResolvedValue([]);
    tmdbMock.hydrateCinenerdleDailyStarterMovies.mockResolvedValue(undefined);
  });

  it("prefers the richer cached person record when movie-credit id and name lookups disagree", async () => {
    const staleAndyWeirRecord = makePersonRecord({
      id: 1352085,
      tmdbId: 1352085,
      name: "Andy Weir",
      movieConnectionKeys: ["project hail mary (2026)"],
      rawTmdbMovieCreditsResponse: {
        crew: [],
      },
    });
    const andyWeirRecord = makePersonRecord({
      id: 1352085,
      tmdbId: 1352085,
      name: "Andy Weir",
      movieConnectionKeys: ["project hail mary (2026)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 1352085,
        name: "Andy Weir",
        profile_path: "/andy-weir.jpg",
        popularity: 42,
      }),
      rawTmdbMovieCreditsResponse: {
        crew: [],
      },
    });
    const projectHailMary = makeFilmRecord({
      id: "project-hail-mary-2026",
      tmdbId: 123,
      title: "Project Hail Mary",
      year: "2026",
      personConnectionKeys: ["andy weir"],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [
          makePersonCredit({
            id: 999999,
            name: "Andy Weir",
            job: "Writer",
            popularity: 10,
            profile_path: null,
          }),
        ],
      },
      starterPeopleByRole: {
        cast: [],
        directors: [],
        writers: ["Andy Weir"],
        composers: [],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "Project Hail Mary" && year === "2026" ? projectHailMary : null,
    );
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockImplementation(async (personName: string) =>
      personName === "Andy Weir" ? [projectHailMary] : [],
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(staleAndyWeirRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Andy Weir" ? andyWeirRecord : null,
    );

    const previewCards = await buildBookmarkPreviewCardsFromHash(
      "#film|Project+Hail+Mary+(2026)|Andy+Weir",
    );

    expect(previewCards).toHaveLength(2);
    expect(previewCards[1]).toEqual(
      expect.objectContaining({
        kind: "person",
        name: "Andy Weir",
        imageUrl: expect.stringContaining("/andy-weir.jpg"),
        hasCachedTmdbSource: true,
      }),
    );
  });

  it("uses a cached snapshot person record when the movie credits omit that person", async () => {
    const andyWeirRecord = makePersonRecord({
      id: 1352085,
      tmdbId: 1352085,
      name: "Andy Weir",
      movieConnectionKeys: ["project hail mary (2026)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 1352085,
        name: "Andy Weir",
        profile_path: "/andy-weir.jpg",
        popularity: 42,
      }),
      rawTmdbMovieCreditsResponse: {
        crew: [],
      },
    });
    const projectHailMary = makeFilmRecord({
      id: "project-hail-mary-2026",
      tmdbId: 123,
      title: "Project Hail Mary",
      year: "2026",
      personConnectionKeys: ["andy weir"],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [
          makePersonCredit({
            id: 47506,
            name: "Drew Goddard",
            job: "Screenplay",
            popularity: 10,
          }),
        ],
      },
      starterPeopleByRole: {
        cast: [],
        directors: [],
        writers: ["Andy Weir", "Drew Goddard"],
        composers: [],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "Project Hail Mary" && year === "2026" ? projectHailMary : null,
    );
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockResolvedValue([]);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Andy Weir" ? andyWeirRecord : null,
    );

    const previewCards = await buildBookmarkPreviewCardsFromHash(
      "#film|Project+Hail+Mary+(2026)|Andy+Weir",
    );

    expect(previewCards).toHaveLength(2);
    expect(previewCards[1]).toEqual(
      expect.objectContaining({
        kind: "person",
        key: "person:1352085",
        name: "Andy Weir",
        imageUrl: expect.stringContaining("/andy-weir.jpg"),
        hasCachedTmdbSource: true,
      }),
    );
  });

  it("preserves escape segments as break preview cards", async () => {
    const firstManRecord = makeFilmRecord({
      title: "First Man",
      year: "2018",
      personConnectionKeys: ["kyle chandler"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 100,
            name: "Kyle Chandler",
          }),
        ],
        crew: [],
      },
    });

    tmdbMock.fetchCinenerdleDailyStarterMovies.mockResolvedValue([firstManRecord]);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(firstManRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Tom Hanks"
        ? makePersonRecord({
          name: "Tom Hanks",
        })
        : null,
    );

    const previewCards = await buildBookmarkPreviewCardsFromHash(
      "#cinenerdle|First+Man+(2018)|Kyle+Chandler||Tom+Hanks",
    );

    expect(previewCards.at(-2)).toEqual(
      expect.objectContaining({
        kind: "break",
        name: ESCAPE_LABEL,
      }),
    );
    expect(previewCards.at(-1)).toEqual(
      expect.objectContaining({
        kind: "person",
        name: "Tom Hanks",
      }),
    );
  });
});

describe("buildTreeFromHash", () => {
  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    Object.values(tmdbMock).forEach((mock) => mock.mockReset());

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([]);
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordsByMovieKey.mockResolvedValue([]);
    tmdbMock.fetchCinenerdleDailyStarterMovies.mockResolvedValue([]);
    tmdbMock.hydrateCinenerdleDailyStarterMovies.mockResolvedValue(undefined);
  });

  it("inserts a separator row and starts a disconnected branch after an escape", async () => {
    const firstManRecord = makeFilmRecord({
      title: "First Man",
      year: "2018",
      personConnectionKeys: ["kyle chandler"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 100,
            name: "Kyle Chandler",
          }),
        ],
        crew: [],
      },
    });
    tmdbMock.fetchCinenerdleDailyStarterMovies.mockResolvedValue([firstManRecord]);
    const kyleChandlerRecord = makePersonRecord({
      id: 100,
      tmdbId: 100,
      name: "Kyle Chandler",
      movieConnectionKeys: ["game night (2018)"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 200,
            title: "Game Night",
            release_date: "2018-02-23",
          }),
        ],
        crew: [],
      },
    });
    const tomHanksRecord = makePersonRecord({
      id: 101,
      tmdbId: 101,
      name: "Tom Hanks",
      movieConnectionKeys: [],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "First Man" && year === "2018" ? firstManRecord : null,
    );
    indexedDbMock.getPersonRecordById.mockImplementation(async (personId: number) =>
      personId === 100 ? kyleChandlerRecord : personId === 101 ? tomHanksRecord : null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Kyle Chandler"
        ? kyleChandlerRecord
        : personName === "Tom Hanks"
          ? tomHanksRecord
          : null,
    );

    const tree = await buildTreeFromHash(
      "#cinenerdle|First+Man+(2018)|Kyle+Chandler||Tom+Hanks",
    );

    expect(tree.map((row) => row.find((node) => node.selected)?.data.kind ?? null)).toEqual([
      "cinenerdle",
      "movie",
      "person",
      "break",
      "person",
    ]);
    expect(tree[3]).toHaveLength(1);
    expect(tree[3]?.[0]).toEqual(
      expect.objectContaining({
        selected: true,
        disabled: true,
        data: expect.objectContaining({
          kind: "break",
          name: ESCAPE_LABEL,
        }),
      }),
    );
    expect(tree[4]).toHaveLength(1);
    expect(tree[4]?.[0]?.data).toEqual(
      expect.objectContaining({
        kind: "person",
        name: "Tom Hanks",
      }),
    );
  });
});

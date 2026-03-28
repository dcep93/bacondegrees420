import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeFilmRecord,
  makePersonCredit,
  makePersonRecord,
  makeTmdbPersonSearchResult,
} from "./factories";

const indexedDbMock = vi.hoisted(() => ({
  getFilmRecordByTitleAndYear: vi.fn(),
  getFilmRecordsByIds: vi.fn(),
  getFilmRecordsByPersonConnectionKey: vi.fn(),
  getPersonRecordById: vi.fn(),
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

import { buildBookmarkPreviewCardsFromHash } from "../controller";

describe("buildBookmarkPreviewCardsFromHash", () => {
  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    Object.values(tmdbMock).forEach((mock) => mock.mockReset());

    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
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
});

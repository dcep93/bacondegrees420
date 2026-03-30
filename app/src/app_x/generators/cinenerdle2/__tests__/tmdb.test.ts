import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
} from "./factories";

const indexedDbMock = vi.hoisted(() => ({
  getAllFilmRecords: vi.fn(),
  getAllPersonRecords: vi.fn(),
  batchCinenerdleRecordsUpdatedEvents: vi.fn(async (callback: () => Promise<unknown>) => callback()),
  getAllSearchableConnectionEntities: vi.fn(),
  getFilmRecordById: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getFilmRecordsByIds: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordByName: vi.fn(),
  saveFilmRecord: vi.fn(),
  saveFilmRecords: vi.fn(),
  savePersonRecord: vi.fn(),
}));

const connectionGraphMock = vi.hoisted(() => ({
  getMovieConnectionEntityKey: vi.fn((title: string, year = "") => `movie:${title.toLowerCase()}:${year}`),
  getPersonConnectionEntityKey: vi.fn((name: string, tmdbId?: number | string | null) =>
    `person:${tmdbId ?? name.toLowerCase()}`,
  ),
  hydrateConnectionEntityFromSearchRecord: vi.fn(),
}));

const debugLogMock = vi.hoisted(() => ({
  addCinenerdleDebugLog: vi.fn(),
}));

vi.mock("../indexed_db", async () => {
  const actual = await vi.importActual("../indexed_db");
  return {
    ...actual,
    ...indexedDbMock,
  };
});

vi.mock("../connection_graph", () => connectionGraphMock);
vi.mock("../debug_log", () => debugLogMock);

import {
  fetchAndCacheMovieCredits,
  hydrateCinenerdleDailyStarterMovies,
  prefetchBestConnectionForYoungestSelectedCard,
  prefetchTopPopularUnhydratedConnections,
  prepareSelectedMovie,
  prepareSelectedPerson,
} from "../tmdb";

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  };
}

describe("tmdb forced refresh helpers", () => {
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => { });

  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    Object.values(connectionGraphMock).forEach((mock) => mock.mockReset());
    connectionGraphMock.getMovieConnectionEntityKey.mockImplementation(
      (title: string, year = "") => `movie:${title.toLowerCase()}:${year}`,
    );
    connectionGraphMock.getPersonConnectionEntityKey.mockImplementation(
      (name: string, tmdbId?: number | string | null) => `person:${tmdbId ?? name.toLowerCase()}`,
    );
    Object.values(debugLogMock).forEach((mock) => mock.mockReset());
    indexedDbMock.getAllFilmRecords.mockResolvedValue([]);
    indexedDbMock.getAllPersonRecords.mockResolvedValue([]);
    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([]);
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
    connectionGraphMock.hydrateConnectionEntityFromSearchRecord.mockImplementation(
      (searchRecord: { key: string; type: "movie" | "person"; nameLower: string }) =>
        Promise.resolve(
          searchRecord.type === "movie"
            ? {
                key: searchRecord.key,
                kind: "movie",
                name: searchRecord.nameLower.replace(/ \(\d{4}\)$/, "").replace(/\b\w/g, (value) => value.toUpperCase()),
                year: searchRecord.nameLower.match(/\((\d{4})\)$/)?.[1] ?? "",
                tmdbId: null,
              }
            : {
                key: searchRecord.key,
                kind: "person",
                name: searchRecord.nameLower.replace(/\b\w/g, (value) => value.toUpperCase()),
                year: "",
                tmdbId: null,
              },
        ),
    );

    vi.stubGlobal(
      "localStorage",
      {
        getItem: vi.fn().mockReturnValue("key:test-api-key"),
        setItem: vi.fn(),
      } satisfies Pick<Storage, "getItem" | "setItem">,
    );
    vi.stubGlobal(
      "setTimeout",
      vi.fn(((callback: TimerHandler) => {
        if (typeof callback === "function") {
          callback();
        }

        return 0;
      }) as typeof setTimeout),
    );
    vi.stubGlobal("window", {
      prompt: vi.fn(),
    });
  });

  afterEach(() => {
    consoleLogSpy.mockClear();
    vi.unstubAllGlobals();
  });

  it("returns hydrated cached movies without refetching unless forceRefresh is enabled", async () => {
    const hydratedMovieRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        popularity: 99,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const fetchMock = vi.fn();

    indexedDbMock.getFilmRecordById.mockResolvedValue(hydratedMovieRecord);
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareSelectedMovie("Heat", "1995", 321);

    expect(result).toBe(hydratedMovieRecord);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("force refreshes cached movies through the exact TMDb id endpoint before refreshing credits", async () => {
    const cachedMovieRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        popularity: 50,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/movie/321/credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/search/movie?")) {
        return createJsonResponse({
          results: [
            makeTmdbMovieSearchResult({
              id: 321,
              title: "Heat",
              release_date: "1995-12-15",
              popularity: 99,
            }),
          ],
        });
      }

      if (url.includes("/movie/321?")) {
        return createJsonResponse(
          makeTmdbMovieSearchResult({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 99,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getFilmRecordById.mockResolvedValue(cachedMovieRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(cachedMovieRecord);
    vi.stubGlobal("fetch", fetchMock);

    await prepareSelectedMovie("Heat", "1995", 321, {
      forceRefresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/movie/321?");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/movie/321/credits?");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/search/movie"))).toBe(false);
    expect(indexedDbMock.saveFilmRecord).toHaveBeenCalledTimes(2);
    expect(indexedDbMock.batchCinenerdleRecordsUpdatedEvents).toHaveBeenCalledTimes(1);
  });

  it("force refreshes cached people instead of returning early", async () => {
    const cachedPersonRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 77,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
      fetchTimestamp: "2026-03-28T12:00:00.000Z",
    });
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/person/60/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/person/60?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 60,
            name: "Al Pacino",
            popularity: 88,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(cachedPersonRecord);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(cachedPersonRecord);
    vi.stubGlobal("fetch", fetchMock);

    await prepareSelectedPerson("Al Pacino", 60, {
      forceRefresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/person/60?");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/person/60/movie_credits?");
    expect(indexedDbMock.savePersonRecord).toHaveBeenCalledTimes(1);
    expect(indexedDbMock.saveFilmRecords).toHaveBeenCalledTimes(1);
    expect(indexedDbMock.batchCinenerdleRecordsUpdatedEvents).toHaveBeenCalledTimes(1);
  });

  it("stores person-derived films like Scream VI as partial connection-derived records", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/person/1372369/movie_credits")) {
        return createJsonResponse({
          cast: [
            {
              id: 934433,
              title: "Scream VI",
              release_date: "2023-03-08",
              poster_path: "/wDWwtvkRRlgTiUr6TyLSMX8FCuZ.jpg",
              popularity: 20.542,
              vote_average: 7,
              vote_count: 3107,
              character: "Laura Crane",
            },
          ],
          crew: [],
        });
      }

      if (url.includes("/person/1372369?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 1372369,
            name: "Samara Weaving",
            profile_path: "/7ThO37CpqkBRgrosep0ROVs2q5s.jpg",
            popularity: 10.8259,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
    vi.stubGlobal("fetch", fetchMock);

    await prepareSelectedPerson("Samara Weaving", 1372369, {
      forceRefresh: true,
    });

    expect(indexedDbMock.saveFilmRecords).toHaveBeenCalledWith([
      expect.objectContaining({
        tmdbId: 934433,
        title: "Scream VI",
        year: "2023",
        tmdbSource: "connection-derived",
        personConnectionKeys: ["samara weaving"],
        rawTmdbMovieCreditsResponse: {
          cast: [
            expect.objectContaining({
              id: 1372369,
              name: "Samara Weaving",
              character: "Laura Crane",
              creditType: "cast",
            }),
          ],
          crew: [],
        },
      }),
    ]);
  });

  it("logs raw movie responses with the requested format", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/movie/321/credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/search/movie?")) {
        return createJsonResponse({
          results: [
            makeTmdbMovieSearchResult({
              id: 321,
              title: "Heat",
              release_date: "1995-12-15",
              popularity: 99,
            }),
          ],
        });
      }

      if (url.includes("/movie/321?")) {
        return createJsonResponse(
          makeTmdbMovieSearchResult({
            id: 321,
            title: "Gran Torino",
            release_date: "2007-12-14",
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    await prepareSelectedMovie("Gran Torino", "2007", 321, {
      forceRefresh: true,
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 0 movie 1 / 1 fetch Gran Torino (2007) pop 88",
      expect.objectContaining({
        movie: expect.objectContaining({
          id: 321,
          title: "Gran Torino",
        }),
        credits: expect.objectContaining({
          cast: [],
          crew: [],
        }),
      }),
    );
    expect(debugLogMock.addCinenerdleDebugLog).toHaveBeenCalledWith(
      "gen 0 movie 1 / 1 fetch Gran Torino (2007) pop 88",
    );
  });

  it("logs a single combined movie line when credits fetch has to resolve the movie first", async () => {
    const unresolvedMovieRecord = makeFilmRecord({
      id: "gran-torino-2007",
      tmdbId: null,
      title: "Gran Torino",
      year: "2007",
    });
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/search/movie")) {
        return createJsonResponse({
          results: [
            makeTmdbMovieSearchResult({
              id: 321,
              title: "Gran Torino",
              release_date: "2007-12-14",
              popularity: 88,
            }),
          ],
        });
      }

      if (url.includes("/movie/321/credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    await fetchAndCacheMovieCredits(unresolvedMovieRecord, "fetch");

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/movie/321/credits"))).toHaveLength(1);
    expect(
      consoleLogSpy.mock.calls.filter(
        ([event]) => event === "gen 0 movie 1 / 1 fetch Gran Torino (2007) pop 88",
      ),
    ).toHaveLength(1);
    expect(debugLogMock.addCinenerdleDebugLog).toHaveBeenCalledWith(
      "gen 0 movie 1 / 1 fetch Gran Torino (2007) pop 88",
    );
  });

  it("logs raw person responses with the requested format", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/person/12/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/person/12?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 12,
            name: "Tom Brady",
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    await prepareSelectedPerson("Tom Brady", 12, {
      forceRefresh: true,
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 0 person 1 / 1 fetch Tom Brady pop 77",
      expect.objectContaining({
        person: expect.objectContaining({
          id: 12,
          name: "Tom Brady",
        }),
        movieCredits: expect.objectContaining({
          cast: [],
          crew: [],
        }),
      }),
    );
    expect(debugLogMock.addCinenerdleDebugLog).toHaveBeenCalledWith(
      "gen 0 person 1 / 1 fetch Tom Brady pop 77",
    );
  });

  it("hydrates starter titles without mutating IndexedDB starter flags", async () => {
    const cachedStarterRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        popularity: 99,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const starterRecord = makeFilmRecord({
      id: "heat-1995",
      title: "Heat",
      year: "1995",
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(cachedStarterRecord);

    await hydrateCinenerdleDailyStarterMovies([starterRecord]);

    expect(indexedDbMock.saveFilmRecord).not.toHaveBeenCalled();
  });

  it("auto-fetches cached movies that do not have top-level TMDb movie data yet", async () => {
    const placeholderMovieRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      tmdbSource: "connection-derived",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        popularity: 10,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/movie/321/credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/search/movie?")) {
        return createJsonResponse({
          results: [
            makeTmdbMovieSearchResult({
              id: 321,
              title: "Heat",
              release_date: "1995-12-15",
              popularity: 99,
            }),
          ],
        });
      }

      if (url.includes("/movie/321?")) {
        return createJsonResponse(
          makeTmdbMovieSearchResult({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 99,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getFilmRecordById.mockResolvedValue(placeholderMovieRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(placeholderMovieRecord);
    vi.stubGlobal("fetch", fetchMock);

    await prepareSelectedMovie("Heat", "1995", 321);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/search/movie?");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/movie/321/credits?");
  });

  it("auto-fetches cached people that do not have top-level TMDb person data yet", async () => {
    const placeholderPersonRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      tmdbSource: "connection-derived",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 44,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/person/60/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/person/60?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 60,
            name: "Al Pacino",
            popularity: 88,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(placeholderPersonRecord);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(placeholderPersonRecord);
    vi.stubGlobal("fetch", fetchMock);

    await prepareSelectedPerson("Al Pacino", 60);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/person/60?");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/person/60/movie_credits?");
  });

  it("coalesces overlapping selected movie fetches for uncached movies", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/search/movie")) {
        return createJsonResponse({
          results: [
            makeTmdbMovieSearchResult({
              id: 934433,
              title: "La Snob",
              release_date: "2024-01-01",
              popularity: 1.38,
            }),
          ],
        });
      }

      if (url.includes("/movie/934433/credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    const [firstResult, secondResult] = await Promise.all([
      prepareSelectedMovie("La Snob", "2024"),
      prepareSelectedMovie("La Snob", "2024"),
    ]);

    expect(firstResult).toBe(secondResult);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/search/movie"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/movie/934433/credits"))).toHaveLength(1);
    expect(
      consoleLogSpy.mock.calls.filter(
        ([event]) => event === "gen 0 movie 1 / 1 fetch La Snob (2024) pop 1.38",
      ),
    ).toHaveLength(1);
  });

  it("does not fan out into global popular prefetches after a selected fetch", async () => {
    const searchRecords = [
      {
        key: "person:tom-brady",
        type: "person" as const,
        nameLower: "tom brady",
        popularity: 10,
      },
      {
        key: "movie:gran-torino:2007",
        type: "movie" as const,
        nameLower: "gran torino (2007)",
        popularity: 9,
      },
    ];
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/person/60/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/person/60?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 60,
            name: "Al Pacino",
            popularity: 88,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue(searchRecords);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    await prepareSelectedPerson("Al Pacino", 60);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 0 person 1 / 1 fetch Al Pacino pop 88",
      expect.objectContaining({
        person: expect.objectContaining({
          id: 60,
          name: "Al Pacino",
        }),
      }),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/search/movie"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/search/person"))).toBe(false);
  });

  it("prefetches the top unfinished movie and person queues", async () => {
    const searchRecords = [
      {
        key: "movie:low:2000",
        type: "movie" as const,
        nameLower: "low movie (2000)",
        popularity: 1,
      },
      {
        key: "movie:gran-torino:2007",
        type: "movie" as const,
        nameLower: "gran torino (2007)",
        popularity: 9,
      },
      {
        key: "person:side-character",
        type: "person" as const,
        nameLower: "side character",
        popularity: 2,
      },
      {
        key: "person:tom-brady",
        type: "person" as const,
        nameLower: "tom brady",
        popularity: 10,
      },
    ];
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);

      if (url.includes("/search/movie")) {
        return createJsonResponse({
          results: [
            makeTmdbMovieSearchResult({
              id: 321,
              title: "Gran Torino",
              release_date: "2007-12-14",
              popularity: 9,
            }),
          ],
        });
      }

      if (url.includes("/movie/321/credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/search/person")) {
        return createJsonResponse({
          results: [
            makeTmdbPersonSearchResult({
              id: 12,
              name: "Tom Brady",
              popularity: 10,
            }),
          ],
        });
      }

      if (url.includes("/person/12?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 12,
            name: "Tom Brady",
            popularity: 10,
          }),
        );
      }

      if (url.includes("/person/12/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue(searchRecords);
    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);
    connectionGraphMock.hydrateConnectionEntityFromSearchRecord.mockImplementation(
      (searchRecord: { key: string; type: "movie" | "person" }) =>
        Promise.resolve(
          searchRecord.type === "movie"
            ? {
                key: searchRecord.key,
                kind: "movie",
                name: searchRecord.key === "movie:gran-torino:2007" ? "Gran Torino" : "Low Movie",
                year: searchRecord.key === "movie:gran-torino:2007" ? "2007" : "2000",
                tmdbId: null,
              }
            : {
                key: searchRecord.key,
                kind: "person",
                name: searchRecord.key === "person:tom-brady" ? "Tom Brady" : "Side Character",
                year: "",
                tmdbId: searchRecord.key === "person:tom-brady" ? 12 : null,
              },
        ),
    );

    await prefetchTopPopularUnhydratedConnections();

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/search/movie"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/movie/321/credits"))).toBe(true);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 1 movie 1 / 1 prefetch Gran Torino (2007) pop 9",
      expect.objectContaining({
        movie: expect.objectContaining({
          id: 321,
          title: "Gran Torino",
        }),
        credits: expect.objectContaining({
          cast: [],
          crew: [],
        }),
      }),
    );
    expect(debugLogMock.addCinenerdleDebugLog).toHaveBeenCalledWith(
      "gen 1 movie 1 / 1 prefetch Gran Torino (2007) pop 9",
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 1 person 1 / 1 prefetch Tom Brady pop 10",
      expect.objectContaining({
        person: expect.objectContaining({
          id: 12,
          name: "Tom Brady",
        }),
        movieCredits: expect.objectContaining({
          cast: [],
          crew: [],
        }),
      }),
    );
    expect(debugLogMock.addCinenerdleDebugLog).toHaveBeenCalledWith(
      "gen 1 person 1 / 1 prefetch Tom Brady pop 10",
    );
  });

  it("prefers the selected endpoint direct queue over a higher-popularity global person candidate", async () => {
    const selectedMovieRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Direct Queue Movie",
      year: "2026",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Direct Queue Movie",
        release_date: "2026-05-01",
        popularity: 40,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 111,
            name: "Direct Choice",
            popularity: 5,
          }),
        ],
        crew: [],
      },
    });
    const searchRecords = [
      {
        key: "person:global-choice",
        type: "person" as const,
        nameLower: "global choice",
        popularity: 99,
      },
    ];
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);

      if (url.includes("/person/111?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 111,
            name: "Direct Choice",
            popularity: 5,
          }),
        );
      }

      if (url.includes("/person/111/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue(searchRecords);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    await prefetchTopPopularUnhydratedConnections({
      key: "movie:321",
      kind: "movie",
      name: "Direct Queue Movie",
      year: "2026",
      popularity: 40,
      popularitySource: null,
      imageUrl: null,
      subtitle: "2026",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: selectedMovieRecord,
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/person/111?"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("Global%20Choice"))).toBe(false);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 1 person 1 / 1 prefetch Direct Choice pop 5",
      expect.objectContaining({
        person: expect.objectContaining({
          id: 111,
          name: "Direct Choice",
        }),
      }),
    );
  });

  it("falls back to the global queue when the selected endpoint direct queue has no eligible person candidates", async () => {
    const selectedMovieRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Fallback Queue Movie",
      year: "2026",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Fallback Queue Movie",
        release_date: "2026-05-01",
        popularity: 40,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 111,
            name: "Already Hydrated",
            popularity: 5,
          }),
        ],
        crew: [],
      },
    });
    const hydratedDirectPerson = makePersonRecord({
      id: 111,
      tmdbId: 111,
      name: "Already Hydrated",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 111,
        name: "Already Hydrated",
        popularity: 5,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const searchRecords = [
      {
        key: "person:global-choice",
        type: "person" as const,
        nameLower: "global choice",
        popularity: 99,
      },
    ];
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);

      if (url.includes("/search/person")) {
        return createJsonResponse({
          results: [
            makeTmdbPersonSearchResult({
              id: 222,
              name: "Global Choice",
              popularity: 99,
            }),
          ],
        });
      }

      if (url.includes("/person/222?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 222,
            name: "Global Choice",
            popularity: 99,
          }),
        );
      }

      if (url.includes("/person/222/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue(searchRecords);
    indexedDbMock.getPersonRecordById.mockImplementation(async (personId: number) =>
      personId === 111 ? hydratedDirectPerson : null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Already Hydrated" ? hydratedDirectPerson : null,
    );
    vi.stubGlobal("fetch", fetchMock);

    await prefetchTopPopularUnhydratedConnections({
      key: "movie:321",
      kind: "movie",
      name: "Fallback Queue Movie",
      year: "2026",
      popularity: 40,
      popularitySource: null,
      imageUrl: null,
      subtitle: "2026",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: selectedMovieRecord,
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/person/111?"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/search/person"))).toBe(true);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 1 person 1 / 1 prefetch Global Choice pop 99",
      expect.objectContaining({
        person: expect.objectContaining({
          id: 222,
          name: "Global Choice",
        }),
      }),
    );
  });

  it("dedupes overlapping global popular prefetch runs", async () => {
    const searchRecords = [
      {
        key: "person:12",
        type: "person" as const,
        nameLower: "tom brady",
        popularity: 10,
      },
    ];
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);

      if (url.includes("/person/12?")) {
        await Promise.resolve();
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 12,
            name: "Tom Brady",
            popularity: 10,
          }),
        );
      }

      if (url.includes("/person/12/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue(searchRecords);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);
    connectionGraphMock.hydrateConnectionEntityFromSearchRecord.mockResolvedValue({
      key: "person:tom-brady",
      kind: "person",
      name: "Tom Brady",
      year: "",
      tmdbId: 12,
    });

    await Promise.all([
      prefetchTopPopularUnhydratedConnections(),
      prefetchTopPopularUnhydratedConnections(),
    ]);

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/person/12?"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/person/12/movie_credits"))).toHaveLength(1);
    expect(
      consoleLogSpy.mock.calls.filter(
        ([event]) => event === "gen 1 person 1 / 1 prefetch Tom Brady pop 10",
      ),
    ).toHaveLength(1);
  });

  it("rebuilds the direct queue when the selected endpoint changes", async () => {
    const selectedMovieRecordA = makeFilmRecord({
      id: 401,
      tmdbId: 401,
      title: "First Selected Movie",
      year: "2026",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 401,
        title: "First Selected Movie",
        release_date: "2026-05-01",
        popularity: 30,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 111,
            name: "First Direct Choice",
            popularity: 10,
          }),
        ],
        crew: [],
      },
    });
    const selectedMovieRecordB = makeFilmRecord({
      id: 402,
      tmdbId: 402,
      title: "Second Selected Movie",
      year: "2026",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 402,
        title: "Second Selected Movie",
        release_date: "2026-05-02",
        popularity: 31,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 222,
            name: "Second Direct Choice",
            popularity: 11,
          }),
        ],
        crew: [],
      },
    });
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);

      if (url.includes("/person/111?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 111,
            name: "First Direct Choice",
            popularity: 10,
          }),
        );
      }

      if (url.includes("/person/111/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/person/222?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 222,
            name: "Second Direct Choice",
            popularity: 11,
          }),
        );
      }

      if (url.includes("/person/222/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([]);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    await prefetchTopPopularUnhydratedConnections({
      key: "movie:401",
      kind: "movie",
      name: "First Selected Movie",
      year: "2026",
      popularity: 30,
      popularitySource: null,
      imageUrl: null,
      subtitle: "2026",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: selectedMovieRecordA,
    });
    await prefetchTopPopularUnhydratedConnections({
      key: "movie:402",
      kind: "movie",
      name: "Second Selected Movie",
      year: "2026",
      popularity: 31,
      popularitySource: null,
      imageUrl: null,
      subtitle: "2026",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: selectedMovieRecordB,
    });

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/person/111?"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/person/222?"))).toHaveLength(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 1 person 1 / 1 prefetch First Direct Choice pop 10",
      expect.any(Object),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 1 person 1 / 1 prefetch Second Direct Choice pop 11",
      expect.any(Object),
    );
  });

  it("fetches an overlapping direct and global person candidate only once", async () => {
    const selectedMovieRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Overlap Queue Movie",
      year: "2026",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Overlap Queue Movie",
        release_date: "2026-05-01",
        popularity: 40,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 12,
            name: "Tom Brady",
            popularity: 10,
          }),
        ],
        crew: [],
      },
    });
    const searchRecords = [
      {
        key: "person:12",
        type: "person" as const,
        nameLower: "tom brady",
        popularity: 10,
      },
    ];
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);

      if (url.includes("/person/12?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 12,
            name: "Tom Brady",
            popularity: 10,
          }),
        );
      }

      if (url.includes("/person/12/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue(searchRecords);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    connectionGraphMock.hydrateConnectionEntityFromSearchRecord.mockResolvedValue({
      key: "person:12",
      kind: "person",
      name: "Tom Brady",
      year: "",
      tmdbId: 12,
    });
    vi.stubGlobal("fetch", fetchMock);

    await prefetchTopPopularUnhydratedConnections({
      key: "movie:321",
      kind: "movie",
      name: "Overlap Queue Movie",
      year: "2026",
      popularity: 40,
      popularitySource: null,
      imageUrl: null,
      subtitle: "2026",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: selectedMovieRecord,
    });

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/person/12?"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/person/12/movie_credits"))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/search/person"))).toBe(false);
  });

  it("backfills the missing person prefetch after a movie prefetch creates new person candidates", async () => {
    const searchRecordsBeforeMovie = [
      {
        key: "movie:gran-torino:2007",
        type: "movie" as const,
        nameLower: "gran torino (2007)",
        popularity: 9,
      },
    ];
    const searchRecordsAfterMovie = [
      ...searchRecordsBeforeMovie,
      {
        key: "person:12",
        type: "person" as const,
        nameLower: "tom brady",
        popularity: 10,
      },
    ];
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);

      if (url.includes("/search/movie")) {
        return createJsonResponse({
          results: [
            makeTmdbMovieSearchResult({
              id: 321,
              title: "Gran Torino",
              release_date: "2007-12-14",
              popularity: 9,
            }),
          ],
        });
      }

      if (url.includes("/movie/321/credits")) {
        indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue(searchRecordsAfterMovie);
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/person/12?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 12,
            name: "Tom Brady",
            popularity: 10,
          }),
        );
      }

      if (url.includes("/person/12/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue(searchRecordsBeforeMovie);
    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);
    connectionGraphMock.hydrateConnectionEntityFromSearchRecord.mockImplementation(
      (searchRecord: { key: string; type: "movie" | "person" }) =>
        Promise.resolve(
          searchRecord.type === "movie"
            ? {
                key: searchRecord.key,
                kind: "movie",
                name: "Gran Torino",
                year: "2007",
                tmdbId: null,
              }
            : {
                key: searchRecord.key,
                kind: "person",
                name: "Tom Brady",
                year: "",
                tmdbId: 12,
              },
        ),
    );

    await prefetchTopPopularUnhydratedConnections();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 1 movie 1 / 1 prefetch Gran Torino (2007) pop 9",
      expect.any(Object),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 1 person 1 / 1 prefetch Tom Brady pop 10",
      expect.any(Object),
    );
  });

  it("prefetches the top partial person for a selected movie instead of skipping to a lower-priority fallback", async () => {
    const selectedMovieRecord = makeFilmRecord({
      id: 1266127,
      tmdbId: 1266127,
      title: "Ready or Not: Here I Come",
      year: "2026",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 1266127,
        title: "Ready or Not: Here I Come",
        release_date: "2026-04-10",
        popularity: 62.46,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 1372369,
            name: "Samara Weaving",
            popularity: 10.83,
          }),
          makePersonCredit({
            id: 999001,
            name: "Joel Labelle",
            popularity: 0.79,
          }),
        ],
        crew: [],
      },
    });
    const partialSamaraRecord = makePersonRecord({
      id: 1372369,
      tmdbId: 1372369,
      name: "Samara Weaving",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 1372369,
        name: "Samara Weaving",
        popularity: 10.83,
      }),
      rawTmdbMovieCreditsResponse: undefined,
    });
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);

      if (url.includes("/person/1372369?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 1372369,
            name: "Samara Weaving",
            popularity: 10.83,
          }),
        );
      }

      if (url.includes("/person/1372369/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getPersonRecordById.mockImplementation(async (personId: number) =>
      personId === 1372369 ? partialSamaraRecord : null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Samara Weaving" ? partialSamaraRecord : null,
    );
    vi.stubGlobal("fetch", fetchMock);

    await prefetchBestConnectionForYoungestSelectedCard({
      key: "movie:1266127",
      kind: "movie",
      name: "Ready or Not: Here I Come",
      year: "2026",
      popularity: 62.46,
      popularitySource: null,
      imageUrl: null,
      subtitle: "2026",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: selectedMovieRecord,
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/person/1372369?"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/person/1372369/movie_credits"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("Joel%20Labelle"))).toBe(false);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "gen 1 person 1 / 1 prefetch Samara Weaving pop 10.83",
      expect.objectContaining({
        person: expect.objectContaining({
          id: 1372369,
          name: "Samara Weaving",
        }),
        movieCredits: expect.objectContaining({
          cast: [],
          crew: [],
        }),
      }),
    );
  });

  it("batches direct movie cache checks for a selected person before prefetching the next movie", async () => {
    const hydratedMovieRecord = makeFilmRecord({
      id: 101,
      tmdbId: 101,
      title: "Hydrated Hit",
      year: "2020",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 101,
        title: "Hydrated Hit",
        release_date: "2020-01-01",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [makePersonCredit({ id: 1, name: "Samara Weaving" })],
        crew: [],
      },
      personConnectionKeys: ["Samara Weaving"],
    });
    const selectedPersonRecord = makePersonRecord({
      id: 1,
      tmdbId: 1,
      name: "Samara Weaving",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 1,
        name: "Samara Weaving",
        popularity: 88,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 101,
            title: "Hydrated Hit",
            release_date: "2020-01-01",
            popularity: 99,
          }),
          makeMovieCredit({
            id: 102,
            title: "Needs Prefetch",
            release_date: "2019-01-01",
            popularity: 55,
          }),
        ],
        crew: [],
      },
    });
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);

      if (url.includes("/search/movie?") && url.includes("Needs+Prefetch")) {
        return createJsonResponse({
          page: 1,
          results: [
            makeTmdbMovieSearchResult({
              id: 102,
              title: "Needs Prefetch",
              release_date: "2019-01-01",
              popularity: 55,
            }),
          ],
          total_pages: 1,
          total_results: 1,
        });
      }

      if (url.includes("/movie/102/credits")) {
        return createJsonResponse({
          cast: [makePersonCredit({ id: 1, name: "Samara Weaving" })],
          crew: [],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getPersonRecordById.mockImplementation(async (personId: number) =>
      personId === 1 ? selectedPersonRecord : null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Samara Weaving" ? selectedPersonRecord : null,
    );
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(
      new Map([[101, hydratedMovieRecord]]),
    );
    indexedDbMock.getFilmRecordById.mockImplementation(async (movieId: number) =>
      movieId === 101 ? hydratedMovieRecord : null,
    );
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    await prefetchBestConnectionForYoungestSelectedCard({
      key: "person:1",
      kind: "person",
      name: "Samara Weaving",
      popularity: 88,
      popularitySource: null,
      imageUrl: null,
      subtitle: "Actor",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      record: selectedPersonRecord,
    });

    expect(indexedDbMock.getFilmRecordsByIds).toHaveBeenCalledWith([101, 102]);
    expect(indexedDbMock.getFilmRecordByTitleAndYear).not.toHaveBeenCalledWith(
      "Hydrated Hit",
      "2020",
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("Needs+Prefetch"))).toBe(true);
  });
});

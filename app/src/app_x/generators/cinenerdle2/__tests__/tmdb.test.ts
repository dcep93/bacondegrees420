import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeFilmRecord,
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
  fetchCinenerdleDailyStarterMovies,
  fetchAndCacheMovieCredits,
  flushTmdbBackgroundWorkForTests,
  hasHydratedMovieRecord,
  hasHydratedPersonRecord,
  hasMovieFullState,
  hasPersonFullState,
  hydrateHashPath,
  hydrateCinenerdleDailyStarterMovies,
  prefetchTopPopularUnhydratedConnections,
  prepareConnectionEntityForPreview,
  prepareSelectedMovie,
  prepareSelectedPerson,
  resolveConnectionQuery,
} from "../tmdb";
import { createPathNode, serializePathNodes } from "../hash";

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

  afterEach(async () => {
    await flushTmdbBackgroundWorkForTests();
    consoleLogSpy.mockClear();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({})));
  });

  it("treats hydrated as direct tmdb source even before credits arrive", () => {
    const directMovieWithoutCredits = makeFilmRecord({
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
      rawTmdbMovieCreditsResponse: undefined,
    });
    const directPersonWithoutCredits = makePersonRecord({
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 77,
      }),
      rawTmdbMovieCreditsResponse: undefined,
    });

    expect(hasHydratedMovieRecord(directMovieWithoutCredits)).toBe(true);
    expect(hasMovieFullState(directMovieWithoutCredits)).toBe(false);
    expect(hasHydratedPersonRecord(directPersonWithoutCredits)).toBe(true);
    expect(hasPersonFullState(directPersonWithoutCredits)).toBe(false);
  });

  it("treats direct movies with empty genres as full state once movie details and credits exist", () => {
    const directMovieWithEmptyGenres = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        genres: [],
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });

    expect(hasMovieFullState(directMovieWithEmptyGenres)).toBe(true);
  });

  it("hydrates preview movies from existing partial cached records", async () => {
    const partialMovieRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: undefined,
      rawTmdbMovieCreditsResponse: undefined,
    });
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/movie/321/credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/movie/321?")) {
        return createJsonResponse(
          makeTmdbMovieSearchResult({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 99,
            runtime: 170,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(partialMovieRecord);
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareConnectionEntityForPreview({
      key: "movie:heat:1995",
      kind: "movie",
      name: "Heat (1995)",
    });

    expect(result).toEqual(
      expect.objectContaining({
        tmdbId: 321,
        rawTmdbMovie: expect.objectContaining({
          id: 321,
          title: "Heat",
        }),
        rawTmdbMovieCreditsResponse: {
          cast: [],
          crew: [],
        },
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/movie/321?");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/movie/321/credits?");
  });

  it("hydrates preview people from existing partial cached records", async () => {
    const partialPersonRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      rawTmdbPerson: undefined,
      rawTmdbMovieCreditsResponse: undefined,
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
            popularity: 77,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    let storedPersonRecord = partialPersonRecord;

    indexedDbMock.getPersonRecordById.mockImplementation(async () => storedPersonRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async () => storedPersonRecord);
    indexedDbMock.savePersonRecord.mockImplementation(async (record) => {
      storedPersonRecord = record;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareConnectionEntityForPreview({
      key: "person:60",
      kind: "person",
      name: "Al Pacino",
    });

    expect(result).toEqual(
      expect.objectContaining({
        tmdbId: 60,
        rawTmdbPerson: expect.objectContaining({
          id: 60,
          name: "Al Pacino",
        }),
        rawTmdbMovieCreditsResponse: {
          cast: [],
          crew: [],
        },
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/person/60?");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/person/60/movie_credits?");
    expect(indexedDbMock.savePersonRecord).toHaveBeenCalledTimes(1);
  });

  it("falls back to movie search when a preview movie has no cached record or tmdb id", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
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

      if (url.includes("/movie/321/credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      if (url.includes("/movie/321?")) {
        return createJsonResponse(
          makeTmdbMovieSearchResult({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 99,
            runtime: 170,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareConnectionEntityForPreview({
      key: "movie:heat:1995",
      kind: "movie",
      name: "Heat (1995)",
    });

    expect(result).toEqual(
      expect.objectContaining({
        tmdbId: 321,
        rawTmdbMovie: expect.objectContaining({
          id: 321,
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/search/movie?");
  });

  it("returns fully hydrated preview people without refetching", async () => {
    const hydratedPersonRecord = makePersonRecord({
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
    });
    const fetchMock = vi.fn();

    indexedDbMock.getPersonRecordById.mockResolvedValue(hydratedPersonRecord);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(hydratedPersonRecord);
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareConnectionEntityForPreview({
      key: "person:60",
      kind: "person",
      name: "Al Pacino",
    });

    expect(result).toBe(hydratedPersonRecord);
    expect(fetchMock).not.toHaveBeenCalled();
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
        genres: [{ id: 28, name: "Action" }],
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

  it("refreshes cached direct movies that are still missing credits", async () => {
    const directMovieWithoutCredits = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        popularity: 99,
        genres: [{ id: 28, name: "Action" }],
      }),
      rawTmdbMovieCreditsResponse: undefined,
    });
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/movie/321/credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getFilmRecordById.mockResolvedValue(directMovieWithoutCredits);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(directMovieWithoutCredits);
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareSelectedMovie("Heat", "1995", 321);

    expect(result).toEqual(
      expect.objectContaining({
        tmdbId: 321,
        rawTmdbMovieCreditsResponse: {
          cast: [],
          crew: [],
        },
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/movie/321/credits?");
  });

  it("does not refetch direct movies solely because genreIds are empty", async () => {
    const sparseMovieRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        popularity: 99,
        genres: [],
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

      if (url.includes("/movie/321?")) {
        return createJsonResponse(
          makeTmdbMovieSearchResult({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 99,
            genres: [{ id: 28, name: "Action" }],
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getFilmRecordById.mockResolvedValue(sparseMovieRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(sparseMovieRecord);
    vi.stubGlobal("navigator", {
      webdriver: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareSelectedMovie("Heat", "1995", 321);

    expect(result).toEqual(sparseMovieRecord);
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
            runtime: 170,
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
    expect(indexedDbMock.saveFilmRecord).toHaveBeenCalledTimes(1);
    expect(indexedDbMock.saveFilmRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        rawTmdbMovie: expect.objectContaining({
          runtime: 170,
        }),
      }),
    );
    expect(indexedDbMock.batchCinenerdleRecordsUpdatedEvents).toHaveBeenCalledTimes(1);
  });

  it("starts movie details and credits in parallel and saves only after both payloads resolve", async () => {
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
    const requestedUrls: string[] = [];
    const movieDeferred = createDeferred<ReturnType<typeof makeTmdbMovieSearchResult>>();
    const creditsDeferred = createDeferred<{ cast: []; crew: [] }>();
    let storedMovieRecord = cachedMovieRecord;
    const fetchMock = vi.fn((input: string) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.includes("/movie/321/credits")) {
        return Promise.resolve(createJsonResponse(creditsDeferred.promise));
      }

      if (url.includes("/movie/321?")) {
        return Promise.resolve(createJsonResponse(movieDeferred.promise));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getFilmRecordById.mockImplementation(async () => storedMovieRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(cachedMovieRecord);
    indexedDbMock.saveFilmRecord.mockImplementation(async (record) => {
      storedMovieRecord = record;
    });
    vi.stubGlobal("fetch", fetchMock);

    const preparePromise = prepareSelectedMovie("Heat", "1995", 321, {
      forceRefresh: true,
    });

    await flushAsyncWork();

    expect(requestedUrls.some((url) => url.includes("/movie/321?"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/movie/321/credits?"))).toBe(true);
    expect(indexedDbMock.saveFilmRecord).not.toHaveBeenCalled();

    movieDeferred.resolve(
      makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        popularity: 99,
        runtime: 170,
      }),
    );

    await flushAsyncWork();

    expect(indexedDbMock.saveFilmRecord).not.toHaveBeenCalled();

    creditsDeferred.resolve({ cast: [], crew: [] });

    await preparePromise;

    expect(indexedDbMock.saveFilmRecord).toHaveBeenCalledTimes(1);
    expect(indexedDbMock.saveFilmRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        tmdbId: 321,
        rawTmdbMovie: expect.objectContaining({
          id: 321,
          title: "Heat",
          runtime: 170,
        }),
        rawTmdbMovieCreditsResponse: {
          cast: [],
          crew: [],
        },
      }),
    );
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

  it("starts person details and credits in parallel and saves only after both payloads resolve", async () => {
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
    const requestedUrls: string[] = [];
    const personDeferred = createDeferred<ReturnType<typeof makeTmdbPersonSearchResult>>();
    const creditsDeferred = createDeferred<{ cast: []; crew: [] }>();
    let storedPersonRecord = cachedPersonRecord;
    const fetchMock = vi.fn((input: string) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.includes("/person/60/movie_credits")) {
        return Promise.resolve(createJsonResponse(creditsDeferred.promise));
      }

      if (url.includes("/person/60?")) {
        return Promise.resolve(createJsonResponse(personDeferred.promise));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getPersonRecordById.mockImplementation(async () => storedPersonRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async () => storedPersonRecord);
    indexedDbMock.savePersonRecord.mockImplementation(async (record) => {
      storedPersonRecord = record;
    });
    vi.stubGlobal("fetch", fetchMock);

    const preparePromise = prepareSelectedPerson("Al Pacino", 60, {
      forceRefresh: true,
    });

    await flushAsyncWork();

    expect(requestedUrls.some((url) => url.includes("/person/60?"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/person/60/movie_credits?"))).toBe(true);
    expect(indexedDbMock.savePersonRecord).not.toHaveBeenCalled();
    expect(indexedDbMock.saveFilmRecords).not.toHaveBeenCalled();

    personDeferred.resolve(
      makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 88,
      }),
    );

    await flushAsyncWork();

    expect(indexedDbMock.savePersonRecord).not.toHaveBeenCalled();
    expect(indexedDbMock.saveFilmRecords).not.toHaveBeenCalled();

    creditsDeferred.resolve({ cast: [], crew: [] });

    await preparePromise;

    expect(indexedDbMock.savePersonRecord).toHaveBeenCalledTimes(1);
    expect(indexedDbMock.saveFilmRecords).toHaveBeenCalledTimes(1);
    expect(indexedDbMock.savePersonRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        tmdbId: 60,
        rawTmdbPerson: expect.objectContaining({
          id: 60,
          name: "Al Pacino",
        }),
        rawTmdbMovieCreditsResponse: {
          cast: [],
          crew: [],
        },
      }),
    );
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
        personConnectionKeys: [1372369],
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

  it("does not remote-fetch movie credits when the movie has no tmdb id", async () => {
    const unresolvedMovieRecord = makeFilmRecord({
      id: "gran-torino-2007",
      tmdbId: null,
      title: "Gran Torino",
      year: "2007",
    });
    const fetchMock = vi.fn();

    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAndCacheMovieCredits(unresolvedMovieRecord, "fetch");

    expect(result).toBe(unresolvedMovieRecord);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(debugLogMock.addCinenerdleDebugLog).not.toHaveBeenCalled();
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
        genres: [{ id: 28, name: "Action" }],
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

  it("searches starter titles once to cache tmdb ids alongside titles", async () => {
    const storage = {
      getItem: vi.fn().mockReturnValue("key:test-api-key"),
      setItem: vi.fn(),
    };
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url === "https://www.cinenerdle2.app/api/battle-data/daily-starters?") {
        return createJsonResponse({
          data: [
            {
              id: "starter-heat",
              title: "Heat (1995)",
            },
          ],
        });
      }

      if (url.includes("/search/movie?") && url.includes("query=Heat")) {
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

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", {
      prompt: vi.fn(),
      localStorage: storage,
    });
    vi.stubGlobal("fetch", fetchMock);

    const starterFilms = await fetchCinenerdleDailyStarterMovies();

    expect(starterFilms).toEqual([
      expect.objectContaining({
        id: 321,
        tmdbId: 321,
        title: "Heat",
        year: "1995",
      }),
    ]);
    expect(storage.setItem).toHaveBeenCalledWith(
      "cinenerdle2.dailyStarterTitles",
      JSON.stringify([{ title: "Heat (1995)", tmdbId: 321 }]),
    );
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
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/movie/321?");
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

  it("coalesces overlapping selected movie fetches for uncached movies without remote fallback", async () => {
    const fetchMock = vi.fn();

    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    const [firstResult, secondResult] = await Promise.all([
      prepareSelectedMovie("La Snob", "2024"),
      prepareSelectedMovie("La Snob", "2024"),
    ]);

    expect(firstResult).toBe(secondResult);
    expect(firstResult).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fan out into global popular prefetches after a selected fetch", async () => {
    const searchRecords = [
      {
        key: "person:12",
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

  it("hydrates bookmark paths without global prefetch fan-out when prefetchConnections is disabled", async () => {
    const bookmarkHash = serializePathNodes([
      createPathNode("movie", "Heat", "1995"),
    ]);
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
        popularity: 99,
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

      if (url.includes("/person/12?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 12,
            name: "Tom Brady",
            popularity: 75,
          }),
        );
      }

      if (url.includes("/person/12/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([
      {
        key: "person:12",
        type: "person",
        nameLower: "tom brady",
        popularity: 10,
      },
    ]);
    indexedDbMock.getFilmRecordById.mockResolvedValue(placeholderMovieRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(placeholderMovieRecord);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    await hydrateHashPath(bookmarkHash, {
      prefetchConnections: false,
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining("/movie/321?"),
      expect.stringContaining("/movie/321/credits?"),
    ]);
  });

  it("keeps the existing global prefetch fan-out when hydrateHashPath uses default options", async () => {
    const bookmarkHash = serializePathNodes([
      createPathNode("movie", "Heat", "1995"),
    ]);
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
        popularity: 99,
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

      if (url.includes("/person/12?")) {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 12,
            name: "Tom Brady",
            popularity: 75,
          }),
        );
      }

      if (url.includes("/person/12/movie_credits")) {
        return createJsonResponse({ cast: [], crew: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([
      {
        key: "person:12",
        type: "person",
        nameLower: "tom brady",
        popularity: 10,
      },
    ]);
    indexedDbMock.getFilmRecordById.mockResolvedValue(placeholderMovieRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(placeholderMovieRecord);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    await hydrateHashPath(bookmarkHash);

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/person/12?"))).toBe(true);
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
        key: "person:12",
        type: "person" as const,
        nameLower: "tom brady",
        popularity: 10,
      },
    ];
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);

      if (url.includes("/movie/321?")) {
        return createJsonResponse(
          makeTmdbMovieSearchResult({
            id: 321,
            title: "Gran Torino",
            release_date: "2007-12-14",
            popularity: 9,
          }),
        );
      }

      if (url.includes("/movie/321/credits")) {
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

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue(searchRecords);
    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (movieName: string, movieYear: string) =>
      movieName.toLowerCase() === "gran torino" && movieYear === "2007"
        ? makeFilmRecord({
            id: 321,
            tmdbId: 321,
            title: "Gran Torino",
            year: "2007",
            tmdbSource: "connection-derived",
            rawTmdbMovie: undefined,
            rawTmdbMovieCreditsResponse: undefined,
          })
        : null,
    );
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
                name: searchRecord.key === "person:12" ? "Tom Brady" : "Side Character",
                year: "",
                tmdbId: searchRecord.key === "person:12" ? 12 : null,
              },
        ),
    );

    await prefetchTopPopularUnhydratedConnections();

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/movie/321?"))).toBe(true);
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
        genres: [{ id: 28, name: "Action" }],
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
        key: "person:222",
        type: "person" as const,
        nameLower: "global choice",
        popularity: 99,
      },
    ];
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);

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
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/person/222?"))).toBe(true);
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

  it("skips popular connection prefetch while running under playwright", async () => {
    const fetchMock = vi.fn();

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([
      {
        key: "person:12",
        type: "person" as const,
        nameLower: "tom brady",
        popularity: 10,
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {
      webdriver: true,
    });

    await prefetchTopPopularUnhydratedConnections();

    expect(indexedDbMock.getAllSearchableConnectionEntities).not.toHaveBeenCalled();
    expect(connectionGraphMock.hydrateConnectionEntityFromSearchRecord).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(debugLogMock.addCinenerdleDebugLog).not.toHaveBeenCalled();
  });

  it("records a debug entry when a selected-card prefetch is skipped under playwright", async () => {
    vi.stubGlobal("navigator", {
      webdriver: true,
    });

    await prefetchTopPopularUnhydratedConnections({
      key: "movie:321",
      kind: "movie",
      name: "Heat",
      year: "1995",
      popularity: 88,
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
    });

    expect(debugLogMock.addCinenerdleDebugLog).toHaveBeenCalledWith(
      "prefetch skipped in playwright for movie:Heat",
    );
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
        genres: [{ id: 28, name: "Action" }],
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
        genres: [{ id: 28, name: "Action" }],
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

      if (url.includes("/movie/321?")) {
        return createJsonResponse(
          makeTmdbMovieSearchResult({
            id: 321,
            title: "Gran Torino",
            release_date: "2007-12-14",
            popularity: 9,
          }),
        );
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
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (movieName: string, movieYear: string) =>
      movieName.toLowerCase() === "gran torino" && movieYear === "2007"
        ? makeFilmRecord({
            id: 321,
            tmdbId: 321,
            title: "Gran Torino",
            year: "2007",
            tmdbSource: "connection-derived",
            rawTmdbMovie: undefined,
            rawTmdbMovieCreditsResponse: undefined,
          })
        : null,
    );
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

  it("runs both tmdb searches and logs one combined payload even when no connection target is found", async () => {
    const movieSearchResponse = { results: [] };
    const personSearchResponse = { results: [] };
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/search/movie?")) {
        return createJsonResponse(movieSearchResponse);
      }

      if (url.includes("/search/person?")) {
        return createJsonResponse(personSearchResponse);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([]);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    const target = await resolveConnectionQuery("La Snob (2024)");

    expect(target).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "tmdb.resolveConnectionQuery search responses",
      {
        movieSearchResponse,
        personSearchResponse,
        query: "La Snob (2024)",
      },
    );
  });

  it("resolves year-qualified movie queries as movies", async () => {
    const filmRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      popularity: 99,
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([
      {
        key: "movie:heat:1995",
        type: "movie",
        nameLower: "heat (1995)",
        popularity: 99,
      },
    ]);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(filmRecord);
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/search/movie?")) {
        return createJsonResponse({
          results: [
            makeTmdbMovieSearchResult({
              id: 321,
              popularity: 99,
              release_date: "1995-12-15",
              title: "Heat",
            }),
          ],
        });
      }

      if (url.includes("/search/person?")) {
        return createJsonResponse({ results: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const target = await resolveConnectionQuery("Heat (1995)");

    expect(target).toEqual({
      kind: "movie",
      name: "Heat",
      year: "1995",
    });
    expect(indexedDbMock.getFilmRecordByTitleAndYear).toHaveBeenCalledWith("Heat", "1995");
  });

  it("resolves bare movie title submits as movies from tmdb search", async () => {
    const movieSearchResponse = {
      results: [
        makeTmdbMovieSearchResult({
          id: 321,
          popularity: 91,
          release_date: "1995-12-15",
          title: "Heat",
        }),
      ],
    };
    const personSearchResponse = { results: [] };
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/search/movie?")) {
        return createJsonResponse(movieSearchResponse);
      }

      if (url.includes("/search/person?")) {
        return createJsonResponse(personSearchResponse);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([
      {
        key: "movie:heat:1995",
        type: "movie",
        nameLower: "heat (1995)",
        popularity: 99,
      },
    ]);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    const target = await resolveConnectionQuery("Heat");

    expect(target).toEqual({
      kind: "movie",
      name: "Heat",
      year: "1995",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(indexedDbMock.getFilmRecordByTitleAndYear).not.toHaveBeenCalled();
    expect(connectionGraphMock.hydrateConnectionEntityFromSearchRecord).not.toHaveBeenCalled();
  });

  it("resolves bare person-name submits as people from tmdb search", async () => {
    const personSearchResponse = {
      results: [
        makeTmdbPersonSearchResult({
          id: 60,
          name: "Al Pacino",
          popularity: 77,
        }),
      ],
    };
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/search/movie?")) {
        return createJsonResponse({ results: [] });
      }

      if (url.includes("/search/person?")) {
        return createJsonResponse(personSearchResponse);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    const personRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 77,
      }),
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([]);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(personRecord);
    vi.stubGlobal("fetch", fetchMock);

    const target = await resolveConnectionQuery("Al Pacino");

    expect(target).toEqual({
      kind: "person",
      name: "Al Pacino",
      tmdbId: 60,
    });
    expect(indexedDbMock.getFilmRecordByTitleAndYear).not.toHaveBeenCalled();
  });

  it("breaks exact cross-kind ties by higher popularity", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/search/movie?")) {
        return createJsonResponse({
          results: [
            makeTmdbMovieSearchResult({
              id: 321,
              popularity: 40,
              release_date: "1995-12-15",
              title: "Heat",
            }),
          ],
        });
      }

      if (url.includes("/search/person?")) {
        return createJsonResponse({
          results: [
            makeTmdbPersonSearchResult({
              id: 60,
              name: "Heat",
              popularity: 90,
            }),
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([]);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    const target = await resolveConnectionQuery("Heat");

    expect(target).toEqual({
      kind: "person",
      name: "Heat",
      tmdbId: 60,
    });
  });

  it("logs combined movie and person search responses once per free-text submit", async () => {
    const movieSearchResponse = {
      results: [
        makeTmdbMovieSearchResult({
          id: 321,
          popularity: 99,
          release_date: "1995-12-15",
          title: "Heat",
        }),
      ],
    };
    const personSearchResponse = {
      results: [
        makeTmdbPersonSearchResult({
          id: 60,
          name: "Heat",
          popularity: 30,
        }),
      ],
    };
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/search/movie?")) {
        return createJsonResponse(movieSearchResponse);
      }

      if (url.includes("/search/person?")) {
        return createJsonResponse(personSearchResponse);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([]);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);

    await resolveConnectionQuery("Heat");

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "tmdb.resolveConnectionQuery search responses",
      {
        movieSearchResponse,
        personSearchResponse,
        query: "Heat",
      },
    );
  });
});

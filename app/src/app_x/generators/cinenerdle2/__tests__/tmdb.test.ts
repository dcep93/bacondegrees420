import { beforeEach, describe, expect, it, vi } from "vitest";
import { TMDB_API_KEY_STORAGE_KEY } from "../constants";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
} from "./factories";

const indexedDbMock = vi.hoisted(() => ({
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
  hydrateConnectionEntityFromSearchRecord: vi.fn(),
}));

vi.mock("../indexed_db", () => indexedDbMock);
vi.mock("../connection_graph", () => connectionGraphMock);

import { prefetchBestConnectionForYoungestSelectedCard } from "../tmdb";

function createJsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function createLocalStorageMock(): Storage {
  let store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store = new Map<string, string>();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function getFetchPathnames(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => {
    const url = typeof input === "string" ? input : input.url;
    return new URL(url).pathname;
  });
}

describe("prefetchBestConnectionForYoungestSelectedCard", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    Object.values(connectionGraphMock).forEach((mock) => mock.mockReset());
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", createLocalStorageMock());

    localStorage.setItem(TMDB_API_KEY_STORAGE_KEY, "test-key");

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([]);
    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    indexedDbMock.saveFilmRecord.mockResolvedValue(undefined);
    indexedDbMock.saveFilmRecords.mockResolvedValue(undefined);
    indexedDbMock.savePersonRecord.mockResolvedValue(undefined);
  });

  it("prefetches the highest-popularity missing person for a selected movie", async () => {
    const selectedMovie = {
      key: "movie:heat:1995",
      kind: "movie" as const,
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
      record: makeFilmRecord({
        title: "Heat",
        year: "1995",
        rawTmdbMovieCreditsResponse: {
          cast: [
            makePersonCredit({
              id: 1,
              name: "Cached Person",
              popularity: 99,
            }),
            makePersonCredit({
              id: 2,
              name: "Target Person",
              popularity: 80,
            }),
          ],
          crew: [],
        },
      }),
    };

    indexedDbMock.getPersonRecordById.mockImplementation(async (id: number) =>
      id === 1 ? makePersonRecord({ id: 1, tmdbId: 1, name: "Cached Person" }) : null,
    );
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const pathname = new URL(url).pathname;

      if (pathname === "/3/person/2") {
        return createJsonResponse(
          makeTmdbPersonSearchResult({
            id: 2,
            name: "Target Person",
            popularity: 80,
          }),
        );
      }

      if (pathname === "/3/person/2/movie_credits") {
        return createJsonResponse({
          cast: [makeMovieCredit({ id: 200, title: "Target Movie", popularity: 42 })],
          crew: [],
        });
      }

      throw new Error(`Unexpected fetch ${pathname}`);
    });

    await prefetchBestConnectionForYoungestSelectedCard(selectedMovie);

    expect(getFetchPathnames(fetchMock)).toEqual([
      "/3/person/2",
      "/3/person/2/movie_credits",
    ]);
    expect(indexedDbMock.savePersonRecord).toHaveBeenCalledTimes(1);
    expect(indexedDbMock.savePersonRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 2,
        tmdbId: 2,
        name: "Target Person",
      }),
    );
  });

  it("prefetches the highest-popularity missing allowed movie for a selected person", async () => {
    const selectedPerson = {
      key: "person:7",
      kind: "person" as const,
      name: "Al Pacino",
      popularity: 0,
      popularitySource: null,
      imageUrl: null,
      subtitle: "",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      record: makePersonRecord({
        id: 7,
        tmdbId: 7,
        name: "Al Pacino",
        rawTmdbMovieCreditsResponse: {
          cast: [
            makeMovieCredit({
              id: 10,
              title: "Cached Hit",
              release_date: "1990-01-01",
              popularity: 95,
            }),
          ],
          crew: [
            makeMovieCredit({
              id: 20,
              title: "Target Hit",
              release_date: "2001-01-01",
              popularity: 80,
              character: undefined,
              job: "Director",
            }),
          ],
        },
      }),
    };

    indexedDbMock.getFilmRecordById.mockImplementation(async (id: number) =>
      id === 10 ? makeFilmRecord({ id: 10, tmdbId: 10, title: "Cached Hit", year: "1990" }) : null,
    );
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname;

      if (pathname === "/3/search/movie") {
        expect(parsedUrl.searchParams.get("query")).toBe("Target Hit");
        return createJsonResponse({
          results: [
            makeTmdbMovieSearchResult({
              id: 20,
              title: "Target Hit",
              release_date: "2001-01-01",
              popularity: 80,
            }),
          ],
        });
      }

      if (pathname === "/3/movie/20/credits") {
        return createJsonResponse({
          cast: [makePersonCredit({ id: 70, name: "Target Co-Star", popularity: 33 })],
          crew: [],
        });
      }

      throw new Error(`Unexpected fetch ${pathname}`);
    });

    await prefetchBestConnectionForYoungestSelectedCard(selectedPerson);

    expect(getFetchPathnames(fetchMock)).toEqual([
      "/3/search/movie",
      "/3/movie/20/credits",
    ]);
    expect(indexedDbMock.saveFilmRecord).toHaveBeenCalled();
    expect(indexedDbMock.saveFilmRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 20,
        tmdbId: 20,
        title: "Target Hit",
        year: "2001",
      }),
    );
  });

  it("no-ops for null and cinenerdle selections", async () => {
    await prefetchBestConnectionForYoungestSelectedCard(null);
    await prefetchBestConnectionForYoungestSelectedCard({
      key: "cinenerdle",
      kind: "cinenerdle",
      name: "cinenerdle",
      popularity: 0,
      popularitySource: null,
      imageUrl: null,
      subtitle: "",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      record: null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(indexedDbMock.saveFilmRecord).not.toHaveBeenCalled();
    expect(indexedDbMock.savePersonRecord).not.toHaveBeenCalled();
  });

  it("no-ops when the selected card is not yet cached locally", async () => {
    await prefetchBestConnectionForYoungestSelectedCard({
      key: "person:missing person",
      kind: "person",
      name: "Missing Person",
      popularity: 0,
      popularitySource: null,
      imageUrl: null,
      subtitle: "",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      record: null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(indexedDbMock.saveFilmRecord).not.toHaveBeenCalled();
    expect(indexedDbMock.savePersonRecord).not.toHaveBeenCalled();
  });

  it("no-ops when every direct connection is already cached", async () => {
    const selectedMovie = {
      key: "movie:heat:1995",
      kind: "movie" as const,
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
      record: makeFilmRecord({
        title: "Heat",
        year: "1995",
        rawTmdbMovieCreditsResponse: {
          cast: [
            makePersonCredit({
              id: 1,
              name: "Cached Person",
              popularity: 99,
            }),
          ],
          crew: [],
        },
      }),
    };

    indexedDbMock.getPersonRecordById.mockResolvedValue(
      makePersonRecord({ id: 1, tmdbId: 1, name: "Cached Person" }),
    );

    await prefetchBestConnectionForYoungestSelectedCard(selectedMovie);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(indexedDbMock.saveFilmRecord).not.toHaveBeenCalled();
    expect(indexedDbMock.savePersonRecord).not.toHaveBeenCalled();
  });
});

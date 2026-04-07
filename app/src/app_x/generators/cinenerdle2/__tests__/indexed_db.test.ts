import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isExcludedFilmRecord } from "../exclusion";
import type { IndexedDbSnapshotConnection, IndexedDbSnapshotPerson } from "../indexed_db";
import { makeFilmRecord, makeTmdbMovieSearchResult } from "./factories";

const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

type MockDeleteRequest = {
  error: Error | null;
  onblocked: null | (() => void);
  onerror: null | (() => void);
  onsuccess: null | (() => void);
};

function setMockWindow() {
  const getItem = vi.fn().mockReturnValue(null);
  const removeItem = vi.fn();
  const setItem = vi.fn();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem,
        removeItem,
        setItem,
      },
    },
  });

  return {
    getItem,
    removeItem,
    setItem,
  };
}

function createDeleteRequest(
  outcome: "success" | "error" | "blocked",
  errorMessage = "Unable to delete IndexedDB",
): MockDeleteRequest {
  const request: MockDeleteRequest = {
    error: outcome === "error" ? new Error(errorMessage) : null,
    onblocked: null,
    onerror: null,
    onsuccess: null,
  };

  queueMicrotask(() => {
    if (outcome === "success") {
      request.onsuccess?.();
      return;
    }

    if (outcome === "blocked") {
      request.onblocked?.();
      return;
    }

    request.onerror?.();
  });

  return request;
}

describe("deleteCinenerdleIndexedDbDatabase", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalIndexedDbDescriptor) {
      Object.defineProperty(globalThis, "indexedDB", originalIndexedDbDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }

    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("deletes the whole IndexedDB database and clears the ready marker", async () => {
    const deleteDatabase = vi.fn().mockImplementation(() => createDeleteRequest("success"));
    const { removeItem } = setMockWindow();

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        deleteDatabase,
      },
    });

    const { deleteCinenerdleIndexedDbDatabase } = await import("../indexed_db");

    await expect(deleteCinenerdleIndexedDbDatabase()).resolves.toBeUndefined();

    expect(deleteDatabase).toHaveBeenCalledTimes(1);
    expect(removeItem).toHaveBeenCalledWith(
      "cinenerdle:searchable-connection-entities-ready",
    );
  });

  it("surfaces blocked deletions with a user-actionable message", async () => {
    const deleteDatabase = vi.fn().mockImplementation(() => createDeleteRequest("blocked"));

    setMockWindow();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        deleteDatabase,
      },
    });

    const { deleteCinenerdleIndexedDbDatabase } = await import("../indexed_db");

    await expect(deleteCinenerdleIndexedDbDatabase()).rejects.toThrow(
      "IndexedDB deletion blocked. Close other tabs and try again.",
    );
  });

  it("surfaces delete errors from IndexedDB", async () => {
    const deleteDatabase = vi.fn().mockImplementation(() =>
      createDeleteRequest("error", "Delete failed"),
    );

    setMockWindow();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        deleteDatabase,
      },
    });

    const { deleteCinenerdleIndexedDbDatabase } = await import("../indexed_db");

    await expect(deleteCinenerdleIndexedDbDatabase()).rejects.toThrow("Delete failed");
  });
});

describe("IndexedDB snapshot film genre preservation", () => {
  it("stores direct-film genres in snapshots and preserves exclusion after inflation", async () => {
    const { createStoredFilmRecord, inflateIndexedDbSnapshot } = await import("../indexed_db");
    const filmRecord = makeFilmRecord({
      id: 670431,
      tmdbId: 670431,
      title: "Normandy: The Great Crusade",
      year: "1994",
      fetchTimestamp: "2026-04-01T16:00:00.000Z",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 670431,
        title: "Normandy: The Great Crusade",
        original_title: "Normandy: The Great Crusade",
        poster_path: "/nQ0CIlWL1qA4pD6Om4peiGv8SvY.jpg",
        release_date: "1994-01-01",
        popularity: 0.8187,
        vote_average: 10,
        vote_count: 1,
        genres: [
          { id: 99, name: "Documentary" },
          { id: 36, name: "History" },
        ],
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
      personConnectionKeys: [],
      tmdbSource: "direct-film-fetch",
    });

    const storedFilm = createStoredFilmRecord(filmRecord);

    expect(storedFilm.genreIds).toEqual([99, 36]);
    expect(storedFilm.fromTmdb).toEqual({
      fetchTimestamp: "2026-04-01T16:00:00.000Z",
      genres: [
        { id: 99, name: "Documentary" },
        { id: 36, name: "History" },
      ],
    });

    const inflatedSnapshot = inflateIndexedDbSnapshot({
      format: "cinenerdle-indexed-db-snapshot",
      version: 12,
      people: [],
      films: [storedFilm],
    });

    expect(inflatedSnapshot.films[0]?.genreIds).toEqual([99, 36]);
    expect(inflatedSnapshot.films[0]?.rawTmdbMovie?.genres).toEqual([
      { id: 99, name: "Documentary" },
      { id: 36, name: "History" },
    ]);
    expect(isExcludedFilmRecord(inflatedSnapshot.films[0])).toBe(true);
  });

  it("keeps excluded documentary movies out of searchable connection entities", async () => {
    const { createStoredFilmRecord, inflateIndexedDbSnapshot } = await import("../indexed_db");
    const documentaryFilm = makeFilmRecord({
      id: 27007,
      tmdbId: 27007,
      title: "Overnight",
      year: "2003",
      fetchTimestamp: "2026-04-01T16:00:00.000Z",
      genreIds: [99],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 27007,
        title: "Overnight",
        original_title: "Overnight",
        release_date: "2003-06-12",
        genres: [{ id: 99, name: "Documentary" }],
      }),
      tmdbSource: "direct-film-fetch",
    });
    const allowedFilm = makeFilmRecord({
      id: 12,
      tmdbId: 12,
      title: "Finding Nemo",
      year: "2003",
      fetchTimestamp: "2026-04-01T16:00:00.000Z",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 12,
        title: "Finding Nemo",
        original_title: "Finding Nemo",
        release_date: "2003-05-30",
        genres: [{ id: 16, name: "Animation" }],
      }),
      tmdbSource: "direct-film-fetch",
    });

    const inflatedSnapshot = inflateIndexedDbSnapshot({
      format: "cinenerdle-indexed-db-snapshot",
      version: 12,
      people: [],
      films: [
        createStoredFilmRecord(documentaryFilm),
        createStoredFilmRecord(allowedFilm),
      ],
    });

    expect(inflatedSnapshot.searchableConnectionEntities).toEqual([
      expect.objectContaining({
        key: "movie:finding nemo:2003",
        type: "movie",
      }),
    ]);
  });

  it("keeps non-documentary movies with empty genreIds in searchable connection entities", async () => {
    const { createStoredFilmRecord, inflateIndexedDbSnapshot } = await import("../indexed_db");
    const allowedSparseFilm = makeFilmRecord({
      id: 27007,
      tmdbId: 27007,
      title: "Overnight",
      year: "2003",
      fetchTimestamp: "2026-04-01T16:00:00.000Z",
      genreIds: [],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 27007,
        title: "Overnight",
        original_title: "Overnight",
        release_date: "2003-06-12",
        genres: [],
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
      tmdbSource: "direct-film-fetch",
    });
    const allowedFilm = makeFilmRecord({
      id: 12,
      tmdbId: 12,
      title: "Finding Nemo",
      year: "2003",
      fetchTimestamp: "2026-04-01T16:00:00.000Z",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 12,
        title: "Finding Nemo",
        original_title: "Finding Nemo",
        release_date: "2003-05-30",
        genres: [{ id: 16, name: "Animation" }],
      }),
      tmdbSource: "direct-film-fetch",
    });

    const inflatedSnapshot = inflateIndexedDbSnapshot({
      format: "cinenerdle-indexed-db-snapshot",
      version: 12,
      people: [],
      films: [
        createStoredFilmRecord(allowedSparseFilm),
        createStoredFilmRecord(allowedFilm),
      ],
    });

    expect(inflatedSnapshot.searchableConnectionEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "movie:overnight:2003",
          type: "movie",
        }),
        expect.objectContaining({
          key: "movie:finding nemo:2003",
          type: "movie",
        }),
      ]),
    );
  });

  it("rehydrates connection-derived movie credits with genre_ids", async () => {
    const { createStoredFilmRecord, inflateIndexedDbSnapshot } = await import("../indexed_db");
    const documentaryFilm = makeFilmRecord({
      id: 27007,
      tmdbId: 27007,
      title: "Overnight",
      year: "2003",
      genreIds: [99],
      personConnectionKeys: [5293],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 27007,
        title: "Overnight",
        original_title: "Overnight",
        release_date: "2003-06-12",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
      tmdbSource: "connection-derived",
    });
    const personSnapshot: IndexedDbSnapshotPerson = {
      tmdbId: 5293,
      name: "Willem Dafoe",
      movieConnectionKeys: [32082],
      popularity: 4.4078,
      fromTmdb: null,
    };
    const storedFilm = {
      ...createStoredFilmRecord(documentaryFilm),
      people: [
        {
          fetchTimestamp: "2026-04-01T16:00:00.000Z",
          personTmdbId: 5293,
          profilePath: null,
          roleType: "cast",
          role: "Self",
          order: 0,
        },
      ] as IndexedDbSnapshotConnection[],
    };

    const inflatedSnapshot = inflateIndexedDbSnapshot({
      format: "cinenerdle-indexed-db-snapshot",
      version: 12,
      people: [personSnapshot],
      films: [storedFilm],
    });

    expect(
      inflatedSnapshot.people[0]?.rawTmdbMovieCreditsResponse?.cast?.[0]?.genre_ids,
    ).toEqual([99]);
  });

  it("keeps documentary connection-derived movies out of searchable connection entities", async () => {
    const { createStoredFilmRecord, inflateIndexedDbSnapshot } = await import("../indexed_db");
    const excludedConnectionDerivedFilm = makeFilmRecord({
      id: 27007,
      tmdbId: 27007,
      title: "Overnight",
      year: "2003",
      genreIds: [99],
      personConnectionKeys: [5293],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 27007,
        title: "Overnight",
        original_title: "Overnight",
        release_date: "2003-06-12",
      }),
      tmdbSource: "connection-derived",
    });
    const allowedFilm = makeFilmRecord({
      id: 12,
      tmdbId: 12,
      title: "Finding Nemo",
      year: "2003",
      fetchTimestamp: "2026-04-01T16:00:00.000Z",
      genreIds: [16],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 12,
        title: "Finding Nemo",
        original_title: "Finding Nemo",
        release_date: "2003-05-30",
        genres: [{ id: 16, name: "Animation" }],
      }),
      tmdbSource: "direct-film-fetch",
    });

    const inflatedSnapshot = inflateIndexedDbSnapshot({
      format: "cinenerdle-indexed-db-snapshot",
      version: 12,
      people: [],
      films: [
        createStoredFilmRecord(excludedConnectionDerivedFilm),
        createStoredFilmRecord(allowedFilm),
      ],
    });

    expect(inflatedSnapshot.searchableConnectionEntities).toEqual([
      expect.objectContaining({
        key: "movie:finding nemo:2003",
        type: "movie",
      }),
    ]);
  });
});

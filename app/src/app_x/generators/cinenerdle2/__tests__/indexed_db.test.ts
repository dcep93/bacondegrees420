import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isExcludedFilmRecord } from "../exclusion";
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

    expect(storedFilm.fromTmdb).toEqual({
      fetchTimestamp: "2026-04-01T16:00:00.000Z",
      genres: [
        { id: 99, name: "Documentary" },
        { id: 36, name: "History" },
      ],
    });

    const inflatedSnapshot = inflateIndexedDbSnapshot({
      format: "cinenerdle-indexed-db-snapshot",
      version: 10,
      people: [],
      films: [storedFilm],
    });

    expect(inflatedSnapshot.films[0]?.rawTmdbMovie?.genres).toEqual([
      { id: 99, name: "Documentary" },
      { id: 36, name: "History" },
    ]);
    expect(isExcludedFilmRecord(inflatedSnapshot.films[0])).toBe(true);
  });
});

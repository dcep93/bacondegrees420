import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAssociatedPeopleFromMovieCredits, getAssociatedMoviesFromPersonCredits } from "../utils";
import { isExcludedFilmRecord } from "../exclusion";
import type {
  IndexedDbSnapshot,
  IndexedDbSnapshotConnection,
  IndexedDbSnapshotPerson,
} from "../indexed_db";
import { makeFilmRecord, makePersonRecord, makeTmdbMovieSearchResult, makeTmdbPersonSearchResult } from "./factories";

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
  it("sorts numeric arrays when stringifying snapshots", async () => {
    const { stringifyIndexedDbSnapshot } = await import("../indexed_db");
    const snapshot: IndexedDbSnapshot = {
      format: "cinenerdle-indexed-db-snapshot",
      version: 13,
      people: [{
        tmdbId: 18,
        name: "John Doe",
        movieConnectionKeys: [122, 5, 38, 38, 12],
        popularity: 1,
        fromTmdb: null,
      }],
      films: [{
        tmdbId: 7,
        title: "Se7en",
        year: "1995",
        posterPath: null,
        popularity: 1,
        genreIds: [80, 18, 9648],
        voteAverage: null,
        voteCount: null,
        releaseDate: "1995-09-22",
        fromTmdb: null,
        personConnectionKeys: [5293, 18, 95, 18],
        people: [
          {
            fetchTimestamp: "2026-04-01T16:00:00.000Z",
            personTmdbId: 5293,
            profilePath: null,
            roleType: "cast",
            role: "Detective Lt. William Somerset",
            order: 1,
          },
          {
            fetchTimestamp: "2026-04-01T16:00:00.000Z",
            personTmdbId: 95,
            profilePath: null,
            roleType: "cast",
            role: "Detective David Mills",
            order: 0,
          },
        ],
      }],
    };

    const stringifiedSnapshot = stringifyIndexedDbSnapshot(snapshot);
    const parsedSnapshot = JSON.parse(stringifiedSnapshot) as IndexedDbSnapshot;

    expect(parsedSnapshot.people[0]?.movieConnectionKeys).toEqual([5, 12, 38, 38, 122]);
    expect(parsedSnapshot.films[0]?.genreIds).toEqual([18, 80, 9648]);
    expect(parsedSnapshot.films[0]?.personConnectionKeys).toEqual([18, 18, 95, 5293]);
    expect(parsedSnapshot.films[0]?.people.map((connection) => connection.personTmdbId)).toEqual([
      5293,
      95,
    ]);
    expect(snapshot.people[0]?.movieConnectionKeys).toEqual([122, 5, 38, 38, 12]);
    expect(snapshot.films[0]?.personConnectionKeys).toEqual([5293, 18, 95, 18]);
  });

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
      runtime: null,
    });

    const inflatedSnapshot = inflateIndexedDbSnapshot({
      format: "cinenerdle-indexed-db-snapshot",
      version: 13,
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

  it("round-trips direct-film runtime through snapshots", async () => {
    const { createStoredFilmRecord, inflateIndexedDbSnapshot } = await import("../indexed_db");
    const filmRecord = makeFilmRecord({
      id: 514754,
      tmdbId: 514754,
      title: "Bao",
      year: "2018",
      fetchTimestamp: "2026-04-01T16:00:00.000Z",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 514754,
        title: "Bao",
        original_title: "Bao",
        poster_path: "/bao.jpg",
        release_date: "2018-06-15",
        runtime: 8,
        genres: [{ id: 16, name: "Animation" }],
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
      tmdbSource: "direct-film-fetch",
    });

    const storedFilm = createStoredFilmRecord(filmRecord);

    expect(storedFilm.fromTmdb).toEqual({
      fetchTimestamp: "2026-04-01T16:00:00.000Z",
      genres: [{ id: 16, name: "Animation" }],
      runtime: 8,
    });

    const inflatedSnapshot = inflateIndexedDbSnapshot({
      format: "cinenerdle-indexed-db-snapshot",
      version: 13,
      people: [],
      films: [storedFilm],
    });

    expect(inflatedSnapshot.films[0]?.rawTmdbMovie?.runtime).toBe(8);
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
      version: 13,
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
      version: 13,
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
      version: 13,
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
      version: 13,
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

  it("keeps music-only connection-derived movies out of searchable connection entities when they come from person credits", async () => {
    const { createStoredFilmRecord, inflateIndexedDbSnapshot } = await import("../indexed_db");
    const excludedMusicFilm = makeFilmRecord({
      id: 838773,
      tmdbId: 838773,
      title: "Hate to See You Go",
      year: "",
      genreIds: [10402],
      personConnectionKeys: [192],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 838773,
        title: "Hate to See You Go",
        original_title: "Hate to See You Go",
        release_date: "",
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
    const personSnapshot: IndexedDbSnapshotPerson = {
      tmdbId: 192,
      name: "Morgan Freeman",
      movieConnectionKeys: [838773],
      popularity: 10,
      fromTmdb: null,
    };
    const storedMusicFilm = {
      ...createStoredFilmRecord(excludedMusicFilm),
      people: [
        {
          fetchTimestamp: "2026-04-01T16:00:00.000Z",
          personTmdbId: 192,
          profilePath: null,
          roleType: "cast",
          role: "Sonny Bell",
          order: 0,
        },
      ] as IndexedDbSnapshotConnection[],
    };

    const inflatedSnapshot = inflateIndexedDbSnapshot({
      format: "cinenerdle-indexed-db-snapshot",
      version: 13,
      people: [personSnapshot],
      films: [
        storedMusicFilm,
        createStoredFilmRecord(allowedFilm),
      ],
    });

    expect(inflatedSnapshot.searchableConnectionEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "person:192",
          type: "person",
        }),
        expect.objectContaining({
          key: "movie:finding nemo:2003",
          type: "movie",
        }),
      ]),
    );
    expect(inflatedSnapshot.searchableConnectionEntities).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "movie:hate to see you go:",
          type: "movie",
        }),
      ]),
    );
  });
});


describe("browser cache credit-order preservation", () => {
  it("preserves cast/crew queues, missing order, all roles and parent popularity on reload", async () => {
    const { createStoredFilmRecord, createStoredPersonRecord, inflateStoredCoreSnapshot } = await import("../indexed_db");
    const film = makeFilmRecord({
      id: 9016, tmdbId: 9016, title: "Queue round trip", year: "2002",
      fetchTimestamp: "2026-10-03T12:00:00Z",
      rawTmdbMovieCreditsResponse: {
        cast: [
          { id: 1, name: "Cast Head", order: 0, popularity: 80, character: "Lead" },
          { id: 2, name: "Cast Second", order: 1, popularity: 60 },
        ],
        crew: [
          { id: 3, name: "Crew Head", popularity: 50, job: "Director" },
          { id: 4, name: "Crew High", popularity: 90, job: "Screenplay" },
          { id: 3, name: "Crew Head", popularity: 50, job: "Story" },
          { id: 5, name: "Other Crew", popularity: 100, job: "Editor" },
        ],
      },
    });
    const people = ["Cast Head", "Cast Second", "Crew Head", "Crew High", "Other Crew"].map((name, index) =>
      createStoredPersonRecord(makePersonRecord({
        id: index + 1, tmdbId: index + 1, name,
        fetchTimestamp: "2026-10-03T12:00:00Z",
        rawTmdbPerson: makeTmdbPersonSearchResult({ id: index + 1, name, popularity: 999 }),
      })));
    const stored = structuredClone({ people, films: [createStoredFilmRecord(film)] });
    const reloaded = inflateStoredCoreSnapshot(stored).films[0];

    expect(reloaded.rawTmdbMovieCreditsResponse).toEqual(film.rawTmdbMovieCreditsResponse);
    expect(reloaded.rawTmdbMovieCreditsResponse?.crew?.[0].order).toBeUndefined();
    expect(getAssociatedPeopleFromMovieCredits(reloaded).map((credit) => credit.id))
      .toEqual(getAssociatedPeopleFromMovieCredits(film).map((credit) => credit.id));
    const savedAgain = { ...stored, films: [createStoredFilmRecord(reloaded)] };
    expect(inflateStoredCoreSnapshot(structuredClone(savedAgain)).films[0].rawTmdbMovieCreditsResponse)
      .toEqual(film.rawTmdbMovieCreditsResponse);
  });

  it("preserves the person's movie credit queues independently of film-store order", async () => {
    const { createStoredPersonRecord, inflateStoredCoreSnapshot } = await import("../indexed_db");
    const person = makePersonRecord({
      id: 102, tmdbId: 102, name: "John Musker",
      rawTmdbMovieCreditsResponse: {
        cast: [
          { id: 90, title: "First cast", popularity: 80 },
          { id: 10, title: "Second cast", popularity: 60 },
        ],
        crew: [
          { id: 70, title: "First crew", popularity: 50, job: "Director" },
          { id: 30, title: "Popular crew", popularity: 90, job: "Screenplay" },
          { id: 70, title: "First crew", popularity: 50, job: "Screenplay" },
        ],
      },
    });
    const stored = structuredClone({ people: [createStoredPersonRecord(person)], films: [] });
    const reloaded = inflateStoredCoreSnapshot(stored).people[0];
    expect(reloaded.rawTmdbMovieCreditsResponse).toEqual(person.rawTmdbMovieCreditsResponse);
    expect(getAssociatedMoviesFromPersonCredits(reloaded).map((credit) => credit.id))
      .toEqual(getAssociatedMoviesFromPersonCredits(person).map((credit) => credit.id));
  });

  it("distinguishes absent credits from an empty response and rejects legacy cache rows", async () => {
    const { createStoredFilmRecord, createStoredPersonRecord, inflateStoredCoreSnapshot } = await import("../indexed_db");
    const film = createStoredFilmRecord(makeFilmRecord({ rawTmdbMovieCreditsResponse: undefined }));
    const person = createStoredPersonRecord(makePersonRecord({ rawTmdbMovieCreditsResponse: { cast: [], crew: [] } }));
    const reloaded = inflateStoredCoreSnapshot({ people: [person], films: [film] });
    expect(film.sourceCredits).toBeNull();
    expect(reloaded.films[0].rawTmdbMovieCreditsResponse).toBeUndefined();
    expect(reloaded.people[0].rawTmdbMovieCreditsResponse).toEqual({ cast: [], crew: [] });
    const legacy = { ...film };
    Reflect.deleteProperty(legacy, "sourceCredits");
    expect(() => inflateStoredCoreSnapshot({ people: [], films: [legacy] }))
      .toThrow("IndexedDB record is missing source credits");
  });
});

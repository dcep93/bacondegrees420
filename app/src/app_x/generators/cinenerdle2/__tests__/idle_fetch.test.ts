import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const indexedDbMock = vi.hoisted(() => ({
  getAllSearchableConnectionEntities: vi.fn(),
  getFilmRecordById: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getIndexedDbSnapshot: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordByName: vi.fn(),
  inflateIndexedDbSnapshot: vi.fn(),
}));

const connectionGraphMock = vi.hoisted(() => ({
  getMovieConnectionEntityKey: vi.fn((title: string, year = "") => `movie:${title}:${year}`),
  getPersonConnectionEntityKey: vi.fn((name: string, tmdbId?: number | string | null) =>
    `person:${tmdbId ?? name}`,
  ),
  hydrateConnectionEntityFromSearchRecord: vi.fn(),
}));

const tmdbMock = vi.hoisted(() => ({
  fetchAndCacheMovie: vi.fn(),
  fetchAndCacheMovieCredits: vi.fn(),
  fetchAndCachePerson: vi.fn(),
}));

vi.mock("../indexed_db", () => indexedDbMock);
vi.mock("../connection_graph", () => connectionGraphMock);
vi.mock("../tmdb", () => tmdbMock);

import { startIdleFetch } from "../idle_fetch";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("startIdleFetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    if (!originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: globalThis,
      });
    }

    indexedDbMock.getAllSearchableConnectionEntities.mockReset();
    indexedDbMock.getFilmRecordById.mockReset();
    indexedDbMock.getFilmRecordByTitleAndYear.mockReset();
    indexedDbMock.getIndexedDbSnapshot.mockReset();
    indexedDbMock.getPersonRecordById.mockReset();
    indexedDbMock.getPersonRecordByName.mockReset();
    indexedDbMock.inflateIndexedDbSnapshot.mockReset();

    connectionGraphMock.getMovieConnectionEntityKey.mockClear();
    connectionGraphMock.getPersonConnectionEntityKey.mockClear();
    connectionGraphMock.hydrateConnectionEntityFromSearchRecord.mockReset();

    tmdbMock.fetchAndCacheMovie.mockReset();
    tmdbMock.fetchAndCacheMovieCredits.mockReset();
    tmdbMock.fetchAndCachePerson.mockReset();

    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    tmdbMock.fetchAndCacheMovie.mockResolvedValue({ id: 1 });
    tmdbMock.fetchAndCacheMovieCredits.mockResolvedValue({ id: 1 });
    tmdbMock.fetchAndCachePerson.mockResolvedValue({ id: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleLogSpy.mockClear();

    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("processes the highest-popularity person and movie in the same tick", async () => {
    const searchRecords = [
      {
        key: "movie:low:2000",
        type: "movie" as const,
        nameLower: "low (2000)",
        popularity: 1,
      },
      {
        key: "movie:top-movie:2001",
        type: "movie" as const,
        nameLower: "top movie (2001)",
        popularity: 9,
      },
      {
        key: "person:low",
        type: "person" as const,
        nameLower: "low person",
        popularity: 2,
      },
      {
        key: "person:high",
        type: "person" as const,
        nameLower: "high person",
        popularity: 10,
      },
    ];

    indexedDbMock.getIndexedDbSnapshot.mockResolvedValue({});
    indexedDbMock.inflateIndexedDbSnapshot.mockReturnValue({
      people: [],
      films: [],
      searchableConnectionEntities: searchRecords,
    });
    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue(searchRecords);
    connectionGraphMock.hydrateConnectionEntityFromSearchRecord.mockImplementation(
      (searchRecord: { key: string; type: "movie" | "person" }) =>
        Promise.resolve(
          searchRecord.type === "person"
            ? {
                key: searchRecord.key,
                kind: "person",
                name: searchRecord.key === "person:high" ? "High Person" : "Low Person",
                year: "",
                tmdbId: null,
              }
            : {
                key: searchRecord.key,
                kind: "movie",
                name: searchRecord.key === "movie:top-movie:2001" ? "Top Movie" : "Low",
                year: searchRecord.key === "movie:top-movie:2001" ? "2001" : "2000",
                tmdbId: null,
              },
        ),
    );

    const handle = startIdleFetch();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(tmdbMock.fetchAndCachePerson).toHaveBeenCalledWith(
      "High Person",
      "prefetch",
      null,
    );
    expect(tmdbMock.fetchAndCacheMovie).toHaveBeenCalledWith(
      "Top Movie",
      "2001",
      "prefetch",
      null,
    );
    expect(tmdbMock.fetchAndCachePerson).not.toHaveBeenCalledWith(
      "Low Person",
      "prefetch",
      null,
    );
    expect(tmdbMock.fetchAndCacheMovie).not.toHaveBeenCalledWith(
      "Low",
      "2000",
      "prefetch",
      null,
    );

    handle.stop();
  });

  it("merges newly discovered records into the person and movie queues", async () => {
    const initialSearchRecords = [
      {
        key: "movie:starter:2001",
        type: "movie" as const,
        nameLower: "starter (2001)",
        popularity: 5,
      },
      {
        key: "person:starter-person",
        type: "person" as const,
        nameLower: "starter person",
        popularity: 4,
      },
    ];
    const mergedSearchRecords = [
      ...initialSearchRecords,
      {
        key: "person:new-person",
        type: "person" as const,
        nameLower: "new person",
        popularity: 20,
      },
      {
        key: "movie:new-movie:2005",
        type: "movie" as const,
        nameLower: "new movie (2005)",
        popularity: 18,
      },
    ];

    indexedDbMock.getIndexedDbSnapshot.mockResolvedValue({});
    indexedDbMock.inflateIndexedDbSnapshot.mockReturnValue({
      people: [],
      films: [],
      searchableConnectionEntities: initialSearchRecords,
    });
    indexedDbMock.getAllSearchableConnectionEntities
      .mockResolvedValueOnce(mergedSearchRecords)
      .mockResolvedValue(mergedSearchRecords);
    connectionGraphMock.hydrateConnectionEntityFromSearchRecord.mockImplementation(
      (searchRecord: { key: string; type: "movie" | "person" }) =>
        Promise.resolve(
          searchRecord.type === "person"
            ? {
                key: searchRecord.key,
                kind: "person",
                name: searchRecord.key === "person:new-person" ? "New Person" : "Starter Person",
                year: "",
                tmdbId: null,
              }
            : {
                key: searchRecord.key,
                kind: "movie",
                name: searchRecord.key === "movie:new-movie:2005" ? "New Movie" : "Starter",
                year: searchRecord.key === "movie:new-movie:2005" ? "2005" : "2001",
                tmdbId: null,
              },
        ),
    );

    const handle = startIdleFetch();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(tmdbMock.fetchAndCacheMovie).toHaveBeenCalledWith(
      "Starter",
      "2001",
      "prefetch",
      null,
    );
    expect(tmdbMock.fetchAndCachePerson).toHaveBeenCalledWith(
      "Starter Person",
      "prefetch",
      null,
    );

    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(tmdbMock.fetchAndCachePerson).toHaveBeenCalledWith(
      "New Person",
      "prefetch",
      null,
    );
    expect(tmdbMock.fetchAndCacheMovie).toHaveBeenCalledWith(
      "New Movie",
      "2005",
      "prefetch",
      null,
    );

    handle.stop();
  });
});

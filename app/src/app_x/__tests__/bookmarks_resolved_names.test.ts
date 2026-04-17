import { beforeEach, describe, expect, it, vi } from "vitest";

const indexedDbMock = vi.hoisted(() => ({
  getAllFilmRecords: vi.fn(),
  getAllPersonRecords: vi.fn(),
  getFilmRecordById: vi.fn(),
  getPersonRecordById: vi.fn(),
}));

vi.mock("../generators/cinenerdle2/indexed_db", async () => {
  const actual = await vi.importActual("../generators/cinenerdle2/indexed_db");
  return {
    ...actual,
    ...indexedDbMock,
  };
});

import {
  serializeBookmarksAsJsonlWithResolvedNames,
  type BookmarkEntry,
} from "../bookmarks";
import { createPathNode, serializePathNodes } from "../generators/cinenerdle2/hash";
import { clearCinenerdleDebugLog } from "../generators/cinenerdle2/debug";

describe("serializeBookmarksAsJsonlWithResolvedNames", () => {
  beforeEach(() => {
    clearCinenerdleDebugLog();
    indexedDbMock.getAllFilmRecords.mockReset();
    indexedDbMock.getAllPersonRecords.mockReset();
    indexedDbMock.getFilmRecordById.mockReset();
    indexedDbMock.getPersonRecordById.mockReset();
    indexedDbMock.getAllFilmRecords.mockResolvedValue([]);
    indexedDbMock.getAllPersonRecords.mockResolvedValue([]);
    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);

    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        clear: () => {
          storage.clear();
        },
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => {
          storage.delete(key);
        },
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
  });

  it("resolves orphan attr row names from indexed db ids", async () => {
    const hash = serializePathNodes([
      createPathNode("person", "James Remar", "", 4724),
    ]);

    localStorage.setItem(
      "bacondegrees420.cinenerdle-item-attrs.v1",
      JSON.stringify({
        film: {
          "9023": ["🐴"],
        },
        person: {
          "6008": ["🟡"],
        },
      }),
    );

    indexedDbMock.getFilmRecordById.mockImplementation(async (id: number | string) =>
      String(id) === "9023" ? { title: "What Lies Beneath" } : null,
    );
    indexedDbMock.getPersonRecordById.mockImplementation(async (id: number | string) =>
      String(id) === "6008" ? { name: "David Patrick Kelly" } : null,
    );

    await expect(serializeBookmarksAsJsonlWithResolvedNames(
      [{ hash }] satisfies BookmarkEntry[],
      [],
    )).resolves.toBe([
      hash,
      "9023:film:What Lies Beneath 🐴",
      "6008:person:David Patrick Kelly 🟡",
    ].join("\n"));
  });

  it("resolves orphan attr row names from cached credits when direct records are missing", async () => {
    const hash = serializePathNodes([
      createPathNode("movie", "The Warriors", "1979"),
    ]);

    localStorage.setItem(
      "bacondegrees420.cinenerdle-item-attrs.v1",
      JSON.stringify({
        film: {
          "318177": ["0"],
        },
        person: {
          "4724": ["🥓"],
        },
      }),
    );

    indexedDbMock.getAllPersonRecords.mockResolvedValue([
      {
        rawTmdbMovieCreditsResponse: {
          cast: [
            {
              id: 318177,
              title: "A Boy Called Sailboat",
              release_date: "2018-04-29",
              order: 0,
            },
          ],
          crew: [],
        },
      },
    ]);
    indexedDbMock.getAllFilmRecords.mockResolvedValue([
      {
        rawTmdbMovieCreditsResponse: {
          cast: [
            {
              id: 4724,
              name: "James Remar",
              order: 0,
            },
          ],
          crew: [],
        },
      },
    ]);

    await expect(serializeBookmarksAsJsonlWithResolvedNames(
      [{ hash }] satisfies BookmarkEntry[],
      [],
    )).resolves.toBe([
      hash,
      "318177:film:A Boy Called Sailboat 0",
      "4724:person:James Remar 🥓",
    ].join("\n"));
  });
});

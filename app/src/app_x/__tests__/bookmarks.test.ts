import { beforeEach, describe, expect, it, vi } from "vitest";

const indexedDbMocks = vi.hoisted(() => {
  const persistedHashes: string[] = [];

  return {
    getPersistedBookmarkHashes: vi.fn(async () => [...persistedHashes]),
    persistedHashes,
    replacePersistedBookmarkHashes: vi.fn(async (hashes: string[]) => {
      persistedHashes.splice(0, persistedHashes.length, ...hashes);
      return [...persistedHashes];
    }),
  };
});

vi.mock("../generators/cinenerdle2/indexed_db", () => ({
  getPersistedBookmarkHashes: indexedDbMocks.getPersistedBookmarkHashes,
  replacePersistedBookmarkHashes: indexedDbMocks.replacePersistedBookmarkHashes,
}));

import {
  BOOKMARKS_STORAGE_KEY,
  loadBookmarks,
  mergeMissingBookmarks,
  parseBookmarksJsonl,
  replaceBookmarks,
  saveBookmarks,
  serializeBookmarksAsJsonl,
  type BookmarkEntry,
} from "../bookmarks";
import { createPathNode, serializePathNodes } from "../generators/cinenerdle2/hash";

const MATRIX_HASH = serializePathNodes([
  createPathNode("movie", "The Matrix", "1999"),
]);
const KEANU_HASH = serializePathNodes([
  createPathNode("person", "Keanu Reeves"),
]);

function createBookmark(hash: string): BookmarkEntry {
  return { hash };
}

describe("bookmarks", () => {
  beforeEach(() => {
    indexedDbMocks.persistedHashes.splice(0, indexedDbMocks.persistedHashes.length);
    indexedDbMocks.getPersistedBookmarkHashes.mockClear();
    indexedDbMocks.replacePersistedBookmarkHashes.mockClear();

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

  it("loads bookmarks from indexeddb when persisted hashes are present", async () => {
    indexedDbMocks.persistedHashes.push(MATRIX_HASH, KEANU_HASH);

    await expect(loadBookmarks()).resolves.toEqual([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]);
    expect(indexedDbMocks.replacePersistedBookmarkHashes).not.toHaveBeenCalled();
  });

  it("migrates legacy localStorage bookmarks into indexeddb hashes", async () => {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify([
      {
        hash: "film|The Matrix (1999)",
        previewCards: [{ kind: "movie", name: "The Matrix" }],
      },
      {
        hash: KEANU_HASH,
      },
      {
        hash: "film|The Matrix (1999)",
      },
    ]));

    await expect(loadBookmarks()).resolves.toEqual([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]);
    expect(indexedDbMocks.replacePersistedBookmarkHashes).toHaveBeenCalledWith([
      MATRIX_HASH,
      KEANU_HASH,
    ]);
    expect(localStorage.getItem(BOOKMARKS_STORAGE_KEY)).toBeNull();
  });

  it("merges only missing bookmarks by normalized hash", () => {
    expect(mergeMissingBookmarks(
      [createBookmark(MATRIX_HASH)],
      [
        createBookmark("film|The Matrix (1999)"),
        createBookmark(KEANU_HASH),
      ],
    )).toEqual([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]);
  });

  it("normalizes and persists bookmark hashes when saving", async () => {
    await expect(saveBookmarks([
      createBookmark("film|The Matrix (1999)"),
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ])).resolves.toEqual([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]);

    expect(indexedDbMocks.persistedHashes).toEqual([
      MATRIX_HASH,
      KEANU_HASH,
    ]);
  });

  it("serializes bookmarks as one hash per line", () => {
    expect(serializeBookmarksAsJsonl([
      createBookmark("film|The Matrix (1999)"),
      createBookmark(KEANU_HASH),
    ])).toBe([
      MATRIX_HASH,
      KEANU_HASH,
    ].join("\n"));
  });

  it("parses valid jsonl bookmark hashes and ignores blank lines", () => {
    expect(parseBookmarksJsonl(`\n${MATRIX_HASH}\n\n${KEANU_HASH}\n`)).toEqual([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]);
  });

  it("rejects invalid jsonl bookmark hashes", () => {
    expect(() => parseBookmarksJsonl("{")).toThrowError(
      "Bookmark JSONL line 1 is not a valid hash",
    );
  });

  it("rejects duplicate jsonl bookmark hashes after normalization", () => {
    expect(() => parseBookmarksJsonl([
      MATRIX_HASH,
      "film|The Matrix (1999)",
    ].join("\n"))).toThrowError(
      "Bookmark JSONL line 2 is a duplicate hash",
    );
  });

  it("replaces bookmarks with normalized persisted entries", async () => {
    await expect(replaceBookmarks([
      createBookmark("film|The Matrix (1999)"),
      createBookmark(KEANU_HASH),
    ])).resolves.toEqual([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]);

    expect(indexedDbMocks.persistedHashes).toEqual([
      MATRIX_HASH,
      KEANU_HASH,
    ]);
  });
});

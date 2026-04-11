import { beforeEach, describe, expect, it } from "vitest";

import {
  BOOKMARKS_STORAGE_KEY,
  loadBookmarks,
  mergeMissingBookmarks,
  parseBookmarksJsonl,
  parseBookmarksJsonlWithItemAttrs,
  replaceBookmarks,
  saveBookmarks,
  serializeBookmarksAsJsonl,
  type BookmarkEntry,
} from "../bookmarks";
import type { BookmarkRowData } from "../bookmark_rows";
import { createPathNode, serializePathNodes } from "../generators/cinenerdle2/hash";
import { CINENERDLE_ITEM_ATTRS_STORAGE_KEY } from "../generators/cinenerdle2/item_attrs";

const MATRIX_HASH = serializePathNodes([
  createPathNode("movie", "The Matrix", "1999"),
]);
const KEANU_HASH = serializePathNodes([
  createPathNode("person", "Keanu Reeves"),
]);

function createBookmark(hash: string): BookmarkEntry {
  return { hash };
}

function createBookmarkRow(hash: string, cards: Array<{
  key: string;
  kind: "movie" | "person";
  name: string;
}>): BookmarkRowData {
  return {
    hash,
    cards: cards.map((card) => ({
      kind: "card" as const,
      key: `${hash}:${card.key}`,
      card: {
        ...card,
      },
    })),
  } as unknown as BookmarkRowData;
}

describe("bookmarks", () => {
  beforeEach(() => {
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

  it("loads bookmarks from localStorage when persisted hashes are present", async () => {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]));

    await expect(loadBookmarks()).resolves.toEqual([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]);
  });

  it("normalizes legacy localStorage bookmark shapes when loading", async () => {
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

    expect(JSON.parse(localStorage.getItem(BOOKMARKS_STORAGE_KEY) ?? "[]")).toEqual([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]);
  });

  it("serializes bookmarks as one hash per line when no attrs are present", () => {
    expect(serializeBookmarksAsJsonl([
      createBookmark("film|The Matrix (1999)"),
      createBookmark(KEANU_HASH),
    ])).toBe([
      MATRIX_HASH,
      KEANU_HASH,
    ].join("\n"));
  });

  it("serializes bookmark item attrs as standalone rows after bookmark rows", () => {
    localStorage.setItem(
      CINENERDLE_ITEM_ATTRS_STORAGE_KEY,
      JSON.stringify({
        film: {
          "603": ["🔥", "⭐"],
        },
        person: {
          "1158": ["🎭"],
        },
      }),
    );

    expect(serializeBookmarksAsJsonl(
      [createBookmark(MATRIX_HASH)],
      [
        createBookmarkRow(MATRIX_HASH, [
          {
            key: "movie:603",
            kind: "movie",
            name: "The Matrix",
          },
          {
            key: "person:1158",
            kind: "person",
            name: "Keanu Reeves",
          },
        ]),
      ],
    )).toBe([
      MATRIX_HASH,
      "603:film:The Matrix 🔥⭐",
      "1158:person:Keanu Reeves 🎭",
    ].join("\n"));
  });

  it("serializes attrs that are not in a bookmark using the id as the fallback name", () => {
    localStorage.setItem(
      CINENERDLE_ITEM_ATTRS_STORAGE_KEY,
      JSON.stringify({
        film: {
          "603": ["🔥"],
        },
        person: {
          orphan_person_id: ["🧠"],
        },
      }),
    );

    expect(serializeBookmarksAsJsonl(
      [createBookmark(MATRIX_HASH)],
      [
        createBookmarkRow(MATRIX_HASH, [
          {
            key: "movie:603",
            kind: "movie",
            name: "The Matrix",
          },
        ]),
      ],
    )).toBe([
      MATRIX_HASH,
      "603:film:The Matrix 🔥",
      "orphan_person_id:person:orphan_person_id 🧠",
    ].join("\n"));
  });

  it("serializes unique attr rows in first-seen order and keeps colons in ids, names, and chars", () => {
    localStorage.setItem(
      CINENERDLE_ITEM_ATTRS_STORAGE_KEY,
      JSON.stringify({
        film: {
          "star wars: episode iv (1977)": ["🔥", ":", "⭐"],
          "603": ["🎬"],
        },
      }),
    );

    expect(serializeBookmarksAsJsonl(
      [
        createBookmark(MATRIX_HASH),
        createBookmark(KEANU_HASH),
      ],
      [
        createBookmarkRow(MATRIX_HASH, [
          {
            key: "movie:star wars: episode iv (1977)",
            kind: "movie",
            name: "Star Wars: Episode IV",
          },
          {
            key: "movie:603",
            kind: "movie",
            name: "The Matrix",
          },
        ]),
        createBookmarkRow(KEANU_HASH, [
          {
            key: "movie:603",
            kind: "movie",
            name: "The Matrix",
          },
        ]),
      ],
    )).toBe([
      MATRIX_HASH,
      KEANU_HASH,
      "star wars: episode iv (1977):film:Star Wars: Episode IV 🔥:⭐",
      "603:film:The Matrix 🎬",
    ].join("\n"));
  });

  it("parses valid bookmark hashes and ignores blank lines", () => {
    expect(parseBookmarksJsonl(`\n${MATRIX_HASH}\n\n${KEANU_HASH}\n`)).toEqual([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]);
  });

  it("parses standalone attr rows after bookmark rows", () => {
    expect(parseBookmarksJsonlWithItemAttrs(
      [
        MATRIX_HASH,
        "603:film:The Matrix 🔥⭐",
        "1158:person:Keanu Reeves 🎭",
      ].join("\n"),
    )).toEqual({
      bookmarks: [createBookmark(MATRIX_HASH)],
      itemAttrs: {
        film: {
          "603": ["🔥", "⭐"],
        },
        person: {
          "1158": ["🎭"],
        },
      },
      itemAttrRows: [
        {
          bucket: "film",
          chars: ["🔥", "⭐"],
          id: "603",
          lineNumber: 2,
          name: "The Matrix",
        },
        {
          bucket: "person",
          chars: ["🎭"],
          id: "1158",
          lineNumber: 3,
          name: "Keanu Reeves",
        },
      ],
    });
  });

  it("parses attr rows whose names and chars include colons", () => {
    expect(parseBookmarksJsonlWithItemAttrs(
      [
        MATRIX_HASH,
        "star wars: episode iv (1977):film:Star Wars: Episode IV 🔥:⭐",
      ].join("\n"),
    )).toEqual({
      bookmarks: [createBookmark(MATRIX_HASH)],
      itemAttrs: {
        film: {
          "star wars: episode iv (1977)": ["🔥", ":", "⭐"],
        },
        person: {},
      },
      itemAttrRows: [
        {
          bucket: "film",
          chars: ["🔥", ":", "⭐"],
          id: "star wars: episode iv (1977)",
          lineNumber: 2,
          name: "Star Wars: Episode IV",
        },
      ],
    });
  });

  it("rejects invalid bookmark hashes", () => {
    expect(() => parseBookmarksJsonl("{")).toThrowError(
      "Bookmark text line 1 is not a valid hash",
    );
  });

  it("rejects old inline attr syntax", () => {
    expect(() => parseBookmarksJsonlWithItemAttrs(
      `${MATRIX_HASH} [film:603=🔥]`,
    )).toThrowError(
      "Bookmark text line 1 uses unsupported inline attr syntax",
    );
  });

  it("rejects malformed attr rows", () => {
    expect(() => parseBookmarksJsonlWithItemAttrs([
      MATRIX_HASH,
      "603:film:TheMatrix",
    ].join("\n"))).toThrowError(
      "Bookmark text line 2 has an invalid attr row",
    );
  });

  it("rejects attr rows with no name before the trailing chars", () => {
    expect(() => parseBookmarksJsonlWithItemAttrs([
      MATRIX_HASH,
      "603:film: 🔥",
    ].join("\n"))).toThrowError(
      "Bookmark text line 2 has an invalid attr row",
    );
  });

  it("rejects duplicate bookmark hashes after normalization", () => {
    expect(() => parseBookmarksJsonl([
      MATRIX_HASH,
      "film|The Matrix (1999)",
    ].join("\n"))).toThrowError(
      "Bookmark text line 2 is a duplicate hash",
    );
  });

  it("rejects duplicate attr rows for the same bucket and id", () => {
    expect(() => parseBookmarksJsonlWithItemAttrs([
      MATRIX_HASH,
      "603:film:The Matrix 🔥",
      "603:film:The Matrix ⭐",
    ].join("\n"))).toThrowError(
      "Bookmark text line 3 is a duplicate attr row",
    );
  });

  it("rejects bookmark rows after attr rows begin", () => {
    expect(() => parseBookmarksJsonlWithItemAttrs([
      MATRIX_HASH,
      "603:film:The Matrix 🔥",
      KEANU_HASH,
    ].join("\n"))).toThrowError(
      "Bookmark text line 3 must appear before attr rows",
    );
  });

  it("parses attr rows that are not referenced by any bookmark", () => {
    expect(parseBookmarksJsonlWithItemAttrs([
      MATRIX_HASH,
      "orphan_person_id:person:orphan_person_id 🧠",
    ].join("\n"))).toEqual({
      bookmarks: [createBookmark(MATRIX_HASH)],
      itemAttrs: {
        film: {},
        person: {
          orphan_person_id: ["🧠"],
        },
      },
      itemAttrRows: [
        {
          bucket: "person",
          chars: ["🧠"],
          id: "orphan_person_id",
          lineNumber: 2,
          name: "orphan_person_id",
        },
      ],
    });
  });

  it("replaces bookmarks with normalized persisted entries", async () => {
    await expect(replaceBookmarks([
      createBookmark("film|The Matrix (1999)"),
      createBookmark(KEANU_HASH),
    ])).resolves.toEqual([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]);

    expect(JSON.parse(localStorage.getItem(BOOKMARKS_STORAGE_KEY) ?? "[]")).toEqual([
      createBookmark(MATRIX_HASH),
      createBookmark(KEANU_HASH),
    ]);
  });
});

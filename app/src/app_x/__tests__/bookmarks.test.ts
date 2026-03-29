import { beforeEach, describe, expect, it } from "vitest";
import {
  BOOKMARKS_STORAGE_KEY,
  loadBookmarks,
  mergeMissingBookmarks,
  mergeSyncedBookmarks,
  saveBookmarks,
  toggleBookmarkPreviewCardSelection,
  type BookmarkEntry,
} from "../bookmarks";
import type { BookmarkPreviewCard } from "../components/bookmark_preview";
import { ESCAPE_LABEL } from "../generators/cinenerdle2/constants";
import { createPathNode, serializePathNodes } from "../generators/cinenerdle2/hash";

const MATRIX_HASH = serializePathNodes([
  createPathNode("movie", "The Matrix", "1999"),
]);
const KEANU_HASH = serializePathNodes([
  createPathNode("person", "Keanu Reeves"),
]);

function createPreviewCard(overrides: Partial<BookmarkPreviewCard> = {}): BookmarkPreviewCard {
  return {
    key: "movie:the-matrix:1999",
    kind: "movie",
    name: "The Matrix",
    imageUrl: null,
    subtitle: "Movie",
    subtitleDetail: "1999",
    popularity: 99,
    popularitySource: "TMDb movie popularity from the cached movie record.",
    connectionCount: 12,
    sources: [],
    status: null,
    hasCachedTmdbSource: true,
    year: "1999",
    voteAverage: 8.7,
    voteCount: 100,
    ...overrides,
  };
}

function createBreakPreviewCard(
  overrides: Partial<Extract<BookmarkPreviewCard, { kind: "break" }>> = {},
): Extract<BookmarkPreviewCard, { kind: "break" }> {
  return {
    key: "break",
    kind: "break",
    name: ESCAPE_LABEL,
    imageUrl: null,
    subtitle: "",
    subtitleDetail: "",
    popularity: 0,
    popularitySource: null,
    connectionCount: null,
    sources: [],
    status: null,
    hasCachedTmdbSource: false,
    ...overrides,
  };
}

function createBookmark(overrides: Partial<BookmarkEntry> = {}): BookmarkEntry {
  return {
    id: "bookmark-1",
    hash: MATRIX_HASH,
    savedAt: "2026-03-28T00:00:00.000Z",
    label: "The Matrix",
    previewCards: [createPreviewCard()],
    selectedPreviewCardIndices: [0],
    ...overrides,
  };
}

describe("bookmarks", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
        clear: () => {
          storage.clear();
        },
      },
    });
  });

  it("loads bookmarks with normalized hashes and valid selected preview indices", () => {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify([
      {
        ...createBookmark({
          hash: "film|The Matrix (1999)",
          label: "  The Matrix  ",
          selectedPreviewCardIndices: [2, 0, 0, -1],
        }),
      },
      {
        id: "invalid-bookmark",
        hash: "#invalid",
      },
    ]));

    expect(loadBookmarks()).toEqual([
      createBookmark({
        hash: MATRIX_HASH,
        label: "The Matrix",
        selectedPreviewCardIndices: [0],
      }),
    ]);
  });

  it("merges only missing bookmarks by normalized hash", () => {
    const localBookmarks = [
      createBookmark({
        id: "local",
        hash: MATRIX_HASH,
        label: "Local Matrix",
      }),
    ];
    const remoteBookmarks = [
      createBookmark({
        id: "remote-duplicate",
        hash: "film|The Matrix (1999)",
        label: "Remote Matrix",
      }),
      createBookmark({
        id: "remote-missing",
        hash: KEANU_HASH,
        label: "Keanu Reeves",
        previewCards: [
          createPreviewCard({
            key: "person:keanu-reeves",
            kind: "person",
            name: "Keanu Reeves",
            subtitle: "Person",
            subtitleDetail: "Actor",
          }),
        ],
      }),
    ];

    expect(mergeMissingBookmarks(localBookmarks, remoteBookmarks)).toEqual([
      localBookmarks[0],
      remoteBookmarks[1],
    ]);
  });

  it("prefers synced bookmark order while preserving local-only bookmarks", () => {
    const localBookmarks = [
      createBookmark({
        id: "local-only",
        hash: KEANU_HASH,
        label: "Keanu Reeves",
        previewCards: [
          createPreviewCard({
            key: "person:keanu-reeves",
            kind: "person",
            name: "Keanu Reeves",
            subtitle: "Person",
            subtitleDetail: "Actor",
          }),
        ],
      }),
      createBookmark({
        id: "local-matrix",
        hash: MATRIX_HASH,
        label: "Local Matrix",
      }),
    ];
    const remoteBookmarks = [
      createBookmark({
        id: "remote-matrix",
        hash: MATRIX_HASH,
        label: "Remote Matrix",
      }),
    ];

    expect(mergeSyncedBookmarks(localBookmarks, remoteBookmarks)).toEqual([
      remoteBookmarks[0],
      localBookmarks[0],
    ]);
  });

  it("normalizes bookmarks before saving them", () => {
    saveBookmarks([
      createBookmark({
        hash: "film|The Matrix (1999)",
        label: "  The Matrix  ",
        selectedPreviewCardIndices: [0, 2, 0],
      }),
    ]);

    expect(JSON.parse(localStorage.getItem(BOOKMARKS_STORAGE_KEY) ?? "[]")).toEqual([
      createBookmark({
        hash: MATRIX_HASH,
        label: "The Matrix",
        selectedPreviewCardIndices: [0],
      }),
    ]);
  });

  it("drops selected preview indices that point at escape separators", () => {
    saveBookmarks([
      createBookmark({
        previewCards: [
          createPreviewCard(),
          createBreakPreviewCard(),
          createPreviewCard({
            key: "person:keanu-reeves",
            kind: "person",
            name: "Keanu Reeves",
            subtitle: "Person",
            subtitleDetail: "Actor",
          }),
        ],
        selectedPreviewCardIndices: [1, 2],
      }),
    ]);

    expect(JSON.parse(localStorage.getItem(BOOKMARKS_STORAGE_KEY) ?? "[]")).toEqual([
      createBookmark({
        previewCards: [
          createPreviewCard(),
          createBreakPreviewCard(),
          createPreviewCard({
            key: "person:keanu-reeves",
            kind: "person",
            name: "Keanu Reeves",
            subtitle: "Person",
            subtitleDetail: "Actor",
          }),
        ],
        selectedPreviewCardIndices: [2],
      }),
    ]);
  });

  it("ignores toggle requests for escape separators", () => {
    const currentBookmarks = [
      createBookmark({
        previewCards: [createPreviewCard(), createBreakPreviewCard()],
        selectedPreviewCardIndices: [0],
      }),
    ];

    expect(toggleBookmarkPreviewCardSelection(currentBookmarks, "bookmark-1", 1)).toEqual(
      currentBookmarks,
    );
  });
});

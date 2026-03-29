import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bookmarkSyncMessageSource,
  bookmarkSyncMessageTypes,
  getSyncedBookmarks,
  setSyncedBookmarks,
} from "../bookmark_sync";
import type { BookmarkEntry } from "../bookmarks";
import { createPathNode, serializePathNodes } from "../generators/cinenerdle2/hash";

const MATRIX_HASH = serializePathNodes([
  createPathNode("movie", "The Matrix", "1999"),
]);

type FakeWindow = {
  location: { origin: string };
  addEventListener: (type: string, listener: (event: MessageEvent<unknown>) => void) => void;
  removeEventListener: (type: string, listener: (event: MessageEvent<unknown>) => void) => void;
  postMessage: (message: unknown, targetOrigin: string) => void;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  dispatchMessage: (message: unknown, source?: unknown) => void;
};

function createBookmark(overrides: Partial<BookmarkEntry> = {}): BookmarkEntry {
  return {
    id: "bookmark-1",
    hash: MATRIX_HASH,
    savedAt: "2026-03-28T00:00:00.000Z",
    label: "The Matrix",
    previewCards: [
      {
        key: "movie:the-matrix:1999",
        kind: "movie",
        name: "The Matrix",
        imageUrl: null,
        subtitle: "Movie",
        subtitleDetail: "1999",
        popularity: 99,
        connectionCount: 12,
        sources: [],
        status: null,
        hasCachedTmdbSource: true,
        year: "1999",
        voteAverage: 8.7,
        voteCount: 100,
      },
    ],
    selectedPreviewCardIndices: [0],
    ...overrides,
  };
}

function createFakeWindow(): FakeWindow {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  const fakeWindow = {
    location: { origin: "https://bacondegrees420.web.app" },
    addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
      if (type === "message") {
        listeners.add(listener);
      }
    },
    removeEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
      if (type === "message") {
        listeners.delete(listener);
      }
    },
    postMessage(_message: unknown, _targetOrigin: string) {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    dispatchMessage(message: unknown, source?: unknown) {
      listeners.forEach((listener) => {
        listener({
          data: message,
          source: source ?? fakeWindow,
        } as MessageEvent<unknown>);
      });
    },
  } satisfies FakeWindow;

  return fakeWindow;
}

const originalWindow = globalThis.window;

describe("bookmark_sync", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("returns synced bookmarks from the extension bridge", async () => {
    const fakeWindow = createFakeWindow();
    fakeWindow.postMessage = (message) => {
      const request = message as {
        requestId: string;
      };

      fakeWindow.dispatchMessage({
        source: bookmarkSyncMessageSource,
        type: bookmarkSyncMessageTypes.response,
        requestId: request.requestId,
        payload: {
          bookmarks: [createBookmark()],
        },
      });
    };

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });

    await expect(getSyncedBookmarks()).resolves.toEqual([createBookmark()]);
  });

  it("times out when no extension bridge responds", async () => {
    vi.useFakeTimers();
    const fakeWindow = createFakeWindow();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });

    const pendingBookmarks = expect(getSyncedBookmarks()).rejects.toThrow(
      "Bookmark extension unavailable",
    );
    await vi.advanceTimersByTimeAsync(6000);
    await pendingBookmarks;
  });

  it("ignores unrelated messages before resolving the matching response", async () => {
    const fakeWindow = createFakeWindow();
    fakeWindow.postMessage = (message) => {
      const request = message as {
        requestId: string;
      };

      fakeWindow.dispatchMessage({
        source: bookmarkSyncMessageSource,
        type: bookmarkSyncMessageTypes.response,
        requestId: "different-request",
        payload: {
          bookmarks: [],
        },
      });
      fakeWindow.dispatchMessage({
        source: "someone-else",
        type: bookmarkSyncMessageTypes.response,
        requestId: request.requestId,
        payload: {
          bookmarks: [],
        },
      });
      fakeWindow.dispatchMessage({
        source: bookmarkSyncMessageSource,
        type: bookmarkSyncMessageTypes.response,
        requestId: request.requestId,
        payload: {
          bookmarks: [createBookmark()],
        },
      });
    };

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });

    await expect(getSyncedBookmarks()).resolves.toEqual([createBookmark()]);
  });

  it("normalizes outgoing bookmarks before posting them to the bridge", async () => {
    const fakeWindow = createFakeWindow();
    let postedBookmarks: unknown = null;
    fakeWindow.postMessage = (message) => {
      const request = message as {
        bookmarks?: unknown;
        requestId: string;
      };
      postedBookmarks = request.bookmarks;
      fakeWindow.dispatchMessage({
        source: bookmarkSyncMessageSource,
        type: bookmarkSyncMessageTypes.response,
        requestId: request.requestId,
        payload: {},
      });
    };

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });

    await setSyncedBookmarks([
      createBookmark({
        hash: "film|The Matrix (1999)",
        label: "  The Matrix  ",
        selectedPreviewCardIndices: [0, 2, 0],
      }),
    ]);

    expect(postedBookmarks).toEqual([
      createBookmark({
        hash: MATRIX_HASH,
        label: "The Matrix",
        selectedPreviewCardIndices: [0],
      }),
    ]);
  });
});

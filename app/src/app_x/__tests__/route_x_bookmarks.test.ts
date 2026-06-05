import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../generators/cinenerdle2/tmdb", () => ({
  hydrateHashPath: vi.fn(),
}));

import {
  isRouteXBookmarksPath,
  loadRouteXBookmarkSource,
  readRouteXBookmarkEntries,
  readRouteXBookmarkItemAttrs,
  resetRouteXBookmarksCache,
  writeRouteXBookmarkEntries,
  writeRouteXBookmarkItemAttrs,
} from "../route_x_bookmarks";

function createFetchResponse(body: string) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  } as Response;
}

function createWindowStub(initialPathname = "/") {
  const eventTarget = new EventTarget();
  const location = {
    pathname: initialPathname,
  };

  return Object.assign(eventTarget, {
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        location.pathname = new URL(url, "https://example.test").pathname;
      },
    },
    location,
  });
}

describe("route_x_bookmarks", () => {
  beforeEach(() => {
    resetRouteXBookmarksCache();
    vi.stubGlobal("window", createWindowStub());
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches the /x route-backed bookmark family without catching exact /x or unrelated paths", () => {
    expect(isRouteXBookmarksPath("/x")).toBe(false);
    expect(isRouteXBookmarksPath("/x/")).toBe(false);
    expect(isRouteXBookmarksPath("/x/bookmarks")).toBe(true);
    expect(isRouteXBookmarksPath("/x/cover")).toBe(true);
    expect(isRouteXBookmarksPath("/x/custom")).toBe(true);
    expect(isRouteXBookmarksPath("/")).toBe(false);
    expect(isRouteXBookmarksPath("/xyz")).toBe(false);
  });

  it("fetches bookmarks.txt on /x/bookmarks and exposes the parsed bookmarks and item attrs", async () => {
    window.history.replaceState(null, "", "/x/bookmarks");
    const fetchMock = vi.fn(async () => createFetchResponse("bookmark text"));
    const parseBookmarksText = vi.fn(() => ({
      bookmarks: [{ hash: "#movie|heat|1995" }],
      itemAttrs: {
        film: {
          "603": ["🔥"],
        },
        person: {
          "1158": ["🎭"],
        },
      },
    }));
    const itemAttrsUpdatedListener = vi.fn();
    window.addEventListener("cinenerdle-item-attrs-updated", itemAttrsUpdatedListener);

    try {
      await expect(loadRouteXBookmarkSource({
        fetchImpl: fetchMock as typeof fetch,
        parseBookmarksText,
      })).resolves.toEqual({
        bookmarks: [{ hash: "#movie|heat|1995" }],
        itemAttrs: {
          film: {
            "603": ["🔥"],
          },
          person: {
            "1158": ["🎭"],
          },
        },
      });
    } finally {
      window.removeEventListener("cinenerdle-item-attrs-updated", itemAttrsUpdatedListener);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/bookmarks.txt");
    expect(parseBookmarksText).toHaveBeenCalledWith("bookmark text");
    expect(readRouteXBookmarkEntries()).toEqual([{ hash: "#movie|heat|1995" }]);
    expect(readRouteXBookmarkItemAttrs()).toEqual({
      film: {
        "603": ["🔥"],
      },
      person: {
        "1158": ["🎭"],
      },
    });
    expect(itemAttrsUpdatedListener).toHaveBeenCalledTimes(1);
  });

  it("keeps route-backed bookmark writes isolated to /x", () => {
    window.history.replaceState(null, "", "/x/bookmarks");

    expect(writeRouteXBookmarkEntries([{ hash: "#person|keanu+reeves" }])).toEqual([
      { hash: "#person|keanu+reeves" },
    ]);
    expect(writeRouteXBookmarkItemAttrs({
      film: {},
      person: {
        "6384": ["⭐"],
      },
    })).toEqual({
      film: {},
      person: {
        "6384": ["⭐"],
      },
    });
    expect(readRouteXBookmarkEntries()).toEqual([{ hash: "#person|keanu+reeves" }]);
    expect(readRouteXBookmarkItemAttrs()).toEqual({
      film: {},
      person: {
        "6384": ["⭐"],
      },
    });

    window.history.replaceState(null, "", "/");
    expect(writeRouteXBookmarkEntries([{ hash: "#movie|the+matrix|1999" }])).toBeNull();
    expect(writeRouteXBookmarkItemAttrs({
      film: {
        "603": ["🔥"],
      },
      person: {},
    })).toBeNull();
    expect(readRouteXBookmarkEntries()).toBeNull();
    expect(readRouteXBookmarkItemAttrs()).toBeNull();
  });
});

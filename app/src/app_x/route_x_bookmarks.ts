import { useEffect, useRef } from "react";
import { hydrateHashPath } from "./generators/cinenerdle2/tmdb";

type RouteBookmarkEntry = {
  hash: string;
};

type RouteBookmarkItemAttrs = {
  film: Record<string, string[]>;
  person: Record<string, string[]>;
};

type ParsedRouteBookmarkText = {
  bookmarks: RouteBookmarkEntry[];
  itemAttrs: RouteBookmarkItemAttrs;
};

type RouteBookmarkSnapshot = {
  bookmarks: RouteBookmarkEntry[];
  itemAttrs: RouteBookmarkItemAttrs;
};

const ROUTE_X_BOOKMARKS_PATH_PATTERN = /^\/x\/.+/u;
const ROUTE_X_BOOKMARKS_URL = "/bookmarks.txt";
const ROUTE_X_ITEM_ATTRS_UPDATED_EVENT = "cinenerdle-item-attrs-updated";

let routeXBookmarkSnapshot: RouteBookmarkSnapshot | null = null;
let routeXBookmarkLoadPromise: Promise<RouteBookmarkSnapshot | null> | null = null;

function normalizeRoutePathname(pathname: string): string {
  const trimmedPathname = pathname.trim() || "/";
  const withLeadingSlash = trimmedPathname.startsWith("/") ? trimmedPathname : `/${trimmedPathname}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, "");
  return withoutTrailingSlash || "/";
}

function createEmptyRouteBookmarkItemAttrs(): RouteBookmarkItemAttrs {
  return {
    film: {},
    person: {},
  };
}

function cloneRouteBookmarkEntries(bookmarks: RouteBookmarkEntry[]): RouteBookmarkEntry[] {
  return bookmarks.map((bookmark) => ({
    hash: bookmark.hash,
  }));
}

function cloneRouteBookmarkItemAttrs(
  itemAttrs: RouteBookmarkItemAttrs,
): RouteBookmarkItemAttrs {
  return {
    film: Object.fromEntries(
      Object.entries(itemAttrs.film).map(([key, chars]) => [key, [...chars]]),
    ),
    person: Object.fromEntries(
      Object.entries(itemAttrs.person).map(([key, chars]) => [key, [...chars]]),
    ),
  };
}

function cloneRouteBookmarkSnapshot(
  snapshot: RouteBookmarkSnapshot,
): RouteBookmarkSnapshot {
  return {
    bookmarks: cloneRouteBookmarkEntries(snapshot.bookmarks),
    itemAttrs: cloneRouteBookmarkItemAttrs(snapshot.itemAttrs),
  };
}

function getCurrentPathname(pathname?: string): string {
  if (typeof pathname === "string") {
    return pathname;
  }

  if (typeof window !== "undefined" && typeof window.location?.pathname === "string") {
    return window.location.pathname;
  }

  return "/";
}

function dispatchRouteXItemAttrsUpdated(itemAttrs: RouteBookmarkItemAttrs): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(ROUTE_X_ITEM_ATTRS_UPDATED_EVENT, {
    detail: {
      changedTargets: [],
      nextItemAttrsSnapshot: cloneRouteBookmarkItemAttrs(itemAttrs),
    },
  }));
}

function setRouteXBookmarkSnapshot(
  nextSnapshot: RouteBookmarkSnapshot,
): RouteBookmarkSnapshot {
  routeXBookmarkSnapshot = cloneRouteBookmarkSnapshot(nextSnapshot);
  dispatchRouteXItemAttrsUpdated(routeXBookmarkSnapshot.itemAttrs);
  return cloneRouteBookmarkSnapshot(routeXBookmarkSnapshot);
}

export function isRouteXBookmarksPath(pathname = getCurrentPathname()): boolean {
  return ROUTE_X_BOOKMARKS_PATH_PATTERN.test(normalizeRoutePathname(pathname));
}

export async function loadRouteXBookmarkSource(options: {
  fetchImpl?: typeof fetch;
  parseBookmarksText: (bookmarkText: string) => ParsedRouteBookmarkText;
  pathname?: string;
  url?: string;
}): Promise<RouteBookmarkSnapshot | null> {
  if (!isRouteXBookmarksPath(options.pathname)) {
    return null;
  }

  if (routeXBookmarkSnapshot) {
    return cloneRouteBookmarkSnapshot(routeXBookmarkSnapshot);
  }

  if (routeXBookmarkLoadPromise) {
    return routeXBookmarkLoadPromise;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) {
    return null;
  }

  routeXBookmarkLoadPromise = (async () => {
    const response = await fetchImpl(options.url ?? ROUTE_X_BOOKMARKS_URL);
    if (!response.ok) {
      throw new Error(`Bookmark fetch failed (${response.status})`);
    }

    const bookmarkText = await response.text();
    const parsedBookmarks = options.parseBookmarksText(bookmarkText);

    return setRouteXBookmarkSnapshot({
      bookmarks: parsedBookmarks.bookmarks,
      itemAttrs: parsedBookmarks.itemAttrs,
    });
  })();

  try {
    return await routeXBookmarkLoadPromise;
  } finally {
    routeXBookmarkLoadPromise = null;
  }
}

export function readRouteXBookmarkEntries(
  pathname = getCurrentPathname(),
): RouteBookmarkEntry[] | null {
  if (!isRouteXBookmarksPath(pathname)) {
    return null;
  }

  return cloneRouteBookmarkEntries(routeXBookmarkSnapshot?.bookmarks ?? []);
}

export function writeRouteXBookmarkEntries(
  bookmarks: RouteBookmarkEntry[],
  pathname = getCurrentPathname(),
): RouteBookmarkEntry[] | null {
  if (!isRouteXBookmarksPath(pathname)) {
    return null;
  }

  const nextSnapshot = setRouteXBookmarkSnapshot({
    bookmarks,
    itemAttrs: routeXBookmarkSnapshot?.itemAttrs ?? createEmptyRouteBookmarkItemAttrs(),
  });
  return nextSnapshot.bookmarks;
}

export function readRouteXBookmarkItemAttrs(
  pathname = getCurrentPathname(),
): RouteBookmarkItemAttrs | null {
  if (!isRouteXBookmarksPath(pathname)) {
    return null;
  }

  return cloneRouteBookmarkItemAttrs(
    routeXBookmarkSnapshot?.itemAttrs ?? createEmptyRouteBookmarkItemAttrs(),
  );
}

export function writeRouteXBookmarkItemAttrs(
  itemAttrs: RouteBookmarkItemAttrs,
  pathname = getCurrentPathname(),
): RouteBookmarkItemAttrs | null {
  if (!isRouteXBookmarksPath(pathname)) {
    return null;
  }

  const nextSnapshot = setRouteXBookmarkSnapshot({
    bookmarks: routeXBookmarkSnapshot?.bookmarks ?? [],
    itemAttrs,
  });
  return nextSnapshot.itemAttrs;
}

export function resetRouteXBookmarksCache(): void {
  routeXBookmarkSnapshot = null;
  routeXBookmarkLoadPromise = null;
}

export function useWarmRouteXBookmarks({
  bookmarks,
  isReady,
}: {
  bookmarks: RouteBookmarkEntry[];
  isReady: boolean;
}) {
  const hydrationRunIdRef = useRef(0);
  const activeHydrationRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    hydrationRunIdRef.current += 1;
    const runId = hydrationRunIdRef.current;

    if (!isRouteXBookmarksPath() || !isReady || bookmarks.length === 0) {
      return;
    }

    const bookmarkHashes = Array.from(
      new Set(
        bookmarks
          .map((bookmark) => bookmark.hash.trim())
          .filter(Boolean),
      ),
    );

    if (bookmarkHashes.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const activeHydration = activeHydrationRef.current;
      if (activeHydration) {
        try {
          await activeHydration;
        } catch {
          // Keep going with the latest route snapshot.
        }
      }

      for (const bookmarkHash of bookmarkHashes) {
        if (cancelled || hydrationRunIdRef.current !== runId) {
          return;
        }

        const hydrationPromise = hydrateHashPath(bookmarkHash);
        activeHydrationRef.current = hydrationPromise;

        try {
          await hydrationPromise;
        } catch {
          // Continue through the list even if one bookmark fails.
        } finally {
          if (activeHydrationRef.current === hydrationPromise) {
            activeHydrationRef.current = null;
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookmarks, isReady]);
}

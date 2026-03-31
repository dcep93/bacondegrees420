import { useCallback, useEffect, useRef, useState } from "react";
import type { AppViewMode } from "./bookmarks";
import {
  getBookmarkPreviewCardHash,
  getBookmarkPreviewCardRootHash,
} from "./index_helpers";
import { normalizeHashValue } from "./generators/cinenerdle2/hash";

export type PendingHashWrite = {
  hash: string;
  mode: "selection" | "navigation";
};

export type AppLocationState = {
  viewMode: AppViewMode;
  pathname: string;
  basePathname: string;
  hash: string;
};

const BOOKMARKS_PATH_SUFFIX = "/bookmarks";

export function normalizePathname(pathname: string): string {
  const trimmedPathname = pathname.trim() || "/";
  const withLeadingSlash = trimmedPathname.startsWith("/") ? trimmedPathname : `/${trimmedPathname}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, "");
  return withoutTrailingSlash || "/";
}

export function getBookmarksPathname(basePathname: string): string {
  const normalizedBasePathname = normalizePathname(basePathname);
  return normalizedBasePathname === "/"
    ? BOOKMARKS_PATH_SUFFIX
    : `${normalizedBasePathname}${BOOKMARKS_PATH_SUFFIX}`;
}

export function getBasePathname(pathname: string): string {
  const normalizedPathname = normalizePathname(pathname);

  if (normalizedPathname === BOOKMARKS_PATH_SUFFIX) {
    return "/";
  }

  if (normalizedPathname.endsWith(BOOKMARKS_PATH_SUFFIX)) {
    return normalizePathname(
      normalizedPathname.slice(0, normalizedPathname.length - BOOKMARKS_PATH_SUFFIX.length),
    );
  }

  return normalizedPathname;
}

export function readAppLocationState(): AppLocationState {
  const pathname = normalizePathname(window.location.pathname);
  const basePathname = getBasePathname(pathname);
  const viewMode: AppViewMode = pathname === getBookmarksPathname(basePathname)
    ? "bookmarks"
    : "generator";

  return {
    viewMode,
    pathname,
    basePathname,
    hash: normalizeHashValue(window.location.hash),
  };
}

export function buildLocationHref(pathname: string, hashValue: string) {
  return `${normalizePathname(pathname)}${window.location.search}${normalizeHashValue(hashValue)}`;
}

export function useAppLocationState() {
  const initialLocationState = readAppLocationState();
  const [appLocation, setAppLocation] = useState(initialLocationState);
  const [hashValue, setHashValue] = useState(initialLocationState.hash);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const pendingHashWriteRef = useRef<PendingHashWrite | null>(null);
  const lastSyncedHashRef = useRef(normalizeHashValue(initialLocationState.hash));
  const bookmarksReturnHashRef = useRef(normalizeHashValue(initialLocationState.hash));

  const syncLocationFromWindow = useCallback((options?: {
    incrementNavigationVersion?: boolean;
    nextHashOverride?: string;
    preserveHashValue?: boolean;
  }) => {
    const nextLocation = readAppLocationState();
    setAppLocation(nextLocation);

    if (options?.preserveHashValue) {
      return;
    }

    const normalizedNextHash = normalizeHashValue(
      options?.nextHashOverride ?? nextLocation.hash,
    );
    lastSyncedHashRef.current = normalizedNextHash;
    pendingHashWriteRef.current = null;
    setHashValue(normalizedNextHash);

    if (options?.incrementNavigationVersion) {
      setNavigationVersion((version) => version + 1);
    }
  }, []);

  const handleHashWrite = useCallback(
    (nextHash: string, mode: PendingHashWrite["mode"]) => {
      pendingHashWriteRef.current = {
        hash: normalizeHashValue(nextHash),
        mode,
      };
    },
    [],
  );

  const navigateToHash = useCallback(
    (nextHash: string, mode: PendingHashWrite["mode"]) => {
      const normalizedHash = normalizeHashValue(nextHash);
      if (!normalizedHash) {
        return;
      }

      handleHashWrite(normalizedHash, mode);
      window.location.hash = normalizedHash.replace(/^#/, "");
    },
    [handleHashWrite],
  );

  const openHashInNewTab = useCallback(
    (nextHash: string) => {
      const normalizedHash = normalizeHashValue(nextHash);
      if (!normalizedHash) {
        return;
      }

      window.open(
        buildLocationHref(appLocation.basePathname, normalizedHash),
        "_blank",
        "noopener,noreferrer",
      );
    },
    [appLocation.basePathname],
  );

  const loadBookmarkHash = useCallback(
    (bookmarkHash: string) => {
      const normalizedBookmarkHash = normalizeHashValue(bookmarkHash);
      bookmarksReturnHashRef.current = normalizedBookmarkHash;
      window.history.replaceState(
        null,
        "",
        buildLocationHref(appLocation.basePathname, normalizedBookmarkHash),
      );
      syncLocationFromWindow({
        incrementNavigationVersion: true,
        nextHashOverride: normalizedBookmarkHash,
      });
    },
    [appLocation.basePathname, syncLocationFromWindow],
  );

  const loadBookmarkCardHash = useCallback(
    (bookmarkHash: string, previewCardIndex: number) => {
      const previewCardHash = getBookmarkPreviewCardHash(bookmarkHash, previewCardIndex);
      bookmarksReturnHashRef.current = previewCardHash;
      window.history.replaceState(
        null,
        "",
        buildLocationHref(appLocation.basePathname, previewCardHash),
      );
      syncLocationFromWindow({
        incrementNavigationVersion: true,
        nextHashOverride: previewCardHash,
      });
    },
    [appLocation.basePathname, syncLocationFromWindow],
  );

  const openBookmarkCardAsRootInNewTab = useCallback(
    (bookmarkHash: string, previewCardIndex: number) => {
      const previewCardRootHash = getBookmarkPreviewCardRootHash(bookmarkHash, previewCardIndex);
      window.open(
        buildLocationHref(appLocation.basePathname, previewCardRootHash),
        "_blank",
        "noopener,noreferrer",
      );
    },
    [appLocation.basePathname],
  );

  const toggleBookmarks = useCallback(() => {
    if (appLocation.viewMode === "bookmarks") {
      const restoreHash = bookmarksReturnHashRef.current;
      window.history.replaceState(
        null,
        "",
        buildLocationHref(appLocation.basePathname, restoreHash),
      );
      syncLocationFromWindow({
        incrementNavigationVersion: true,
        nextHashOverride: restoreHash,
      });
      return;
    }

    bookmarksReturnHashRef.current = normalizeHashValue(hashValue);
    window.history.pushState(
      null,
      "",
      buildLocationHref(getBookmarksPathname(appLocation.basePathname), ""),
    );
    syncLocationFromWindow({
      preserveHashValue: true,
    });
  }, [appLocation.basePathname, appLocation.viewMode, hashValue, syncLocationFromWindow]);

  const resetLocation = useCallback(() => {
    bookmarksReturnHashRef.current = "";
    window.history.replaceState(
      null,
      "",
      buildLocationHref(appLocation.basePathname, ""),
    );
    syncLocationFromWindow({
      incrementNavigationVersion: true,
      nextHashOverride: "",
    });
  }, [appLocation.basePathname, syncLocationFromWindow]);

  useEffect(() => {
    if (window.location.hash === hashValue) {
      return;
    }

    window.history.replaceState(
      null,
      "",
      buildLocationHref(appLocation.pathname, hashValue),
    );
  }, [appLocation.pathname, hashValue]);

  useEffect(() => {
    function syncHashState(nextHash: string) {
      const normalizedNextHash = normalizeHashValue(nextHash);
      const pendingHashWrite = pendingHashWriteRef.current;
      const matchedPendingHashWrite =
        pendingHashWrite !== null && pendingHashWrite.hash === normalizedNextHash;

      if (lastSyncedHashRef.current === normalizedNextHash) {
        if (matchedPendingHashWrite) {
          pendingHashWriteRef.current = null;
        }

        return;
      }

      lastSyncedHashRef.current = normalizedNextHash;
      setHashValue(normalizedNextHash);

      if (!matchedPendingHashWrite || pendingHashWrite.mode !== "selection") {
        setNavigationVersion((version) => version + 1);
      }

      if (matchedPendingHashWrite) {
        pendingHashWriteRef.current = null;
      }
    }

    function handleHashChange() {
      setAppLocation(readAppLocationState());
      syncHashState(window.location.hash);
    }

    function handlePopState() {
      const nextLocation = readAppLocationState();
      setAppLocation(nextLocation);
      syncHashState(nextLocation.hash);
    }

    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return {
    appLocation,
    bookmarksReturnHashRef,
    handleHashWrite,
    hashValue,
    isBookmarksView: appLocation.viewMode === "bookmarks",
    loadBookmarkCardHash,
    loadBookmarkHash,
    navigationVersion,
    openBookmarkCardAsRootInNewTab,
    openHashInNewTab,
    resetLocation,
    syncLocationFromWindow,
    toggleBookmarks,
    navigateToHash,
  };
}

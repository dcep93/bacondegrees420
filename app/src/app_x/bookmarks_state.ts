import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadBookmarks,
  moveBookmarkEntry,
  parseBookmarksJsonlWithItemAttrs,
  removeBookmarkEntry,
  saveBookmarks,
  serializeBookmarksAsJsonl,
  upsertBookmarkEntry,
  type BookmarkEntry,
} from "./bookmarks";
import { buildBookmarkRowData, createBookmarkRowPlaceholder, type BookmarkRowData } from "./bookmark_rows";
import { normalizeHashValue } from "./generators/cinenerdle2/hash";
import {
  CINENERDLE_RECORDS_UPDATED_EVENT,
} from "./generators/cinenerdle2/indexed_db";
import {
  CINENERDLE_ITEM_ATTRS_UPDATED_EVENT,
  writeCinenerdleItemAttrs,
} from "./generators/cinenerdle2/item_attrs";
import { hydrateHashPath } from "./generators/cinenerdle2/tmdb";

export function isBookmarksJsonlDraftChanged(
  serializedBookmarksJsonl: string,
  bookmarksJsonlDraft: string,
): boolean {
  return bookmarksJsonlDraft !== serializedBookmarksJsonl;
}

export function resetBookmarksJsonlDraft(serializedBookmarksJsonl: string): string {
  return serializedBookmarksJsonl;
}

type HydrateBookmarksSequentiallyOptions = {
  bookmarkHashes: string[];
  getActiveHydration: () => Promise<void> | null;
  hydrateBookmarkHash?: (bookmarkHash: string) => Promise<void>;
  isCurrentRun: () => boolean;
  setActiveHydration: (promise: Promise<void> | null) => void;
};

export async function hydrateBookmarksSequentially({
  bookmarkHashes,
  getActiveHydration,
  hydrateBookmarkHash = (bookmarkHash: string) => hydrateHashPath(bookmarkHash, {
    prefetchConnections: false,
  }),
  isCurrentRun,
  setActiveHydration,
}: HydrateBookmarksSequentiallyOptions): Promise<void> {
  const waitForActiveHydration = getActiveHydration();
  if (waitForActiveHydration) {
    try {
      await waitForActiveHydration;
    } catch {
      // Ignore the replaced run's failure and continue with the latest snapshot.
    }
  }

  for (const bookmarkHash of bookmarkHashes) {
    if (!isCurrentRun()) {
      return;
    }

    const hydrationPromise = hydrateBookmarkHash(bookmarkHash);
    setActiveHydration(hydrationPromise);

    try {
      await hydrationPromise;
    } catch {
      // Keep walking the queue even if a single bookmark fails to hydrate.
    } finally {
      if (getActiveHydration() === hydrationPromise) {
        setActiveHydration(null);
      }
    }
  }
}

export function useBookmarksState({
  hashValue,
  onToast,
  shouldHydrateBookmarks,
}: {
  hashValue: string;
  onToast: (message: string) => void;
  shouldHydrateBookmarks: boolean;
}) {
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [bookmarkRows, setBookmarkRows] = useState<BookmarkRowData[]>([]);
  const [isBookmarksJsonlEditorOpen, setIsBookmarksJsonlEditorOpen] = useState(false);
  const [bookmarksJsonlDraft, setBookmarksJsonlDraft] = useState("");
  const [isSavingBookmark, setIsSavingBookmark] = useState(false);
  const [itemAttrsVersion, setItemAttrsVersion] = useState(0);
  const bookmarksRef = useRef<BookmarkEntry[]>([]);
  const bookmarksHydrationRunIdRef = useRef(0);
  const bookmarksHydrationInFlightRef = useRef<Promise<void> | null>(null);
  const bookmarksPersistenceRequestIdRef = useRef(0);
  const serializedBookmarksJsonlRef = useRef("");
  const bookmarksJsonlTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const serializedBookmarksJsonl = useMemo(
    () => {
      void itemAttrsVersion;
      return serializeBookmarksAsJsonl(bookmarks, bookmarkRows);
    },
    [bookmarkRows, bookmarks, itemAttrsVersion],
  );

  const isBookmarksJsonlDraftDirty = isBookmarksJsonlDraftChanged(
    serializedBookmarksJsonl,
    bookmarksJsonlDraft,
  );

  const refreshBookmarkRows = useCallback(async (nextBookmarks: BookmarkEntry[]) => {
    if (nextBookmarks.length === 0) {
      setBookmarkRows([]);
      return;
    }

    try {
      setBookmarkRows(await Promise.all(nextBookmarks.map((bookmark) => buildBookmarkRowData(bookmark.hash))));
    } catch {
      setBookmarkRows([]);
    }
  }, []);

  useEffect(() => {
    const requestId = bookmarksPersistenceRequestIdRef.current;
    let isActive = true;

    void loadBookmarks()
      .then((loadedBookmarks) => {
        if (!isActive || bookmarksPersistenceRequestIdRef.current !== requestId) {
          return;
        }

        bookmarksRef.current = loadedBookmarks;
        setBookmarks(loadedBookmarks);
      })
      .catch(() => { });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    bookmarksRef.current = bookmarks;
  }, [bookmarks]);

  useEffect(() => {
    let cancelled = false;

    void (bookmarks.length === 0
      ? Promise.resolve<BookmarkRowData[]>([])
      : Promise.all(bookmarks.map((bookmark) => buildBookmarkRowData(bookmark.hash))))
      .then((nextBookmarkRows) => {
        if (!cancelled) {
          setBookmarkRows(nextBookmarkRows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBookmarkRows([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookmarks]);

  useEffect(() => {
    bookmarksHydrationRunIdRef.current += 1;
    const runId = bookmarksHydrationRunIdRef.current;

    if (!shouldHydrateBookmarks || bookmarks.length === 0) {
      return;
    }

    let cancelled = false;
    const pendingBookmarkHashes = bookmarks.map((bookmark) => bookmark.hash);

    void hydrateBookmarksSequentially({
      bookmarkHashes: pendingBookmarkHashes,
      getActiveHydration: () => bookmarksHydrationInFlightRef.current,
      isCurrentRun: () => !cancelled && bookmarksHydrationRunIdRef.current === runId,
      setActiveHydration: (promise) => {
        bookmarksHydrationInFlightRef.current = promise;
      },
    });

    return () => {
      cancelled = true;
    };
  }, [bookmarks, shouldHydrateBookmarks]);

  useEffect(() => {
    function handleCinenerdleRecordsUpdated() {
      void refreshBookmarkRows(bookmarksRef.current);
    }

    window.addEventListener(CINENERDLE_RECORDS_UPDATED_EVENT, handleCinenerdleRecordsUpdated);
    return () => {
      window.removeEventListener(CINENERDLE_RECORDS_UPDATED_EVENT, handleCinenerdleRecordsUpdated);
    };
  }, [refreshBookmarkRows]);

  useEffect(() => {
    function handleCinenerdleItemAttrsUpdated() {
      setItemAttrsVersion((version) => version + 1);
    }

    window.addEventListener(CINENERDLE_ITEM_ATTRS_UPDATED_EVENT, handleCinenerdleItemAttrsUpdated);
    return () => {
      window.removeEventListener(CINENERDLE_ITEM_ATTRS_UPDATED_EVENT, handleCinenerdleItemAttrsUpdated);
    };
  }, []);

  useEffect(() => {
    const previousSerializedBookmarksJsonl = serializedBookmarksJsonlRef.current;
    serializedBookmarksJsonlRef.current = serializedBookmarksJsonl;
    setBookmarksJsonlDraft((currentDraft) =>
      currentDraft === previousSerializedBookmarksJsonl
        ? serializedBookmarksJsonl
        : currentDraft,
    );
  }, [serializedBookmarksJsonl]);

  useEffect(() => {
    if (isBookmarksJsonlEditorOpen) {
      bookmarksJsonlTextareaRef.current?.focus();
    }
  }, [isBookmarksJsonlEditorOpen]);

  const persistBookmarks = useCallback(async (nextBookmarks: BookmarkEntry[]) => {
    const requestId = bookmarksPersistenceRequestIdRef.current + 1;
    bookmarksPersistenceRequestIdRef.current = requestId;
    bookmarksRef.current = nextBookmarks;
    setBookmarks(nextBookmarks);

    try {
      const persistedBookmarks = await saveBookmarks(nextBookmarks);
      if (bookmarksPersistenceRequestIdRef.current === requestId) {
        bookmarksRef.current = persistedBookmarks;
        setBookmarks(persistedBookmarks);
      }

      return persistedBookmarks;
    } catch (error: unknown) {
      if (bookmarksPersistenceRequestIdRef.current === requestId) {
        onToast(
          error instanceof Error && error.message
            ? error.message
            : "Bookmark save failed",
        );
      }

      return null;
    }
  }, [onToast]);

  const handleApplyBookmarksJsonl = useCallback(async () => {
    try {
      const parsedJsonl = parseBookmarksJsonlWithItemAttrs(bookmarksJsonlDraft);
      const persistedBookmarks = await persistBookmarks(parsedJsonl.bookmarks);
      if (!persistedBookmarks) {
        return;
      }

      const nextBookmarkRows = await Promise.all(
        persistedBookmarks.map((bookmark) => buildBookmarkRowData(bookmark.hash)),
      );
      writeCinenerdleItemAttrs(parsedJsonl.itemAttrs);
      setBookmarkRows(nextBookmarkRows);
      setBookmarksJsonlDraft(serializeBookmarksAsJsonl(persistedBookmarks, nextBookmarkRows));
      setIsBookmarksJsonlEditorOpen(false);
      onToast("Bookmarks updated");
    } catch (error: unknown) {
      onToast(
        error instanceof Error && error.message
          ? error.message
          : "Bookmark text failed",
      );
    }
  }, [bookmarksJsonlDraft, onToast, persistBookmarks]);

  const handleSaveBookmark = useCallback(() => {
    const normalizedHash = normalizeHashValue(hashValue);
    const existingBookmark = bookmarksRef.current.find((bookmark) => bookmark.hash === normalizedHash);

    if (!normalizedHash) {
      onToast("Bookmark failed");
      return;
    }

    setIsSavingBookmark(true);
    void persistBookmarks(upsertBookmarkEntry(bookmarksRef.current, { hash: normalizedHash }))
      .then((persistedBookmarks) => {
        if (persistedBookmarks) {
          onToast(existingBookmark ? "Bookmark updated" : "Bookmark saved");
        }
      })
      .finally(() => {
        setIsSavingBookmark(false);
      });
  }, [hashValue, onToast, persistBookmarks]);

  const displayedBookmarkRows = useMemo(
    () => bookmarkRows.length === bookmarks.length
      ? bookmarkRows
      : bookmarks.map((bookmark) => createBookmarkRowPlaceholder(bookmark.hash)),
    [bookmarkRows, bookmarks],
  );

  return {
    bookmarks,
    bookmarksJsonlDraft,
    bookmarksJsonlTextareaRef,
    displayedBookmarkRows,
    handleApplyBookmarksJsonl,
    handleMoveBookmark: (bookmarkHash: string, direction: "up" | "down") =>
      void persistBookmarks(moveBookmarkEntry(bookmarksRef.current, bookmarkHash, direction)),
    handleOpenBookmarksJsonlEditor: () => {
      void refreshBookmarkRows(bookmarksRef.current)
        .finally(() => {
          setIsBookmarksJsonlEditorOpen(true);
        });
    },
    handleCloseBookmarksJsonlEditor: () => setIsBookmarksJsonlEditorOpen(false),
    handleRemoveBookmark: (bookmarkHash: string) =>
      void persistBookmarks(removeBookmarkEntry(bookmarksRef.current, bookmarkHash)),
    handleResetBookmarksJsonlDraft: () =>
      setBookmarksJsonlDraft(resetBookmarksJsonlDraft(serializedBookmarksJsonl)),
    handleSaveBookmark,
    isBookmarksJsonlDraftDirty,
    isBookmarksJsonlEditorOpen,
    isSavingBookmark,
    setBookmarksJsonlDraft,
  };
}

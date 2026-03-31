import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadBookmarks,
  moveBookmarkEntry,
  parseBookmarksJsonl,
  removeBookmarkEntry,
  saveBookmarks,
  serializeBookmarksAsJsonl,
  upsertBookmarkEntry,
  type BookmarkEntry,
} from "./bookmarks";
import { buildBookmarkRowData, createBookmarkRowPlaceholder, type BookmarkRowData } from "./bookmark_rows";
import { normalizeHashValue } from "./generators/cinenerdle2/hash";
import {
  batchCinenerdleRecordsUpdatedEvents,
  CINENERDLE_RECORDS_UPDATED_EVENT,
} from "./generators/cinenerdle2/indexed_db";
import { hydrateHashPathItems } from "./generators/cinenerdle2/controller";

export function isBookmarksJsonlDraftChanged(
  serializedBookmarksJsonl: string,
  bookmarksJsonlDraft: string,
): boolean {
  return bookmarksJsonlDraft !== serializedBookmarksJsonl;
}

export function resetBookmarksJsonlDraft(serializedBookmarksJsonl: string): string {
  return serializedBookmarksJsonl;
}

export function useBookmarksState({
  hashValue,
  isCinenerdleIndexedDbBootstrapLoading,
  onToast,
}: {
  hashValue: string;
  isCinenerdleIndexedDbBootstrapLoading: boolean;
  onToast: (message: string) => void;
}) {
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [bookmarkRows, setBookmarkRows] = useState<BookmarkRowData[]>([]);
  const [isBookmarksJsonlEditorOpen, setIsBookmarksJsonlEditorOpen] = useState(false);
  const [bookmarksJsonlDraft, setBookmarksJsonlDraft] = useState("");
  const [isSavingBookmark, setIsSavingBookmark] = useState(false);
  const bookmarksRef = useRef<BookmarkEntry[]>([]);
  const bookmarksPersistenceRequestIdRef = useRef(0);
  const serializedBookmarksJsonlRef = useRef("");
  const bookmarksJsonlTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const serializedBookmarksJsonl = serializeBookmarksAsJsonl(bookmarks);

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
    let cancelled = false;

    if (isCinenerdleIndexedDbBootstrapLoading || bookmarks.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void batchCinenerdleRecordsUpdatedEvents(async () => {
      for (const bookmark of bookmarks) {
        if (cancelled) {
          return;
        }

        await hydrateHashPathItems(bookmark.hash, {
          forceRefreshSelectedPath: false,
        });
      }
    }).catch(() => { });

    return () => {
      cancelled = true;
    };
  }, [bookmarks, isCinenerdleIndexedDbBootstrapLoading]);

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
      const persistedBookmarks = await persistBookmarks(parseBookmarksJsonl(bookmarksJsonlDraft));
      if (!persistedBookmarks) {
        return;
      }

      setBookmarksJsonlDraft(serializeBookmarksAsJsonl(persistedBookmarks));
      setIsBookmarksJsonlEditorOpen(false);
      onToast("Bookmarks updated");
    } catch (error: unknown) {
      onToast(
        error instanceof Error && error.message
          ? error.message
          : "Bookmark JSONL failed",
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
    handleOpenBookmarksJsonlEditor: () => setIsBookmarksJsonlEditorOpen(true),
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

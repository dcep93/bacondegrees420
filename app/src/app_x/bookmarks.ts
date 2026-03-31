import {
  getPersistedBookmarkHashes,
  replacePersistedBookmarkHashes,
} from "./generators/cinenerdle2/indexed_db";
import { normalizeHashValue } from "./generators/cinenerdle2/hash";

export const BOOKMARKS_STORAGE_KEY = "bacondegrees420.bookmarks.v1";

export type AppViewMode = "generator" | "bookmarks";

export type BookmarkEntry = {
  hash: string;
};

function normalizeBookmarkHash(hash: string): string {
  return normalizeHashValue(hash);
}

function isBookmarkEntryLike(value: unknown): value is { hash: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { hash?: unknown }).hash === "string",
  );
}

export function normalizeBookmarkEntries(value: unknown): BookmarkEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenHashes = new Set<string>();
  const normalizedBookmarks: BookmarkEntry[] = [];

  value.forEach((candidateBookmark) => {
    const candidateHash =
      typeof candidateBookmark === "string"
        ? candidateBookmark
        : isBookmarkEntryLike(candidateBookmark)
          ? candidateBookmark.hash
          : "";
    const normalizedHash = normalizeBookmarkHash(candidateHash);

    if (!normalizedHash || seenHashes.has(normalizedHash)) {
      return;
    }

    seenHashes.add(normalizedHash);
    normalizedBookmarks.push({
      hash: normalizedHash,
    });
  });

  return normalizedBookmarks;
}

function readLegacyBookmarksFromLocalStorage(): BookmarkEntry[] {
  try {
    const rawBookmarks = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!rawBookmarks) {
      return [];
    }

    return normalizeBookmarkEntries(JSON.parse(rawBookmarks));
  } catch {
    return [];
  }
}

async function migrateLegacyBookmarksToIndexedDb(): Promise<BookmarkEntry[]> {
  const legacyBookmarks = readLegacyBookmarksFromLocalStorage();
  if (legacyBookmarks.length === 0) {
    return [];
  }

  const migratedHashes = await replacePersistedBookmarkHashes(
    legacyBookmarks.map((bookmark) => bookmark.hash),
  );

  try {
    localStorage.removeItem(BOOKMARKS_STORAGE_KEY);
  } catch {
    // Ignore localStorage cleanup failures after a successful migration write.
  }

  return migratedHashes.map((hash) => ({ hash }));
}

export async function loadBookmarks(): Promise<BookmarkEntry[]> {
  const persistedHashes = await getPersistedBookmarkHashes();
  if (persistedHashes.length > 0) {
    return persistedHashes.map((hash) => ({ hash }));
  }

  return migrateLegacyBookmarksToIndexedDb();
}

export async function saveBookmarks(bookmarks: BookmarkEntry[]): Promise<BookmarkEntry[]> {
  const normalizedBookmarks = normalizeBookmarkEntries(bookmarks);
  const persistedHashes = await replacePersistedBookmarkHashes(
    normalizedBookmarks.map((bookmark) => bookmark.hash),
  );

  return persistedHashes.map((hash) => ({ hash }));
}

export function serializeBookmarksAsJsonl(bookmarks: BookmarkEntry[]): string {
  return normalizeBookmarkEntries(bookmarks)
    .map((bookmark) => bookmark.hash)
    .join("\n");
}

export function parseBookmarksJsonl(jsonlText: string): BookmarkEntry[] {
  const parsedLines = jsonlText
    .split(/\r?\n/)
    .map((line, index) => ({
      line: line.trim(),
      lineNumber: index + 1,
    }))
    .filter(({ line }) => Boolean(line));

  if (parsedLines.length === 0) {
    return [];
  }

  const seenHashes = new Set<string>();

  return parsedLines.map(({ line, lineNumber }) => {
    const normalizedHash = normalizeBookmarkHash(line);
    if (!normalizedHash) {
      throw new Error(`Bookmark JSONL line ${lineNumber} is not a valid hash`);
    }

    if (seenHashes.has(normalizedHash)) {
      throw new Error(`Bookmark JSONL line ${lineNumber} is a duplicate hash`);
    }

    seenHashes.add(normalizedHash);
    return {
      hash: normalizedHash,
    };
  });
}

export async function replaceBookmarks(bookmarks: BookmarkEntry[]): Promise<BookmarkEntry[]> {
  return saveBookmarks(bookmarks);
}

export function mergeMissingBookmarks(
  currentBookmarks: BookmarkEntry[],
  incomingBookmarks: unknown,
): BookmarkEntry[] {
  const normalizedCurrentBookmarks = normalizeBookmarkEntries(currentBookmarks);
  const existingHashes = new Set(
    normalizedCurrentBookmarks.map((bookmark) => bookmark.hash),
  );
  const missingBookmarks = normalizeBookmarkEntries(incomingBookmarks).filter((bookmark) => {
    if (existingHashes.has(bookmark.hash)) {
      return false;
    }

    existingHashes.add(bookmark.hash);
    return true;
  });

  if (missingBookmarks.length === 0) {
    return normalizedCurrentBookmarks;
  }

  return [...normalizedCurrentBookmarks, ...missingBookmarks];
}

export function upsertBookmarkEntry(
  currentBookmarks: BookmarkEntry[],
  nextBookmark: BookmarkEntry,
): BookmarkEntry[] {
  const normalizedBookmark = normalizeBookmarkEntries([nextBookmark])[0];
  if (!normalizedBookmark) {
    return normalizeBookmarkEntries(currentBookmarks);
  }

  const dedupedBookmarks = normalizeBookmarkEntries(currentBookmarks).filter(
    (bookmark) => bookmark.hash !== normalizedBookmark.hash,
  );
  return [normalizedBookmark, ...dedupedBookmarks];
}

export function removeBookmarkEntry(
  currentBookmarks: BookmarkEntry[],
  bookmarkHash: string,
): BookmarkEntry[] {
  const normalizedBookmarkHash = normalizeBookmarkHash(bookmarkHash);
  return normalizeBookmarkEntries(currentBookmarks).filter(
    (bookmark) => bookmark.hash !== normalizedBookmarkHash,
  );
}

export function moveBookmarkEntry(
  currentBookmarks: BookmarkEntry[],
  bookmarkHash: string,
  direction: "up" | "down",
): BookmarkEntry[] {
  const normalizedBookmarkHash = normalizeBookmarkHash(bookmarkHash);
  const normalizedBookmarks = normalizeBookmarkEntries(currentBookmarks);
  const bookmarkIndex = normalizedBookmarks.findIndex(
    (bookmark) => bookmark.hash === normalizedBookmarkHash,
  );
  if (bookmarkIndex < 0) {
    return normalizedBookmarks;
  }

  const nextIndex = direction === "up" ? bookmarkIndex - 1 : bookmarkIndex + 1;
  if (nextIndex < 0 || nextIndex >= normalizedBookmarks.length) {
    return normalizedBookmarks;
  }

  const nextBookmarks = [...normalizedBookmarks];
  const [movedBookmark] = nextBookmarks.splice(bookmarkIndex, 1);
  nextBookmarks.splice(nextIndex, 0, movedBookmark);
  return nextBookmarks;
}

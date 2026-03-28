import type { BookmarkPreviewCard } from "./components/bookmark_preview";
import { normalizeHashValue } from "./generators/cinenerdle2/hash";

const BOOKMARKS_STORAGE_KEY = "bacondegrees420.bookmarks.v1";

export type AppViewMode = "generator" | "bookmarks";

export type BookmarkEntry = {
  id: string;
  hash: string;
  savedAt: string;
  label: string;
  previewCards: BookmarkPreviewCard[];
  selectedPreviewCardIndices: number[];
};

function sanitizeSelectedPreviewCardIndices(
  previewCards: BookmarkPreviewCard[],
  selectedPreviewCardIndices: number[] | undefined,
) {
  return Array.from(
    new Set(
      (selectedPreviewCardIndices ?? []).filter((value) =>
        Number.isInteger(value) && value >= 0 && value < previewCards.length
      ),
    ),
  ).sort((left, right) => left - right);
}

function isBookmarkPreviewCard(value: unknown): value is BookmarkPreviewCard {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<BookmarkPreviewCard>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.subtitle === "string" &&
    typeof candidate.subtitleDetail === "string" &&
    typeof candidate.popularity === "number" &&
    (candidate.connectionCount === null || typeof candidate.connectionCount === "number") &&
    Array.isArray(candidate.sources) &&
    typeof candidate.hasCachedTmdbSource === "boolean"
  );
}

function isBookmarkEntry(value: unknown): value is BookmarkEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<BookmarkEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.hash === "string" &&
    typeof candidate.savedAt === "string" &&
    typeof candidate.label === "string" &&
    Array.isArray(candidate.previewCards) &&
    candidate.previewCards.every(isBookmarkPreviewCard) &&
    (
      candidate.selectedPreviewCardIndices === undefined ||
      (
        Array.isArray(candidate.selectedPreviewCardIndices) &&
        candidate.selectedPreviewCardIndices.every((value) => typeof value === "number")
      )
    )
  );
}

function normalizeBookmarkEntry(bookmark: BookmarkEntry): BookmarkEntry {
  return {
    ...bookmark,
    hash: normalizeHashValue(bookmark.hash),
    label: bookmark.label.trim(),
    selectedPreviewCardIndices: sanitizeSelectedPreviewCardIndices(
      bookmark.previewCards,
      bookmark.selectedPreviewCardIndices,
    ),
  };
}

export function createBookmarkId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `bookmark-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function loadBookmarks(): BookmarkEntry[] {
  try {
    const rawBookmarks = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!rawBookmarks) {
      return [];
    }

    const parsedBookmarks = JSON.parse(rawBookmarks);
    if (!Array.isArray(parsedBookmarks)) {
      return [];
    }

    return parsedBookmarks
      .filter(isBookmarkEntry)
      .map((bookmark) => normalizeBookmarkEntry({
        ...bookmark,
        selectedPreviewCardIndices: bookmark.selectedPreviewCardIndices ?? [],
      }))
      .filter((bookmark) => bookmark.label && bookmark.previewCards.length > 0);
  } catch (error) {
    console.error("bacondegrees420.loadBookmarks", error);
    return [];
  }
}

export function saveBookmarks(bookmarks: BookmarkEntry[]) {
  localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks));
}

export function upsertBookmarkEntry(
  currentBookmarks: BookmarkEntry[],
  nextBookmark: BookmarkEntry,
): BookmarkEntry[] {
  const normalizedBookmark = normalizeBookmarkEntry(nextBookmark);
  const normalizedHash = normalizedBookmark.hash;
  const dedupedBookmarks = currentBookmarks.filter((bookmark) => bookmark.hash !== normalizedHash);
  const nextBookmarks = [normalizedBookmark, ...dedupedBookmarks];

  saveBookmarks(nextBookmarks);
  return nextBookmarks;
}

export function removeBookmarkEntry(
  currentBookmarks: BookmarkEntry[],
  bookmarkId: string,
): BookmarkEntry[] {
  const nextBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
  saveBookmarks(nextBookmarks);
  return nextBookmarks;
}

export function moveBookmarkEntry(
  currentBookmarks: BookmarkEntry[],
  bookmarkId: string,
  direction: "up" | "down",
): BookmarkEntry[] {
  const bookmarkIndex = currentBookmarks.findIndex((bookmark) => bookmark.id === bookmarkId);
  if (bookmarkIndex < 0) {
    return currentBookmarks;
  }

  const nextIndex = direction === "up" ? bookmarkIndex - 1 : bookmarkIndex + 1;
  if (nextIndex < 0 || nextIndex >= currentBookmarks.length) {
    return currentBookmarks;
  }

  const nextBookmarks = [...currentBookmarks];
  const [movedBookmark] = nextBookmarks.splice(bookmarkIndex, 1);
  nextBookmarks.splice(nextIndex, 0, movedBookmark);
  saveBookmarks(nextBookmarks);
  return nextBookmarks;
}

export function toggleBookmarkPreviewCardSelection(
  currentBookmarks: BookmarkEntry[],
  bookmarkId: string,
  previewCardIndex: number,
): BookmarkEntry[] {
  const bookmarkIndex = currentBookmarks.findIndex((bookmark) => bookmark.id === bookmarkId);
  if (bookmarkIndex < 0) {
    return currentBookmarks;
  }

  const currentBookmark = currentBookmarks[bookmarkIndex];
  if (previewCardIndex < 0 || previewCardIndex >= currentBookmark.previewCards.length) {
    return currentBookmarks;
  }

  const isSelected = currentBookmark.selectedPreviewCardIndices.includes(previewCardIndex);
  const nextSelectedPreviewCardIndices = isSelected
    ? currentBookmark.selectedPreviewCardIndices.filter((value) => value !== previewCardIndex)
    : [...currentBookmark.selectedPreviewCardIndices, previewCardIndex];
  const nextBookmarks = [...currentBookmarks];
  nextBookmarks[bookmarkIndex] = normalizeBookmarkEntry({
    ...currentBookmark,
    selectedPreviewCardIndices: nextSelectedPreviewCardIndices,
  });
  saveBookmarks(nextBookmarks);
  return nextBookmarks;
}

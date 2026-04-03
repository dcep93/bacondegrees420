import {
  getPersistedBookmarkHashes,
  replacePersistedBookmarkHashes,
} from "./generators/cinenerdle2/indexed_db";
import { normalizeHashValue } from "./generators/cinenerdle2/hash";
import {
  getCinenerdleItemAttrTargetFromCard,
  normalizeItemAttrChars,
  readCinenerdleItemAttrs,
  type CinenerdleItemAttrTarget,
  type CinenerdleItemAttrs,
} from "./generators/cinenerdle2/item_attrs";
import type { BookmarkRowData } from "./bookmark_rows";

export const BOOKMARKS_STORAGE_KEY = "bacondegrees420.bookmarks.v1";

export type AppViewMode = "generator" | "bookmarks";

export type BookmarkEntry = {
  hash: string;
};

export type ParsedBookmarksJsonl = {
  bookmarks: BookmarkEntry[];
  itemAttrs: CinenerdleItemAttrs;
  itemAttrRows: ParsedBookmarkItemAttrRow[];
};

export type ParsedBookmarkItemAttrRow = {
  bucket: CinenerdleItemAttrTarget["bucket"];
  chars: string[];
  id: string;
  lineNumber: number;
  name: string;
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

function createEmptyParsedItemAttrs(): CinenerdleItemAttrs {
  return {
    film: {},
    person: {},
  };
}

function mergeParsedItemAttr(
  itemAttrs: CinenerdleItemAttrs,
  target: Pick<CinenerdleItemAttrTarget, "bucket" | "id">,
  candidateChars: string[],
): void {
  const currentChars = itemAttrs[target.bucket][target.id] ?? [];
  itemAttrs[target.bucket][target.id] = normalizeItemAttrChars([
    ...currentChars,
    ...candidateChars,
  ]);
}

export function getBookmarkRowItemAttrTargets(bookmarkRow: BookmarkRowData): CinenerdleItemAttrTarget[] {
  const targets: CinenerdleItemAttrTarget[] = [];
  const seenTargets = new Set<string>();

  bookmarkRow.cards.forEach((rowCard) => {
    if (rowCard.kind !== "card" || rowCard.card.kind === "cinenerdle") {
      return;
    }

    const target = getCinenerdleItemAttrTargetFromCard({
      key: rowCard.card.key,
      kind: rowCard.card.kind,
      name: rowCard.card.name,
    });
    if (!target) {
      return;
    }

    const fingerprint = `${target.bucket}:${target.id}`;
    if (seenTargets.has(fingerprint)) {
      return;
    }

    seenTargets.add(fingerprint);
    targets.push(target);
  });

  return targets;
}

function serializeBookmarkItemAttrRows(
  bookmarkRowsByHash: Map<string, BookmarkRowData>,
  bookmarks: BookmarkEntry[],
): string[] {
  const itemAttrs = readCinenerdleItemAttrs();
  const seenTargets = new Set<string>();
  const serializedAttrRows: string[] = [];

  normalizeBookmarkEntries(bookmarks).forEach((bookmark) => {
    const bookmarkRow = bookmarkRowsByHash.get(bookmark.hash);
    if (!bookmarkRow) {
      return;
    }

    getBookmarkRowItemAttrTargets(bookmarkRow).forEach((target) => {
      const fingerprint = `${target.bucket}:${target.id}`;
      if (seenTargets.has(fingerprint)) {
        return;
      }

      seenTargets.add(fingerprint);
      const targetChars = itemAttrs[target.bucket][target.id] ?? [];
      if (targetChars.length === 0) {
        return;
      }

      serializedAttrRows.push(`${target.id}:${target.bucket}:${target.name} ${targetChars.join("")}`);
    });
  });

  return serializedAttrRows;
}

export function serializeBookmarksAsJsonl(
  bookmarks: BookmarkEntry[],
  bookmarkRows: BookmarkRowData[] = [],
): string {
  const bookmarkRowsByHash = new Map(
    bookmarkRows.map((bookmarkRow) => [normalizeBookmarkHash(bookmarkRow.hash), bookmarkRow]),
  );

  const normalizedBookmarks = normalizeBookmarkEntries(bookmarks);
  const serializedBookmarkRows = normalizedBookmarks.map((bookmark) => bookmark.hash);
  const serializedAttrRows = serializeBookmarkItemAttrRows(bookmarkRowsByHash, normalizedBookmarks);

  return [...serializedBookmarkRows, ...serializedAttrRows].join("\n");
}

function createBookmarkTextError(lineNumber: number, message: string): Error {
  return new Error(`Bookmark text line ${lineNumber} ${message}`);
}

function createUnsupportedInlineAttrError(lineNumber: number): Error {
  return createBookmarkTextError(lineNumber, "uses unsupported inline attr syntax");
}

function parseBookmarkItemAttrRow(line: string, lineNumber: number): ParsedBookmarkItemAttrRow {
  if (/\[(film|person):/u.test(line)) {
    throw createUnsupportedInlineAttrError(lineNumber);
  }

  const bucketDelimiterMatch = line.match(/:(film|person):/u);
  const lastSpaceIndex = line.lastIndexOf(" ");
  if (!bucketDelimiterMatch || typeof bucketDelimiterMatch.index !== "number") {
    throw createBookmarkTextError(lineNumber, "has an invalid attr row");
  }

  const bucketDelimiterIndex = bucketDelimiterMatch.index;
  const bucket = bucketDelimiterMatch[1] as CinenerdleItemAttrTarget["bucket"];
  const id = line.slice(0, bucketDelimiterIndex).trim();
  const nameStartIndex = bucketDelimiterIndex + bucketDelimiterMatch[0].length;

  if (!id || lastSpaceIndex < nameStartIndex || lastSpaceIndex >= line.length - 1) {
    throw createBookmarkTextError(lineNumber, "has an invalid attr row");
  }

  const name = line.slice(nameStartIndex, lastSpaceIndex).trim();
  const chars = normalizeItemAttrChars(line.slice(lastSpaceIndex + 1));
  if (!name || chars.length === 0) {
    throw createBookmarkTextError(lineNumber, "has an invalid attr row");
  }

  return {
    bucket,
    chars,
    id,
    lineNumber,
    name,
  };
}

export function parseBookmarksJsonlWithItemAttrs(jsonlText: string): ParsedBookmarksJsonl {
  const parsedLines = jsonlText
    .split(/\r?\n/)
    .map((line, index) => ({
      line: line.trim(),
      lineNumber: index + 1,
    }))
    .filter(({ line }) => Boolean(line));

  if (parsedLines.length === 0) {
    return {
      bookmarks: [],
      itemAttrs: createEmptyParsedItemAttrs(),
      itemAttrRows: [],
    };
  }

  const seenHashes = new Set<string>();
  const seenItemAttrTargets = new Set<string>();
  const parsedBookmarks: BookmarkEntry[] = [];
  const parsedItemAttrs = createEmptyParsedItemAttrs();
  const parsedItemAttrRows: ParsedBookmarkItemAttrRow[] = [];
  let hasSeenAttrRows = false;

  parsedLines.forEach(({ line, lineNumber }) => {
    if (/\[(film|person):/u.test(line)) {
      throw createUnsupportedInlineAttrError(lineNumber);
    }

    const normalizedHash = normalizeBookmarkHash(line);
    if (normalizedHash) {
      if (hasSeenAttrRows) {
        throw createBookmarkTextError(lineNumber, "must appear before attr rows");
      }

      if (seenHashes.has(normalizedHash)) {
        throw createBookmarkTextError(lineNumber, "is a duplicate hash");
      }

      seenHashes.add(normalizedHash);
      parsedBookmarks.push({
        hash: normalizedHash,
      });
      return;
    }

    if (!hasSeenAttrRows && !/:(film|person):/u.test(line)) {
      throw createBookmarkTextError(lineNumber, "is not a valid hash");
    }

    const parsedItemAttrRow = parseBookmarkItemAttrRow(line, lineNumber);
    const fingerprint = `${parsedItemAttrRow.bucket}:${parsedItemAttrRow.id}`;
    if (seenItemAttrTargets.has(fingerprint)) {
      throw createBookmarkTextError(lineNumber, "is a duplicate attr row");
    }

    hasSeenAttrRows = true;
    seenItemAttrTargets.add(fingerprint);
    parsedItemAttrRows.push(parsedItemAttrRow);
    mergeParsedItemAttr(
      parsedItemAttrs,
      {
        bucket: parsedItemAttrRow.bucket,
        id: parsedItemAttrRow.id,
      },
      parsedItemAttrRow.chars,
    );
  });

  return {
    bookmarks: parsedBookmarks,
    itemAttrs: parsedItemAttrs,
    itemAttrRows: parsedItemAttrRows,
  };
}

export function parseBookmarksJsonl(jsonlText: string): BookmarkEntry[] {
  return parseBookmarksJsonlWithItemAttrs(jsonlText).bookmarks;
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

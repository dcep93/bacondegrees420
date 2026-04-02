import {
  getPersistedBookmarkHashes,
  replacePersistedBookmarkHashes,
} from "./generators/cinenerdle2/indexed_db";
import { normalizeHashValue } from "./generators/cinenerdle2/hash";
import {
  decodeItemAttrToken,
  encodeItemAttrToken,
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

function serializeBookmarkItemAttrTags(bookmarkRow: BookmarkRowData | undefined): string[] {
  if (!bookmarkRow) {
    return [];
  }

  const itemAttrs = readCinenerdleItemAttrs();
  return getBookmarkRowItemAttrTargets(bookmarkRow)
    .map((target) => {
      const targetChars = itemAttrs[target.bucket][target.id] ?? [];
      if (targetChars.length === 0) {
        return "";
      }

      return `[${target.bucket}:${encodeItemAttrToken(target.id)}=${targetChars.join("")}]`;
    })
    .filter(Boolean);
}

export function serializeBookmarksAsJsonl(
  bookmarks: BookmarkEntry[],
  bookmarkRows: BookmarkRowData[] = [],
): string {
  const bookmarkRowsByHash = new Map(
    bookmarkRows.map((bookmarkRow) => [normalizeBookmarkHash(bookmarkRow.hash), bookmarkRow]),
  );

  return normalizeBookmarkEntries(bookmarks)
    .map((bookmark) => {
      const attrTags = serializeBookmarkItemAttrTags(bookmarkRowsByHash.get(bookmark.hash));
      return attrTags.length > 0 ? `${bookmark.hash} ${attrTags.join(" ")}` : bookmark.hash;
    })
    .join("\n");
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
    };
  }

  const seenHashes = new Set<string>();
  const parsedBookmarks: BookmarkEntry[] = [];
  const parsedItemAttrs = createEmptyParsedItemAttrs();

  parsedLines.forEach(({ line, lineNumber }) => {
    const tagStartIndex = line.search(/\s+\[(film|person):/u);
    const rawHash = tagStartIndex >= 0 ? line.slice(0, tagStartIndex).trimEnd() : line;
    const rawTagText = tagStartIndex >= 0 ? line.slice(tagStartIndex) : "";
    const normalizedHash = normalizeBookmarkHash(rawHash);
    if (!normalizedHash) {
      throw new Error(`Bookmark JSONL line ${lineNumber} is not a valid hash`);
    }

    if (seenHashes.has(normalizedHash)) {
      throw new Error(`Bookmark JSONL line ${lineNumber} is a duplicate hash`);
    }

    seenHashes.add(normalizedHash);
    parsedBookmarks.push({
      hash: normalizedHash,
    });

    let remainingTagText = rawTagText;
    while (remainingTagText.trim().length > 0) {
      const nextTagMatch = remainingTagText.match(
        /^\s+\[(film|person):([^=\]]+)=([^\]\s]+)\]/u,
      );
      if (!nextTagMatch) {
        throw new Error(`Bookmark JSONL line ${lineNumber} has an invalid attr tag`);
      }

      const [, bucket, encodedId, rawChars] = nextTagMatch;
      const decodedId = decodeItemAttrToken(encodedId);
      const normalizedChars = normalizeItemAttrChars(rawChars);
      if (!decodedId || normalizedChars.length === 0) {
        throw new Error(`Bookmark JSONL line ${lineNumber} has an invalid attr tag`);
      }

      mergeParsedItemAttr(
        parsedItemAttrs,
        {
          bucket: bucket as CinenerdleItemAttrTarget["bucket"],
          id: decodedId,
        },
        normalizedChars,
      );
      remainingTagText = remainingTagText.slice(nextTagMatch[0].length);
    }
  });

  return {
    bookmarks: parsedBookmarks,
    itemAttrs: parsedItemAttrs,
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

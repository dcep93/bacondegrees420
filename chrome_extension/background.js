const BOOKMARKS_STORAGE_KEY = "bacondegrees420.bookmarks.v1";
const BOOKMARKS_INDEX_STORAGE_KEY = `${BOOKMARKS_STORAGE_KEY}.index.v2`;
const BOOKMARK_ENTRY_STORAGE_KEY_PREFIX = `${BOOKMARKS_STORAGE_KEY}.entry.v2.`;

function normalizeHashValue(hash) {
  if (typeof hash !== "string") {
    return "";
  }

  const trimmedHash = hash.trim();
  if (!trimmedHash) {
    return "";
  }

  return trimmedHash.startsWith("#") ? trimmedHash : `#${trimmedHash}`;
}

function sanitizeSelectedPreviewCardIndices(previewCards, selectedPreviewCardIndices) {
  if (!Array.isArray(selectedPreviewCardIndices)) {
    return [];
  }

  return Array.from(
    new Set(
      selectedPreviewCardIndices.filter((value) =>
        Number.isInteger(value) && value >= 0 && value < previewCards.length
      ),
    ),
  ).sort((left, right) => left - right);
}

function isBookmarkPreviewCard(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    typeof value.key === "string" &&
    typeof value.kind === "string" &&
    typeof value.name === "string" &&
    typeof value.subtitle === "string" &&
    typeof value.subtitleDetail === "string" &&
    typeof value.popularity === "number" &&
    (value.connectionCount === null || typeof value.connectionCount === "number") &&
    Array.isArray(value.sources) &&
    typeof value.hasCachedTmdbSource === "boolean"
  );
}

function isBookmarkEntry(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.hash === "string" &&
    typeof value.savedAt === "string" &&
    typeof value.label === "string" &&
    Array.isArray(value.previewCards) &&
    value.previewCards.every(isBookmarkPreviewCard) &&
    (
      value.selectedPreviewCardIndices === undefined ||
      (
        Array.isArray(value.selectedPreviewCardIndices) &&
        value.selectedPreviewCardIndices.every((index) => typeof index === "number")
      )
    )
  );
}

function normalizeBookmarkEntry(bookmark) {
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

function normalizeBookmarkEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isBookmarkEntry)
    .map((bookmark) => normalizeBookmarkEntry({
      ...bookmark,
      selectedPreviewCardIndices: bookmark.selectedPreviewCardIndices ?? [],
    }))
    .filter((bookmark) => bookmark.label && bookmark.previewCards.length > 0);
}

function getBookmarkEntryStorageKey(bookmarkId) {
  return `${BOOKMARK_ENTRY_STORAGE_KEY_PREFIX}${bookmarkId}`;
}

function getBookmarkIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((bookmarkId) => typeof bookmarkId === "string" && bookmarkId)));
}

function getBookmarksFromChunkedStorage(storageRecord) {
  if (!(BOOKMARKS_INDEX_STORAGE_KEY in storageRecord)) {
    return null;
  }

  const bookmarkIds = getBookmarkIds(storageRecord[BOOKMARKS_INDEX_STORAGE_KEY]);
  return normalizeBookmarkEntries(
    bookmarkIds.map((bookmarkId) => storageRecord[getBookmarkEntryStorageKey(bookmarkId)]),
  );
}

function loadSyncedBookmarks(callback) {
  chrome.storage.sync.get(null, (storageRecord) => {
    if (chrome.runtime.lastError) {
      callback({
        error: chrome.runtime.lastError.message || "Failed to load synced bookmarks",
      });
      return;
    }

    const chunkedBookmarks = getBookmarksFromChunkedStorage(storageRecord);
    if (chunkedBookmarks !== null) {
      callback({ bookmarks: chunkedBookmarks });
      return;
    }

    callback({
      bookmarks: normalizeBookmarkEntries(storageRecord[BOOKMARKS_STORAGE_KEY]),
    });
  });
}

function saveSyncedBookmarks(bookmarks, callback) {
  const normalizedBookmarks = normalizeBookmarkEntries(bookmarks);

  chrome.storage.sync.get([BOOKMARKS_INDEX_STORAGE_KEY], (storageRecord) => {
    if (chrome.runtime.lastError) {
      callback({
        error: chrome.runtime.lastError.message || "Failed to inspect synced bookmarks",
      });
      return;
    }

    const previousBookmarkIds = getBookmarkIds(storageRecord[BOOKMARKS_INDEX_STORAGE_KEY]);
    const nextBookmarkIds = normalizedBookmarks.map((bookmark) => bookmark.id);
    const nextStorageRecord = {
      [BOOKMARKS_INDEX_STORAGE_KEY]: nextBookmarkIds,
    };

    normalizedBookmarks.forEach((bookmark) => {
      nextStorageRecord[getBookmarkEntryStorageKey(bookmark.id)] = bookmark;
    });

    const keysToRemove = Array.from(new Set([
      BOOKMARKS_STORAGE_KEY,
      ...previousBookmarkIds
        .filter((bookmarkId) => !nextBookmarkIds.includes(bookmarkId))
        .map((bookmarkId) => getBookmarkEntryStorageKey(bookmarkId)),
    ]));

    const persistNextStorageRecord = () => {
      chrome.storage.sync.set(nextStorageRecord, () => {
        if (chrome.runtime.lastError) {
          callback({
            error: chrome.runtime.lastError.message || "Failed to save synced bookmarks",
          });
          return;
        }

        logStorageUsage();
        callback({ bookmarks: normalizedBookmarks });
      });
    };

    if (keysToRemove.length === 0) {
      persistNextStorageRecord();
      return;
    }

    chrome.storage.sync.remove(keysToRemove, () => {
      if (chrome.runtime.lastError) {
        callback({
          error: chrome.runtime.lastError.message || "Failed to prune synced bookmarks",
        });
        return;
      }

      persistNextStorageRecord();
    });
  });
}

function logStorageUsage() {
  chrome.storage.sync.getBytesInUse(null, (bytesInUse) => {
    if (chrome.runtime.lastError) {
      console.error("Failed to measure BaconDegrees420 sync usage", chrome.runtime.lastError.message);
      return;
    }

    console.log(
      `BaconDegrees420 chrome.storage.sync usage: ${(bytesInUse / 1024).toFixed(2)} KB`,
    );
  });
}

chrome.runtime.onInstalled.addListener(() => {
  logStorageUsage();
});

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === "sync") {
    logStorageUsage();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "bookmarks:get") {
    loadSyncedBookmarks(sendResponse);
    return true;
  }

  if (message.type === "bookmarks:set") {
    saveSyncedBookmarks(message.bookmarks, sendResponse);
    return true;
  }

  return false;
});

logStorageUsage();

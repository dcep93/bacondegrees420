const BOOKMARKS_STORAGE_KEY = "bacondegrees420.bookmarks.v1";

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
    chrome.storage.sync.get([BOOKMARKS_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          error: chrome.runtime.lastError.message || "Failed to load synced bookmarks",
        });
        return;
      }

      sendResponse({
        bookmarks: normalizeBookmarkEntries(result[BOOKMARKS_STORAGE_KEY]),
      });
    });
    return true;
  }

  if (message.type === "bookmarks:set") {
    const normalizedBookmarks = normalizeBookmarkEntries(message.bookmarks);
    chrome.storage.sync.set({ [BOOKMARKS_STORAGE_KEY]: normalizedBookmarks }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({
          error: chrome.runtime.lastError.message || "Failed to save synced bookmarks",
        });
        return;
      }

      logStorageUsage();
      sendResponse({ bookmarks: normalizedBookmarks });
    });
    return true;
  }

  return false;
});

logStorageUsage();

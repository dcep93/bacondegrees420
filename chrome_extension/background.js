const BOOKMARKS_STORAGE_KEY = "bacondegrees420.bookmarks.v1";
const BOOKMARKS_INDEX_STORAGE_KEY = `${BOOKMARKS_STORAGE_KEY}.index.v2`;
const BOOKMARK_ENTRY_STORAGE_KEY_PREFIX = `${BOOKMARKS_STORAGE_KEY}.entry.v2.`;
const BOOKMARKS_DIRECTORY_STORAGE_KEY = `${BOOKMARKS_STORAGE_KEY}.directory.v3`;
const BOOKMARK_CHUNK_STORAGE_KEY_PREFIX = `${BOOKMARKS_STORAGE_KEY}.chunk.v3.`;
const BOOKMARK_CHUNK_SIZE = 6000;

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

function isChunkDirectory(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    value.version === 3 &&
    value.encoding === "gzip-base64-json" &&
    Array.isArray(value.chunkKeys) &&
    value.chunkKeys.every((chunkKey) => typeof chunkKey === "string")
  );
}

function getBookmarkEntryStorageKey(bookmarkId) {
  return `${BOOKMARK_ENTRY_STORAGE_KEY_PREFIX}${bookmarkId}`;
}

function getBookmarkChunkStorageKey(chunkIndex) {
  return `${BOOKMARK_CHUNK_STORAGE_KEY_PREFIX}${chunkIndex}`;
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

function splitIntoChunks(value, chunkSize) {
  const chunks = [];

  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }

  return chunks;
}

function uint8ArrayToBase64(bytes) {
  let binaryString = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    const slice = bytes.subarray(index, index + 0x8000);
    binaryString += String.fromCharCode(...slice);
  }

  return btoa(binaryString);
}

function base64ToUint8Array(base64Value) {
  const binaryString = atob(base64Value);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return bytes;
}

async function gzipJsonString(jsonString) {
  const compressionStream = new CompressionStream("gzip");
  const compressedBufferPromise = new Response(compressionStream.readable).arrayBuffer();
  const writer = compressionStream.writable.getWriter();
  await writer.write(new TextEncoder().encode(jsonString));
  await writer.close();
  const compressedBuffer = await compressedBufferPromise;
  return uint8ArrayToBase64(new Uint8Array(compressedBuffer));
}

async function gunzipJsonString(base64Value) {
  const decompressionStream = new DecompressionStream("gzip");
  const decompressedBufferPromise = new Response(decompressionStream.readable).arrayBuffer();
  const writer = decompressionStream.writable.getWriter();
  await writer.write(base64ToUint8Array(base64Value));
  await writer.close();
  const decompressedBuffer = await decompressedBufferPromise;
  return new TextDecoder().decode(decompressedBuffer);
}

function getStorageSync(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(values, (storageRecord) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "Failed to read chrome.storage.sync"));
        return;
      }

      resolve(storageRecord);
    });
  });
}

function setStorageSync(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "Failed to write chrome.storage.sync"));
        return;
      }

      resolve();
    });
  });
}

function removeStorageSync(keys) {
  return new Promise((resolve, reject) => {
    if (keys.length === 0) {
      resolve();
      return;
    }

    chrome.storage.sync.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "Failed to remove chrome.storage.sync keys"));
        return;
      }

      resolve();
    });
  });
}

async function loadCompressedBookmarksFromStorage(storageRecord) {
  const directory = storageRecord[BOOKMARKS_DIRECTORY_STORAGE_KEY];
  if (!isChunkDirectory(directory)) {
    return null;
  }

  const chunkRecord = await getStorageSync(directory.chunkKeys);
  const compressedPayload = directory.chunkKeys
    .map((chunkKey) => (typeof chunkRecord[chunkKey] === "string" ? chunkRecord[chunkKey] : ""))
    .join("");

  if (!compressedPayload) {
    return [];
  }

  const jsonString = await gunzipJsonString(compressedPayload);
  return normalizeBookmarkEntries(JSON.parse(jsonString));
}

async function loadSyncedBookmarksData() {
  const storageRecord = await getStorageSync(null);

  try {
    const compressedBookmarks = await loadCompressedBookmarksFromStorage(storageRecord);
    if (compressedBookmarks !== null) {
      return compressedBookmarks;
    }
  } catch (error) {
    console.error(
      "Failed to load compressed BaconDegrees420 bookmark payload",
      error instanceof Error ? error.message : error,
    );
  }

  const chunkedBookmarks = getBookmarksFromChunkedStorage(storageRecord);
  if (chunkedBookmarks !== null) {
    return chunkedBookmarks;
  }

  return normalizeBookmarkEntries(storageRecord[BOOKMARKS_STORAGE_KEY]);
}

function loadSyncedBookmarks(callback) {
  loadSyncedBookmarksData()
    .then((bookmarks) => {
      callback({ bookmarks });
    })
    .catch((error) => {
      console.error(
        "Failed to load BaconDegrees420 synced bookmarks",
        error instanceof Error ? error.message : error,
      );
      callback({
        error: error instanceof Error ? error.message : "Failed to load synced bookmarks",
      });
    });
}

async function saveSyncedBookmarksData(bookmarks) {
  const normalizedBookmarks = normalizeBookmarkEntries(bookmarks);
  const currentStorageRecord = await getStorageSync(null);
  const jsonString = JSON.stringify(normalizedBookmarks);
  const compressedPayload = await gzipJsonString(jsonString);
  const compressedChunks = splitIntoChunks(compressedPayload, BOOKMARK_CHUNK_SIZE);
  const nextChunkKeys = compressedChunks.map((_, chunkIndex) => getBookmarkChunkStorageKey(chunkIndex));
  const directory = {
    version: 3,
    encoding: "gzip-base64-json",
    chunkKeys: nextChunkKeys,
    bookmarkCount: normalizedBookmarks.length,
    jsonLength: jsonString.length,
    compressedLength: compressedPayload.length,
  };
  const nextStorageRecord = {
    [BOOKMARKS_DIRECTORY_STORAGE_KEY]: directory,
  };

  compressedChunks.forEach((chunkValue, chunkIndex) => {
    nextStorageRecord[nextChunkKeys[chunkIndex]] = chunkValue;
  });

  const previousDirectory = currentStorageRecord[BOOKMARKS_DIRECTORY_STORAGE_KEY];
  const previousChunkKeys = isChunkDirectory(previousDirectory) ? previousDirectory.chunkKeys : [];
  const legacyKeys = Object.keys(currentStorageRecord).filter((storageKey) =>
    storageKey === BOOKMARKS_STORAGE_KEY ||
    storageKey === BOOKMARKS_INDEX_STORAGE_KEY ||
    storageKey === BOOKMARKS_DIRECTORY_STORAGE_KEY ||
    storageKey.startsWith(BOOKMARK_ENTRY_STORAGE_KEY_PREFIX) ||
    storageKey.startsWith(BOOKMARK_CHUNK_STORAGE_KEY_PREFIX),
  );
  const keysToRemove = Array.from(new Set(
    legacyKeys.filter((storageKey) =>
      storageKey !== BOOKMARKS_DIRECTORY_STORAGE_KEY &&
      !nextChunkKeys.includes(storageKey),
    ).concat(
      previousChunkKeys.filter((storageKey) => !nextChunkKeys.includes(storageKey)),
    ),
  ));

  await removeStorageSync(keysToRemove);
  await setStorageSync(nextStorageRecord);
  return normalizedBookmarks;
}

function saveSyncedBookmarks(bookmarks) {
  void saveSyncedBookmarksData(bookmarks)
    .catch((error) => {
      console.error(
        "Failed to save BaconDegrees420 synced bookmarks",
        error instanceof Error ? error.message : error,
      );
    });
}

function getStorageFormat(storageRecord) {
  if (isChunkDirectory(storageRecord[BOOKMARKS_DIRECTORY_STORAGE_KEY])) {
    return "v3";
  }

  if (BOOKMARKS_INDEX_STORAGE_KEY in storageRecord) {
    return "v2";
  }

  if (Array.isArray(storageRecord[BOOKMARKS_STORAGE_KEY])) {
    return "v1";
  }

  return "empty";
}

function getStorageUsageMetadata(storageRecord) {
  const directory = storageRecord[BOOKMARKS_DIRECTORY_STORAGE_KEY];
  if (isChunkDirectory(directory)) {
    return `format=v3 chunks=${directory.chunkKeys.length} bookmarks=${directory.bookmarkCount} json=${directory.jsonLength} compressed=${directory.compressedLength}`;
  }

  if (BOOKMARKS_INDEX_STORAGE_KEY in storageRecord) {
    const bookmarkIds = getBookmarkIds(storageRecord[BOOKMARKS_INDEX_STORAGE_KEY]);
    return `format=v2 bookmarks=${bookmarkIds.length}`;
  }

  if (Array.isArray(storageRecord[BOOKMARKS_STORAGE_KEY])) {
    return `format=v1 bookmarks=${normalizeBookmarkEntries(storageRecord[BOOKMARKS_STORAGE_KEY]).length}`;
  }

  return "format=empty";
}

async function migrateLegacySyncedBookmarksIfNeeded() {
  const storageRecord = await getStorageSync(null);
  const storageFormat = getStorageFormat(storageRecord);

  if (storageFormat === "v3" || storageFormat === "empty") {
    return;
  }

  const bookmarks =
    storageFormat === "v2"
      ? getBookmarksFromChunkedStorage(storageRecord)
      : normalizeBookmarkEntries(storageRecord[BOOKMARKS_STORAGE_KEY]);

  if (!bookmarks || bookmarks.length === 0) {
    return;
  }

  await saveSyncedBookmarksData(bookmarks);
}

function logStorageUsage() {
  chrome.storage.sync.get(null, (storageRecord) => {
    if (chrome.runtime.lastError) {
      console.error("Failed to inspect BaconDegrees420 sync usage", chrome.runtime.lastError.message);
      return;
    }

    chrome.storage.sync.getBytesInUse(null, (bytesInUse) => {
      if (chrome.runtime.lastError) {
        console.error("Failed to measure BaconDegrees420 sync usage", chrome.runtime.lastError.message);
        return;
      }

      console.log(
        `BaconDegrees420 chrome.storage.sync usage: ${(bytesInUse / 1024).toFixed(2)} KB ${getStorageUsageMetadata(storageRecord)}`,
      );
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void migrateLegacySyncedBookmarksIfNeeded()
    .catch((error) => {
      console.error(
        "Failed to migrate BaconDegrees420 synced bookmarks on install",
        error instanceof Error ? error.message : error,
      );
    })
    .finally(() => {
      logStorageUsage();
    });
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
    sendResponse({ accepted: true });
    saveSyncedBookmarks(message.bookmarks);
    return false;
  }

  return false;
});

void migrateLegacySyncedBookmarksIfNeeded()
  .catch((error) => {
    console.error(
      "Failed to migrate BaconDegrees420 synced bookmarks on startup",
      error instanceof Error ? error.message : error,
    );
  })
  .finally(() => {
    logStorageUsage();
  });

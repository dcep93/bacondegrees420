import {
  getIndexedDbSnapshot,
  getSearchableConnectionEntityPersistenceReadyMarkerValue,
  getSearchableConnectionEntityPersistenceStatus,
  inflateIndexedDbSnapshot,
  stringifyIndexedDbSnapshot,
} from "./indexed_db";
import { getCinenerdleIndexedDbBootstrapStatus } from "./bootstrap";
import {
  addCinenerdleDebugLog,
  clearCinenerdleDebugLog,
  getCinenerdleDebugEntries,
  getCinenerdleDebugEntriesMatching,
  getCinenerdleDebugEntryCount,
  removeCinenerdleDebugEntriesMatching,
} from "./debug_log";
import type { CinenerdleDebugEntry } from "./debug_log";

export {
  addCinenerdleDebugLog,
  clearCinenerdleDebugLog,
  getCinenerdleDebugEntryCount,
};

const EMPTY_DEBUG_LOG_TEXT = "[]";
const IS_DEV_MODE = import.meta.env.DEV;

export function getCinenerdleDebugNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function canUseDomClipboardFallback(): boolean {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

function canAttemptClipboardWrite(): boolean {
  return Boolean(navigator.clipboard?.writeText) || canUseDomClipboardFallback();
}

function copyTextWithDomFallback(text: string): boolean {
  if (!canUseDomClipboardFallback() || !document.body) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      if (copyTextWithDomFallback(text)) {
        return;
      }

      throw new Error("Clipboard copy failed. Focus this tab and try again.");
    }
  }

  if (copyTextWithDomFallback(text)) {
    return;
  }

  throw new Error("Clipboard API is unavailable.");
}

export function getCinenerdleDebugLogText(): string {
  const debugEntries = getCinenerdleDebugEntries();
  if (debugEntries.length === 0) {
    return EMPTY_DEBUG_LOG_TEXT;
  }

  return JSON.stringify(debugEntries, null, 2);
}

async function copyFilteredCinenerdleDebugEntriesToClipboard(
  predicate: (entry: CinenerdleDebugEntry) => boolean,
): Promise<number> {
  if (!IS_DEV_MODE) {
    throw new Error("Clipboard copy is only available in dev mode.");
  }

  if (!canAttemptClipboardWrite()) {
    throw new Error("Clipboard API is unavailable.");
  }

  const copiedEntries = getCinenerdleDebugEntriesMatching(predicate);
  const copiedEntryCount = copiedEntries.length;
  const copiedText =
    copiedEntryCount === 0
      ? EMPTY_DEBUG_LOG_TEXT
      : JSON.stringify(copiedEntries, null, 2);

  await writeTextToClipboard(copiedText);
  removeCinenerdleDebugEntriesMatching(predicate);
  return copiedEntryCount;
}

export async function copyCinenerdleTextToClipboard(
  text: string,
  _options?: {
    event?: string;
    details?: Record<string, unknown>;
    includeCopiedTextInDebugLog?: boolean;
  },
): Promise<void> {
  void _options;
  await writeTextToClipboard(text);
}

export async function copyCinenerdleDebugLogToClipboard(): Promise<number> {
  if (!IS_DEV_MODE) {
    throw new Error("Clipboard copy is only available in dev mode.");
  }

  if (!canAttemptClipboardWrite()) {
    throw new Error("Clipboard API is unavailable.");
  }

  const copiedEntries = getCinenerdleDebugEntries();
  const copiedEntryCount = copiedEntries.length;
  const copiedText =
    copiedEntryCount === 0
      ? EMPTY_DEBUG_LOG_TEXT
      : JSON.stringify(copiedEntries, null, 2);

  await writeTextToClipboard(copiedText);
  removeCinenerdleDebugEntriesMatching(() => true);
  return copiedEntryCount;
}

export async function copyCinenerdleBootstrapDebugLogToClipboard(): Promise<number> {
  return copyFilteredCinenerdleDebugEntriesToClipboard((entry) => entry.event.startsWith("bootstrap:"));
}

export async function copyCinenerdlePerfDebugLogToClipboard(): Promise<number> {
  return copyFilteredCinenerdleDebugEntriesToClipboard((entry) => entry.event.startsWith("perf:"));
}

export async function copyCinenerdleSearchablePersistenceDebugLogToClipboard(): Promise<number> {
  return copyFilteredCinenerdleDebugEntriesToClipboard((entry) =>
    entry.event.startsWith("searchable-persist:"));
}

function isCinenerdleRecoveryDebugEntry(event: string): boolean {
  return (
    event.startsWith("bootstrap:") ||
    event.startsWith("idb-reset:") ||
    event.startsWith("recovery:")
  );
}

function getCinenerdleRecoveryDebugLogText(): string {
  const bootstrapStatus = getCinenerdleIndexedDbBootstrapStatus();
  const searchablePersistenceStatus = getSearchableConnectionEntityPersistenceStatus();
  const recoveryEntries = getCinenerdleDebugEntriesMatching((entry) =>
    isCinenerdleRecoveryDebugEntry(entry.event));

  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      location:
        typeof window !== "undefined"
          ? {
              href: window.location.href,
              pathname: window.location.pathname,
              hash: window.location.hash,
            }
          : null,
      bootstrapStatus,
      searchablePersistenceStatus,
      searchablePersistenceReadyMarker: getSearchableConnectionEntityPersistenceReadyMarkerValue(),
      entries: recoveryEntries,
    },
    null,
    2,
  );
}

export async function copyCinenerdleRecoveryDebugLogToClipboard(): Promise<number> {
  if (!canAttemptClipboardWrite()) {
    throw new Error("Clipboard API is unavailable.");
  }

  const recoveryEntries = getCinenerdleDebugEntriesMatching((entry) =>
    isCinenerdleRecoveryDebugEntry(entry.event));

  await writeTextToClipboard(getCinenerdleRecoveryDebugLogText());
  removeCinenerdleDebugEntriesMatching((entry) => isCinenerdleRecoveryDebugEntry(entry.event));
  return recoveryEntries.length;
}

export async function copyCinenerdleIndexedDbSnapshotToClipboard(): Promise<{
  peopleCount: number;
  filmCount: number;
  searchableConnectionEntityCount: number;
}> {
  if (!canAttemptClipboardWrite()) {
    throw new Error("Clipboard API is unavailable.");
  }

  const snapshot = await getIndexedDbSnapshot();
  const inflatedSnapshot = inflateIndexedDbSnapshot(snapshot);
  await writeTextToClipboard(stringifyIndexedDbSnapshot(snapshot));

  return {
    peopleCount: snapshot.people.length,
    filmCount: snapshot.films.length,
    searchableConnectionEntityCount: inflatedSnapshot.searchableConnectionEntities.length,
  };
}

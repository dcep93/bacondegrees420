import { getIndexedDbSnapshot } from "./indexed_db";

const EMPTY_DEBUG_LOG_TEXT = "[]";
const MAX_DEBUG_ENTRIES = 400;
const IS_DEV_MODE = import.meta.env.DEV;

type CinenerdleDebugEntry = {
  at: string;
  event: string;
  details?: unknown;
};

const cinenerdleDebugEntries: CinenerdleDebugEntry[] = [];

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

function trimCinenerdleDebugEntries() {
  if (cinenerdleDebugEntries.length <= MAX_DEBUG_ENTRIES) {
    return;
  }

  cinenerdleDebugEntries.splice(0, cinenerdleDebugEntries.length - MAX_DEBUG_ENTRIES);
}

export function addCinenerdleDebugLog(event: string, details?: unknown): void {
  if (!IS_DEV_MODE) {
    return;
  }

  cinenerdleDebugEntries.push({
    at: new Date().toISOString(),
    event,
    details,
  });
  trimCinenerdleDebugEntries();
}

export function clearCinenerdleDebugLog(): void {
  cinenerdleDebugEntries.length = 0;
}

export function getCinenerdleDebugEntryCount(): number {
  return cinenerdleDebugEntries.length;
}

export function getCinenerdleDebugLogText(): string {
  if (cinenerdleDebugEntries.length === 0) {
    return EMPTY_DEBUG_LOG_TEXT;
  }

  return JSON.stringify(cinenerdleDebugEntries, null, 2);
}

export async function copyCinenerdleDebugLogToClipboard(): Promise<number> {
  if (!IS_DEV_MODE) {
    throw new Error("Clipboard copy is only available in dev mode.");
  }

  if (!canAttemptClipboardWrite()) {
    throw new Error("Clipboard API is unavailable.");
  }

  const copiedEntries = [...cinenerdleDebugEntries];
  const copiedEntryCount = copiedEntries.length;
  const copiedText =
    copiedEntryCount === 0
      ? EMPTY_DEBUG_LOG_TEXT
      : JSON.stringify(copiedEntries, null, 2);

  await writeTextToClipboard(copiedText);
  cinenerdleDebugEntries.splice(0, copiedEntryCount);
  return copiedEntryCount;
}

export async function copyCinenerdleIndexedDbSnapshotToClipboard(): Promise<{
  peopleCount: number;
  filmCount: number;
  searchableConnectionEntityCount: number;
}> {
  if (!IS_DEV_MODE) {
    throw new Error("Clipboard copy is only available in dev mode.");
  }

  if (!canAttemptClipboardWrite()) {
    throw new Error("Clipboard API is unavailable.");
  }

  const snapshot = await getIndexedDbSnapshot();
  await writeTextToClipboard(JSON.stringify(snapshot, null, 2));

  return {
    peopleCount: snapshot.people.length,
    filmCount: snapshot.films.length,
    searchableConnectionEntityCount: snapshot.searchableConnectionEntities.length,
  };
}

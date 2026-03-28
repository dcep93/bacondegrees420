const EMPTY_DEBUG_LOG_TEXT = "[]";
const MAX_DEBUG_ENTRIES = 400;

type CinenerdleDebugEntry = {
  at: string;
  event: string;
  details?: unknown;
};

const cinenerdleDebugEntries: CinenerdleDebugEntry[] = [];

function trimCinenerdleDebugEntries() {
  if (cinenerdleDebugEntries.length <= MAX_DEBUG_ENTRIES) {
    return;
  }

  cinenerdleDebugEntries.splice(0, cinenerdleDebugEntries.length - MAX_DEBUG_ENTRIES);
}

// Keep these exports available so debug logging can be reactivated quickly.
export function addCinenerdleDebugLog(event: string, details?: unknown): void {
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
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable.");
  }

  await navigator.clipboard.writeText(getCinenerdleDebugLogText());
  return getCinenerdleDebugEntryCount();
}

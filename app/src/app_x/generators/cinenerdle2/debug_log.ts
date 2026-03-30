const MAX_DEBUG_ENTRIES = 400;
const IS_DEV_MODE = import.meta.env.DEV;
export const CINENERDLE_DEBUG_LOG_UPDATED_EVENT = "cinenerdle-debug-log-updated";

export type CinenerdleDebugEntry = {
  at: string;
  event: string;
  details?: unknown;
};

const cinenerdleDebugEntries: CinenerdleDebugEntry[] = [];

function dispatchCinenerdleDebugLogUpdatedEvent(): void {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function"
  ) {
    return;
  }

  window.dispatchEvent(new Event(CINENERDLE_DEBUG_LOG_UPDATED_EVENT));
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
  dispatchCinenerdleDebugLogUpdatedEvent();
}

export function clearCinenerdleDebugLog(): void {
  cinenerdleDebugEntries.length = 0;
  dispatchCinenerdleDebugLogUpdatedEvent();
}

export function getCinenerdleDebugEntryCount(): number {
  return cinenerdleDebugEntries.length;
}

export function getCinenerdleDebugEntries(): CinenerdleDebugEntry[] {
  return [...cinenerdleDebugEntries];
}

export function getCinenerdleDebugEntriesMatching(
  predicate: (entry: CinenerdleDebugEntry) => boolean,
): CinenerdleDebugEntry[] {
  return cinenerdleDebugEntries.filter(predicate);
}

export function isCinenerdleFetchDebugEntry(entry: CinenerdleDebugEntry): boolean {
  return entry.event.startsWith("gen ") && /\b(?:pre)?fetch\b/.test(entry.event);
}

export function getCinenerdleFetchDebugEntryCount(): number {
  return cinenerdleDebugEntries.filter(isCinenerdleFetchDebugEntry).length;
}

export function removeCinenerdleDebugEntriesMatching(
  predicate: (entry: CinenerdleDebugEntry) => boolean,
): number {
  const originalLength = cinenerdleDebugEntries.length;

  for (let index = cinenerdleDebugEntries.length - 1; index >= 0; index -= 1) {
    if (predicate(cinenerdleDebugEntries[index]!)) {
      cinenerdleDebugEntries.splice(index, 1);
    }
  }

  const removedCount = originalLength - cinenerdleDebugEntries.length;
  if (removedCount > 0) {
    dispatchCinenerdleDebugLogUpdatedEvent();
  }

  return removedCount;
}

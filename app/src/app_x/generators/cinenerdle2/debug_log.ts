const MAX_DEBUG_ENTRIES = 400;
const IS_DEV_MODE = import.meta.env.DEV;
export const CINENERDLE_DEBUG_LOG_UPDATED_EVENT = "cinenerdle-debug-log-updated";

export type CinenerdleDebugEntry = {
  at: string;
  event: string;
  details?: unknown;
};

const cinenerdleDebugEntries: CinenerdleDebugEntry[] = [];
let cinenerdleFetchDebugEntryCount = 0;

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

  const removeCount = cinenerdleDebugEntries.length - MAX_DEBUG_ENTRIES;
  const removedFetchDebugEntryCount = cinenerdleDebugEntries
    .slice(0, removeCount)
    .filter(isCinenerdleFetchDebugEntry).length;

  cinenerdleDebugEntries.splice(0, removeCount);
  cinenerdleFetchDebugEntryCount = Math.max(
    0,
    cinenerdleFetchDebugEntryCount - removedFetchDebugEntryCount,
  );
}

export function addCinenerdleDebugLog(event: string, details?: unknown): void {
  const isFetchDebugEntry = isCinenerdleFetchDebugEvent(event);

  if (isFetchDebugEntry) {
    cinenerdleFetchDebugEntryCount += 1;
  }

  if (!IS_DEV_MODE) {
    if (isFetchDebugEntry) {
      dispatchCinenerdleDebugLogUpdatedEvent();
    }
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
  cinenerdleFetchDebugEntryCount = 0;
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

function isCinenerdleFetchDebugEvent(event: string): boolean {
  return event.startsWith("gen ") && /\b(?:pre)?fetch\b/.test(event);
}

export function isCinenerdleFetchDebugEntry(entry: CinenerdleDebugEntry): boolean {
  return isCinenerdleFetchDebugEvent(entry.event);
}

export function getCinenerdleFetchDebugEntryCount(): number {
  return cinenerdleFetchDebugEntryCount;
}

export function removeCinenerdleDebugEntriesMatching(
  predicate: (entry: CinenerdleDebugEntry) => boolean,
): number {
  const originalLength = cinenerdleDebugEntries.length;
  let removedFetchDebugEntryCount = 0;

  for (let index = cinenerdleDebugEntries.length - 1; index >= 0; index -= 1) {
    if (predicate(cinenerdleDebugEntries[index]!)) {
      if (isCinenerdleFetchDebugEntry(cinenerdleDebugEntries[index]!)) {
        removedFetchDebugEntryCount += 1;
      }
      cinenerdleDebugEntries.splice(index, 1);
    }
  }

  const removedCount = originalLength - cinenerdleDebugEntries.length;
  if (removedCount > 0) {
    cinenerdleFetchDebugEntryCount = Math.max(
      0,
      cinenerdleFetchDebugEntryCount - removedFetchDebugEntryCount,
    );
    dispatchCinenerdleDebugLogUpdatedEvent();
  }

  return removedCount;
}

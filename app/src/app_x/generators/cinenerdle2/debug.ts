const EMPTY_DEBUG_LOG_TEXT = "[]";

export function clearCinenerdleDebugLog(): void {}

export function getCinenerdleDebugEntryCount(): number {
  return 0;
}

export function getCinenerdleDebugLogText(): string {
  return EMPTY_DEBUG_LOG_TEXT;
}

export async function copyCinenerdleDebugLogToClipboard(): Promise<number> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable.");
  }

  await navigator.clipboard.writeText(EMPTY_DEBUG_LOG_TEXT);
  return 0;
}

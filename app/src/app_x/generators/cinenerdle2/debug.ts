const MAX_LOG_ENTRIES = 400;

type DebugEntry = {
  timestamp: string;
  event: string;
  details?: unknown;
};

const debugEntries: DebugEntry[] = [];

function truncateText(value: string, limit = 4000): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}…`;
}

function safeSerialize(details: unknown): string {
  if (details === undefined) {
    return "";
  }

  const seen = new WeakSet<object>();

  try {
    return truncateText(
      JSON.stringify(
        details,
        (_key, value) => {
          if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
              return "[Circular]";
            }

            seen.add(value);
          }

          if (typeof value === "string" && value.length > 500) {
            return `${value.slice(0, 500)}…`;
          }

          return value;
        },
        2,
      ),
    );
  } catch (error) {
    return `<<unserializable: ${error instanceof Error ? error.message : String(error)}>>`;
  }
}

export function logCinenerdleDebug(event: string, details?: unknown): void {
  const entry: DebugEntry = {
    timestamp: new Date().toISOString(),
    event,
    details,
  };

  debugEntries.push(entry);
  if (debugEntries.length > MAX_LOG_ENTRIES) {
    debugEntries.splice(0, debugEntries.length - MAX_LOG_ENTRIES);
  }

  if (details === undefined) {
    console.log(`[cinenerdle2] ${event}`);
    return;
  }

  console.log(`[cinenerdle2] ${event}`, details);
}

export function clearCinenerdleDebugLog(): void {
  debugEntries.length = 0;
}

export function getCinenerdleDebugLogText(): string {
  return debugEntries
    .map((entry) => {
      const serializedDetails = safeSerialize(entry.details);
      return serializedDetails
        ? `${entry.timestamp} ${entry.event}\n${serializedDetails}`
        : `${entry.timestamp} ${entry.event}`;
    })
    .join("\n\n");
}

export async function copyCinenerdleDebugLogToClipboard(): Promise<void> {
  const logText = getCinenerdleDebugLogText();

  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable.");
  }

  await navigator.clipboard.writeText(logText || "No cinenerdle2 debug logs captured yet.");
}

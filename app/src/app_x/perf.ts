import { addCinenerdleDebugLog } from "./generators/cinenerdle2/debug";

type PerfDetails = Record<string, unknown>;

type PerfMeasureOptions<T> = {
  always?: boolean;
  details?: PerfDetails;
  slowThresholdMs?: number;
  summarizeResult?: (result: T) => PerfDetails | undefined;
};

const PERF_QUERY_PARAM = "perf";
const PERF_STORAGE_KEY = "bacondegrees420:perf";
const PERF_DISABLED = import.meta.env.MODE === "test";
const perfMarks = new Map<string, number>();
const perfOnceKeys = new Set<string>();

function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function readWindowPerfToggle(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const queryValue = searchParams.get(PERF_QUERY_PARAM)?.trim().toLowerCase();
    if (queryValue === "1" || queryValue === "true" || queryValue === "yes") {
      return true;
    }

    const storageValue = window.localStorage.getItem(PERF_STORAGE_KEY)?.trim().toLowerCase();
    return storageValue === "1" || storageValue === "true" || storageValue === "yes";
  } catch {
    return false;
  }
}

export function isPerfLoggingEnabled(): boolean {
  if (PERF_DISABLED) {
    return false;
  }

  return import.meta.env.DEV || readWindowPerfToggle();
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(2)}s`;
  }

  if (durationMs >= 100) {
    return `${durationMs.toFixed(0)}ms`;
  }

  return `${durationMs.toFixed(1)}ms`;
}

function mergeDetails(...details: Array<PerfDetails | undefined>): PerfDetails | undefined {
  const merged = details.reduce<PerfDetails>((result, currentDetails) => {
    if (!currentDetails) {
      return result;
    }

    Object.entries(currentDetails).forEach(([key, value]) => {
      if (value !== undefined) {
        result[key] = value;
      }
    });

    return result;
  }, {});

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function emitPerfLog(
  level: "log" | "warn",
  label: string,
  durationMs: number | null,
  details?: PerfDetails,
): void {
  if (!isPerfLoggingEnabled()) {
    return;
  }

  const message = durationMs === null
    ? `[bacon-perf] ${label}`
    : `[bacon-perf] ${label} in ${formatDuration(durationMs)}`;

  addCinenerdleDebugLog(message, {
    details,
    durationMs,
    level,
  });
}

export function logPerf(label: string, details?: PerfDetails): void {
  emitPerfLog("log", label, null, details);
}

export function logPerfOnce(onceKey: string, label: string, details?: PerfDetails): void {
  if (perfOnceKeys.has(onceKey)) {
    return;
  }

  perfOnceKeys.add(onceKey);
  logPerf(label, details);
}

export function markPerf(markName: string): void {
  if (!isPerfLoggingEnabled()) {
    return;
  }

  perfMarks.set(markName, now());
}

export function logPerfSinceMark(
  label: string,
  markName: string,
  details?: PerfDetails,
): void {
  if (!isPerfLoggingEnabled()) {
    return;
  }

  const startTime = perfMarks.get(markName);
  if (startTime === undefined) {
    emitPerfLog("log", `${label} (missing mark: ${markName})`, null, details);
    return;
  }

  emitPerfLog("log", label, now() - startTime, details);
}

export async function measureAsync<T>(
  label: string,
  callback: () => Promise<T>,
  options: PerfMeasureOptions<T> = {},
): Promise<T> {
  if (!isPerfLoggingEnabled()) {
    return callback();
  }

  const startTime = now();

  try {
    const result = await callback();
    const durationMs = now() - startTime;
    if (options.always || durationMs >= (options.slowThresholdMs ?? 0)) {
      emitPerfLog(
        "log",
        label,
        durationMs,
        mergeDetails(options.details, options.summarizeResult?.(result)),
      );
    }

    return result;
  } catch (error) {
    const durationMs = now() - startTime;
    emitPerfLog(
      "warn",
      `${label} failed`,
      durationMs,
      mergeDetails(options.details, {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}

export function measureSync<T>(
  label: string,
  callback: () => T,
  options: PerfMeasureOptions<T> = {},
): T {
  if (!isPerfLoggingEnabled()) {
    return callback();
  }

  const startTime = now();

  try {
    const result = callback();
    const durationMs = now() - startTime;
    if (options.always || durationMs >= (options.slowThresholdMs ?? 0)) {
      emitPerfLog(
        "log",
        label,
        durationMs,
        mergeDetails(options.details, options.summarizeResult?.(result)),
      );
    }

    return result;
  } catch (error) {
    const durationMs = now() - startTime;
    emitPerfLog(
      "warn",
      `${label} failed`,
      durationMs,
      mergeDetails(options.details, {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}

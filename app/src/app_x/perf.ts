import { addCinenerdleDebugLog } from "./generators/cinenerdle2/debug_log";

type PerfDetails = Record<string, unknown>;

type PerfMeasureOptions<T> = {
  always?: boolean;
  details?: PerfDetails;
  slowThresholdMs?: number;
  summarizeResult?: (result: T) => PerfDetails | undefined;
};

const DEFAULT_SLOW_THRESHOLD_MS = 50;
const perfMarks = new Map<string, number>();
const loggedPerfOnceKeys = new Set<string>();

function getPerfNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function roundPerfElapsedMs(value: number): number {
  return Number(value.toFixed(2));
}

function getPerfEventName(label: string): string {
  return `perf:${label}`;
}

function mergePerfDetails(
  ...detailSets: Array<PerfDetails | undefined>
): PerfDetails | undefined {
  const mergedDetails = detailSets.reduce<PerfDetails>(
    (nextDetails, details) => (details ? { ...nextDetails, ...details } : nextDetails),
    {},
  );

  return Object.keys(mergedDetails).length > 0 ? mergedDetails : undefined;
}

function getPerfSlowThresholdMs<T>(options: PerfMeasureOptions<T>): number {
  return options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;
}

function shouldLogMeasuredPerf<T>(
  elapsedMs: number,
  options: PerfMeasureOptions<T>,
): boolean {
  return options.always === true || elapsedMs >= getPerfSlowThresholdMs(options);
}

function summarizePerfResult<T>(
  options: PerfMeasureOptions<T>,
  result: T,
): PerfDetails | undefined {
  try {
    return options.summarizeResult?.(result);
  } catch (error) {
    return {
      summarizeResultError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isPerfLoggingEnabled(): boolean {
  return import.meta.env.DEV;
}

export function logPerf(label: string, details?: PerfDetails): void {
  if (!isPerfLoggingEnabled()) {
    return;
  }

  addCinenerdleDebugLog(getPerfEventName(label), details);
}

export function logPerfOnce(onceKey: string, label: string, details?: PerfDetails): void {
  if (loggedPerfOnceKeys.has(onceKey)) {
    return;
  }

  loggedPerfOnceKeys.add(onceKey);
  logPerf(label, details);
}

export function markPerf(markName: string): void {
  perfMarks.set(markName, getPerfNow());
}

export function logPerfSinceMark(
  label: string,
  markName: string,
  details?: PerfDetails,
): void {
  const startedAt = perfMarks.get(markName);
  if (startedAt === undefined) {
    return;
  }

  logPerf(
    label,
    mergePerfDetails(details, {
      elapsedMs: roundPerfElapsedMs(getPerfNow() - startedAt),
      markName,
    }),
  );
}

export async function measureAsync<T>(
  label: string,
  callback: () => Promise<T>,
  options: PerfMeasureOptions<T> = {},
): Promise<T> {
  const startedAt = getPerfNow();

  try {
    const result = await callback();
    const elapsedMs = roundPerfElapsedMs(getPerfNow() - startedAt);

    if (shouldLogMeasuredPerf(elapsedMs, options)) {
      logPerf(
        label,
        mergePerfDetails(options.details, summarizePerfResult(options, result), {
          elapsedMs,
          status: "ok",
        }),
      );
    }

    return result;
  } catch (error) {
    const elapsedMs = roundPerfElapsedMs(getPerfNow() - startedAt);
    logPerf(
      label,
      mergePerfDetails(options.details, {
        elapsedMs,
        errorMessage: error instanceof Error ? error.message : String(error),
        status: "error",
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
  const startedAt = getPerfNow();

  try {
    const result = callback();
    const elapsedMs = roundPerfElapsedMs(getPerfNow() - startedAt);

    if (shouldLogMeasuredPerf(elapsedMs, options)) {
      logPerf(
        label,
        mergePerfDetails(options.details, summarizePerfResult(options, result), {
          elapsedMs,
          status: "ok",
        }),
      );
    }

    return result;
  } catch (error) {
    const elapsedMs = roundPerfElapsedMs(getPerfNow() - startedAt);
    logPerf(
      label,
      mergePerfDetails(options.details, {
        elapsedMs,
        errorMessage: error instanceof Error ? error.message : String(error),
        status: "error",
      }),
    );
    throw error;
  }
}

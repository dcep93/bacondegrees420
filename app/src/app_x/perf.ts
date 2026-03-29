type PerfDetails = Record<string, unknown>;

type PerfMeasureOptions<T> = {
  always?: boolean;
  details?: PerfDetails;
  slowThresholdMs?: number;
  summarizeResult?: (result: T) => PerfDetails | undefined;
};

export function isPerfLoggingEnabled(): boolean {
  return false;
}

export function logPerf(_label: string, _details?: PerfDetails): void {
  return;
}

export function logPerfOnce(_onceKey: string, _label: string, _details?: PerfDetails): void {
  return;
}

export function markPerf(_markName: string): void {
  return;
}

export function logPerfSinceMark(
  _label: string,
  _markName: string,
  _details?: PerfDetails,
): void {
  return;
}

export async function measureAsync<T>(
  _label: string,
  callback: () => Promise<T>,
  _options: PerfMeasureOptions<T> = {},
): Promise<T> {
  return callback();
}

export function measureSync<T>(
  _label: string,
  callback: () => T,
  _options: PerfMeasureOptions<T> = {},
): T {
  return callback();
}

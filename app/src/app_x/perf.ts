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

export function logPerf(label: string, details?: PerfDetails): void {
  void label;
  void details;
  return;
}

export function logPerfOnce(onceKey: string, label: string, details?: PerfDetails): void {
  void onceKey;
  void label;
  void details;
  return;
}

export function markPerf(markName: string): void {
  void markName;
  return;
}

export function logPerfSinceMark(
  label: string,
  markName: string,
  details?: PerfDetails,
): void {
  void label;
  void markName;
  void details;
  return;
}

export async function measureAsync<T>(
  label: string,
  callback: () => Promise<T>,
  options: PerfMeasureOptions<T> = {},
): Promise<T> {
  void label;
  void options;
  return callback();
}

export function measureSync<T>(
  label: string,
  callback: () => T,
  options: PerfMeasureOptions<T> = {},
): T {
  void label;
  void options;
  return callback();
}

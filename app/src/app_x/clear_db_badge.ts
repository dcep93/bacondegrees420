export function formatClearDbBadgeText(
  fetchDebugEntryCount: number,
  totalFetchCount: number,
): string {
  const normalizedTotalFetchCount = Math.max(0, Math.trunc(totalFetchCount));
  const normalizedFetchDebugEntryCount = Math.max(0, Math.trunc(fetchDebugEntryCount));

  return `${Math.min(normalizedFetchDebugEntryCount, normalizedTotalFetchCount)} / ${normalizedTotalFetchCount}`;
}

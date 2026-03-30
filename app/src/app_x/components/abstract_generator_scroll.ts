export function resolveTreeChangeScrollSuppression(
  options: {
    activeSuppressTreeChangeScrollKey: number | string | null;
    hasPendingScrollWork: boolean;
    lastSeenSuppressTreeChangeScrollKey: number | string | null;
    suppressTreeChangeScrollKey: number | string | null;
  },
): {
  nextActiveSuppressTreeChangeScrollKey: number | string | null;
  nextLastSeenSuppressTreeChangeScrollKey: number | string | null;
  shouldRunScrollWork: boolean;
} {
  if (options.suppressTreeChangeScrollKey === null) {
    return {
      nextActiveSuppressTreeChangeScrollKey: null,
      nextLastSeenSuppressTreeChangeScrollKey: null,
      shouldRunScrollWork: options.hasPendingScrollWork,
    };
  }

  const isNewSuppressTreeChangeScrollKey =
    options.suppressTreeChangeScrollKey !== options.lastSeenSuppressTreeChangeScrollKey;
  const nextActiveSuppressTreeChangeScrollKey = isNewSuppressTreeChangeScrollKey
    ? options.suppressTreeChangeScrollKey
    : options.activeSuppressTreeChangeScrollKey;
  const shouldSuppressTreeChangeScroll =
    nextActiveSuppressTreeChangeScrollKey === options.suppressTreeChangeScrollKey;

  return {
    nextActiveSuppressTreeChangeScrollKey,
    nextLastSeenSuppressTreeChangeScrollKey: options.suppressTreeChangeScrollKey,
    shouldRunScrollWork: options.hasPendingScrollWork && !shouldSuppressTreeChangeScroll,
  };
}

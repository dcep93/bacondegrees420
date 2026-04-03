function clampScrollLeft(left: number, maxScrollLeft: number): number {
  return Math.min(Math.max(left, 0), Math.max(maxScrollLeft, 0));
}

export function getUnselectedRowScrollCardIndex(
  renderedOriginalCols: number[],
  fallbackOriginalCol = 0,
): number {
  return renderedOriginalCols[0] ?? fallbackOriginalCol;
}

export function getGeneratorRowScrollLeft({
  alignment,
  maxScrollLeft,
  targetLeft,
  targetWidth,
  trackPaddingLeft,
  visibleAnchorX,
}: {
  alignment: "center" | "start";
  maxScrollLeft: number;
  targetLeft: number;
  targetWidth: number;
  trackPaddingLeft: number;
  visibleAnchorX: number;
}): number {
  const unclampedLeft = alignment === "start"
    ? targetLeft - trackPaddingLeft
    : targetLeft + (targetWidth / 2) - visibleAnchorX;

  return clampScrollLeft(unclampedLeft, maxScrollLeft);
}

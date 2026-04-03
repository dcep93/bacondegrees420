const GENERATION_VERTICAL_SCROLL_MARGIN_PX = 12;

export function getFullyVisibleViewportScrollTop(
  rect: {
    bottom: number;
    height: number;
    top: number;
  },
  viewportHeight: number,
  currentScrollTop: number,
  margin = GENERATION_VERTICAL_SCROLL_MARGIN_PX,
): number | null {
  if (viewportHeight <= 0) {
    return null;
  }

  const targetViewportTop = margin;
  const targetViewportBottom = Math.max(targetViewportTop, viewportHeight - margin);
  const availableViewportHeight = targetViewportBottom - targetViewportTop;

  if (rect.height > availableViewportHeight) {
    return Math.max(0, currentScrollTop + rect.top - targetViewportTop);
  }

  if (rect.top < targetViewportTop) {
    return Math.max(0, currentScrollTop + rect.top - targetViewportTop);
  }

  if (rect.bottom > targetViewportBottom) {
    return Math.max(0, currentScrollTop + rect.bottom - targetViewportBottom);
  }

  return null;
}

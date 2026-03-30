import type { MouseEvent } from "react";

export async function triggerPopularityChipRefresh(
  event: Pick<MouseEvent<HTMLElement>, "preventDefault" | "stopPropagation">,
  options: {
    isRefreshing: boolean;
    onPopularityClick?: (() => Promise<void> | void) | null;
    setIsRefreshing?: (isRefreshing: boolean) => void;
  },
): Promise<boolean> {
  const { isRefreshing, onPopularityClick, setIsRefreshing } = options;
  if (!onPopularityClick) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  if (isRefreshing) {
    return false;
  }

  setIsRefreshing?.(true);
  try {
    await onPopularityClick();
    return true;
  } finally {
    setIsRefreshing?.(false);
  }
}

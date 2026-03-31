import type { MouseEvent } from "react";

export async function triggerTmdbRowClick(
  event: Pick<MouseEvent<HTMLElement>, "preventDefault" | "stopPropagation">,
  options: {
    isRefreshing: boolean;
    onTmdbRowClick?: (() => Promise<void> | void) | null;
    setIsRefreshing?: (isRefreshing: boolean) => void;
  },
): Promise<boolean> {
  const { isRefreshing, onTmdbRowClick, setIsRefreshing } = options;
  if (!onTmdbRowClick) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  if (isRefreshing) {
    return false;
  }

  setIsRefreshing?.(true);
  try {
    await onTmdbRowClick();
    return true;
  } finally {
    setIsRefreshing?.(false);
  }
}

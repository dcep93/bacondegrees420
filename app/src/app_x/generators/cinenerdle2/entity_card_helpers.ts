import type { MouseEvent } from "react";
import { getFirstItemAttrChar } from "./item_attrs";

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

export function getAcceptedItemAttrInput(
  rawValue: string,
  existingItemAttrs: string[],
): string | null {
  const nextChar = getFirstItemAttrChar(rawValue);
  if (!nextChar || existingItemAttrs.includes(nextChar)) {
    return null;
  }

  return nextChar;
}

export function formatRemovedItemAttrMessage(itemAttr: string, itemName: string): string {
  return `Removed ${itemAttr} from ${itemName}`;
}

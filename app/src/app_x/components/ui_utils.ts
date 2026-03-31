import type { MouseEvent } from "react";

export function joinClassNames(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export function handleIsolatedClick(
  event: MouseEvent<HTMLElement>,
  onClick?: (event: MouseEvent<HTMLElement>) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  onClick?.(event);
}

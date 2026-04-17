export type InitialTreeViewportBehavior = "align-like-root-bubble" | "scroll-to-bottom";

export function getInitialTreeViewportBehavior(options: {
  bookmarkNavigationRequestVersion: number;
  lastHandledBookmarkNavigationRequestVersion: number;
}): InitialTreeViewportBehavior {
  return options.bookmarkNavigationRequestVersion >
      options.lastHandledBookmarkNavigationRequestVersion
    ? "align-like-root-bubble"
    : "scroll-to-bottom";
}

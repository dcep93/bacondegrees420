import { describe, expect, it } from "vitest";
import { getInitialTreeViewportBehavior } from "../initial_tree_viewport";

describe("getInitialTreeViewportBehavior", () => {
  it("uses root-bubble alignment for a new bookmark navigation request", () => {
    expect(getInitialTreeViewportBehavior({
      bookmarkNavigationRequestVersion: 2,
      lastHandledBookmarkNavigationRequestVersion: 1,
    })).toBe("align-like-root-bubble");
  });

  it("keeps the default bottom scroll when there is no new bookmark navigation request", () => {
    expect(getInitialTreeViewportBehavior({
      bookmarkNavigationRequestVersion: 2,
      lastHandledBookmarkNavigationRequestVersion: 2,
    })).toBe("scroll-to-bottom");
  });
});

import { describe, expect, it } from "vitest";
import {
  didRequestNewTabNavigation,
  getBookmarkPreviewCardHash,
  getBookmarkPreviewCardRootHash,
  getSelectedPathTooltipEntries,
} from "../index_helpers";

describe("index hash helpers", () => {
  it("detects cmd/ctrl click requests for new-tab navigation", () => {
    expect(didRequestNewTabNavigation({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(didRequestNewTabNavigation({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(didRequestNewTabNavigation({ metaKey: false, ctrlKey: false })).toBe(false);
  });

  it("includes ESCAPE in selected-path tooltip entries", () => {
    expect(
      getSelectedPathTooltipEntries(
        "#cinenerdle|First+Man+(2018)|Kyle+Chandler||Tom+Hanks",
      ),
    ).toEqual([
      "cinenerdle",
      "First Man (2018)",
      "Kyle Chandler",
      "ESCAPE",
      "Tom Hanks",
    ]);
  });

  it("preserves escape segments when slicing bookmark preview hashes", () => {
    expect(
      getBookmarkPreviewCardHash(
        "#cinenerdle|First+Man+(2018)|Kyle+Chandler||Tom+Hanks",
        4,
      ),
    ).toBe("#cinenerdle|First+Man+(2018)|Kyle+Chandler||Tom+Hanks");
  });

  it("keeps trailing escape segments when slicing to the separator itself", () => {
    expect(
      getBookmarkPreviewCardHash(
        "#cinenerdle|First+Man+(2018)|Kyle+Chandler||Tom+Hanks",
        3,
      ),
    ).toBe("#cinenerdle|First+Man+(2018)|Kyle+Chandler|");
  });

  it("derives a root hash for a bookmark preview card", () => {
    expect(
      getBookmarkPreviewCardRootHash(
        "#cinenerdle|First+Man+(2018)|Kyle+Chandler||Tom+Hanks",
        2,
      ),
    ).toBe("#person|Kyle+Chandler");
  });
});

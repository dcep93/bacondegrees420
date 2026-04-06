import { afterEach, describe, expect, it, vi } from "vitest";
import { getBookmarksReturnHashValue } from "../app_location";

describe("getBookmarksReturnHashValue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers the live window hash when entering bookmarks", () => {
    vi.stubGlobal("window", {
      location: {
        hash: "#person|Fred+Willard",
      },
    });

    expect(getBookmarksReturnHashValue("#cinenerdle|Zootopia+(2016)|Fred+Willard")).toBe(
      "#person|Fred+Willard",
    );
  });

  it("falls back to the current state hash when the live window hash is empty", () => {
    vi.stubGlobal("window", {
      location: {
        hash: "",
      },
    });

    expect(getBookmarksReturnHashValue("#person|Fred+Willard")).toBe("#person|Fred+Willard");
  });

  it("prefers the last synced hash when the live window hash has drifted", () => {
    vi.stubGlobal("window", {
      location: {
        hash: "#cinenerdle|Zootopia+(2016)|Judy+Hopps|Best+in+Show+(2000)|Fred+Willard",
      },
    });

    expect(
      getBookmarksReturnHashValue(
        "#cinenerdle|Zootopia+(2016)|Judy+Hopps|Best+in+Show+(2000)|Fred+Willard",
        "#person|Fred+Willard",
      ),
    ).toBe("#person|Fred+Willard");
  });
});

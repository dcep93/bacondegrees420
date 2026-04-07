import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBasePathname,
  getBookmarksPathname,
  getBookmarksReturnHashValue,
  getCoverPathname,
  normalizePathname,
  readAppLocationState,
} from "../app_location";

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

describe("app_location routes", () => {
  it("builds top-level bookmarks and cover paths from the app base pathname", () => {
    expect(getBookmarksPathname("/")).toBe("/bookmarks");
    expect(getBookmarksPathname("/bacon")).toBe("/bacon/bookmarks");
    expect(getCoverPathname("/")).toBe("/cover");
    expect(getCoverPathname("/bacon")).toBe("/bacon/cover");
  });

  it("derives the base pathname from generator, bookmarks, and cover routes", () => {
    expect(getBasePathname("/")).toBe("/");
    expect(getBasePathname("/bacon")).toBe("/bacon");
    expect(getBasePathname("/bookmarks")).toBe("/");
    expect(getBasePathname("/cover")).toBe("/");
    expect(getBasePathname("/bacon/bookmarks")).toBe("/bacon");
    expect(getBasePathname("/bacon/cover")).toBe("/bacon");
  });

  it("reads /cover as the cover view mode", () => {
    vi.stubGlobal("window", {
      location: {
        hash: "",
        pathname: "/cover",
      },
    });

    expect(readAppLocationState()).toEqual({
      viewMode: "cover",
      pathname: "/cover",
      basePathname: "/",
      hash: "",
    });
  });

  it("normalizes pathnames with missing or extra slashes", () => {
    expect(normalizePathname("cover/")).toBe("/cover");
    expect(normalizePathname("/bacon/cover///")).toBe("/bacon/cover");
  });
});

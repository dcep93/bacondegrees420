import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDefaultBookmarksReturnHashValue,
  getDefaultBookmarksReturnPathname,
  getBasePathname,
  getBookmarksPathname,
  getBookmarksReturnHashValue,
  getCoverPathname,
  getGeneratorPathname,
  isRootRouteXPath,
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds top-level bookmarks and cover paths from the app base pathname", () => {
    expect(getBookmarksPathname("/")).toBe("/bookmarks");
    expect(getBookmarksPathname("/bacon")).toBe("/bacon/bookmarks");
    expect(getCoverPathname("/")).toBe("/cover");
    expect(getCoverPathname("/bacon")).toBe("/bacon/cover");
  });

  it("derives the base pathname from generator, bookmarks, and cover routes", () => {
    expect(getBasePathname("/")).toBe("/");
    expect(getBasePathname("/bacon")).toBe("/bacon");
    expect(getBasePathname("/x")).toBe("/x");
    expect(getBasePathname("/bookmarks")).toBe("/");
    expect(getBasePathname("/cover")).toBe("/");
    expect(getBasePathname("/bacon/bookmarks")).toBe("/bacon");
    expect(getBasePathname("/bacon/cover")).toBe("/bacon");
  });

  it("recognizes the exact /x route as the route-backed bookmarks entry", () => {
    expect(isRootRouteXPath("/x")).toBe(true);
    expect(isRootRouteXPath("/x/")).toBe(true);
    expect(isRootRouteXPath("/x/bookmarks")).toBe(false);
    expect(isRootRouteXPath("/xyz")).toBe(false);
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

  it("reads /x as the bookmarks view mode", () => {
    vi.stubGlobal("window", {
      location: {
        hash: "",
        pathname: "/x",
      },
    });

    expect(readAppLocationState()).toEqual({
      viewMode: "bookmarks",
      pathname: "/x",
      basePathname: "/x",
      hash: "",
    });
  });

  it("keeps /x in bookmarks view even when a hash is present", () => {
    vi.stubGlobal("window", {
      location: {
        hash: "#person|Fred+Willard",
        pathname: "/x",
      },
    });

    expect(readAppLocationState()).toEqual({
      viewMode: "bookmarks",
      pathname: "/x",
      basePathname: "/x",
      hash: "#person|Fred+Willard",
    });
  });

  it("routes x-family bookmark loads to the root generator path", () => {
    expect(getGeneratorPathname("/x")).toBe("/");
    expect(getGeneratorPathname("/")).toBe("/");
    expect(getGeneratorPathname("/bacon")).toBe("/bacon");
  });

  it("uses root as the direct-close fallback for x-family bookmarks", () => {
    expect(getDefaultBookmarksReturnPathname({
      viewMode: "bookmarks",
      pathname: "/x",
      basePathname: "/x",
    })).toBe("/");
    expect(getDefaultBookmarksReturnHashValue({
      basePathname: "/x",
      hash: "#person|Fred+Willard",
    })).toBe("");
  });

  it("preserves existing close fallback behavior for non-x bookmark routes", () => {
    expect(getDefaultBookmarksReturnPathname({
      viewMode: "bookmarks",
      pathname: "/bookmarks",
      basePathname: "/",
    })).toBe("/");
    expect(getDefaultBookmarksReturnPathname({
      viewMode: "bookmarks",
      pathname: "/bacon/bookmarks",
      basePathname: "/bacon",
    })).toBe("/bacon");
    expect(getDefaultBookmarksReturnHashValue({
      basePathname: "/bacon",
      hash: "#person|Fred+Willard",
    })).toBe("#person|Fred+Willard");
  });

  it("normalizes pathnames with missing or extra slashes", () => {
    expect(normalizePathname("cover/")).toBe("/cover");
    expect(normalizePathname("/bacon/cover///")).toBe("/bacon/cover");
  });
});

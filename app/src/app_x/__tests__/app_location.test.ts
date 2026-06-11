import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLocationHref,
  getDefaultBookmarksReturnHashValue,
  getDefaultBookmarksReturnPathname,
  getBasePathname,
  getBookmarksPathname,
  getBookmarksReturnHashValue,
  getCoverPathname,
  getGeneratorPathname,
  isSlideshowSearchParam,
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

  it("recognizes the exact /x route as the Fishburne ranking entry", () => {
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

  it("reads /x as the Fishburne ranking view mode", () => {
    vi.stubGlobal("window", {
      location: {
        hash: "",
        pathname: "/x",
      },
    });

    expect(readAppLocationState()).toEqual({
      viewMode: "fishburneRanking",
      pathname: "/x",
      basePathname: "/x",
      hash: "",
    });
  });

  it("keeps /x in Fishburne ranking view even when a hash is present", () => {
    vi.stubGlobal("window", {
      location: {
        hash: "#person|Fred+Willard",
        pathname: "/x",
      },
    });

    expect(readAppLocationState()).toEqual({
      viewMode: "fishburneRanking",
      pathname: "/x",
      basePathname: "/x",
      hash: "#person|Fred+Willard",
    });
  });

  it("reads /x/bookmarks as the route-backed bookmarks view mode", () => {
    vi.stubGlobal("window", {
      location: {
        hash: "",
        pathname: "/x/bookmarks",
      },
    });

    expect(readAppLocationState()).toEqual({
      viewMode: "bookmarks",
      pathname: "/x/bookmarks",
      basePathname: "/x",
      hash: "",
    });
  });

  it("routes x-family bookmark loads to the root generator path", () => {
    expect(getGeneratorPathname("/x")).toBe("/");
    expect(getGeneratorPathname("/")).toBe("/");
    expect(getGeneratorPathname("/bacon")).toBe("/bacon");
  });

  it("detects slideshow mode from a defined URL search parameter", () => {
    expect(isSlideshowSearchParam("?slideshow")).toBe(true);
    expect(isSlideshowSearchParam("?slideshow=")).toBe(true);
    expect(isSlideshowSearchParam("?foo=1&slideshow&bar=2")).toBe(true);
    expect(isSlideshowSearchParam("?foo=slideshow")).toBe(false);
    expect(isSlideshowSearchParam("")).toBe(false);
  });

  it("can build hrefs that omit only the slideshow query parameter", () => {
    vi.stubGlobal("window", {
      location: {
        search: "?foo=1&slideshow&bar=2",
      },
    });

    expect(buildLocationHref("/", "#person|Al+Pacino", { omitSlideshow: true })).toBe(
      "/?foo=1&bar=2#person|Al+Pacino",
    );
  });

  it("preserves the slideshow query parameter by default when building hrefs", () => {
    vi.stubGlobal("window", {
      location: {
        search: "?slideshow",
      },
    });

    expect(buildLocationHref("/", "#person|Al+Pacino")).toBe(
      "/?slideshow#person|Al+Pacino",
    );
  });

  it("uses root as the direct-close fallback for x-family bookmarks", () => {
    expect(getDefaultBookmarksReturnPathname({
      viewMode: "bookmarks",
      pathname: "/x/bookmarks",
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

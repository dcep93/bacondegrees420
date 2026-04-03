import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CinenerdleEntityCard,
  type RenderableCinenerdleEntityCard,
} from "../entity_card";
import {
  formatRemovedItemAttrMessage,
  getAcceptedItemAttrInput,
  triggerTmdbRowClick,
} from "../entity_card_helpers";
import { getCinenerdleItemAttrCounts } from "../entity_card_ordering";

function makeRenderableMovieCard(
  overrides: Partial<RenderableCinenerdleEntityCard> = {},
): RenderableCinenerdleEntityCard {
  return {
    key: "movie:heat:1995",
    kind: "movie",
    name: "Heat",
    imageUrl: null,
    subtitle: "1995",
    subtitleDetail: "",
    popularity: 88,
    popularitySource: "TMDb movie popularity from the cached movie record.",
    connectionCount: 12,
    connectionRank: 3,
    connectionOrder: 5,
    connectionParentLabel: "Al Pacino",
    sources: [{ iconUrl: "https://img.test/tmdb.svg", label: "TMDb" }],
    status: null,
    hasCachedTmdbSource: true,
    isExcluded: false,
    isSelected: false,
    isLocked: false,
    isAncestorSelected: false,
    itemAttrs: [],
    connectedItemAttrs: [],
    inheritedItemAttrs: [],
    itemAttrCounts: {
      activeCount: 0,
      passiveCount: 0,
    },
    voteAverage: 8.2,
    voteCount: 9000,
    ...overrides,
  };
}

function makeRenderableCinenerdleCard(): RenderableCinenerdleEntityCard {
  return {
    key: "cinenerdle",
    kind: "cinenerdle",
    name: "cinenerdle",
    imageUrl: "https://img.test/cinenerdle.svg",
    subtitle: "Daily starters",
    subtitleDetail: "Open today's board",
    popularity: 0,
    popularitySource: "Cinenerdle root cards do not have a popularity score.",
    connectionCount: 7,
    connectionRank: null,
    connectionOrder: null,
    connectionParentLabel: null,
    sources: [{ iconUrl: "https://img.test/cinenerdle.svg", label: "Cinenerdle" }],
    status: null,
    hasCachedTmdbSource: false,
    isExcluded: false,
    isSelected: false,
    isLocked: false,
    isAncestorSelected: false,
  };
}

describe("CinenerdleEntityCard", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        clear: () => {
          storage.clear();
        },
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => {
          storage.delete(key);
        },
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
  });

  it("does not render the TMDb footer icon strip outside the connection badge", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={makeRenderableMovieCard()} />,
    );

    expect(html).not.toContain("cinenerdle-card-sources");
    expect(html).toContain("cinenerdle-card-count-icon");
    expect(html).toContain("src=\"https://img.test/tmdb.svg\"");
  });

  it("renders the connection badge as rank-links when rank is available", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={makeRenderableMovieCard()} />,
    );

    expect(html).toContain("#3 / 12");
    expect(html).not.toContain("3 -");
  });

  it("renders the badge tooltip with the item name, total links, and parent rank", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={makeRenderableMovieCard()} />,
    );

    expect(html).toContain("role=\"tooltip\"");
    expect(html).toContain("cinenerdle-card-inline-tooltip-left");
    expect(html).toContain(
      "Heat has 12 connections\nAl Pacino is the #3 connection",
    );
  });

  it("still renders the rank badge when order is unavailable", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          connectionOrder: null,
          connectionParentLabel: null,
        })}
      />,
    );

    expect(html).toContain("#3 / 12");
    expect(html).not.toContain("3 -");
  });

  it("keeps the parent-rank tooltip copy when order is unavailable", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          connectionOrder: null,
        })}
      />,
    );

    expect(html).toContain("Heat has 12 connections\nAl Pacino is the #3 connection");
  });

  it("still renders the full connection count tooltip when only the count is available", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          connectionRank: null,
          connectionOrder: null,
          connectionParentLabel: null,
        })}
      />,
    );

    expect(html).toContain("12");
    expect(html).toContain("Heat has 12 connections");
    expect(html).not.toContain("is the #");
  });

  it("does not render the upper-left footer badge when the card lacks cached tmdb hydration", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          hasCachedTmdbSource: false,
        })}
      />,
    );

    expect(html).not.toContain("#3 / 12");
    expect(html).not.toContain("cinenerdle-card-count-icon");
    expect(html).not.toContain(
      "Heat has 12 connections\nAl Pacino is the #3 connection",
    );
  });

  it("renders a single refreshable footer tooltip with connection and tmdb lines", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          onTmdbRowClick: async () => { },
          tmdbTooltipText: "TMDb data fetched 3/29/2026, 4:03:24 PM.\nClick to refetch.",
        })}
      />,
    );

    expect(html).toContain("cinenerdle-card-footer-tooltip-anchor");
    expect(html).toContain("cinenerdle-card-footer-tooltip-panel");
    expect(html).not.toContain("cinenerdle-card-footer-tooltip-header");
    expect(html).not.toContain("cinenerdle-card-footer-tooltip-section-label");
    expect(html).not.toContain("cinenerdle-card-footer-tooltip-action");
    expect(html).toContain("Heat has 12 connections");
    expect(html).toContain("Al Pacino is the #3 connection");
    expect(html).toContain("TMDb data fetched 3/29/2026, 4:03:24 PM.");
    expect(html).not.toContain("Click to refetch.");
    expect(html).not.toContain("TMDb movie popularity from the cached movie record.");
    expect(html.match(/role="tooltip"/g)).toHaveLength(1);
  });

  it("wraps the entire footer in the refreshable tooltip anchor when a tmdb row click handler is present", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          onTmdbRowClick: async () => { },
        })}
      />,
    );

    expect(html).toContain("cinenerdle-card-chip-tooltip-anchor cinenerdle-card-footer-tooltip-anchor");
    expect(html).toContain("<footer class=\"cinenerdle-card-footer\">");
    expect(html.indexOf("cinenerdle-card-footer-tooltip-anchor"))
      .toBeLessThan(html.indexOf("<footer class=\"cinenerdle-card-footer\">"));
    expect(html).toContain("cinenerdle-card-footer-top cinenerdle-card-footer-top-refreshable");
    expect(html).toContain("cinenerdle-card-footer-bottom");
  });

  it("leaves the footer top row non-refreshable when no tmdb row click handler is present", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          onTmdbRowClick: null,
        })}
      />,
    );

    expect(html).toContain("cinenerdle-card-footer-top");
    expect(html).not.toContain("cinenerdle-card-footer-top-refreshable");
  });

  it("renders popularity with stable two-decimal precision", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          popularity: 88,
        })}
      />,
    );

    expect(html).toContain("Popularity 88.00");
  });

  it("renders popularity before the connection badge in the footer top row", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={makeRenderableMovieCard()} />,
    );

    expect(html.indexOf("Popularity 88.00")).toBeLessThan(html.indexOf("#3 / 12"));
  });

  it("renders the extra row for non-cinenerdle cards only", () => {
    const movieHtml = renderToStaticMarkup(
      <CinenerdleEntityCard card={makeRenderableMovieCard()} />,
    );
    const cinenerdleHtml = renderToStaticMarkup(
      <CinenerdleEntityCard card={makeRenderableCinenerdleCard()} />,
    );

    expect(movieHtml).toContain("cinenerdle-card-extra-row");
    expect(movieHtml).toContain("Toggle attrs for Heat");
    expect(cinenerdleHtml).not.toContain("cinenerdle-card-extra-row");
    expect(cinenerdleHtml).not.toContain("Toggle attrs for");
  });

  it("renders attr buttons instead of placeholder copy when attrs are present", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          itemAttrs: ["🔥", "⭐"],
          connectedItemAttrs: ["🔥", "⭐"],
          itemAttrCounts: {
            activeCount: 2,
            passiveCount: 0,
          },
        })}
      />,
    );

    expect(html).toContain("Remove 🔥 from Heat");
    expect(html).toContain("Remove ⭐ from Heat");
    expect(html).not.toContain("hello world");
  });

  it("renders inherited attrs from the connected source as non-interactive chips", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          itemAttrs: ["⭐"],
          connectedItemAttrs: ["🔥", "⭐"],
          inheritedItemAttrs: ["🔥"],
          itemAttrCounts: {
            activeCount: 1,
            passiveCount: 1,
          },
        })}
      />,
    );

    expect(html).toContain("Remove ⭐ from Heat");
    expect(html).toContain("cinenerdle-card-extra-chip cinenerdle-card-extra-chip-passive");
    expect(html).toContain("disabled=\"\" type=\"button\">🔥</button>");
    expect(html).not.toContain("Remove 🔥 from Heat");
  });

  it("ignores whitespace-only attr input", () => {
    expect(getAcceptedItemAttrInput(" ", [])).toBeNull();
  });

  it("ignores duplicate attr input for the same item", () => {
    expect(getAcceptedItemAttrInput("🔥", ["🔥"])).toBeNull();
  });

  it("accepts emoji attrs as a single input char", () => {
    expect(getAcceptedItemAttrInput("🔥", [])).toBe("🔥");
  });

  it("formats the attr removal alert copy", () => {
    expect(formatRemovedItemAttrMessage("🔥", "Heat")).toBe("Removed 🔥 from Heat");
  });

  it("computes active and passive attr counts for row sorting", () => {
    expect(getCinenerdleItemAttrCounts(["🔥", "⭐"], ["🎬"])).toEqual({
      activeCount: 2,
      passiveCount: 1,
    });
  });

  it("renders cinenerdle root cards as image-only shells", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={makeRenderableCinenerdleCard()} />,
    );

    expect(html).toContain("cinenerdle-card-root");
    expect(html).not.toContain("cinenerdle-card-copy");
    expect(html).not.toContain("Daily starters");
    expect(html).not.toContain("Open today&#x27;s board");
    expect(html).toContain("src=\"https://img.test/cinenerdle.svg\"");
  });

  it("renders multiple credit lines when provided", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          subtitle: "2007 • Cast as",
          subtitleDetail: "Charles 'Chuck' Levine",
          creditLines: [
            {
              subtitle: "2007 • Cast as",
              subtitleDetail: "Charles 'Chuck' Levine",
            },
            {
              subtitle: "2007 • Producer",
              subtitleDetail: "",
            },
          ],
        })}
      />,
    );

    expect(html).toContain("2007 • Cast as");
    expect(html).toContain("Charles &#x27;Chuck&#x27; Levine");
    expect(html).toContain("2007 • Producer");
  });

  it("renders excluded movie badge icons in greyscale without changing the rest of the card", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          isExcluded: true,
        })}
      />,
    );

    expect(html).toContain("cinenerdle-card-count-icon");
    expect(html).toContain("filter:grayscale(1)");
    expect(html).toContain("opacity:0.9");
    expect(html).toContain("#3 / 12");
    expect(html).toContain("Popularity 88.00");
  });
});

describe("triggerTmdbRowClick", () => {
  it("prevents bubbling and invokes the refresh callback", async () => {
    let prevented = false;
    let stopped = false;
    let refreshCallCount = 0;

    const didRefresh = await triggerTmdbRowClick(
      {
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      },
      {
        isRefreshing: false,
        onTmdbRowClick: async () => {
          refreshCallCount += 1;
        },
      },
    );

    expect(didRefresh).toBe(true);
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
    expect(refreshCallCount).toBe(1);
  });

  it("still prevents bubbling while ignoring duplicate refresh clicks", async () => {
    let prevented = false;
    let stopped = false;
    let refreshCallCount = 0;

    const didRefresh = await triggerTmdbRowClick(
      {
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      },
      {
        isRefreshing: true,
        onTmdbRowClick: async () => {
          refreshCallCount += 1;
        },
      },
    );

    expect(didRefresh).toBe(false);
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
    expect(refreshCallCount).toBe(0);
  });
});

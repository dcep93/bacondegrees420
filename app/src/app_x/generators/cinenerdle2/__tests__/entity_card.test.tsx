import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CinenerdleEntityCard, type RenderableCinenerdleEntityCard } from "../entity_card";
import { triggerTmdbRowClick } from "../entity_card_helpers";

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
    isSelected: false,
    isLocked: false,
    isAncestorSelected: false,
    voteAverage: 8.2,
    voteCount: 9000,
    ...overrides,
  };
}

describe("CinenerdleEntityCard", () => {
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

  it("renders fetched-at popularity tooltip copy when provided", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          onTmdbRowClick: async () => { },
          tmdbTooltipText: "TMDb data fetched 3/29/2026, 4:03:24 PM.\nClick to refetch.",
        })}
      />,
    );

    expect(html).toContain("TMDb data fetched 3/29/2026, 4:03:24 PM.\nClick to refetch.");
    expect(html).not.toContain("TMDb movie popularity from the cached movie record.");
  });

  it("marks the footer top row as refreshable when a tmdb row click handler is present", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          onTmdbRowClick: async () => { },
        })}
      />,
    );

    expect(html).toContain("cinenerdle-card-footer-top cinenerdle-card-footer-top-refreshable");
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

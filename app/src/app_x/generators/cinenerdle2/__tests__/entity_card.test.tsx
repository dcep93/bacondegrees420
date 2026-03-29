import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CinenerdleEntityCard, type RenderableCinenerdleEntityCard } from "../entity_card";

function makeRenderableMovieCard(
  overrides: Partial<RenderableCinenerdleEntityCard> = {},
): RenderableCinenerdleEntityCard {
  return {
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
  it("does not render the TMDb footer icon strip", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={makeRenderableMovieCard()} />,
    );

    expect(html).not.toContain("cinenerdle-card-sources");
    expect(html).not.toContain("cinenerdle-card-source-icon");
  });

  it("renders the connection badge as rank-order-links when order is available", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={makeRenderableMovieCard()} />,
    );

    expect(html).toContain("3 - 5 / 12");
  });

  it("renders the badge tooltip with the item name, links, parent label, rank, and order", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={makeRenderableMovieCard()} />,
    );

    expect(html).toContain("role=\"tooltip\"");
    expect(html).toContain(
      "Heat has 12 connections\nordered 5 for Al Pacino\nrank 3 by popularity",
    );
  });

  it("falls back to the legacy rank-links badge when order is unavailable", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          connectionOrder: null,
          connectionParentLabel: null,
        })}
      />,
    );

    expect(html).toContain("3 / 12");
    expect(html).not.toContain("3 -");
  });

  it("does not render the upper-left footer badge when the card lacks cached tmdb hydration", () => {
    const html = renderToStaticMarkup(
      <CinenerdleEntityCard
        card={makeRenderableMovieCard({
          hasCachedTmdbSource: false,
        })}
      />,
    );

    expect(html).not.toContain("3 - 5 / 12");
    expect(html).not.toContain(
      "Heat has 12 connections\nordered 5 for Al Pacino\nrank 3 by popularity",
    );
  });
});

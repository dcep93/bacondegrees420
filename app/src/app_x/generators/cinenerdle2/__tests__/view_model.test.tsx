import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CinenerdleEntityCard,
  type RenderableCinenerdleEntityCard,
} from "../entity_card";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
} from "./factories";
import { createCardViewModel } from "../view_model";
import type { CinenerdleCard, CinenerdleCardViewModel } from "../view_types";

function asRenderableEntityCard(
  cardViewModel: CinenerdleCardViewModel,
): RenderableCinenerdleEntityCard {
  if (cardViewModel.kind === "break" || cardViewModel.kind === "dbinfo") {
    throw new Error(`Expected renderable entity card, received ${cardViewModel.kind}`);
  }

  return cardViewModel;
}

function makePersonCard(
  overrides: Partial<Extract<CinenerdleCard, { kind: "person" }>> = {},
): Extract<CinenerdleCard, { kind: "person" }> {
  return {
    key: "person:60",
    kind: "person",
    name: "Al Pacino",
    popularity: 77,
    popularitySource: null,
    imageUrl: null,
    subtitle: "",
    subtitleDetail: "",
    connectionCount: 2,
    sources: [],
    status: null,
    record: makePersonRecord({
      movieConnectionKeys: ["heat (1995)", "insomnia (2002)"],
      rawTmdbPerson: makeTmdbPersonSearchResult(),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 50, title: "Heat", release_date: "1995-12-15" }),
          makeMovieCredit({ id: 51, title: "Insomnia", release_date: "2002-05-24" }),
        ],
      },
    }),
    ...overrides,
  };
}

function makeMovieCard(
  overrides: Partial<Extract<CinenerdleCard, { kind: "movie" }>> = {},
): Extract<CinenerdleCard, { kind: "movie" }> {
  return {
    key: "movie:50",
    kind: "movie",
    name: "Heat",
    year: "1995",
    popularity: 66,
    popularitySource: null,
    imageUrl: null,
    subtitle: "1995",
    subtitleDetail: "",
    connectionCount: 2,
    sources: [],
    status: null,
    voteAverage: null,
    voteCount: null,
    record: makeFilmRecord({
      personConnectionKeys: ["al pacino", "robert de niro"],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        genres: [{ id: 28, name: "Action" }],
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    }),
    ...overrides,
  };
}

describe("createCardViewModel provenance gating", () => {
  it("does not expose cached tmdb source for connection-derived people rebuilt from credits", () => {
    const cardViewModel = createCardViewModel(
      makePersonCard({
        record: makePersonRecord({
          tmdbSource: "connection-derived",
          movieConnectionKeys: ["inside (2023)"],
          rawTmdbPerson: makeTmdbPersonSearchResult({
            id: 1913732,
            name: "Gene Bervoets",
            popularity: 4.2,
          }),
          rawTmdbMovieCreditsResponse: {
            cast: [
              makeMovieCredit({
                id: 940551,
                title: "Inside",
                release_date: "2023-03-10",
              }),
            ],
          },
        }),
        key: "person:1913732",
        name: "Gene Bervoets",
        connectionCount: 1,
      }),
      { isSelected: false },
    );

    expect(cardViewModel.hasCachedTmdbSource).toBe(false);

    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={asRenderableEntityCard(cardViewModel)} />,
    );
    expect(html).not.toContain("cinenerdle-card-count");
  });

  it("still exposes cached tmdb source for directly fetched people", () => {
    const cardViewModel = createCardViewModel(
      makePersonCard({
        record: makePersonRecord({
          tmdbSource: "direct-person-fetch",
          movieConnectionKeys: ["heat (1995)", "insomnia (2002)"],
          rawTmdbPerson: makeTmdbPersonSearchResult(),
          rawTmdbMovieCreditsResponse: {
            cast: [
              makeMovieCredit({ id: 50, title: "Heat", release_date: "1995-12-15" }),
            ],
          },
        }),
      }),
      { isSelected: false },
    );

    expect(cardViewModel.hasCachedTmdbSource).toBe(true);

    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={asRenderableEntityCard(cardViewModel)} />,
    );
    expect(html).toContain("cinenerdle-card-count");
  });

  it("still exposes cached tmdb source for directly fetched movies", () => {
    const cardViewModel = createCardViewModel(makeMovieCard(), { isSelected: false });

    expect(cardViewModel.hasCachedTmdbSource).toBe(true);
    expect(cardViewModel.isExcluded).toBe(false);

    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={asRenderableEntityCard(cardViewModel)} />,
    );
    expect(html).toContain("cinenerdle-card-count");
  });

  it("marks documentary movies as excluded in the card view model", () => {
    const cardViewModel = createCardViewModel(
      makeMovieCard({
        sources: [{ iconUrl: "https://img.test/tmdb.png", label: "TMDb" }],
        record: makeFilmRecord({
          tmdbSource: "direct-film-fetch",
          rawTmdbMovie: makeTmdbMovieSearchResult({
            genres: [
              { id: 99, name: "Documentary" },
              { id: 36, name: "History" },
            ],
          }),
          rawTmdbMovieCreditsResponse: {
            cast: [],
            crew: [],
          },
        }),
      }),
      { isSelected: false },
    );

    expect(cardViewModel.isExcluded).toBe(true);

    const html = renderToStaticMarkup(
      <CinenerdleEntityCard card={asRenderableEntityCard(cardViewModel)} />,
    );
    expect(html).toContain("filter:grayscale(1)");
  });
});

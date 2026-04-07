import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  makeFilmRecord,
  makePersonRecord,
  makeTmdbMovieSearchResult,
} from "../generators/cinenerdle2/__tests__/factories";
import {
  CoverPageView,
  createCoverPersonCardViewModel,
  formatCoverCreditDetail,
} from "../components/cover_page";
import type { ResolvedMovieCoverRecord } from "../movie_person_cover";

function makeResolvedMovie(
  movieRecord: ReturnType<typeof makeFilmRecord>,
  inputLabel: string,
  tmdbId: number,
): ResolvedMovieCoverRecord {
  return {
    inputLabel,
    movieRecord: movieRecord as ResolvedMovieCoverRecord["movieRecord"],
    tmdbId,
  };
}

describe("cover_page helpers", () => {
  it("formats multiple matched roles into a compact detail string", () => {
    expect(formatCoverCreditDetail([
      {
        id: 10,
        name: "Person",
        order: 0,
        creditType: "cast",
        character: "Protagonist",
      },
      {
        id: 10,
        name: "Person",
        order: 0,
        creditType: "crew",
        job: "Writer",
      },
    ])).toBe("Protagonist | Writer");
  });

  it("builds person card credit lines from matched input movies in input order", () => {
    const personRecord = makePersonRecord({
      id: 10,
      tmdbId: 10,
      name: "John Example",
      rawTmdbPerson: {
        id: 10,
        name: "John Example",
        popularity: 88,
      },
    });
    const firstMovie = makeFilmRecord({
      id: 101,
      tmdbId: 101,
      title: "First Movie",
      year: "2001",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 101,
        title: "First Movie",
        release_date: "2001-01-01",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [{
          id: 10,
          name: "John Example",
          order: 0,
          creditType: "cast",
          character: "Hero",
        }],
        crew: [],
      },
    });
    const secondMovie = makeFilmRecord({
      id: 102,
      tmdbId: 102,
      title: "Second Movie",
      year: "2002",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 102,
        title: "Second Movie",
        release_date: "2002-01-01",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [{
          id: 10,
          name: "John Example",
          order: 0,
          creditType: "crew",
          job: "Director",
        }],
      },
    });

    expect(createCoverPersonCardViewModel(personRecord, [
      makeResolvedMovie(firstMovie, "First Movie (2001)", 101),
      makeResolvedMovie(secondMovie, "Second Movie (2002)", 102),
    ])).toEqual(expect.objectContaining({
      kind: "person",
      name: "John Example",
      creditLines: [
        {
          subtitle: "First Movie (2001)",
          subtitleDetail: "Hero",
        },
        {
          subtitle: "Second Movie (2002)",
          subtitleDetail: "Director",
        },
      ],
    }));
  });
});

describe("CoverPageView", () => {
  it("renders loading and error states", () => {
    const html = renderToStaticMarkup(
      <CoverPageView
        cards={[]}
        inputValue={"Heat (1995)\nCollateral (2004)"}
        isLoading
        message="Unable to resolve movie: Missing (2000)"
        messageTone="error"
        onInputChange={vi.fn()}
      />,
    );

    expect(html).toContain("Movie Cover");
    expect(html).toContain("aria-label=\"Movie cover input\"");
    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("Unable to resolve movie: Missing (2000)");
    expect(html).toContain("Finding the smallest person cover...");
  });

  it("renders winning person cards with matched movie role lines", () => {
    const personRecord = makePersonRecord({
      id: 10,
      tmdbId: 10,
      name: "John Example",
      rawTmdbPerson: {
        id: 10,
        name: "John Example",
        popularity: 88,
      },
    });
    const firstMovie = makeFilmRecord({
      id: 101,
      tmdbId: 101,
      title: "First Movie",
      year: "2001",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 101,
        title: "First Movie",
        release_date: "2001-01-01",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [{
          id: 10,
          name: "John Example",
          order: 0,
          creditType: "cast",
          character: "Hero",
        }],
        crew: [],
      },
    });
    const card = createCoverPersonCardViewModel(
      personRecord,
      [makeResolvedMovie(firstMovie, "First Movie (2001)", 101)],
    );

    const html = renderToStaticMarkup(
      <CoverPageView
        cards={[card]}
        inputValue={"First Movie (2001)"}
        isLoading={false}
        message="Found 1 people covering 1 movies."
        messageTone="muted"
        onInputChange={vi.fn()}
      />,
    );

    expect(html).toContain("Found 1 people covering 1 movies.");
    expect(html).toContain("John Example");
    expect(html).toContain("First Movie (2001)");
    expect(html).toContain("Hero");
  });
});

import { describe, expect, it } from "vitest";
import { TMDB_POSTER_BASE_URL } from "../constants";
import {
  getAssociatedMovieCreditGroupsFromPersonCredits,
  getAssociatedMoviesFromPersonCredits,
  getAssociatedPeopleFromMovieCreditsForSnapshot,
  formatFallbackPersonDisplayName,
  formatMoviePathLabel,
  getAssociatedPeopleFromMovieCredits,
  getAssociatedPersonCreditGroupsFromMovieCredits,
  getCinenerdleMovieId,
  getCinenerdlePersonId,
  getFilmKey,
  getMovieCardKey,
  getMovieKeyFromCredit,
  getMoviePosterUrl,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getPersonCardKey,
  getPersonProfileImageUrl,
  getPosterUrl,
  getTmdbMovieCredits,
  getUniqueSortedTmdbMovieCredits,
  getValidTmdbEntityId,
  isAllowedBfsTmdbMovieCredit,
  normalizeName,
  normalizeTitle,
  normalizeWhitespace,
  parseMoviePathLabel,
} from "../utils";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
} from "./factories";

describe("normalization helpers", () => {
  it("normalizes whitespace, names, and titles", () => {
    expect(normalizeWhitespace("  Kenneth   Collard  ")).toBe("Kenneth Collard");
    expect(normalizeName("  Kenneth   Collard  ")).toBe("kenneth collard");
    expect(normalizeTitle("  The   Insider  ")).toBe("the insider");
  });

  it("formats fallback person display names without touching mixed-case names", () => {
    expect(formatFallbackPersonDisplayName("  andy   weir  ")).toBe("Andy Weir");
    expect(formatFallbackPersonDisplayName("Drew Goddard")).toBe("Drew Goddard");
    expect(formatFallbackPersonDisplayName("k.d. lang")).toBe("k.d. lang");
  });

  it("formats and parses movie labels with and without a year", () => {
    expect(formatMoviePathLabel("Heat", "1995")).toBe("Heat (1995)");
    expect(formatMoviePathLabel("Heat")).toBe("Heat");
    expect(parseMoviePathLabel("  Heat   (1995) ")).toEqual({
      kind: "movie",
      name: "Heat",
      year: "1995",
    });
    expect(parseMoviePathLabel("Heat")).toEqual({
      kind: "movie",
      name: "Heat",
      year: "",
    });
  });
});

describe("key helpers", () => {
  it("builds normalized film and person keys", () => {
    expect(getFilmKey("  Heat  ", " 1995 ")).toBe("heat (1995)");
    expect(getCinenerdleMovieId("Heat", "1995")).toBe("heat (1995)");
    expect(getCinenerdlePersonId("  Al   Pacino ")).toBe("al pacino");
    expect(getPersonCardKey("Al Pacino")).toBe("person:al pacino");
    expect(getPersonCardKey("Al Pacino", 77)).toBe("person:77");
    expect(getMovieCardKey("Heat", "1995")).toBe("movie:heat (1995)");
    expect(getMovieCardKey("Heat", "1995", 88)).toBe("movie:88");
  });
});

describe("tmdb credit helpers", () => {
  it("derives movie title, year, and key from credits", () => {
    const credit = makeMovieCredit({
      title: undefined,
      original_title: "Le Samourai",
      release_date: "1967-10-25",
    });

    expect(getMovieTitleFromCredit(credit)).toBe("Le Samourai");
    expect(getMovieYearFromCredit(credit)).toBe("1967");
    expect(getMovieKeyFromCredit(credit)).toBe("le samourai (1967)");
  });

  it("coerces valid tmdb ids and rejects invalid candidates", () => {
    expect(getValidTmdbEntityId(123)).toBe(123);
    expect(getValidTmdbEntityId("456")).toBe(456);
    expect(getValidTmdbEntityId("12.5")).toBeNull();
    expect(getValidTmdbEntityId("-4")).toBeNull();
    expect(getValidTmdbEntityId(Infinity)).toBeNull();
    expect(getValidTmdbEntityId(undefined)).toBeNull();
  });
});

describe("poster helpers", () => {
  it("builds poster URLs and handles nullish paths", () => {
    expect(getPosterUrl("/heat.jpg")).toBe(`${TMDB_POSTER_BASE_URL}/w185/heat.jpg`);
    expect(getPosterUrl("/heat.jpg", "w500")).toBe(`${TMDB_POSTER_BASE_URL}/w500/heat.jpg`);
    expect(getPosterUrl(null)).toBeNull();
  });

  it("prefers TMDb profile and movie poster paths when present", () => {
    expect(
      getPersonProfileImageUrl(
        makePersonRecord({
          rawTmdbPerson: {
            id: 7,
            name: "Al Pacino",
            profile_path: "/profile.jpg",
          },
        }),
      ),
    ).toBe(`${TMDB_POSTER_BASE_URL}/w185/profile.jpg`);

    expect(
      getMoviePosterUrl(
        makeFilmRecord({
          rawTmdbMovie: {
            id: 8,
            title: "Heat",
            poster_path: "/tmdb.jpg",
          },
        }),
      ),
    ).toBe(`${TMDB_POSTER_BASE_URL}/w185/tmdb.jpg`);
    expect(getMoviePosterUrl(makeFilmRecord())).toBeNull();
  });

  it("uses TMDb posters and null profile values when available data is sparse", () => {
    expect(
      getMoviePosterUrl(
        makeFilmRecord({
          rawTmdbMovie: {
            id: 9,
            title: "Heat",
            poster_path: "/tmdb-only.jpg",
          },
        }),
      ),
    ).toBe(`${TMDB_POSTER_BASE_URL}/w185/tmdb-only.jpg`);
    expect(getPersonProfileImageUrl(makePersonRecord())).toBeNull();
  });
});

describe("tmdb credit aggregation", () => {
  it("merges cast and crew credits and annotates their credit types", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [makeMovieCredit({ id: 1, title: "Heat" })],
        crew: [makeMovieCredit({ id: 2, title: "The Insider", creditType: undefined, job: "Writer" })],
      },
    });

    expect(getTmdbMovieCredits(personRecord)).toEqual([
      expect.objectContaining({ id: 1, title: "Heat", creditType: "cast" }),
      expect.objectContaining({ id: 2, title: "The Insider", creditType: "crew", job: "Writer" }),
    ]);
  });

  it("returns an empty list when a person record has no TMDb credits", () => {
    expect(getTmdbMovieCredits(null)).toEqual([]);
    expect(getAssociatedMoviesFromPersonCredits(makePersonRecord())).toEqual([]);
    expect(getUniqueSortedTmdbMovieCredits(makePersonRecord())).toEqual([]);
  });

  it("filters BFS movie credits by uncredited cast and allowed crew jobs", () => {
    expect(
      isAllowedBfsTmdbMovieCredit(
        makeMovieCredit({
          creditType: "cast",
          character: "Bank Clerk (uncredited)",
        }),
      ),
    ).toBe(false);
    expect(
      isAllowedBfsTmdbMovieCredit(
        makeMovieCredit({
          creditType: "cast",
          character: "Vincent Hanna",
        }),
      ),
    ).toBe(true);
    expect(
      isAllowedBfsTmdbMovieCredit(
        makeMovieCredit({
          creditType: "crew",
          job: "Director of Photography",
          character: undefined,
        }),
      ),
    ).toBe(true);
    expect(
      isAllowedBfsTmdbMovieCredit(
        makeMovieCredit({
          creditType: "crew",
          job: "Producer",
          character: undefined,
        }),
      ),
    ).toBe(false);
  });

  it("dedupes movie credits by id, drops missing ids, and sorts by popularity", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 5, title: "Heat", popularity: 10 }),
          makeMovieCredit({ id: 5, title: "Heat", popularity: 999 }),
          makeMovieCredit({ id: undefined, title: "No Id", popularity: 50 }),
        ],
        crew: [makeMovieCredit({ id: 6, title: "Insomnia", popularity: 70, creditType: undefined })],
      },
    });

    expect(getUniqueSortedTmdbMovieCredits(personRecord).map((credit) => credit.id)).toEqual([6, 5]);
  });

  it("preserves cast queue order when dual-merging person movie credits", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 1, title: "First Cast", popularity: 90 }),
          makeMovieCredit({ id: 2, title: "Second Cast", popularity: 40 }),
        ],
        crew: [],
      },
    });

    expect(getAssociatedMoviesFromPersonCredits(personRecord).map((credit) => credit.title)).toEqual([
      "First Cast",
      "Second Cast",
    ]);
  });

  it("alternates ordered and popularity turns when only cast movie credits remain", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 1, title: "Early Low", order: 0, popularity: 10 }),
          makeMovieCredit({ id: 2, title: "Lincoln", order: 5, popularity: 80 }),
          makeMovieCredit({ id: 3, title: "Middle", order: 2, popularity: 30 }),
        ],
        crew: [],
      },
    });

    expect(getAssociatedMoviesFromPersonCredits(personRecord).map((credit) => credit.title)).toEqual([
      "Early Low",
      "Lincoln",
      "Middle",
    ]);
  });

  it("preserves crew queue order when dual-merging person movie credits", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [
          makeMovieCredit({ id: 1, title: "First Crew", popularity: 90, creditType: undefined }),
          makeMovieCredit({ id: 2, title: "Second Crew", popularity: 40, creditType: undefined }),
        ],
      },
    });

    expect(getAssociatedMoviesFromPersonCredits(personRecord).map((credit) => credit.title)).toEqual([
      "First Crew",
      "Second Crew",
    ]);
  });

  it("keeps both cast and crew roles inside a grouped person-to-movie connection", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 3563,
            title: "I Now Pronounce You Chuck & Larry",
            release_date: "2007-07-12",
            popularity: 3.5179,
            character: "Charles 'Chuck' Levine",
          }),
        ],
        crew: [
          makeMovieCredit({
            id: 3563,
            title: "I Now Pronounce You Chuck & Larry",
            release_date: "2007-07-12",
            popularity: 3.5179,
            creditType: undefined,
            character: undefined,
            job: "Producer",
            department: "Production",
            order: undefined,
          }),
        ],
      },
    });

    expect(getAssociatedMovieCreditGroupsFromPersonCredits(personRecord)).toEqual([
      [
        expect.objectContaining({
          id: 3563,
          creditType: "cast",
          character: "Charles 'Chuck' Levine",
        }),
        expect.objectContaining({
          id: 3563,
          creditType: "crew",
          job: "Producer",
        }),
      ],
    ]);
    expect(getAssociatedMoviesFromPersonCredits(personRecord)).toEqual([
      expect.objectContaining({
        id: 3563,
        creditType: "cast",
        character: "Charles 'Chuck' Levine",
      }),
    ]);
  });

  it("keeps both cast and crew roles for snapshot export while preserving a cast-first movie connection card", () => {
    const movieRecord = makeFilmRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 19292,
            name: "Adam Sandler",
            popularity: 7.408,
            character: "Charles 'Chuck' Levine",
          }),
        ],
        crew: [
          makePersonCredit({
            id: 19292,
            name: "Adam Sandler",
            popularity: 7.408,
            creditType: undefined,
            character: undefined,
            job: "Producer",
            department: "Production",
            order: undefined,
          }),
        ],
      },
    });

    expect(getAssociatedPersonCreditGroupsFromMovieCredits(movieRecord)).toEqual([
      [
        expect.objectContaining({
          id: 19292,
          creditType: "cast",
          character: "Charles 'Chuck' Levine",
        }),
        expect.objectContaining({
          id: 19292,
          creditType: "crew",
          job: "Producer",
        }),
      ],
    ]);
    expect(getAssociatedPeopleFromMovieCredits(movieRecord)).toEqual([
      expect.objectContaining({
        id: 19292,
        creditType: "cast",
        character: "Charles 'Chuck' Levine",
      }),
    ]);
    expect(getAssociatedPeopleFromMovieCreditsForSnapshot(movieRecord)).toEqual([
      expect.objectContaining({
        id: 19292,
        creditType: "cast",
        character: "Charles 'Chuck' Levine",
      }),
      expect.objectContaining({
        id: 19292,
        creditType: "crew",
        job: "Producer",
      }),
    ]);
  });

  it("alternates ordered turns with global popularity turns when merging person movie credits", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 1, title: "Cast Head", order: 0, popularity: 80 }),
          makeMovieCredit({ id: 2, title: "Cast Tail", order: 1, popularity: 20 }),
        ],
        crew: [
          makeMovieCredit({ id: 3, title: "Crew Head", popularity: 50, creditType: undefined }),
          makeMovieCredit({ id: 4, title: "Crew High", popularity: 90, creditType: undefined }),
          makeMovieCredit({ id: 5, title: "Crew Tail", popularity: 10, creditType: undefined }),
        ],
      },
    });

    expect(getAssociatedMoviesFromPersonCredits(personRecord).map((credit) => credit.title)).toEqual([
      "Cast Head",
      "Crew High",
      "Crew Head",
      "Cast Tail",
      "Crew Tail",
    ]);
  });

  it("uses cast order before alternating person movie credits", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 1, title: "Cast Later", order: 5, popularity: 70 }),
          makeMovieCredit({ id: 2, title: "Beau Is Afraid", order: 0, popularity: 10 }),
        ],
        crew: [
          makeMovieCredit({ id: 3, title: "Crew Head", popularity: 8, creditType: undefined }),
          makeMovieCredit({ id: 4, title: "Crew High", popularity: 30, creditType: undefined }),
        ],
      },
    });

    expect(getAssociatedMoviesFromPersonCredits(personRecord).map((credit) => credit.title)).toEqual([
      "Beau Is Afraid",
      "Cast Later",
      "Crew Head",
      "Crew High",
    ]);
  });

  it("prefers cast when ordered turns tie on popularity for person movie credits", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 1, title: "Cast Head", popularity: 60 }),
        ],
        crew: [
          makeMovieCredit({ id: 2, title: "Crew Head", popularity: 60, creditType: undefined }),
        ],
      },
    });

    expect(getAssociatedMoviesFromPersonCredits(personRecord).map((credit) => credit.title)).toEqual([
      "Cast Head",
      "Crew Head",
    ]);
  });

  it("prefers cast when global-popularity turns tie for person movie credits", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 1, title: "Ordered Winner", popularity: 90 }),
          makeMovieCredit({ id: 2, title: "Cast Global Tie", popularity: 60 }),
        ],
        crew: [
          makeMovieCredit({ id: 3, title: "Crew Head", popularity: 10, creditType: undefined }),
          makeMovieCredit({ id: 4, title: "Crew Global Tie", popularity: 60, creditType: undefined }),
        ],
      },
    });

    expect(getAssociatedMoviesFromPersonCredits(personRecord).map((credit) => credit.title)).toEqual([
      "Ordered Winner",
      "Cast Global Tie",
      "Crew Head",
      "Crew Global Tie",
    ]);
  });

  it("keeps earlier queue position when global-popularity ties within a queue", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 1, title: "Cast Head", popularity: 95 }),
          makeMovieCredit({ id: 2, title: "Cast Tail", popularity: 5 }),
        ],
        crew: [
          makeMovieCredit({ id: 3, title: "Crew Earlier", popularity: 90, creditType: undefined }),
          makeMovieCredit({ id: 4, title: "Crew Later", popularity: 90, creditType: undefined }),
        ],
      },
    });

    expect(getAssociatedMoviesFromPersonCredits(personRecord).map((credit) => credit.title)).toEqual([
      "Cast Head",
      "Crew Earlier",
      "Crew Later",
      "Cast Tail",
    ]);
  });

  it("dedupes and filters person movie credits without disturbing the dual-merge sequence", () => {
    const personRecord = makePersonRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 1, title: "Keep Cast", popularity: 80 }),
          makeMovieCredit({ id: 1, title: "Duplicate Cast", popularity: 70 }),
          makeMovieCredit({ id: undefined, title: "Missing Id", popularity: 60 }),
        ],
        crew: [
          makeMovieCredit({ id: 2, title: "Keep Crew", popularity: 75, creditType: undefined }),
          makeMovieCredit({ id: 1, title: "Duplicate Crew", popularity: 74, creditType: undefined }),
        ],
      },
    });

    expect(getAssociatedMoviesFromPersonCredits(personRecord).map((credit) => credit.title)).toEqual([
      "Keep Cast",
      "Keep Crew",
    ]);
  });

  it("alternates ordered turns with global popularity turns for movie credits while preserving filtering", () => {
    const filmRecord = makeFilmRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 1, name: "Al Pacino", order: 1, popularity: 50 }),
          makePersonCredit({ id: 2, name: "Robert De Niro", order: 0, popularity: 80 }),
          makePersonCredit({
            id: 3,
            name: "Bit Part",
            order: 2,
            character: "Clerk (uncredited)",
            popularity: 99,
          }),
          makePersonCredit({ id: undefined, name: "Kenneth Collard", order: 3, popularity: 40 }),
          makePersonCredit({ id: undefined, name: "  kenneth   collard ", order: 4, popularity: 10 }),
        ],
        crew: [
          makePersonCredit({
            id: 4,
            name: "Aaron Sorkin",
            order: 99,
            creditType: undefined,
            character: undefined,
            job: "Screenplay",
            department: "Writing",
            popularity: 60,
          }),
          makePersonCredit({
            id: 5,
            name: "Michael Mann",
            order: 98,
            creditType: undefined,
            character: undefined,
            job: "Director",
            department: "Directing",
            popularity: 90,
          }),
          makePersonCredit({
            id: 6,
            name: "Producer Person",
            order: 97,
            creditType: undefined,
            character: undefined,
            job: "Producer",
            department: "Production",
            popularity: 100,
          }),
        ],
      },
    });

    expect(getAssociatedPeopleFromMovieCredits(filmRecord).map((credit) => credit.name)).toEqual([
      "Michael Mann",
      "Robert De Niro",
      "Aaron Sorkin",
      "Al Pacino",
      "Kenneth Collard",
    ]);
  });

  it("prefers cast when ordered turns tie on popularity for movie credits", () => {
    const filmRecord = makeFilmRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 1, name: "Cast Head", order: 0, popularity: 60 }),
        ],
        crew: [
          makePersonCredit({
            id: 2,
            name: "Crew Head",
            order: 10,
            creditType: undefined,
            character: undefined,
            job: "Director",
            popularity: 60,
          }),
        ],
      },
    });

    expect(getAssociatedPeopleFromMovieCredits(filmRecord).map((credit) => credit.name)).toEqual([
      "Cast Head",
      "Crew Head",
    ]);
  });

  it("uses the lowest crew order on ordered turns for movie credits", () => {
    const filmRecord = makeFilmRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 1, name: "Cast Head", order: 4, popularity: 70 }),
          makePersonCredit({ id: 2, name: "Cast Tail", order: 8, popularity: 10 }),
        ],
        crew: [
          makePersonCredit({
            id: 3,
            name: "Crew Later",
            order: 9,
            creditType: undefined,
            character: undefined,
            job: "Director",
            popularity: 20,
          }),
          makePersonCredit({
            id: 4,
            name: "Crew Earliest",
            order: 1,
            creditType: undefined,
            character: undefined,
            job: "Writer",
            popularity: 60,
          }),
          makePersonCredit({
            id: 5,
            name: "Crew Most Popular",
            order: 7,
            creditType: undefined,
            character: undefined,
            job: "Screenplay",
            popularity: 90,
          }),
        ],
      },
    });

    expect(getAssociatedPeopleFromMovieCredits(filmRecord).map((credit) => credit.name)).toEqual([
      "Cast Head",
      "Crew Most Popular",
      "Crew Earliest",
      "Crew Later",
      "Cast Tail",
    ]);
  });

  it("drops nameless movie-credit people even if they have ids", () => {
    const filmRecord = makeFilmRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 1, name: "", popularity: 90 }),
          makePersonCredit({ id: 2, name: "Val Kilmer", popularity: 50 }),
        ],
      },
    });

    expect(getAssociatedPeopleFromMovieCredits(filmRecord).map((credit) => credit.name)).toEqual([
      "Val Kilmer",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { TMDB_POSTER_BASE_URL } from "../constants";
import type { CinenerdleDailyStarter } from "../types";
import {
  buildPeopleByRoleFromStarter,
  createEmptyPeopleByRole,
  formatMoviePathLabel,
  getAssociatedPeopleFromMovieCredits,
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
  getSnapshotConnectionLabels,
  getSnapshotPeopleByRole,
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
  makeStarter,
} from "./factories";

describe("normalization helpers", () => {
  it("normalizes whitespace, names, and titles", () => {
    expect(normalizeWhitespace("  Kenneth   Collard  ")).toBe("Kenneth Collard");
    expect(normalizeName("  Kenneth   Collard  ")).toBe("kenneth collard");
    expect(normalizeTitle("  The   Insider  ")).toBe("the insider");
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

  it("prefers profile paths and cinenerdle starter posters when present", () => {
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
          rawCinenerdleDailyStarter: makeStarter({
            posterUrl: "https://img.test/starter.jpg",
          }),
          rawTmdbMovie: {
            id: 8,
            title: "Heat",
            poster_path: "/tmdb.jpg",
          },
        }),
      ),
    ).toBe("https://img.test/starter.jpg");
    expect(getMoviePosterUrl(makeFilmRecord())).toBeNull();
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

  it("dedupes people identities, filters unsupported crew jobs, and sorts by popularity", () => {
    const filmRecord = makeFilmRecord({
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 1, name: "Al Pacino", popularity: 80 }),
          makePersonCredit({ id: 1, name: "Al Pacino", popularity: 20 }),
          makePersonCredit({ id: 2, name: "Bit Part", character: "Clerk (uncredited)", popularity: 99 }),
          makePersonCredit({ id: undefined, name: "Kenneth Collard", popularity: 40 }),
          makePersonCredit({ id: undefined, name: "  kenneth   collard ", popularity: 10 }),
        ],
        crew: [
          makePersonCredit({
            id: 3,
            name: "Michael Mann",
            creditType: undefined,
            character: undefined,
            job: "Director",
            department: "Directing",
            popularity: 70,
          }),
          makePersonCredit({
            id: 4,
            name: "Producer Person",
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
      "Bit Part",
      "Al Pacino",
      "Michael Mann",
      "Kenneth Collard",
    ]);
  });
});

describe("starter and snapshot helpers", () => {
  it("creates empty people-by-role buckets", () => {
    expect(createEmptyPeopleByRole()).toEqual({
      cast: [],
      directors: [],
      writers: [],
      composers: [],
    });
  });

  it("filters falsey starter names and preserves order", () => {
    const starter = {
      cast: ["Tom Hanks", null, "Meg Ryan"],
      directors: [undefined, "Nora Ephron"],
      writers: ["", "Delia Ephron"],
      composers: ["Marc Shaiman", false],
    } as unknown as CinenerdleDailyStarter;

    expect(buildPeopleByRoleFromStarter(starter)).toEqual({
      cast: ["Tom Hanks", "Meg Ryan"],
      directors: ["Nora Ephron"],
      writers: ["Delia Ephron"],
      composers: ["Marc Shaiman"],
    });
  });

  it("returns snapshot people and flattened labels with an empty fallback", () => {
    const filmRecord = makeFilmRecord({
      starterPeopleByRole: {
        cast: ["Al Pacino"],
        directors: ["Michael Mann"],
        writers: ["Michael Mann"],
        composers: ["Elliot Goldenthal"],
      },
    });

    expect(getSnapshotPeopleByRole(filmRecord)).toEqual({
      cast: ["Al Pacino"],
      directors: ["Michael Mann"],
      writers: ["Michael Mann"],
      composers: ["Elliot Goldenthal"],
    });
    expect(getSnapshotConnectionLabels(filmRecord)).toEqual([
      "Al Pacino",
      "Michael Mann",
      "Michael Mann",
      "Elliot Goldenthal",
    ]);
    expect(getSnapshotPeopleByRole(null)).toEqual(createEmptyPeopleByRole());
    expect(getSnapshotConnectionLabels(null)).toEqual([]);
  });
});

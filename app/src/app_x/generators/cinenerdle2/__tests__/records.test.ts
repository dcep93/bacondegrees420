import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFilmRecord,
  buildPersonRecord,
  chooseBestFilmRecord,
  pickBestPersonRecord,
  chooseBestMovieSearchResult,
  withDerivedFilmFields,
  withDerivedPersonFields,
} from "../records";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeStarter,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
} from "./factories";

afterEach(() => {
  vi.useRealTimers();
});

describe("withDerivedPersonFields", () => {
  it("normalizes derived person fields and dedupes movie connection keys", () => {
    const personRecord = withDerivedPersonFields(
      makePersonRecord({
        id: 111,
        tmdbId: null,
        lookupKey: "",
        name: "  Kenneth   Collard  ",
        nameLower: "",
        movieConnectionKeys: ["heat (1995)"],
        rawTmdbPerson: makeTmdbPersonSearchResult({
          id: 222,
          name: "Kenneth Collard",
        }),
        rawTmdbMovieCreditsResponse: {
          cast: [
            makeMovieCredit({ id: 1, title: "Heat", release_date: "1995-12-15" }),
            makeMovieCredit({ id: 2, title: "Insomnia", release_date: "2002-05-24" }),
          ],
          crew: [
            makeMovieCredit({
              id: 3,
              title: "Heat",
              release_date: "1995-12-15",
              creditType: undefined,
              character: undefined,
              job: "Costumer",
            }),
            makeMovieCredit({
              id: 4,
              title: "The Insider",
              release_date: "1999-11-05",
              creditType: undefined,
              character: undefined,
              job: "Director",
            }),
          ],
        },
      }),
    );

    expect(personRecord.tmdbId).toBe(222);
    expect(personRecord.lookupKey).toBe("kenneth collard");
    expect(personRecord.nameLower).toBe("kenneth collard");
    expect(personRecord.movieConnectionKeys).toEqual([
      "heat (1995)",
      "insomnia (2002)",
      "the insider (1999)",
    ]);
  });

  it("falls back to a numeric record id when no tmdb person payload is present", () => {
    const personRecord = withDerivedPersonFields(
      makePersonRecord({
        id: 444,
        tmdbId: null,
        rawTmdbPerson: undefined,
        rawTmdbMovieCreditsResponse: undefined,
      }),
    );

    expect(personRecord.tmdbId).toBe(444);
    expect(personRecord.movieConnectionKeys).toEqual([]);
  });

  it("drops stale producer-only movie connections when tmdb movie credits are available", () => {
    const personRecord = withDerivedPersonFields(
      makePersonRecord({
        id: 444,
        tmdbId: 444,
        name: "Producer Person",
        movieConnectionKeys: ["heat (1995)"],
        rawTmdbMovieCreditsResponse: {
          cast: [],
          crew: [
            makeMovieCredit({
              id: 3,
              title: "Heat",
              release_date: "1995-12-15",
              creditType: undefined,
              job: "Producer",
            }),
          ],
        },
      }),
    );

    expect(personRecord.movieConnectionKeys).toEqual([]);
  });
});

describe("withDerivedFilmFields", () => {
  it("normalizes derived film fields from TMDb movie credits only", () => {
    const filmRecord = withDerivedFilmFields(
      makeFilmRecord({
        id: "starter-heat",
        tmdbId: null,
        lookupKey: "",
        title: "  Heat  ",
        titleLower: "",
        year: "1995",
        titleYear: "",
        popularity: 70,
        personConnectionKeys: ["al pacino"],
        rawTmdbMovie: makeTmdbMovieSearchResult({
          id: 555,
          title: "Heat",
        }),
        rawTmdbMovieCreditsResponse: {
          cast: [
            makePersonCredit({ id: 1, name: "Al Pacino" }),
            makePersonCredit({ id: 2, name: "Robert De Niro" }),
          ],
          crew: [
            makePersonCredit({
              id: 3,
              name: "Michael Mann",
              creditType: undefined,
              character: undefined,
              job: "Director",
            }),
            makePersonCredit({
              id: 4,
              name: "Mark Avery",
              creditType: undefined,
              character: undefined,
              job: "Costumer",
            }),
          ],
        },
        rawCinenerdleDailyStarter: makeStarter(),
        isCinenerdleDailyStarter: undefined,
      }),
    );

    expect(filmRecord.tmdbId).toBe(555);
    expect(filmRecord.lookupKey).toBe("heat (1995)");
    expect(filmRecord.titleLower).toBe("heat");
    expect(filmRecord.titleYear).toBe("heat (1995)");
    expect(filmRecord.personConnectionKeys).toEqual(["al pacino", "robert de niro", "michael mann"]);
    expect(filmRecord.personConnectionKeys).not.toContain("mark avery");
    expect(filmRecord.isCinenerdleDailyStarter).toBe(1);
  });

  it("defaults the starter flag to zero when no starter payload exists", () => {
    const filmRecord = withDerivedFilmFields(
      makeFilmRecord({
        id: "plain-film",
        tmdbId: null,
        rawTmdbMovie: undefined,
        rawCinenerdleDailyStarter: undefined,
        isCinenerdleDailyStarter: undefined,
      }),
    );

    expect(filmRecord.isCinenerdleDailyStarter).toBe(0);
    expect(filmRecord.tmdbId).toBeNull();
  });
});

describe("buildFilmRecord", () => {
  it("overlays TMDb data while preserving starter fields and cached credits", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T12:34:56.000Z"));

    const existingFilmRecord = makeFilmRecord({
      id: "starter-heat",
      tmdbId: null,
      title: "Heat",
      year: "1995",
      popularity: 10,
      personConnectionKeys: ["al pacino"],
      rawCinenerdleDailyStarter: makeStarter({
        title: "Heat (1995)",
      }),
      isCinenerdleDailyStarter: 1,
      rawTmdbMovieCreditsResponse: {
        cast: [makePersonCredit({ id: 1, name: "Al Pacino" })],
        crew: [],
      },
      tmdbCreditsSavedAt: "2026-03-27T00:00:00.000Z",
    });
    const tmdbFilm = makeTmdbMovieSearchResult({
      id: 999,
      title: "Heat",
      release_date: "1995-12-15",
      popularity: 99,
      vote_average: 8.5,
      vote_count: 9999,
    });

    const filmRecord = buildFilmRecord(existingFilmRecord, tmdbFilm);

    expect(filmRecord.id).toBe(999);
    expect(filmRecord.tmdbId).toBe(999);
    expect(filmRecord.popularity).toBe(99);
    expect(filmRecord.rawTmdbMovie).toEqual(tmdbFilm);
    expect(filmRecord.rawCinenerdleDailyStarter).toEqual(existingFilmRecord.rawCinenerdleDailyStarter);
    expect(filmRecord.rawTmdbMovieCreditsResponse).toEqual(existingFilmRecord.rawTmdbMovieCreditsResponse);
    expect(filmRecord.tmdbCreditsSavedAt).toBe("2026-03-27T00:00:00.000Z");
    expect(filmRecord.tmdbSavedAt).toBe("2026-03-28T12:34:56.000Z");
    expect(filmRecord.isCinenerdleDailyStarter).toBe(1);
  });

  it("uses original_title and release year when no existing film record is present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T13:00:00.000Z"));

    const filmRecord = buildFilmRecord(
      null,
      makeTmdbMovieSearchResult({
        id: 42,
        title: undefined,
        original_title: "Le Samourai",
        release_date: "1967-10-25",
        popularity: 75,
      }),
    );

    expect(filmRecord.id).toBe(42);
    expect(filmRecord.tmdbId).toBe(42);
    expect(filmRecord.title).toBe("Le Samourai");
    expect(filmRecord.year).toBe("1967");
    expect(filmRecord.lookupKey).toBe("le samourai (1967)");
    expect(filmRecord.tmdbSavedAt).toBe("2026-03-28T13:00:00.000Z");
  });
});

describe("chooseBestMovieSearchResult", () => {
  it("prefers an exact title match with the requested year", () => {
    const results = [
      makeTmdbMovieSearchResult({ id: 1, title: "Heat", release_date: "1986-01-01" }),
      makeTmdbMovieSearchResult({ id: 2, title: "Heat", release_date: "1995-12-15" }),
      makeTmdbMovieSearchResult({ id: 3, title: "The Heat", release_date: "2013-01-01" }),
    ];

    expect(chooseBestMovieSearchResult(results, "Heat", "1995")).toEqual(results[1]);
  });

  it("falls back to the first exact title match, then the first result, then null", () => {
    const results = [
      makeTmdbMovieSearchResult({ id: 1, title: "The Insider" }),
      makeTmdbMovieSearchResult({ id: 2, title: "Heat" }),
      makeTmdbMovieSearchResult({ id: 3, title: "Heat" }),
    ];

    expect(chooseBestMovieSearchResult(results, "Heat")).toEqual(results[1]);
    expect(chooseBestMovieSearchResult(results, "Collateral")).toEqual(results[0]);
    expect(chooseBestMovieSearchResult(undefined, "Collateral")).toBeNull();
  });

  it("matches titles case-insensitively and ignores surrounding whitespace in the query", () => {
    const results = [
      makeTmdbMovieSearchResult({ id: 1, title: "Heat" }),
      makeTmdbMovieSearchResult({ id: 2, title: "Collateral" }),
    ];

    expect(chooseBestMovieSearchResult(results, "  HEAT  ")).toEqual(results[0]);
  });
});

describe("chooseBestFilmRecord", () => {
  it("prefers exact matches by year, then TMDb-backed records, then popularity", () => {
    const exactNoTmdb = makeFilmRecord({
      id: "a",
      tmdbId: null,
      title: "Heat",
      year: "1995",
      popularity: 100,
    });
    const exactWithTmdb = makeFilmRecord({
      id: "b",
      tmdbId: 123,
      title: "Heat",
      year: "1995",
      popularity: 10,
    });
    const wrongYear = makeFilmRecord({
      id: "c",
      tmdbId: 999,
      title: "Heat",
      year: "1986",
      popularity: 999,
    });

    expect(chooseBestFilmRecord([exactNoTmdb, exactWithTmdb, wrongYear], "Heat", "1995")).toEqual(
      exactWithTmdb,
    );
    expect(chooseBestFilmRecord([wrongYear], "Heat", "1995")).toBeNull();
  });

  it("falls back to popularity ordering when tmdb availability is tied", () => {
    const lowerPopularity = makeFilmRecord({
      id: "low",
      tmdbId: null,
      title: "Heat",
      year: "1995",
      popularity: 10,
    });
    const higherPopularity = makeFilmRecord({
      id: "high",
      tmdbId: null,
      title: "Heat",
      year: "1995",
      popularity: 40,
    });

    expect(chooseBestFilmRecord([lowerPopularity, higherPopularity], "heat", "1995")).toEqual(
      higherPopularity,
    );
  });
});

describe("buildPersonRecord", () => {
  it("creates a normalized person record with a saved timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T08:00:00.000Z"));

    const person = makeTmdbPersonSearchResult({
      id: 321,
      name: "  Kenneth   Collard  ",
      popularity: 13,
    });
    const searchResponse = { results: [person] };
    const movieCreditsResponse = {
      cast: [makeMovieCredit({ id: 1, title: "Heat", release_date: "1995-12-15" })],
      crew: [],
    };

    const personRecord = buildPersonRecord(person, searchResponse, movieCreditsResponse);

    expect(personRecord).toEqual({
      id: 321,
      tmdbId: 321,
      lookupKey: "kenneth collard",
      name: "  Kenneth   Collard  ",
      nameLower: "kenneth collard",
      movieConnectionKeys: ["heat (1995)"],
      rawTmdbPerson: person,
      rawTmdbPersonSearchResponse: searchResponse,
      rawTmdbMovieCreditsResponse: movieCreditsResponse,
      savedAt: "2026-03-28T08:00:00.000Z",
    });
  });
});

describe("pickBestPersonRecord", () => {
  it("prefers the richer matching record with a profile image", () => {
    const staleRecord = makePersonRecord({
      id: 1352085,
      tmdbId: 1352085,
      name: "Andy Weir",
      rawTmdbMovieCreditsResponse: { crew: [] },
    });
    const richerRecord = makePersonRecord({
      id: 1352085,
      tmdbId: 1352085,
      name: "Andy Weir",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 1352085,
        name: "Andy Weir",
        profile_path: "/andy-weir.jpg",
        popularity: 2,
      }),
      rawTmdbMovieCreditsResponse: { crew: [] },
      savedAt: "2026-03-28T12:00:00.000Z",
    });

    expect(pickBestPersonRecord(staleRecord, richerRecord)).toEqual(richerRecord);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFilmRecord,
  buildPersonRecord,
  chooseBestFilmRecord,
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
    ]);
  });
});

describe("withDerivedFilmFields", () => {
  it("normalizes derived film fields and merges TMDb plus starter people", () => {
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
            }),
          ],
        },
        starterPeopleByRole: {
          cast: ["Val Kilmer"],
          directors: ["Michael Mann"],
          writers: ["Michael Mann"],
          composers: ["Elliot Goldenthal"],
        },
        rawCinenerdleDailyStarter: makeStarter(),
        isCinenerdleDailyStarter: undefined,
      }),
    );

    expect(filmRecord.tmdbId).toBe(555);
    expect(filmRecord.lookupKey).toBe("heat (1995)");
    expect(filmRecord.titleLower).toBe("heat");
    expect(filmRecord.titleYear).toBe("heat (1995)");
    expect(filmRecord.personConnectionKeys).toEqual([
      "al pacino",
      "robert de niro",
      "michael mann",
      "val kilmer",
      "elliot goldenthal",
    ]);
    expect(filmRecord.isCinenerdleDailyStarter).toBe(1);
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
      starterPeopleByRole: {
        cast: ["Al Pacino"],
        directors: ["Michael Mann"],
        writers: ["Michael Mann"],
        composers: ["Elliot Goldenthal"],
      },
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
    expect(filmRecord.starterPeopleByRole).toEqual(existingFilmRecord.starterPeopleByRole);
    expect(filmRecord.rawTmdbMovieCreditsResponse).toEqual(existingFilmRecord.rawTmdbMovieCreditsResponse);
    expect(filmRecord.tmdbCreditsSavedAt).toBe("2026-03-27T00:00:00.000Z");
    expect(filmRecord.tmdbSavedAt).toBe("2026-03-28T12:34:56.000Z");
    expect(filmRecord.isCinenerdleDailyStarter).toBe(1);
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

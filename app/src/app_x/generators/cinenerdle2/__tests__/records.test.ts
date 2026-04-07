import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPersonRecordFromFilmCredit,
  buildFilmRecord,
  buildPersonRecord,
  chooseBestFilmRecord,
  chooseBestMovieSearchResult,
  mergeFetchedTmdbMovie,
  mergePersonRecords,
  pickBestPersonRecord,
  withDerivedFilmFields,
  withDerivedPersonFields,
} from "../records";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
} from "./factories";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
    expect(personRecord.movieConnectionKeys).toEqual([1, 2, 4]);
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
      }),
    );

    expect(filmRecord.tmdbId).toBe(555);
    expect(filmRecord.lookupKey).toBe("heat (1995)");
    expect(filmRecord.titleLower).toBe("heat");
    expect(filmRecord.titleYear).toBe("heat (1995)");
    expect(filmRecord.personConnectionKeys).toEqual([1, 2, 3]);
    expect(filmRecord.personConnectionKeys).not.toContain(4);
  });

  it("leaves starter-specific fields out of derived film records", () => {
    const filmRecord = withDerivedFilmFields(
      makeFilmRecord({
        id: "plain-film",
        tmdbId: null,
        rawTmdbMovie: undefined,
      }),
    );

    expect("rawCinenerdleDailyStarter" in filmRecord).toBe(false);
    expect("isCinenerdleDailyStarter" in filmRecord).toBe(false);
    expect(filmRecord.tmdbId).toBeNull();
  });
});

describe("buildFilmRecord", () => {
  it("restores direct-film genres when an older cached movie payload had none", () => {
    const mergedMovie = mergeFetchedTmdbMovie(
      makeTmdbMovieSearchResult({
        id: 27007,
        title: "Overnight",
        release_date: "2003-06-12",
        genres: [],
      }),
      makeTmdbMovieSearchResult({
        id: 27007,
        title: "Overnight",
        release_date: "2003-06-12",
        genres: [{ id: 99, name: "Documentary" }],
      }),
      "2026-04-03T00:00:00.000Z",
      "2026-04-04T00:00:00.000Z",
    );

    expect(mergedMovie.genres).toEqual([{ id: 99, name: "Documentary" }]);
  });

  it("overlays TMDb data while preserving cached credits", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T12:34:56.000Z"));

    const existingFilmRecord = makeFilmRecord({
      id: "starter-heat",
      tmdbId: null,
      title: "Heat",
      year: "1995",
      popularity: 10,
      personConnectionKeys: ["al pacino"],
      rawTmdbMovieCreditsResponse: {
        cast: [makePersonCredit({ id: 1, name: "Al Pacino" })],
        crew: [],
      },
      fetchTimestamp: "2026-03-27T00:00:00.000Z",
    });
    const tmdbFilm = makeTmdbMovieSearchResult({
      id: 999,
      title: "Heat",
      release_date: "1995-12-15",
      popularity: 99,
      vote_average: 8.5,
      vote_count: 9999,
      runtime: 170,
    });

    const filmRecord = buildFilmRecord(existingFilmRecord, tmdbFilm);

    expect(filmRecord.id).toBe(999);
    expect(filmRecord.tmdbId).toBe(999);
    expect(filmRecord.tmdbSource).toBe("direct-film-fetch");
    expect(filmRecord.popularity).toBe(99);
    expect(filmRecord.rawTmdbMovie).toEqual(tmdbFilm);
    expect(filmRecord.rawTmdbMovieCreditsResponse).toEqual(existingFilmRecord.rawTmdbMovieCreditsResponse);
    expect(filmRecord.fetchTimestamp).toBe("2026-03-28T12:34:56.000Z");
  });

  it("preserves an older runtime when a newer fetch omits it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T13:00:00.000Z"));

    const existingFilmRecord = makeFilmRecord({
      id: 999,
      tmdbId: 999,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 999,
        title: "Heat",
        release_date: "1995-12-15",
        runtime: 170,
      }),
      fetchTimestamp: "2026-03-27T00:00:00.000Z",
    });

    const filmRecord = buildFilmRecord(
      existingFilmRecord,
      makeTmdbMovieSearchResult({
        id: 999,
        title: "Heat",
        release_date: "1995-12-15",
        runtime: undefined,
      }),
    );

    expect(filmRecord.rawTmdbMovie?.runtime).toBe(170);
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
    expect(filmRecord.fetchTimestamp).toBe("2026-03-28T13:00:00.000Z");
  });

  it("keeps older non-empty movie fields when a newer fetch is sparse", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T13:00:00.000Z"));

    const existingFilmRecord = makeFilmRecord({
      id: 999,
      tmdbId: 999,
      title: "Heat",
      year: "1995",
      popularity: 88,
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 999,
        title: "Heat",
        poster_path: "/heat.jpg",
        release_date: "1995-12-15",
        popularity: 88,
        vote_average: 8.2,
        vote_count: 9000,
      }),
      fetchTimestamp: "2026-03-27T00:00:00.000Z",
    });

    const filmRecord = buildFilmRecord(
      existingFilmRecord,
      makeTmdbMovieSearchResult({
        id: 999,
        title: "Heat",
        poster_path: null,
        popularity: 91,
        vote_average: undefined,
        vote_count: undefined,
      }),
    );

    expect(filmRecord.popularity).toBe(91);
    expect(filmRecord.rawTmdbMovie).toEqual(expect.objectContaining({
      poster_path: "/heat.jpg",
      popularity: 91,
      vote_average: 8.2,
      vote_count: 9000,
      release_date: "1995-12-15",
    }));
  });

  it("replaces populated movie fields when the newer fetch also has values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T13:00:00.000Z"));

    const existingFilmRecord = makeFilmRecord({
      id: 999,
      tmdbId: 999,
      title: "Heat",
      year: "1995",
      popularity: 88,
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 999,
        title: "Heat",
        poster_path: "/old-heat.jpg",
        release_date: "1995-12-15",
        popularity: 88,
        vote_average: 8.2,
        vote_count: 9000,
      }),
      fetchTimestamp: "2026-03-27T00:00:00.000Z",
    });

    const filmRecord = buildFilmRecord(
      existingFilmRecord,
      makeTmdbMovieSearchResult({
        id: 999,
        title: "Heat",
        poster_path: "/new-heat.jpg",
        popularity: 91,
        vote_average: 8.5,
        vote_count: 9100,
        release_date: "1995-12-16",
      }),
    );

    expect(filmRecord.popularity).toBe(91);
    expect(filmRecord.rawTmdbMovie).toEqual(expect.objectContaining({
      poster_path: "/new-heat.jpg",
      popularity: 91,
      vote_average: 8.5,
      vote_count: 9100,
      release_date: "1995-12-16",
    }));
  });

  it("alerts when the same tmdb film id disagrees on normalized title or year", () => {
    const alertMock = vi.fn();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { alert: alertMock });
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    expect(() =>
      buildFilmRecord(
        makeFilmRecord({
          id: 999,
          tmdbId: 999,
          title: "Heat",
          year: "1995",
        }),
        makeTmdbMovieSearchResult({
          id: 999,
          title: "Collateral",
          release_date: "2004-08-06",
        }),
      ),
    ).toThrow("conflicting title/year");
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0]?.[0]).toContain("\"reason\": \"conflicting-film-data\"");
  });
});

describe("buildPersonRecordFromFilmCredit", () => {
  it("builds a minimal persistent person record for credited film people", () => {
    const filmRecord = makeFilmRecord({
      title: "Gladiator",
      year: "2000",
      fetchTimestamp: "2026-03-30T00:00:00.000Z",
    });
    const personRecord = buildPersonRecordFromFilmCredit(
      filmRecord,
      makePersonCredit({
        id: 934,
        name: "Russell Crowe",
        profile_path: "/russell.jpg",
        popularity: 6.4841,
        fetchTimestamp: "2026-03-30T00:00:10.000Z",
      }),
    );

    expect(personRecord).toEqual(
      expect.objectContaining({
        id: 934,
        tmdbId: 934,
        tmdbSource: "connection-derived",
        name: "Russell Crowe",
        nameLower: "russell crowe",
        movieConnectionKeys: [50],
        fetchTimestamp: "2026-03-30T00:00:10.000Z",
        rawTmdbPerson: expect.objectContaining({
          id: 934,
          name: "Russell Crowe",
          profile_path: "/russell.jpg",
          popularity: 6.4841,
        }),
      }),
    );
  });

  it("returns null when the credited person cannot produce a valid tmdb identity", () => {
    expect(
      buildPersonRecordFromFilmCredit(
        makeFilmRecord({
          title: "Gladiator",
          year: "2000",
        }),
        makePersonCredit({
          id: undefined,
          name: "",
        }),
      ),
    ).toBeNull();
  });
});

describe("mergePersonRecords", () => {
  it("preserves richer person data while accumulating movie connection keys", () => {
    const existingPersonRecord = makePersonRecord({
      id: 934,
      tmdbId: 934,
      name: "Russell Crowe",
      movieConnectionKeys: [95],
      fetchTimestamp: "2026-03-27T00:00:00.000Z",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 934,
        name: "Russell Crowe",
        profile_path: "/russell.jpg",
        popularity: 6.48,
      }),
    });
    const nextPersonRecord = makePersonRecord({
      id: 934,
      tmdbId: 934,
      name: "Russell Crowe",
      movieConnectionKeys: [50],
      fetchTimestamp: "2026-03-28T00:00:00.000Z",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 934,
        name: "Russell Crowe",
        profile_path: null,
        popularity: 6.48,
      }),
    });

    expect(mergePersonRecords(existingPersonRecord, nextPersonRecord)).toEqual(
      expect.objectContaining({
        id: 934,
        tmdbId: 934,
        tmdbSource: "direct-person-fetch",
        movieConnectionKeys: [95, 50],
        rawTmdbPerson: expect.objectContaining({
          profile_path: "/russell.jpg",
        }),
      }),
    );
  });

  it("keeps older non-empty person fields when a newer fetch is sparse", () => {
    const mergedPersonRecord = mergePersonRecords(
      makePersonRecord({
        id: 934,
        tmdbId: 934,
        name: "Russell Crowe",
        fetchTimestamp: "2026-03-27T00:00:00.000Z",
        rawTmdbPerson: makeTmdbPersonSearchResult({
          id: 934,
          name: "Russell Crowe",
          profile_path: "/russell.jpg",
          popularity: 6.48,
        }),
      }),
      makePersonRecord({
        id: 934,
        tmdbId: 934,
        name: "Russell Crowe",
        fetchTimestamp: "2026-03-28T00:00:00.000Z",
        rawTmdbPerson: makeTmdbPersonSearchResult({
          id: 934,
          name: "Russell Crowe",
          profile_path: null,
          popularity: 7.25,
        }),
      }),
    );

    expect(mergedPersonRecord.fetchTimestamp).toBe("2026-03-28T00:00:00.000Z");
    expect(mergedPersonRecord.rawTmdbPerson).toEqual(expect.objectContaining({
      profile_path: "/russell.jpg",
      popularity: 7.25,
    }));
  });

  it("replaces populated person fields when the newer fetch also has values", () => {
    const mergedPersonRecord = mergePersonRecords(
      makePersonRecord({
        id: 934,
        tmdbId: 934,
        name: "Russell Crowe",
        fetchTimestamp: "2026-03-27T00:00:00.000Z",
        rawTmdbPerson: makeTmdbPersonSearchResult({
          id: 934,
          name: "Russell Crowe",
          profile_path: "/russell-old.jpg",
          popularity: 6.48,
        }),
      }),
      makePersonRecord({
        id: 934,
        tmdbId: 934,
        name: "Russell Crowe",
        fetchTimestamp: "2026-03-28T00:00:00.000Z",
        rawTmdbPerson: makeTmdbPersonSearchResult({
          id: 934,
          name: "Russell Crowe",
          profile_path: "/russell-new.jpg",
          popularity: 7.25,
        }),
      }),
    );

    expect(mergedPersonRecord.rawTmdbPerson).toEqual(expect.objectContaining({
      profile_path: "/russell-new.jpg",
      popularity: 7.25,
    }));
  });

  it("keeps a direct-person-fetch source when newer connection-derived data is merged in", () => {
    const mergedPersonRecord = mergePersonRecords(
      makePersonRecord({
        id: 1372369,
        tmdbId: 1372369,
        name: "Samara Weaving",
        fetchTimestamp: "2026-03-30T20:52:30.000Z",
        tmdbSource: "direct-person-fetch",
        rawTmdbPerson: makeTmdbPersonSearchResult({
          id: 1372369,
          name: "Samara Weaving",
          profile_path: "/samara.jpg",
          popularity: 10.83,
        }),
        rawTmdbMovieCreditsResponse: {
          cast: [makeMovieCredit({ id: 1266127, title: "Ready or Not: Here I Come" })],
          crew: [],
        },
      }),
      makePersonRecord({
        id: 1372369,
        tmdbId: 1372369,
        name: "Samara Weaving",
        fetchTimestamp: "2026-03-30T20:52:31.000Z",
        tmdbSource: "connection-derived",
        movieConnectionKeys: ["ready or not: here i come (2026)"],
        rawTmdbPerson: makeTmdbPersonSearchResult({
          id: 1372369,
          name: "Samara Weaving",
          profile_path: null,
          popularity: 10.83,
        }),
        rawTmdbMovieCreditsResponse: undefined,
      }),
    );

    expect(mergedPersonRecord.tmdbSource).toBe("direct-person-fetch");
    expect(pickBestPersonRecord(mergedPersonRecord)?.tmdbSource).toBe("direct-person-fetch");
  });

  it("alerts when the same tmdb person id disagrees on normalized name", () => {
    const alertMock = vi.fn();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { alert: alertMock });
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    expect(() =>
      mergePersonRecords(
        makePersonRecord({
          id: 934,
          tmdbId: 934,
          name: "Russell Crowe",
          rawTmdbPerson: makeTmdbPersonSearchResult({
            id: 934,
            name: "Russell Crowe",
          }),
        }),
        makePersonRecord({
          id: 934,
          tmdbId: 934,
          name: "Someone Else",
          tmdbSource: "connection-derived",
        }),
      ),
    ).toThrow("conflicting names");
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0]?.[0]).toContain("\"reason\": \"conflicting-person-data\"");
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

    const personRecord = buildPersonRecord(person, movieCreditsResponse, searchResponse);

    expect(personRecord).toEqual({
      id: 321,
      tmdbId: 321,
      lookupKey: "kenneth collard",
      name: "  Kenneth   Collard  ",
      nameLower: "kenneth collard",
      movieConnectionKeys: [1],
      tmdbSource: "direct-person-fetch",
      rawTmdbPerson: person,
      rawTmdbPersonSearchResponse: searchResponse,
      rawTmdbMovieCreditsResponse: movieCreditsResponse,
      fetchTimestamp: "2026-03-28T08:00:00.000Z",
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
      fetchTimestamp: "2026-03-28T12:00:00.000Z",
    });

    expect(pickBestPersonRecord(staleRecord, richerRecord)).toEqual(richerRecord);
  });
});

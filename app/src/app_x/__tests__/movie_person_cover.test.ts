import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeFilmRecord,
  makePersonRecord,
  makeTmdbMovieSearchResult,
} from "../generators/cinenerdle2/__tests__/factories";

const indexedDbMock = vi.hoisted(() => ({
  getFilmRecordByTitleAndYear: vi.fn(),
  getPersonRecordsByMovieId: vi.fn(),
  saveFilmRecord: vi.fn(),
}));
const tmdbMock = vi.hoisted(() => ({
  hasMovieFullState: vi.fn(),
  prepareConnectionEntityForPreview: vi.fn(),
  prepareSelectedMovie: vi.fn(),
}));

vi.mock("../generators/cinenerdle2/indexed_db", () => indexedDbMock);
vi.mock("../generators/cinenerdle2/tmdb", () => tmdbMock);

import {
  getBestPersonTmdbIdsForMovieIds,
  getBestPersonTmdbIdsForMovieLabels,
  resolveMovieCoverRecordsForLabels,
  selectBestPersonTmdbIdsForMovieIds,
  type PersonCoverCandidate,
} from "../movie_person_cover";

describe("movie_person_cover", () => {
  beforeEach(() => {
    indexedDbMock.getFilmRecordByTitleAndYear.mockReset();
    indexedDbMock.getPersonRecordsByMovieId.mockReset();
    indexedDbMock.saveFilmRecord.mockReset();
    tmdbMock.hasMovieFullState.mockReset();
    tmdbMock.prepareConnectionEntityForPreview.mockReset();
    tmdbMock.prepareSelectedMovie.mockReset();
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    indexedDbMock.getPersonRecordsByMovieId.mockResolvedValue([]);
    indexedDbMock.saveFilmRecord.mockResolvedValue(undefined);
    tmdbMock.hasMovieFullState.mockImplementation((movieRecord: { rawTmdbMovie?: unknown; rawTmdbMovieCreditsResponse?: unknown } | null | undefined) =>
      Boolean(movieRecord?.rawTmdbMovie && movieRecord?.rawTmdbMovieCreditsResponse));
    tmdbMock.prepareConnectionEntityForPreview.mockResolvedValue(null);
    tmdbMock.prepareSelectedMovie.mockResolvedValue(null);
  });

  it("returns a single person when one person covers every requested movie", () => {
    const candidates: PersonCoverCandidate[] = [
      {
        tmdbId: 101,
        popularity: 25,
        movieConnectionKeys: [1, 2, 3],
      },
      {
        tmdbId: 102,
        popularity: 50,
        movieConnectionKeys: [1, 2],
      },
      {
        tmdbId: 103,
        popularity: 50,
        movieConnectionKeys: [3],
      },
    ];

    expect(selectBestPersonTmdbIdsForMovieIds([1, 2, 3], candidates)).toEqual([101]);
  });

  it("prefers a shorter cover over a higher-popularity longer cover", () => {
    const candidates: PersonCoverCandidate[] = [
      {
        tmdbId: 201,
        popularity: 10,
        movieConnectionKeys: [1, 2, 3],
      },
      {
        tmdbId: 202,
        popularity: 100,
        movieConnectionKeys: [1, 2],
      },
      {
        tmdbId: 203,
        popularity: 100,
        movieConnectionKeys: [3],
      },
    ];

    expect(selectBestPersonTmdbIdsForMovieIds([1, 2, 3], candidates)).toEqual([201]);
  });

  it("prefers higher total popularity among minimum-length covers", () => {
    const candidates: PersonCoverCandidate[] = [
      {
        tmdbId: 301,
        popularity: 40,
        movieConnectionKeys: [1],
      },
      {
        tmdbId: 302,
        popularity: 20,
        movieConnectionKeys: [2],
      },
      {
        tmdbId: 303,
        popularity: 15,
        movieConnectionKeys: [1],
      },
      {
        tmdbId: 304,
        popularity: 10,
        movieConnectionKeys: [2],
      },
    ];

    expect(selectBestPersonTmdbIdsForMovieIds([1, 2], candidates)).toEqual([301, 302]);
  });

  it("uses the lowest sorted tmdb ids when length and popularity tie", () => {
    const candidates: PersonCoverCandidate[] = [
      {
        tmdbId: 405,
        popularity: 15,
        movieConnectionKeys: [1],
      },
      {
        tmdbId: 406,
        popularity: 15,
        movieConnectionKeys: [2],
      },
      {
        tmdbId: 407,
        popularity: 15,
        movieConnectionKeys: [1],
      },
      {
        tmdbId: 408,
        popularity: 15,
        movieConnectionKeys: [2],
      },
    ];

    expect(selectBestPersonTmdbIdsForMovieIds([1, 2], candidates)).toEqual([405, 406]);
  });

  it("ignores duplicate input movie ids", () => {
    const candidates: PersonCoverCandidate[] = [
      {
        tmdbId: 501,
        popularity: 12,
        movieConnectionKeys: [1, 2],
      },
      {
        tmdbId: 502,
        popularity: 50,
        movieConnectionKeys: [2],
      },
    ];

    expect(selectBestPersonTmdbIdsForMovieIds([1, 1, 2], candidates)).toEqual([501]);
  });

  it("finds the true minimum-cardinality cover when a greedy choice would miss it", () => {
    const candidates: PersonCoverCandidate[] = [
      {
        tmdbId: 601,
        popularity: 100,
        movieConnectionKeys: [1, 2, 3],
      },
      {
        tmdbId: 602,
        popularity: 10,
        movieConnectionKeys: [4, 5],
      },
      {
        tmdbId: 603,
        popularity: 10,
        movieConnectionKeys: [6],
      },
      {
        tmdbId: 604,
        popularity: 10,
        movieConnectionKeys: [1, 2, 4],
      },
      {
        tmdbId: 605,
        popularity: 10,
        movieConnectionKeys: [3, 5, 6],
      },
    ];

    expect(selectBestPersonTmdbIdsForMovieIds([1, 2, 3, 4, 5, 6], candidates)).toEqual([604, 605]);
  });

  it("gathers async candidates across movies and merges duplicate people by tmdb id", async () => {
    indexedDbMock.getPersonRecordsByMovieId.mockImplementation(async (movieTmdbId: number) => {
      if (movieTmdbId === 2000) {
        return [
          makePersonRecord({
            id: 101,
            tmdbId: 101,
            name: "Shared Person",
            movieConnectionKeys: [2000],
            rawTmdbPerson: {
              id: 101,
              name: "Shared Person",
              popularity: 40,
            },
          }),
          makePersonRecord({
            id: 102,
            tmdbId: 102,
            name: "Movie One Only",
            movieConnectionKeys: [2000],
            rawTmdbPerson: {
              id: 102,
              name: "Movie One Only",
              popularity: 50,
            },
          }),
        ];
      }

      if (movieTmdbId === 2001) {
        return [
          makePersonRecord({
            id: 101,
            tmdbId: 101,
            name: "Shared Person",
            movieConnectionKeys: [2000, 2001],
            rawTmdbPerson: {
              id: 101,
              name: "Shared Person",
              popularity: 60,
            },
          }),
          makePersonRecord({
            id: 103,
            tmdbId: 103,
            name: "Movie Two Only",
            movieConnectionKeys: [2001],
            rawTmdbPerson: {
              id: 103,
              name: "Movie Two Only",
              popularity: 20,
            },
          }),
        ];
      }

      return [];
    });

    await expect(getBestPersonTmdbIdsForMovieIds([2000, 2001])).resolves.toEqual([101]);
  });

  it("throws when an async movie id is missing or has no connected people", async () => {
    indexedDbMock.getPersonRecordsByMovieId.mockImplementation(async (movieTmdbId: number) => {
      if (movieTmdbId === 2000) {
        return [
          makePersonRecord({
            id: 101,
            tmdbId: 101,
            name: "Covered Person",
            movieConnectionKeys: [2000],
            rawTmdbPerson: {
              id: 101,
              name: "Covered Person",
              popularity: 25,
            },
          }),
        ];
      }

      return [];
    });

    await expect(getBestPersonTmdbIdsForMovieIds([2000, 2999])).rejects.toThrow(
      "Unable to cover movie TMDB ids: 2999",
    );
  });

  it("resolves a movie from indexeddb by exact title and year without tmdb search", async () => {
    const cachedMovie = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(cachedMovie);

    indexedDbMock.getPersonRecordsByMovieId
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makePersonRecord({
          id: 10,
          tmdbId: 10,
          name: "Al Pacino",
          movieConnectionKeys: [321],
        }),
      ]);

    await expect(resolveMovieCoverRecordsForLabels(["Heat (1995)"])).resolves.toEqual([{
      inputLabel: "Heat (1995)",
      movieRecord: cachedMovie,
      tmdbId: 321,
    }]);
    expect(tmdbMock.prepareConnectionEntityForPreview).not.toHaveBeenCalled();
    expect(indexedDbMock.saveFilmRecord).toHaveBeenCalledWith(cachedMovie);
  });

  it("falls back to tmdb search and cache when a movie is not available locally", async () => {
    const hydratedMovie = makeFilmRecord({
      id: 654,
      tmdbId: 654,
      title: "Collateral",
      year: "2004",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 654,
        title: "Collateral",
        release_date: "2004-08-06",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    tmdbMock.prepareConnectionEntityForPreview.mockResolvedValue(hydratedMovie);

    indexedDbMock.getPersonRecordsByMovieId
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makePersonRecord({
          id: 20,
          tmdbId: 20,
          name: "Tom Cruise",
          movieConnectionKeys: [654],
        }),
      ]);

    await expect(resolveMovieCoverRecordsForLabels(["Collateral (2004)"])).resolves.toEqual([{
      inputLabel: "Collateral (2004)",
      movieRecord: hydratedMovie,
      tmdbId: 654,
    }]);
    expect(tmdbMock.prepareConnectionEntityForPreview).toHaveBeenCalledWith({
      key: "movie:collateral (2004)",
      kind: "movie",
      name: "Collateral (2004)",
      year: "2004",
    });
  });

  it("forces a movie refresh when cached movie credits have not produced person records", async () => {
    const cachedMovie = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const refreshedMovie = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(cachedMovie);
    indexedDbMock.getPersonRecordsByMovieId
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makePersonRecord({
          id: 10,
          tmdbId: 10,
          name: "Al Pacino",
          movieConnectionKeys: [321],
        }),
      ]);
    tmdbMock.prepareSelectedMovie.mockResolvedValue(refreshedMovie);

    await expect(resolveMovieCoverRecordsForLabels(["Heat (1995)"])).resolves.toEqual([{
      inputLabel: "Heat (1995)",
      movieRecord: refreshedMovie,
      tmdbId: 321,
    }]);
    expect(tmdbMock.prepareSelectedMovie).toHaveBeenCalledWith("Heat", "1995", 321, {
      forceRefresh: true,
    });
  });

  it("throws when a movie label cannot be resolved to a tmdb movie", async () => {
    await expect(resolveMovieCoverRecordsForLabels(["Unknown Movie (1999)"])).rejects.toThrow(
      "Unable to resolve movie: Unknown Movie (1999)",
    );
  });

  it("throws a clear error when a hydrated movie still has no derived people", async () => {
    const cachedMovie = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(cachedMovie);
    indexedDbMock.getPersonRecordsByMovieId.mockResolvedValue([]);
    tmdbMock.prepareSelectedMovie.mockResolvedValue(cachedMovie);

    await expect(resolveMovieCoverRecordsForLabels(["Heat (1995)"])).rejects.toThrow(
      "Unable to derive connected people for movie: Heat (1995)",
    );
  });

  it("returns the same winning ids for movie labels once labels resolve", async () => {
    const firstMovie = makeFilmRecord({
      id: 2000,
      tmdbId: 2000,
      title: "Movie One",
      year: "2000",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 2000,
        title: "Movie One",
        release_date: "2000-01-01",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const secondMovie = makeFilmRecord({
      id: 2001,
      tmdbId: 2001,
      title: "Movie Two",
      year: "2001",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 2001,
        title: "Movie Two",
        release_date: "2001-01-01",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) => {
      if (title === "Movie One" && year === "2000") {
        return firstMovie;
      }

      if (title === "Movie Two" && year === "2001") {
        return secondMovie;
      }

      return null;
    });
    indexedDbMock.getPersonRecordsByMovieId.mockImplementation(async (movieTmdbId: number) => {
      if (movieTmdbId === 2000) {
        return [
          makePersonRecord({
            id: 101,
            tmdbId: 101,
            name: "Shared Person",
            movieConnectionKeys: [2000, 2001],
            rawTmdbPerson: {
              id: 101,
              name: "Shared Person",
              popularity: 50,
            },
          }),
        ];
      }

      if (movieTmdbId === 2001) {
        return [
          makePersonRecord({
            id: 101,
            tmdbId: 101,
            name: "Shared Person",
            movieConnectionKeys: [2000, 2001],
            rawTmdbPerson: {
              id: 101,
              name: "Shared Person",
              popularity: 50,
            },
          }),
        ];
      }

      return [];
    });
    indexedDbMock.saveFilmRecord.mockResolvedValue(undefined);

    await expect(
      getBestPersonTmdbIdsForMovieLabels(["Movie One (2000)", "Movie Two (2001)"]),
    ).resolves.toEqual([101]);
  });

  it("ignores blank lines and dedupes duplicate resolved movie ids", async () => {
    const cachedMovie = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(cachedMovie);
    indexedDbMock.getPersonRecordsByMovieId.mockResolvedValue([
      makePersonRecord({
        id: 10,
        tmdbId: 10,
        name: "Al Pacino",
        movieConnectionKeys: [321],
      }),
    ]);

    await expect(
      resolveMovieCoverRecordsForLabels(["", "Heat (1995)", "  Heat (1995)  ", "   "]),
    ).resolves.toEqual([{
      inputLabel: "Heat (1995)",
      movieRecord: cachedMovie,
      tmdbId: 321,
    }]);
  });
});

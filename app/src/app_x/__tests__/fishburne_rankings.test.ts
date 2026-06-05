import { describe, expect, it, vi } from "vitest";
import {
  getFishburneRankedMovies,
  getMostPopularNonFishburneConnection,
  LAURENCE_FISHBURNE_TMDB_ID,
} from "../fishburne_rankings";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
} from "../generators/cinenerdle2/__tests__/factories";
import type { FilmRecord, PersonRecord } from "../generators/cinenerdle2/types";

function makeFishburnePerson(movieCredits: ReturnType<typeof makeMovieCredit>[]): PersonRecord {
  return makePersonRecord({
    id: LAURENCE_FISHBURNE_TMDB_ID,
    tmdbId: LAURENCE_FISHBURNE_TMDB_ID,
    name: "Laurence Fishburne",
    rawTmdbPerson: makeTmdbPersonSearchResult({
      id: LAURENCE_FISHBURNE_TMDB_ID,
      name: "Laurence Fishburne",
    }),
    rawTmdbMovieCreditsResponse: {
      cast: movieCredits,
      crew: [],
    },
  });
}

function makeHydratedMovie(overrides: {
  id: number;
  popularity?: number;
  title: string;
  year: string;
  credits: ReturnType<typeof makePersonCredit>[];
}): FilmRecord {
  return makeFilmRecord({
    id: overrides.id,
    tmdbId: overrides.id,
    title: overrides.title,
    year: overrides.year,
    popularity: overrides.popularity ?? 10,
    rawTmdbMovie: makeTmdbMovieSearchResult({
      id: overrides.id,
      title: overrides.title,
      release_date: overrides.year ? `${overrides.year}-01-01` : "",
      popularity: overrides.popularity ?? 10,
    }),
    rawTmdbMovieCreditsResponse: {
      cast: overrides.credits,
      crew: [],
    },
  });
}

describe("fishburne rankings", () => {
  it("excludes Laurence by id and normalized name when choosing a top connection", () => {
    const movie = makeHydratedMovie({
      id: 101,
      title: "Deep Cover",
      year: "1992",
      credits: [
        makePersonCredit({
          id: LAURENCE_FISHBURNE_TMDB_ID,
          name: "Laurence Fishburne",
          popularity: 1000,
        }),
        makePersonCredit({
          id: 9999,
          name: "laurence fishburne",
          popularity: 900,
        }),
        makePersonCredit({
          id: 202,
          name: "Jeff Goldblum",
          popularity: 12,
        }),
      ],
    });

    expect(getMostPopularNonFishburneConnection(movie)).toEqual({
      creditType: "cast",
      name: "Jeff Goldblum",
      popularity: 12,
      roleLabel: "Ellie Burr",
      tmdbId: 202,
    });
  });

  it("dedupes Fishburne movie credits, picks each movie's most popular non-Laurence connection, and sorts ascending", async () => {
    const fishburne = makeFishburnePerson([
      makeMovieCredit({
        id: 10,
        title: "Movie A",
        release_date: "1999-01-01",
        popularity: 50,
      }),
      makeMovieCredit({
        id: 20,
        title: "Movie B",
        release_date: "2000-01-01",
        popularity: 60,
      }),
      makeMovieCredit({
        id: 10,
        title: "Movie A",
        release_date: "1999-01-01",
        popularity: 50,
      }),
      makeMovieCredit({
        id: 30,
        title: "Movie C",
        release_date: "2001-01-01",
        popularity: 70,
      }),
    ]);
    const movies = new Map<number, FilmRecord>([
      [10, makeHydratedMovie({
        id: 10,
        title: "Movie A",
        year: "1999",
        credits: [
          makePersonCredit({ id: 101, name: "Connection A", popularity: 8 }),
          makePersonCredit({ id: 102, name: "Connection A Lower", popularity: 3 }),
        ],
      })],
      [20, makeHydratedMovie({
        id: 20,
        title: "Movie B",
        year: "2000",
        credits: [
          makePersonCredit({ id: 201, name: "Connection B", popularity: 2 }),
        ],
      })],
      [30, makeHydratedMovie({
        id: 30,
        title: "Movie C",
        year: "2001",
        credits: [
          makePersonCredit({
            id: LAURENCE_FISHBURNE_TMDB_ID,
            name: "Laurence Fishburne",
            popularity: 99,
          }),
        ],
      })],
    ]);
    const fetchMovie = vi.fn(async (
      _title: string,
      _year = "",
      _reason: "fetch" | "prefetch" = "fetch",
      tmdbId?: number | string | null,
    ) => {
      void _year;
      void _reason;
      return movies.get(Number(tmdbId)) ?? null;
    });

    const rows = await getFishburneRankedMovies({
      dependencies: {
        fetchMovie,
        getCachedMovieRecordById: async () => null,
        preparePerson: async () => fishburne,
      },
    });

    expect(rows.map((row) => row.movie.title)).toEqual(["Movie B", "Movie A", "Movie C"]);
    expect(rows.map((row) => row.topConnection?.name ?? null)).toEqual([
      "Connection B",
      "Connection A",
      null,
    ]);
    expect(rows.map((row) => row.status)).toEqual(["ranked", "ranked", "noConnection"]);
    expect(fetchMovie).toHaveBeenCalledTimes(3);
  });

  it("puts movies with unavailable records after ranked movies", async () => {
    const fishburne = makeFishburnePerson([
      makeMovieCredit({
        id: 10,
        title: "Ranked Movie",
        release_date: "1999-01-01",
      }),
      makeMovieCredit({
        id: 20,
        title: "Missing Movie",
        release_date: "2000-01-01",
      }),
    ]);

    const rows = await getFishburneRankedMovies({
      dependencies: {
        fetchMovie: async (_title, _year, _reason, tmdbId) =>
          Number(tmdbId) === 10
            ? makeHydratedMovie({
                id: 10,
                title: "Ranked Movie",
                year: "1999",
                credits: [
                  makePersonCredit({ id: 101, name: "Connection", popularity: 4 }),
                ],
              })
            : null,
        getCachedMovieRecordById: async () => null,
        preparePerson: async () => fishburne,
      },
    });

    expect(rows.map((row) => row.status)).toEqual(["ranked", "missingMovieRecord"]);
  });
});

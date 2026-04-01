/// <reference types="node" />
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { isExcludedFilmRecord } from "../exclusion";
import { makeFilmRecord, makeTmdbMovieSearchResult } from "./factories";

type ExcludeFixtureEntry = {
  movie: {
    id: number;
    title: string;
    original_title: string;
    poster_path: string | null;
    release_date: string;
    popularity: number;
    vote_average: number;
    vote_count: number;
    genres: Array<{
      id: number;
      name: string;
    }>;
  };
};

function readExcludeFixture(): ExcludeFixtureEntry[] {
  return JSON.parse(
    readFileSync(new URL("./exclude.json", import.meta.url), "utf8"),
  ) as ExcludeFixtureEntry[];
}

describe("film exclusion fixture", () => {
  it("marks every fixture movie as excluded", () => {
    const entries = readExcludeFixture();

    expect(entries.length).toBeGreaterThan(0);

    entries.forEach(({ movie }) => {
      const filmRecord = makeFilmRecord({
        id: movie.id,
        tmdbId: movie.id,
        title: movie.title,
        year: movie.release_date.slice(0, 4),
        fetchTimestamp: "2026-04-01T16:00:00.000Z",
        rawTmdbMovie: makeTmdbMovieSearchResult({
          id: movie.id,
          title: movie.title,
          original_title: movie.original_title,
          poster_path: movie.poster_path,
          release_date: movie.release_date,
          popularity: movie.popularity,
          vote_average: movie.vote_average,
          vote_count: movie.vote_count,
          genres: movie.genres,
        }),
        tmdbSource: "direct-film-fetch",
      });

      expect(isExcludedFilmRecord(filmRecord)).toBe(true);
    });
  });
});

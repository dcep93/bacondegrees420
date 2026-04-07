import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePersonRecord } from "../generators/cinenerdle2/__tests__/factories";

const indexedDbMock = vi.hoisted(() => ({
  getPersonRecordsByMovieId: vi.fn(),
}));

vi.mock("../generators/cinenerdle2/indexed_db", () => indexedDbMock);

import {
  getBestPersonTmdbIdsForMovieIds,
  selectBestPersonTmdbIdsForMovieIds,
  type PersonCoverCandidate,
} from "../movie_person_cover";

describe("movie_person_cover", () => {
  beforeEach(() => {
    indexedDbMock.getPersonRecordsByMovieId.mockReset();
    indexedDbMock.getPersonRecordsByMovieId.mockResolvedValue([]);
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
});

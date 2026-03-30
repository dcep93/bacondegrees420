import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildIndexedDbSnapshot,
  inflateIndexedDbSnapshot,
  stringifyIndexedDbSnapshot,
} from "../indexed_db";
import { withDerivedFilmFields, withDerivedPersonFields } from "../records";
import {
  makeFilmRecord,
  makePersonCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
} from "./factories";

describe("buildIndexedDbSnapshot", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      alert: vi.fn(),
    });
  });

  it("builds a v9 snapshot and round-trips direct TMDb data plus placeholder people", () => {
    const person = withDerivedPersonFields(makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        profile_path: "/al-pacino.jpg",
        popularity: 44,
      }),
      fetchTimestamp: "2026-03-28T08:00:00.000Z",
    }));

    const heatFilm = withDerivedFilmFields(makeFilmRecord({
      id: 50,
      tmdbId: 50,
      title: "Heat",
      year: "1995",
      popularity: 88,
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 50,
        title: "Heat",
        release_date: "1995-12-15",
        poster_path: "/heat.jpg",
        popularity: 88,
        vote_average: 8.2,
        vote_count: 9000,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [makePersonCredit({
          id: 60,
          name: "Al Pacino",
          profile_path: "/al-pacino.jpg",
          popularity: 44,
          character: "Vincent Hanna",
        })],
        crew: [makePersonCredit({
          id: 70,
          name: "Michael Mann",
          profile_path: "/michael-mann.jpg",
          popularity: 33,
          creditType: "crew",
          job: "Director",
          character: undefined,
        })],
      },
      fetchTimestamp: "2026-03-28T09:00:00.000Z",
    }));

    const snapshot = buildIndexedDbSnapshot({
      people: [person],
      films: [heatFilm],
      searchableConnectionEntities: [],
    });

    expect(snapshot).toEqual({
      format: "cinenerdle-indexed-db-snapshot",
      version: 9,
      people: [
        {
          tmdbId: 60,
          name: "Al Pacino",
          movieConnectionKeys: [],
          popularity: 44,
          fromTmdb: {
            fetchTimestamp: "2026-03-28T08:00:00.000Z",
            profilePath: "/al-pacino.jpg",
          },
        },
        {
          tmdbId: 70,
          name: "Michael Mann",
          movieConnectionKeys: [],
          popularity: 33,
          fromTmdb: null,
        },
      ],
      films: [
        {
          tmdbId: 50,
          title: "Heat",
          year: "1995",
          posterPath: "/heat.jpg",
          popularity: 88,
          voteAverage: 8.2,
          voteCount: 9000,
          releaseDate: "1995-12-15",
          fromTmdb: {
            fetchTimestamp: "2026-03-28T09:00:00.000Z",
          },
          personConnectionKeys: ["al pacino", "michael mann"],
          people: [
            {
              fetchTimestamp: "2026-03-28T09:00:00.000Z",
              personTmdbId: 60,
              profilePath: "/al-pacino.jpg",
              roleType: "cast",
              role: "Vincent Hanna",
              order: 0,
            },
            {
              fetchTimestamp: "2026-03-28T09:00:00.000Z",
              personTmdbId: 70,
              profilePath: "/michael-mann.jpg",
              roleType: "crew",
              role: "Director",
              order: 0,
            },
          ],
        },
      ],
    });

    const inflatedSnapshot = inflateIndexedDbSnapshot(snapshot);
    expect(inflatedSnapshot.searchableConnectionEntities).toEqual([
      {
        key: "movie:heat:1995",
        type: "movie",
        nameLower: "heat (1995)",
        popularity: 88,
      },
      {
        key: "person:60",
        type: "person",
        nameLower: "al pacino",
        popularity: 44,
      },
      {
        key: "person:70",
        type: "person",
        nameLower: "michael mann",
        popularity: 33,
      },
    ]);
    expect(inflatedSnapshot.people[0]?.rawTmdbPerson).toEqual(
      expect.objectContaining({
        id: 60,
        profile_path: "/al-pacino.jpg",
        popularity: 44,
      }),
    );
    expect(inflatedSnapshot.people[1]?.tmdbSource).toBe("connection-derived");
    expect(inflatedSnapshot.people[1]?.rawTmdbPerson).toEqual(
      expect.objectContaining({
        id: 70,
        profile_path: "/michael-mann.jpg",
        popularity: 33,
      }),
    );
    expect(inflatedSnapshot.people[0]?.movieConnectionKeys).toEqual(["heat (1995)"]);
    expect(inflatedSnapshot.films[0]?.rawTmdbMovieCreditsResponse?.crew?.[0]).toEqual(
      expect.objectContaining({
        id: 70,
        name: "Michael Mann",
        profile_path: "/michael-mann.jpg",
        job: "Director",
        fetchTimestamp: "2026-03-28T09:00:00.000Z",
      }),
    );
  });

  it("stores explicit connection fields even when the standalone person has direct TMDb data", () => {
    const person = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Steven Spielberg",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Steven Spielberg",
        profile_path: "/standalone.jpg",
        popularity: 77,
      }),
      fetchTimestamp: "2026-03-28T10:00:00.000Z",
    });
    const film = makeFilmRecord({
      id: 50,
      tmdbId: 50,
      title: "Jaws",
      year: "1975",
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [makePersonCredit({
          id: 60,
          name: "Steven Spielberg",
          profile_path: "/credit.jpg",
          popularity: 77,
          creditType: "crew",
          job: "Director",
          character: undefined,
        })],
      },
    });

    const snapshot = buildIndexedDbSnapshot({
      people: [person],
      films: [film],
      searchableConnectionEntities: [],
    });

    expect(snapshot.people).toEqual([
      {
        tmdbId: 60,
        name: "Steven Spielberg",
        movieConnectionKeys: [],
        popularity: 77,
        fromTmdb: {
          fetchTimestamp: "2026-03-28T10:00:00.000Z",
          profilePath: "/standalone.jpg",
        },
      },
    ]);
    expect(snapshot.films[0]?.people).toEqual([
      {
        fetchTimestamp: "2026-03-28T10:00:00.000Z",
        personTmdbId: 60,
        profilePath: "/credit.jpg",
        roleType: "crew",
        role: "Director",
        order: 0,
      },
    ]);

    const inflatedSnapshot = inflateIndexedDbSnapshot(snapshot);
    expect(inflatedSnapshot.films[0]?.rawTmdbMovieCreditsResponse?.crew?.[0]).toEqual(
      expect.objectContaining({
        id: 60,
        name: "Steven Spielberg",
        profile_path: "/credit.jpg",
        job: "Director",
        fetchTimestamp: "2026-03-28T10:00:00.000Z",
      }),
    );
  });

  it("preserves both cast and crew snapshot entries when the same movie person has multiple roles", () => {
    const film = makeFilmRecord({
      id: 3563,
      tmdbId: 3563,
      title: "I Now Pronounce You Chuck & Larry",
      year: "2007",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 3563,
        title: "I Now Pronounce You Chuck & Larry",
        release_date: "2007-07-12",
        popularity: 3.5179,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [makePersonCredit({
          id: 19292,
          name: "Adam Sandler",
          profile_path: "/adam.jpg",
          popularity: 7.408,
          character: "Charles 'Chuck' Levine",
        })],
        crew: [makePersonCredit({
          id: 19292,
          name: "Adam Sandler",
          profile_path: "/adam.jpg",
          popularity: 7.408,
          creditType: "crew",
          character: undefined,
          job: "Producer",
          department: "Production",
          order: undefined,
        })],
      },
      fetchTimestamp: "2026-03-30T17:56:19.000Z",
    });

    const snapshot = buildIndexedDbSnapshot({
      people: [],
      films: [film],
      searchableConnectionEntities: [],
    });

    expect(snapshot.films[0]?.people).toEqual([
      expect.objectContaining({
        personTmdbId: 19292,
        roleType: "cast",
        role: "Charles 'Chuck' Levine",
      }),
      expect.objectContaining({
        personTmdbId: 19292,
        roleType: "crew",
        role: "Producer",
      }),
    ]);

    const inflatedSnapshot = inflateIndexedDbSnapshot(snapshot);
    expect(inflatedSnapshot.films[0]?.rawTmdbMovieCreditsResponse).toEqual({
      cast: [
        expect.objectContaining({
          id: 19292,
          name: "Adam Sandler",
          character: "Charles 'Chuck' Levine",
        }),
      ],
      crew: [
        expect.objectContaining({
          id: 19292,
          name: "Adam Sandler",
          job: "Producer",
        }),
      ],
    });
  });

  it("aborts export when standalone and film-credit-derived person names disagree", () => {
    const alertMock = vi.fn();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { alert: alertMock });
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const person = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        profile_path: "/al-pacino.jpg",
        popularity: 77,
      }),
      fetchTimestamp: "2026-03-28T12:00:00.000Z",
    });
    const film = makeFilmRecord({
      id: 50,
      tmdbId: 50,
      title: "Heat",
      year: "1995",
      rawTmdbMovieCreditsResponse: {
        cast: [makePersonCredit({
          id: 60,
          name: "Someone Else",
          profile_path: "/different.jpg",
          popularity: 99,
        })],
        crew: [],
      },
      fetchTimestamp: "2026-03-28T13:00:00.000Z",
    });

    expect(() =>
      buildIndexedDbSnapshot({
        people: [person],
        films: [film],
        searchableConnectionEntities: [],
      }),
    ).toThrow("conflicting person data");
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0]?.[0]).toContain("\"reason\": \"conflicting-person-data\"");
    expect(writeTextMock.mock.calls[0]?.[0]).toContain("\"tmdbId\": 60");
    expect(writeTextMock.mock.calls[0]?.[0]).toContain("\"standalonePerson\"");
    expect(writeTextMock.mock.calls[0]?.[0]).toContain("\"derivedPerson\"");
  });

  it("aborts export when a film credit person lacks a numeric tmdb id", () => {
    const alertMock = vi.fn();
    vi.stubGlobal("window", { alert: alertMock });

    const film = makeFilmRecord({
      id: 50,
      tmdbId: 50,
      title: "Heat",
      year: "1995",
      rawTmdbMovieCreditsResponse: {
        cast: [makePersonCredit({
          id: undefined,
          name: "No Id Person",
        })],
        crew: [],
      },
      fetchTimestamp: "2026-03-28T09:00:00.000Z",
    });

    expect(() =>
      buildIndexedDbSnapshot({
        people: [],
        films: [film],
        searchableConnectionEntities: [],
      }),
    ).toThrow("missing a numeric TMDb id");
    expect(alertMock).toHaveBeenCalledTimes(1);
  });

  it("rejects legacy v8 snapshots", () => {
    expect(() =>
      inflateIndexedDbSnapshot({
        format: "cinenerdle-indexed-db-snapshot",
        version: 8,
        people: [],
        films: [],
      } as never),
    ).toThrow("Unsupported IndexedDB snapshot version: 8");
  });

  it("does not export top-level fromTmdb for people that only came from film connections", () => {
    const snapshot = buildIndexedDbSnapshot({
      people: [
        withDerivedPersonFields(makePersonRecord({
          id: 108,
          tmdbId: 108,
          name: "Peter Jackson",
          tmdbSource: "connection-derived",
          movieConnectionKeys: [
            "the lord of the rings: the fellowship of the ring (2001)",
            "the lord of the rings: the two towers (2002)",
            "the lord of the rings: the return of the king (2003)",
          ],
          rawTmdbPerson: makeTmdbPersonSearchResult({
            id: 108,
            name: "Peter Jackson",
            profile_path: "/bNc908d59Ba8VDNr4eCcm4G1cR.jpg",
            popularity: 2.9407,
          }),
          fetchTimestamp: "2026-03-30T16:03:39.894Z",
        })),
      ],
      films: [],
      searchableConnectionEntities: [],
    });

    expect(snapshot.people).toContainEqual({
      tmdbId: 108,
      name: "Peter Jackson",
      movieConnectionKeys: [
        "the lord of the rings: the fellowship of the ring (2001)",
        "the lord of the rings: the two towers (2002)",
        "the lord of the rings: the return of the king (2003)",
      ],
      popularity: 2.9407,
      fromTmdb: null,
    });
  });

  it("round-trips connection-derived partial film credits with flattened root film metadata", () => {
    const partialFilm = withDerivedFilmFields(makeFilmRecord({
      id: 200,
      tmdbId: 200,
      title: "Ready or Not: Here I Come",
      year: "2026",
      popularity: 99,
      tmdbSource: "connection-derived",
      personConnectionKeys: ["samara weaving"],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 200,
        title: "Ready or Not: Here I Come",
        release_date: "2026-04-10",
        popularity: 99,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 1372369,
            name: "Samara Weaving",
            profile_path: "/7ThO37CpqkBRgrosep0ROVs2q5s.jpg",
            popularity: 10.8259,
            character: "Grace",
            fetchTimestamp: "2026-03-30T04:00:00.000Z",
          }),
        ],
        crew: [],
      },
      fetchTimestamp: "2026-03-30T04:00:00.000Z",
    }));

    const snapshot = buildIndexedDbSnapshot({
      people: [],
      films: [partialFilm],
      searchableConnectionEntities: [],
    });

    expect(snapshot.films[0]).toEqual(expect.objectContaining({
      posterPath: "/heat.jpg",
      popularity: 99,
      voteAverage: 8.2,
      voteCount: 9000,
      releaseDate: "2026-04-10",
      fromTmdb: null,
      personConnectionKeys: ["samara weaving"],
      people: [
        expect.objectContaining({
          personTmdbId: 1372369,
          roleType: "cast",
          role: "Grace",
        }),
      ],
    }));

    const inflatedSnapshot = inflateIndexedDbSnapshot(snapshot);

    expect(inflatedSnapshot.films[0]).toEqual(expect.objectContaining({
      tmdbSource: "connection-derived",
      personConnectionKeys: ["samara weaving"],
    }));
    expect(inflatedSnapshot.films[0]?.rawTmdbMovieCreditsResponse?.cast).toEqual([
      expect.objectContaining({
        id: 1372369,
        name: "Samara Weaving",
        character: "Grace",
      }),
    ]);
    expect(inflatedSnapshot.films[0]?.rawTmdbMovie).toEqual(
      expect.objectContaining({
        id: 200,
        title: "Ready or Not: Here I Come",
        poster_path: "/heat.jpg",
        popularity: 99,
        release_date: "2026-04-10",
      }),
    );
    expect(inflatedSnapshot.people).toContainEqual(expect.objectContaining({
      tmdbId: 1372369,
      name: "Samara Weaving",
      tmdbSource: "connection-derived",
      rawTmdbPerson: expect.objectContaining({
        popularity: 10.8259,
      }),
    }));
  });

  it("preserves standalone person movie connection keys across snapshot round-trips", () => {
    const person = withDerivedPersonFields(makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)", "insomnia (2002)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 44,
      }),
      fetchTimestamp: "2026-03-28T08:00:00.000Z",
    }));

    const snapshot = buildIndexedDbSnapshot({
      people: [person],
      films: [],
      searchableConnectionEntities: [],
    });

    expect(snapshot.people[0]).toEqual(expect.objectContaining({
      movieConnectionKeys: ["heat (1995)", "insomnia (2002)"],
    }));

    const inflatedSnapshot = inflateIndexedDbSnapshot(snapshot);

    expect(inflatedSnapshot.people[0]).toEqual(expect.objectContaining({
      movieConnectionKeys: ["heat (1995)", "insomnia (2002)"],
    }));
  });

  it("escapes ambiguous unicode characters while preserving round-trip fidelity", () => {
    const snapshot = {
      format: "cinenerdle-indexed-db-snapshot" as const,
      version: 9 as const,
      people: [
        {
          tmdbId: 1,
          name: "A\u200BB",
          movieConnectionKeys: ["heat (1995)"],
          popularity: 0,
          fromTmdb: {
            fetchTimestamp: "2026-03-28T00:00:00.000Z",
            profilePath: null,
          },
        },
      ],
      films: [
        {
          tmdbId: 2,
          title: "Heat\u202E",
          year: "1995",
          posterPath: null,
          popularity: 66,
          voteAverage: null,
          voteCount: null,
          releaseDate: "first\u00a0movie",
          fromTmdb: {
            fetchTimestamp: "2026-03-28T01:00:00.000Z",
          },
          personConnectionKeys: [],
          people: [],
        },
      ],
    };

    const serializedSnapshot = stringifyIndexedDbSnapshot(snapshot);

    expect(serializedSnapshot).toContain("A\\u200bB");
    expect(serializedSnapshot).toContain("first\\u00a0movie");
    expect(serializedSnapshot).toContain("Heat\\u202e");
    expect(JSON.parse(serializedSnapshot)).toEqual(snapshot);
  });
});

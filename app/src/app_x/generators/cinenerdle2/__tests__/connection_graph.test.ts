import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
} from "./factories";

const indexedDbMock = vi.hoisted(() => ({
  getCinenerdleStarterFilmRecords: vi.fn(),
  getFilmRecordsByIds: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getFilmRecordsByPersonConnectionKey: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordByName: vi.fn(),
  getPersonRecordsByMovieKey: vi.fn(),
  getSearchableConnectionEntityByKey: vi.fn(),
}));

vi.mock("../indexed_db", () => indexedDbMock);
const starterStorageMock = vi.hoisted(() => ({
  isCinenerdleDailyStarterFilm: vi.fn(),
}));
vi.mock("../starter_storage", () => starterStorageMock);

import {
  createCinenerdleConnectionEntity,
  createConnectionEntityFromMovieRecord,
  createConnectionEntityFromPersonRecord,
  findConnectionPathBidirectional,
  getConnectionNeighborKeysForEntityKey,
  hydrateConnectionEntityFromSearchRecord,
} from "../connection_graph";

describe("findConnectionPathBidirectional", () => {
  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([]);
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockResolvedValue([]);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    indexedDbMock.getPersonRecordsByMovieKey.mockResolvedValue([]);
    indexedDbMock.getSearchableConnectionEntityByKey.mockResolvedValue(null);
    starterStorageMock.isCinenerdleDailyStarterFilm.mockReset();
    starterStorageMock.isCinenerdleDailyStarterFilm.mockReturnValue(false);
  });

  it("allows a starter movie to connect directly to cinenerdle", async () => {
    const adAstra = makeFilmRecord({
      title: "Ad Astra",
      year: "2019",
    });
    starterStorageMock.isCinenerdleDailyStarterFilm.mockImplementation(
      (title: string, year: string) => title === "Ad Astra" && year === "2019",
    );

    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([adAstra]);
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(
      async (title: string, year: string) =>
        title === "ad astra" && year === "2019" ? adAstra : null,
    );

    const result = await findConnectionPathBidirectional(
      createConnectionEntityFromMovieRecord(adAstra),
      createCinenerdleConnectionEntity(1),
    );

    expect(result.status).toBe("found");
    expect(result.path.map((entity) => entity.key)).toEqual([
      "movie:ad astra:2019",
      "cinenerdle",
    ]);
  });

  it("does not allow cinenerdle to act as an intermediate hop", async () => {
    const adAstra = makeFilmRecord({
      title: "Ad Astra",
      year: "2019",
    });
    const gravity = makeFilmRecord({
      title: "Gravity",
      year: "2013",
    });
    starterStorageMock.isCinenerdleDailyStarterFilm.mockImplementation(
      (title: string, year: string) =>
        (title === "Ad Astra" && year === "2019") ||
        (title === "Gravity" && year === "2013"),
    );

    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([adAstra, gravity]);
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(
      async (title: string, year: string) => {
        if (title === "ad astra" && year === "2019") {
          return adAstra;
        }

        if (title === "gravity" && year === "2013") {
          return gravity;
        }

        return null;
      },
    );

    const result = await findConnectionPathBidirectional(
      createConnectionEntityFromMovieRecord(adAstra),
      createConnectionEntityFromMovieRecord(gravity),
    );

    expect(result.status).toBe("not_found");
    expect(result.path).toEqual([]);
  });

  it("does not allow a producer-only person record to connect through stale movie keys", async () => {
    const heat = makeFilmRecord({
      title: "Heat",
      year: "1995",
    });
    const producerOnlyPerson = makePersonRecord({
      id: 44,
      tmdbId: 44,
      name: "Producer Person",
      movieConnectionKeys: [10],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [
          {
            id: 10,
            title: "Heat",
            release_date: "1995-12-15",
            job: "Producer",
          },
        ],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(
      async (title: string, year: string) =>
        title === "heat" && year === "1995" ? heat : null,
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(producerOnlyPerson);
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockResolvedValue([]);

    const result = await findConnectionPathBidirectional(
      createConnectionEntityFromPersonRecord(producerOnlyPerson),
      createConnectionEntityFromMovieRecord(heat),
    );

    expect(result.status).toBe("not_found");
    expect(result.path).toEqual([]);
  });

  it("excludes documentary movies from Willem Dafoe's graph neighbors", async () => {
    const overnight = makeFilmRecord({
      id: 27007,
      tmdbId: 27007,
      title: "Overnight",
      year: "2003",
      genreIds: [99],
      personConnectionKeys: ["willem dafoe"],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const spiderMan = makeFilmRecord({
      id: 557,
      tmdbId: 557,
      title: "Spider-Man",
      year: "2002",
      personConnectionKeys: ["willem dafoe"],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const dafoe = makePersonRecord({
      id: 5293,
      tmdbId: 5293,
      name: "Willem Dafoe",
      movieConnectionKeys: ["overnight (2003)", "spider-man (2002)"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 27007,
            title: "Overnight",
            release_date: "2003-06-12",
            genre_ids: [99],
          }),
          makeMovieCredit({
            id: 557,
            title: "Spider-Man",
            release_date: "2002-05-01",
            genre_ids: [28],
          }),
        ],
        crew: [],
      },
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(dafoe);
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockResolvedValue([overnight, spiderMan]);

    const neighborKeys = await getConnectionNeighborKeysForEntityKey("person:5293");

    expect(neighborKeys).toEqual(["movie:spider-man:2002"]);
  });

  it("does not traverse excluded documentary movies during BFS", async () => {
    const overnight = makeFilmRecord({
      id: 27007,
      tmdbId: 27007,
      title: "Overnight",
      year: "2003",
      genreIds: [99],
      personConnectionKeys: ["willem dafoe", "troy duffy"],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const spiderMan = makeFilmRecord({
      id: 557,
      tmdbId: 557,
      title: "Spider-Man",
      year: "2002",
      personConnectionKeys: ["willem dafoe"],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const dafoe = makePersonRecord({
      id: 5293,
      tmdbId: 5293,
      name: "Willem Dafoe",
      movieConnectionKeys: ["overnight (2003)", "spider-man (2002)"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 27007,
            title: "Overnight",
            release_date: "2003-06-12",
            genre_ids: [99],
          }),
          makeMovieCredit({
            id: 557,
            title: "Spider-Man",
            release_date: "2002-05-01",
            genre_ids: [28],
          }),
        ],
        crew: [],
      },
    });
    const troyDuffy = makePersonRecord({
      id: 7000,
      tmdbId: 7000,
      name: "Troy Duffy",
      movieConnectionKeys: ["overnight (2003)"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 27007,
            title: "Overnight",
            release_date: "2003-06-12",
            genre_ids: [99],
          }),
        ],
        crew: [],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) => {
      if (title === "overnight" && year === "2003") {
        return overnight;
      }

      if (title === "spider-man" && year === "2002") {
        return spiderMan;
      }

      return null;
    });
    indexedDbMock.getPersonRecordById.mockImplementation(async (personId: number) => {
      if (personId === 5293) {
        return dafoe;
      }

      if (personId === 7000) {
        return troyDuffy;
      }

      return null;
    });
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockImplementation(async (personName: string) => {
      if (personName === "willem dafoe") {
        return [overnight, spiderMan];
      }

      if (personName === "troy duffy") {
        return [overnight];
      }

      return [];
    });
    indexedDbMock.getPersonRecordsByMovieKey.mockImplementation(async (movieKey: string) => {
      if (movieKey === "spider-man (2002)") {
        return [dafoe];
      }

      if (movieKey === "overnight (2003)") {
        return [dafoe, troyDuffy];
      }

      return [];
    });

    const result = await findConnectionPathBidirectional(
      createConnectionEntityFromMovieRecord(spiderMan),
      createConnectionEntityFromPersonRecord(troyDuffy),
    );

    expect(result.status).toBe("not_found");
    expect(result.path).toEqual([]);
  });

  it("does not traverse zero-vote movies as intermediate BFS hops", async () => {
    const heat = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      personConnectionKeys: [60],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 60,
            name: "Al Pacino",
            order: 0,
            popularity: 88,
          }),
        ],
        crew: [],
      },
    });
    const hiddenFeature = makeFilmRecord({
      id: 27008,
      tmdbId: 27008,
      title: "Hidden Feature",
      year: "2004",
      personConnectionKeys: [60, 70],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 27008,
        title: "Hidden Feature",
        original_title: "Hidden Feature",
        release_date: "2004-01-02",
        vote_count: 0,
        genres: [{ id: 18, name: "Drama" }],
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
      tmdbSource: "direct-film-fetch",
    });
    const collateral = makeFilmRecord({
      id: 654,
      tmdbId: 654,
      title: "Collateral",
      year: "2004",
      personConnectionKeys: [70],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 70,
            name: "Bridge Person",
            order: 0,
            popularity: 45,
          }),
        ],
        crew: [],
      },
    });
    const pacino = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: [321, 27008],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            vote_count: 6000,
          }),
          makeMovieCredit({
            id: 27008,
            title: "Hidden Feature",
            release_date: "2004-01-02",
            vote_count: 0,
          }),
        ],
        crew: [],
      },
    });
    const bridgePerson = makePersonRecord({
      id: 70,
      tmdbId: 70,
      name: "Bridge Person",
      movieConnectionKeys: [27008, 654],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 27008,
            title: "Hidden Feature",
            release_date: "2004-01-02",
            vote_count: 0,
          }),
          makeMovieCredit({
            id: 654,
            title: "Collateral",
            release_date: "2004-08-04",
            vote_count: 4000,
          }),
        ],
        crew: [],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) => {
      if (title === "heat" && year === "1995") {
        return heat;
      }

      if (title === "hidden feature" && year === "2004") {
        return hiddenFeature;
      }

      if (title === "collateral" && year === "2004") {
        return collateral;
      }

      return null;
    });
    indexedDbMock.getPersonRecordById.mockImplementation(async (personId: number) => {
      if (personId === 60) {
        return pacino;
      }

      if (personId === 70) {
        return bridgePerson;
      }

      return null;
    });
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockImplementation(async (personName: string) => {
      if (personName === "al pacino") {
        return [heat, hiddenFeature];
      }

      if (personName === "bridge person") {
        return [hiddenFeature, collateral];
      }

      return [];
    });
    indexedDbMock.getPersonRecordsByMovieKey.mockImplementation(async (movieKey: string) => {
      if (movieKey === "heat (1995)") {
        return [pacino];
      }

      if (movieKey === "hidden feature (2004)") {
        return [pacino, bridgePerson];
      }

      if (movieKey === "collateral (2004)") {
        return [bridgePerson];
      }

      return [];
    });

    const result = await findConnectionPathBidirectional(
      createConnectionEntityFromMovieRecord(heat),
      createConnectionEntityFromMovieRecord(collateral),
    );

    expect(result.status).toBe("not_found");
    expect(result.path).toEqual([]);
  });

  it("allows a zero-vote movie to remain a valid BFS endpoint", async () => {
    const hiddenFeature = makeFilmRecord({
      id: 27008,
      tmdbId: 27008,
      title: "Hidden Feature",
      year: "2004",
      personConnectionKeys: [60],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 27008,
        title: "Hidden Feature",
        original_title: "Hidden Feature",
        release_date: "2004-01-02",
        vote_count: 0,
        genres: [{ id: 18, name: "Drama" }],
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
      tmdbSource: "direct-film-fetch",
    });
    const pacino = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: [27008],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 27008,
            title: "Hidden Feature",
            release_date: "2004-01-02",
            vote_count: 0,
          }),
        ],
        crew: [],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(
      async (title: string, year: string) =>
        title === "hidden feature" && year === "2004" ? hiddenFeature : null,
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(pacino);
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockResolvedValue([hiddenFeature]);

    const result = await findConnectionPathBidirectional(
      createConnectionEntityFromPersonRecord(pacino),
      createConnectionEntityFromMovieRecord(hiddenFeature),
    );

    expect(result.status).toBe("found");
    expect(result.path.map((entity) => entity.key)).toEqual([
      "person:60",
      "movie:hidden feature:2004",
    ]);
  });

  it("does not connect movies through different people who share the same name", async () => {
    const ted2 = makeFilmRecord({
      id: 214756,
      tmdbId: 214756,
      title: "Ted 2",
      year: "2015",
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 1223657,
            name: "Tom Brady",
            order: 17,
            character: "Tom Brady",
            popularity: 1,
          }),
        ],
        crew: [],
      },
    });
    const theHotChick = makeFilmRecord({
      id: 11852,
      tmdbId: 11852,
      title: "The Hot Chick",
      year: "2002",
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [
          makePersonCredit({
            id: 66512,
            name: "Tom Brady",
            creditType: undefined,
            character: undefined,
            job: "Director",
            popularity: 2,
          }),
        ],
      },
    });
    const ted2TomBrady = makePersonRecord({
      id: 1223657,
      tmdbId: 1223657,
      name: "Tom Brady",
      movieConnectionKeys: ["ted 2 (2015)"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 214756,
            title: "Ted 2",
            release_date: "2015-06-25",
            character: "Tom Brady",
          }),
        ],
        crew: [],
      },
    });
    const hotChickTomBrady = makePersonRecord({
      id: 66512,
      tmdbId: 66512,
      name: "Tom Brady",
      movieConnectionKeys: ["the hot chick (2002)"],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [
          makeMovieCredit({
            id: 11852,
            title: "The Hot Chick",
            release_date: "2002-12-13",
            creditType: undefined,
            character: undefined,
            job: "Director",
          }),
        ],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) => {
      if (title === "ted 2" && year === "2015") {
        return ted2;
      }

      if (title === "the hot chick" && year === "2002") {
        return theHotChick;
      }

      return null;
    });
    indexedDbMock.getPersonRecordById.mockImplementation(async (personId: number) => {
      if (personId === 1223657) {
        return ted2TomBrady;
      }

      if (personId === 66512) {
        return hotChickTomBrady;
      }

      return null;
    });
    indexedDbMock.getPersonRecordsByMovieKey.mockImplementation(async (movieKey: string) => {
      if (movieKey === "ted 2 (2015)") {
        return [ted2TomBrady];
      }

      if (movieKey === "the hot chick (2002)") {
        return [hotChickTomBrady];
      }

      return [];
    });

    const result = await findConnectionPathBidirectional(
      createConnectionEntityFromMovieRecord(ted2),
      createConnectionEntityFromMovieRecord(theHotChick),
    );

    expect(result.status).toBe("not_found");
    expect(result.path).toEqual([]);
  });

  it("preserves the searchable record name for person ids instead of synthesizing a placeholder label", async () => {
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockResolvedValue([]);

    const entity = await hydrateConnectionEntityFromSearchRecord({
      key: "person:1229",
      type: "person",
      nameLower: "jeff bridges",
      popularity: 15,
    });

    expect(entity).toEqual(expect.objectContaining({
      key: "person:1229",
      kind: "person",
      tmdbId: 1229,
      name: "Jeff Bridges",
      label: "Jeff Bridges",
    }));
  });
});

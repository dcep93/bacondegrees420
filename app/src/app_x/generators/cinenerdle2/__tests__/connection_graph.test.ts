import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
} from "./factories";

const indexedDbMock = vi.hoisted(() => ({
  getCinenerdleStarterFilmRecords: vi.fn(),
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
} from "../connection_graph";

describe("findConnectionPathBidirectional", () => {
  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([]);
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
    const producerOnlyPerson = {
      id: 44,
      tmdbId: 44,
      name: "Producer Person",
      nameLower: "producer person",
      lookupKey: "producer person",
      movieConnectionKeys: ["heat (1995)"],
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
    };

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
});

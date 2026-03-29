import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeFilmRecord,
  makeStarter,
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
  });

  it("allows a starter movie to connect directly to cinenerdle", async () => {
    const adAstra = makeFilmRecord({
      title: "Ad Astra",
      year: "2019",
      rawCinenerdleDailyStarter: makeStarter({
        id: "starter-ad-astra",
        title: "Ad Astra (2019)",
      }),
    });

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
      rawCinenerdleDailyStarter: makeStarter({
        id: "starter-ad-astra",
        title: "Ad Astra (2019)",
      }),
    });
    const gravity = makeFilmRecord({
      title: "Gravity",
      year: "2013",
      rawCinenerdleDailyStarter: makeStarter({
        id: "starter-gravity",
        title: "Gravity (2013)",
      }),
    });

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
});

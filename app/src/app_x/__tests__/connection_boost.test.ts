import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLegacyPersonConnectionId,
  makeFilmRecord,
  makePersonRecord,
} from "../generators/cinenerdle2/__tests__/factories";

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeName(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

const indexedDbMock = vi.hoisted(() => ({
  getFilmRecordById: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getFilmRecordsByPersonConnectionKey: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordByName: vi.fn(),
  getPersonRecordsByMovieKey: vi.fn(),
}));

vi.mock("../generators/cinenerdle2/indexed_db", () => indexedDbMock);

import { resolveConnectionBoostPreview } from "../connection_boost_preview";

describe("resolveConnectionBoostPreview", () => {
  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());

    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockResolvedValue([]);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
    indexedDbMock.getPersonRecordsByMovieKey.mockResolvedValue([]);
  });

  it("picks the highest-popularity distance-2 movie and the highest-popularity shared person for movie selections", async () => {
    const selectedMovie = makeFilmRecord({
      id: "selected-movie-2000",
      tmdbId: 2000,
      title: "Selected Movie",
      year: "2000",
      popularity: 30,
      personConnectionKeys: ["person alpha", "person beta", "person gamma"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          { id: 101, name: "Person Alpha", order: 0, popularity: 85, profile_path: "/alpha.jpg" },
          { id: 102, name: "Person Beta", order: 1, popularity: 90, profile_path: "/beta.jpg" },
          { id: 103, name: "Person Gamma", order: 2, popularity: 70, profile_path: "/gamma.jpg" },
        ],
        crew: [],
      },
    });
    const highPopMovie = makeFilmRecord({
      id: "high-pop-2005",
      tmdbId: 2005,
      title: "High Pop Movie",
      year: "2005",
      popularity: 95,
      personConnectionKeys: ["person alpha", "person beta"],
    });
    const moreSharedButLowerMovie = makeFilmRecord({
      id: "more-shared-2004",
      tmdbId: 2004,
      title: "More Shared Movie",
      year: "2004",
      popularity: 80,
      personConnectionKeys: ["person alpha", "person beta", "person gamma"],
    });
    const personAlpha = makePersonRecord({
      id: 101,
      tmdbId: 101,
      name: "Person Alpha",
      movieConnectionKeys: ["selected movie (2000)", "high pop movie (2005)", "more shared movie (2004)"],
      rawTmdbPerson: { id: 101, name: "Person Alpha", popularity: 85, profile_path: "/alpha-cached.jpg" },
    });
    const personBeta = makePersonRecord({
      id: 102,
      tmdbId: 102,
      name: "Person Beta",
      movieConnectionKeys: ["selected movie (2000)", "high pop movie (2005)", "more shared movie (2004)"],
      rawTmdbPerson: { id: 102, name: "Person Beta", popularity: 90, profile_path: "/beta-cached.jpg" },
    });
    const personGamma = makePersonRecord({
      id: 103,
      tmdbId: 103,
      name: "Person Gamma",
      movieConnectionKeys: ["selected movie (2000)", "more shared movie (2004)"],
      rawTmdbPerson: { id: 103, name: "Person Gamma", popularity: 70, profile_path: "/gamma-cached.jpg" },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      [selectedMovie, highPopMovie, moreSharedButLowerMovie].find(
        (film) => film.title === title && film.year === year,
      ) ?? null,
    );
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockImplementation(async (personName: string) =>
      [selectedMovie, highPopMovie, moreSharedButLowerMovie].filter((film) =>
        film.personConnectionKeys.some((candidate) => {
          const matchingPersonId =
            [personAlpha, personBeta, personGamma].find(
              (person) => normalizeName(person.name) === normalizeName(personName),
            )?.tmdbId ?? null;
          return candidate === matchingPersonId || candidate === getLegacyPersonConnectionId(personName);
        }),
      ),
    );
    indexedDbMock.getPersonRecordById.mockImplementation(async (id: number) =>
      [personAlpha, personBeta, personGamma].find((person) => person.id === id) ?? null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (name: string) =>
      [personAlpha, personBeta, personGamma].find(
        (person) => normalizeName(person.name) === normalizeName(name),
      ) ?? null,
    );

    const preview = await resolveConnectionBoostPreview({
      key: "movie:selected movie:2000",
      kind: "movie",
      name: "Selected Movie",
      year: "2000",
      popularity: 0,
      popularitySource: null,
      imageUrl: null,
      subtitle: "",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: null,
    });

    expect(preview).not.toBeNull();
    expect(preview?.distanceTwo.name).toBe("High Pop Movie (2005)");
    expect(preview?.sharedConnection.name).toBe("Person Beta");
  });

  it("ignores the selected movie when scanning distance-2 movie candidates", async () => {
    const selectedMovie = makeFilmRecord({
      id: "selected-movie-2000",
      tmdbId: 2000,
      title: "Selected Movie",
      year: "2000",
      popularity: 30,
      personConnectionKeys: ["shared person"],
    });
    const nextMovie = makeFilmRecord({
      id: "next-movie-2001",
      tmdbId: 2001,
      title: "Next Movie",
      year: "2001",
      popularity: 40,
      personConnectionKeys: ["shared person"],
    });
    const sharedPerson = makePersonRecord({
      id: 101,
      tmdbId: 101,
      name: "Shared Person",
      movieConnectionKeys: ["selected movie (2000)", "next movie (2001)"],
      rawTmdbPerson: { id: 101, name: "Shared Person", popularity: 80 },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      [selectedMovie, nextMovie].find((film) => film.title === title && film.year === year) ?? null,
    );
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockImplementation(async () =>
      [selectedMovie, nextMovie],
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(sharedPerson);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(sharedPerson);

    const preview = await resolveConnectionBoostPreview({
      key: "movie:selected movie:2000",
      kind: "movie",
      name: "Selected Movie",
      year: "2000",
      popularity: 0,
      popularitySource: null,
      imageUrl: null,
      subtitle: "",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: null,
    });

    expect(preview).not.toBeNull();
    expect(preview?.distanceTwo.name).toBe("Next Movie (2001)");
  });

  it("returns null when the selected movie cannot be resolved", async () => {
    const preview = await resolveConnectionBoostPreview({
      key: "movie:missing:2000",
      kind: "movie",
      name: "Missing",
      year: "2000",
      popularity: 0,
      popularitySource: null,
      imageUrl: null,
      subtitle: "",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: null,
    });

    expect(preview).toBeNull();
  });

  it("returns null when the selected movie has no valid distance-2 result", async () => {
    const selectedMovie = makeFilmRecord({
      id: "selected-movie-2000",
      tmdbId: 2000,
      title: "Selected Movie",
      year: "2000",
      popularity: 30,
      personConnectionKeys: ["shared person"],
    });
    const sharedPerson = makePersonRecord({
      id: 101,
      tmdbId: 101,
      name: "Shared Person",
      movieConnectionKeys: ["selected movie (2000)"],
      rawTmdbPerson: { id: 101, name: "Shared Person", popularity: 80 },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(selectedMovie);
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockResolvedValue([selectedMovie]);
    indexedDbMock.getPersonRecordById.mockResolvedValue(sharedPerson);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(sharedPerson);

    const preview = await resolveConnectionBoostPreview({
      key: "movie:selected movie:2000",
      kind: "movie",
      name: "Selected Movie",
      year: "2000",
      popularity: 0,
      popularitySource: null,
      imageUrl: null,
      subtitle: "",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: null,
    });

    expect(preview).toBeNull();
  });

  it("picks the highest-popularity distance-2 person and the highest-popularity shared movie for person selections", async () => {
    const selectedPerson = makePersonRecord({
      id: 401,
      tmdbId: 401,
      name: "Selected Person",
      movieConnectionKeys: [301, 302, 303],
      rawTmdbPerson: { id: 401, name: "Selected Person", popularity: 45 },
      rawTmdbMovieCreditsResponse: {
        cast: [
          { id: 301, title: "Shared Low", release_date: "2010-01-01", popularity: 60 },
          { id: 302, title: "Shared High", release_date: "2011-01-01", popularity: 95 },
        ],
        crew: [
          { id: 303, title: "Path Only", release_date: "2012-01-01", job: "Writer", popularity: 50 },
        ],
      },
    });
    const distanceTwoHigh = makePersonRecord({
      id: 402,
      tmdbId: 402,
      name: "Distance Two High",
      movieConnectionKeys: [301, 302],
      rawTmdbPerson: { id: 402, name: "Distance Two High", popularity: 99 },
    });
    const distanceTwoLower = makePersonRecord({
      id: 403,
      tmdbId: 403,
      name: "Distance Two Lower",
      movieConnectionKeys: [301, 302, 303],
      rawTmdbPerson: { id: 403, name: "Distance Two Lower", popularity: 80 },
    });
    const sharedLowMovie = makeFilmRecord({
      id: "shared-low-2010",
      tmdbId: 301,
      title: "Shared Low",
      year: "2010",
      popularity: 60,
    });
    const sharedHighMovie = makeFilmRecord({
      id: "shared-high-2011",
      tmdbId: 302,
      title: "Shared High",
      year: "2011",
      popularity: 95,
    });
    const pathOnlyMovie = makeFilmRecord({
      id: "path-only-2012",
      tmdbId: 303,
      title: "Path Only",
      year: "2012",
      popularity: 50,
    });

    indexedDbMock.getPersonRecordById.mockImplementation(async (id: number) =>
      [selectedPerson, distanceTwoHigh, distanceTwoLower].find((person) => person.id === id) ?? null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (name: string) =>
      [selectedPerson, distanceTwoHigh, distanceTwoLower].find(
        (person) => normalizeName(person.name) === normalizeName(name),
      ) ?? null,
    );
    indexedDbMock.getPersonRecordsByMovieKey.mockImplementation(async (movieKey: string) => {
      if (movieKey === "shared low (2010)" || movieKey === "shared high (2011)") {
        return [selectedPerson, distanceTwoHigh, distanceTwoLower];
      }

      if (movieKey === "path only (2012)") {
        return [selectedPerson, distanceTwoLower];
      }

      return [];
    });
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      [sharedLowMovie, sharedHighMovie, pathOnlyMovie].find(
        (film) => film.title === title && film.year === year,
      ) ?? null,
    );
    indexedDbMock.getFilmRecordById.mockImplementation(async (id: number) =>
      [sharedLowMovie, sharedHighMovie, pathOnlyMovie].find((film) => film.tmdbId === id) ?? null,
    );

    const preview = await resolveConnectionBoostPreview({
      key: "person:401",
      kind: "person",
      name: "Selected Person",
      popularity: 0,
      popularitySource: null,
      imageUrl: null,
      subtitle: "",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      record: null,
    });

    expect(preview).not.toBeNull();
    expect(preview?.distanceTwo.name).toBe("Distance Two High");
    expect(preview?.sharedConnection.name).toBe("Shared High (2011)");
  });

  it("returns null when the selected person has no valid distance-2 result", async () => {
    const selectedPerson = makePersonRecord({
      id: 401,
      tmdbId: 401,
      name: "Selected Person",
      movieConnectionKeys: [301],
      rawTmdbPerson: { id: 401, name: "Selected Person", popularity: 45 },
    });
    const soloMovie = makeFilmRecord({
      id: "solo-movie-2010",
      tmdbId: 301,
      title: "Solo Movie",
      year: "2010",
      popularity: 50,
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(selectedPerson);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(selectedPerson);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(soloMovie);
    indexedDbMock.getFilmRecordById.mockResolvedValue(soloMovie);
    indexedDbMock.getPersonRecordsByMovieKey.mockResolvedValue([selectedPerson]);

    const preview = await resolveConnectionBoostPreview({
      key: "person:401",
      kind: "person",
      name: "Selected Person",
      popularity: 0,
      popularitySource: null,
      imageUrl: null,
      subtitle: "",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      record: null,
    });

    expect(preview).toBeNull();
  });
});

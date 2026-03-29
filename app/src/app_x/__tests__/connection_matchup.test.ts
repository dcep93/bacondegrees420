import { describe, expect, it, vi } from "vitest";
import {
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
  getAllFilmRecords: vi.fn(),
  getAllPersonRecords: vi.fn(),
  clearIndexedDb: vi.fn(),
  estimateIndexedDbUsageBytes: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getAllSearchableConnectionEntities: vi.fn(),
  getFilmRecordsByPersonConnectionKey: vi.fn(),
  getIndexedDbSnapshot: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordByName: vi.fn(),
  getPersonRecordsByMovieKey: vi.fn(),
}));

vi.mock("../generators/cinenerdle2/indexed_db", () => indexedDbMock);

import { resolveConnectionMatchupPreview } from "../connection_matchup_preview";

describe("resolveConnectionMatchupPreview", () => {
  it("suggests a spoiler connected to the youngest selected movie", async () => {
    const theAmazingSpiderMan = makeFilmRecord({
      id: "the-amazing-spider-man-2012",
      tmdbId: 1930,
      title: "The Amazing Spider-Man",
      year: "2012",
      popularity: 28.6,
      personConnectionKeys: ["andrew garfield", "emma stone", "irrfan khan"],
      starterPeopleByRole: {
        cast: ["Andrew Garfield", "Emma Stone", "Irrfan Khan"],
        directors: [],
        writers: [],
        composers: [],
      },
    });
    const theAmazingSpiderMan2 = makeFilmRecord({
      id: "the-amazing-spider-man-2-2014",
      tmdbId: 102382,
      title: "The Amazing Spider-Man 2",
      year: "2014",
      popularity: 22.4,
      personConnectionKeys: ["andrew garfield", "emma stone"],
      starterPeopleByRole: {
        cast: ["Andrew Garfield", "Emma Stone"],
        directors: [],
        writers: [],
        composers: [],
      },
    });
    const people = [
      makePersonRecord({
        id: 37625,
        tmdbId: 37625,
        name: "Andrew Garfield",
        movieConnectionKeys: ["the amazing spider-man (2012)", "the amazing spider-man 2 (2014)"],
        rawTmdbPerson: { id: 37625, name: "Andrew Garfield", popularity: 88 },
      }),
      makePersonRecord({
        id: 54693,
        tmdbId: 54693,
        name: "Emma Stone",
        movieConnectionKeys: ["the amazing spider-man (2012)", "the amazing spider-man 2 (2014)"],
        rawTmdbPerson: { id: 54693, name: "Emma Stone", popularity: 95 },
      }),
      makePersonRecord({
        id: 86002,
        tmdbId: 86002,
        name: "Irrfan Khan",
        movieConnectionKeys: ["the amazing spider-man (2012)"],
        rawTmdbPerson: { id: 86002, name: "Irrfan Khan", popularity: 61 },
      }),
    ];

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      [theAmazingSpiderMan, theAmazingSpiderMan2].find(
        (film) => film.title === title && film.year === year,
      ) ?? null,
    );
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockImplementation(async (personName: string) =>
      [theAmazingSpiderMan, theAmazingSpiderMan2].filter((film) =>
        Array.isArray(film.personConnectionKeys) &&
        film.personConnectionKeys.some(
          (candidate) => typeof candidate === "string" && normalizeName(candidate) === normalizeName(personName),
        ),
      ),
    );
    indexedDbMock.getAllPersonRecords.mockResolvedValue(people);

    const preview = await resolveConnectionMatchupPreview({
      key: "movie:the amazing spider-man:2012",
      kind: "movie",
      name: "The Amazing Spider-Man",
      year: "2012",
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
    expect(preview?.counterpart.name).toBe("The Amazing Spider-Man 2 (2014)");
    expect(preview?.spoiler.name).toBe("Irrfan Khan");
    expect(preview?.counterpart.tooltipText).toContain("Popularity: 22.4");
    expect(preview?.counterpart.tooltipText.split("\n")).toEqual([
      "The Amazing Spider-Man 2 (2014)",
      "Popularity: 22.4",
      "Emma Stone",
      "Andrew Garfield",
    ]);
  });

  it("prefers starter display casing over normalized connection keys in counterpart tooltips", async () => {
    // Keep matchup fixtures local to the test. Do not import dump.json here:
    // that file is only for manual debugging and should never be test data.
    const projectHailMary = {
      id: "project-hail-mary-2026",
      tmdbId: null,
      lookupKey: "project hail mary (2026)",
      title: "Project Hail Mary",
      titleLower: "project hail mary",
      year: "2026",
      titleYear: "project hail mary (2026)",
      popularity: 15,
      personConnectionKeys: ["ryan gosling", "andy weir", "drew goddard"],
      starterPeopleByRole: {
        cast: ["Ryan Gosling"],
        directors: [],
        writers: ["Andy Weir", "Drew Goddard"],
        composers: [],
      },
      rawTmdbMovieCreditsResponse: {
        cast: [{ id: 30614, name: "Ryan Gosling", popularity: 90 }],
        crew: [{ id: 47506, name: "Drew Goddard", job: "Screenplay", popularity: 10 }],
      },
    };
    const theMartian = {
      id: "the-martian-2015",
      tmdbId: null,
      lookupKey: "the martian (2015)",
      title: "The Martian",
      titleLower: "the martian",
      year: "2015",
      titleYear: "the martian (2015)",
      popularity: 20,
      personConnectionKeys: ["andy weir", "drew goddard"],
      starterPeopleByRole: {
        cast: [],
        directors: [],
        writers: ["Andy Weir", "Drew Goddard"],
        composers: [],
      },
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [{ id: 47506, name: "Drew Goddard", job: "Screenplay", popularity: 10 }],
      },
    };
    const people = [
      {
        id: 30614,
        tmdbId: 30614,
        lookupKey: "ryan gosling",
        name: "Ryan Gosling",
        nameLower: "ryan gosling",
        movieConnectionKeys: ["project hail mary (2026)"],
        rawTmdbPerson: { id: 30614, name: "Ryan Gosling", popularity: 90 },
      },
      {
        id: 47506,
        tmdbId: 47506,
        lookupKey: "drew goddard",
        name: "Drew Goddard",
        nameLower: "drew goddard",
        movieConnectionKeys: ["project hail mary (2026)", "the martian (2015)"],
        rawTmdbPerson: { id: 47506, name: "Drew Goddard", popularity: 10 },
      },
    ];

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) => {
      if (title === "Project Hail Mary" && year === "2026") {
        return projectHailMary;
      }

      if (title === "The Martian" && year === "2015") {
        return theMartian;
      }

      return null;
    });
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockImplementation(async (personName: string) => {
      const normalizedPersonName = normalizeName(personName);
      return [projectHailMary, theMartian].filter((film) =>
        Array.isArray(film.personConnectionKeys) &&
        film.personConnectionKeys.some(
          (candidate) => typeof candidate === "string" && normalizeName(candidate) === normalizedPersonName,
        ),
      );
    });
    indexedDbMock.getAllPersonRecords.mockResolvedValue(people);

    const preview = await resolveConnectionMatchupPreview({
      key: "movie:project hail mary:2026",
      kind: "movie",
      name: "Project Hail Mary",
      year: "2026",
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
    expect(preview?.counterpart.name).toBe("The Martian (2015)");
    expect(preview?.spoiler.name).toBe("Ryan Gosling");
    expect(preview?.counterpart.tooltipText).toContain("Andy Weir");
    expect(preview?.counterpart.tooltipText).not.toContain("andy weir");
    expect(preview?.counterpart.tooltipText).toContain("Drew Goddard");
  });

  it("sorts shared movie connections in person counterpart tooltips by popularity", async () => {
    const memento = makeFilmRecord({
      id: "memento-2000",
      tmdbId: 77,
      title: "Memento",
      year: "2000",
      popularity: 20,
    });
    const theDarkKnight = makeFilmRecord({
      id: "the-dark-knight-2008",
      tmdbId: 155,
      title: "The Dark Knight",
      year: "2008",
      popularity: 90,
    });
    const inception = makeFilmRecord({
      id: "inception-2010",
      tmdbId: 27205,
      title: "Inception",
      year: "2010",
      popularity: 95,
    });
    const christopherNolan = makePersonRecord({
      id: 525,
      tmdbId: 525,
      name: "Christopher Nolan",
      movieConnectionKeys: [
        "memento (2000)",
        "the dark knight (2008)",
        "inception (2010)",
      ],
      rawTmdbPerson: { id: 525, name: "Christopher Nolan", popularity: 85 },
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [
          { id: 77, title: "Memento", release_date: "2000-09-05", popularity: 20 },
          { id: 155, title: "The Dark Knight", release_date: "2008-07-18", popularity: 90 },
          { id: 27205, title: "Inception", release_date: "2010-07-16", popularity: 95 },
        ],
      },
    });
    const davidGoyer = makePersonRecord({
      id: 7897,
      tmdbId: 7897,
      name: "David S. Goyer",
      movieConnectionKeys: [
        "memento (2000)",
        "the dark knight (2008)",
      ],
      rawTmdbPerson: { id: 7897, name: "David S. Goyer", popularity: 70 },
    });

    indexedDbMock.getPersonRecordById.mockImplementation(async (id: number) => {
      if (id === 525) {
        return christopherNolan;
      }

      return null;
    });
    indexedDbMock.getPersonRecordByName.mockImplementation(async (name: string) => {
      if (normalizeName(name) === normalizeName("Christopher Nolan")) {
        return christopherNolan;
      }

      if (normalizeName(name) === normalizeName("David S. Goyer")) {
        return davidGoyer;
      }

      return null;
    });
    indexedDbMock.getPersonRecordsByMovieKey.mockImplementation(async (movieKey: string) => {
      if (
        movieKey === "memento (2000)" ||
        movieKey === "the dark knight (2008)"
      ) {
        return [christopherNolan, davidGoyer];
      }

      if (movieKey === "inception (2010)") {
        return [christopherNolan];
      }

      return [];
    });
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) => {
      return [memento, theDarkKnight, inception].find(
        (film) => film.title === title && film.year === year,
      ) ?? null;
    });
    indexedDbMock.getAllFilmRecords.mockResolvedValue([memento, theDarkKnight, inception]);

    const preview = await resolveConnectionMatchupPreview({
      key: "person:525",
      kind: "person",
      name: "Christopher Nolan",
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
    expect(preview?.counterpart.name).toBe("David S. Goyer");
    expect(preview?.spoiler.name).toBe("Inception (2010)");
    expect(preview?.counterpart.tooltipText.split("\n")).toEqual([
      "David S. Goyer",
      "Popularity: 70",
      "The Dark Knight (2008)",
      "Memento (2000)",
    ]);
  });
});

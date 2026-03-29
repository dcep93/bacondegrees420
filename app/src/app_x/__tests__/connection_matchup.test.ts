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
      rawTmdbMovieCreditsResponse: {
        cast: [
          { id: 37625, name: "Andrew Garfield", order: 0, popularity: 88 },
          { id: 54693, name: "Emma Stone", order: 1, popularity: 95 },
          { id: 86002, name: "Irrfan Khan", order: 2, popularity: 61 },
        ],
        crew: [],
      },
    });
    const theAmazingSpiderMan2 = makeFilmRecord({
      id: "the-amazing-spider-man-2-2014",
      tmdbId: 102382,
      title: "The Amazing Spider-Man 2",
      year: "2014",
      popularity: 22.4,
      personConnectionKeys: ["emma stone", "andrew garfield"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          { id: 54693, name: "Emma Stone", order: 0, popularity: 95 },
          { id: 37625, name: "Andrew Garfield", order: 1, popularity: 88 },
        ],
        crew: [],
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
      rawTmdbMovieCreditsResponse: {
        cast: [{ id: 30614, name: "Ryan Gosling", order: 0, popularity: 90 }],
        crew: [
          { id: 1352085, name: "Andy Weir", order: 1, job: "Writer", popularity: 20 },
          { id: 47506, name: "Drew Goddard", order: 2, job: "Screenplay", popularity: 10 },
        ],
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
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [
          { id: 1352085, name: "Andy Weir", order: 0, job: "Writer", popularity: 20 },
          { id: 47506, name: "Drew Goddard", order: 1, job: "Screenplay", popularity: 10 },
        ],
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

  it("orders movie spoilers by the selected movie's dual-merge connections before falling back to popularity", async () => {
    const selectedMovie = makeFilmRecord({
      id: "selected-movie-2000",
      tmdbId: 2000,
      title: "Selected Movie",
      year: "2000",
      popularity: 40,
      personConnectionKeys: [
        "low exclusive",
        "shared cast",
        "shared crew",
        "high exclusive",
      ],
      rawTmdbMovieCreditsResponse: {
        cast: [
          { id: 101, name: "Low Exclusive", order: 0, popularity: 85 },
          { id: 102, name: "Shared Cast", order: 1, popularity: 80 },
        ],
        crew: [
          { id: 103, name: "Shared Crew", order: 0, job: "Director", popularity: 70 },
          { id: 104, name: "High Exclusive", order: 1, job: "Writer", popularity: 95 },
        ],
      },
    });
    const counterpartMovie = makeFilmRecord({
      id: "counterpart-movie-2001",
      tmdbId: 2001,
      title: "Counterpart Movie",
      year: "2001",
      popularity: 35,
      personConnectionKeys: ["shared cast", "shared crew"],
      rawTmdbMovieCreditsResponse: {
        cast: [{ id: 102, name: "Shared Cast", order: 0, popularity: 80 }],
        crew: [{ id: 103, name: "Shared Crew", order: 0, job: "Director", popularity: 70 }],
      },
    });
    const people = [
      makePersonRecord({
        id: 101,
        tmdbId: 101,
        name: "Low Exclusive",
        movieConnectionKeys: ["selected movie (2000)"],
        rawTmdbPerson: { id: 101, name: "Low Exclusive", popularity: 85 },
      }),
      makePersonRecord({
        id: 102,
        tmdbId: 102,
        name: "Shared Cast",
        movieConnectionKeys: ["selected movie (2000)", "counterpart movie (2001)"],
        rawTmdbPerson: { id: 102, name: "Shared Cast", popularity: 80 },
      }),
      makePersonRecord({
        id: 103,
        tmdbId: 103,
        name: "Shared Crew",
        movieConnectionKeys: ["selected movie (2000)", "counterpart movie (2001)"],
        rawTmdbPerson: { id: 103, name: "Shared Crew", popularity: 70 },
      }),
      makePersonRecord({
        id: 104,
        tmdbId: 104,
        name: "High Exclusive",
        movieConnectionKeys: ["selected movie (2000)"],
        rawTmdbPerson: { id: 104, name: "High Exclusive", popularity: 95 },
      }),
    ];

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      [selectedMovie, counterpartMovie].find(
        (film) => film.title === title && film.year === year,
      ) ?? null,
    );
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockImplementation(async (personName: string) =>
      [selectedMovie, counterpartMovie].filter((film) =>
        Array.isArray(film.personConnectionKeys) &&
        film.personConnectionKeys.some(
          (candidate) => typeof candidate === "string" && normalizeName(candidate) === normalizeName(personName),
        ),
      ),
    );
    indexedDbMock.getPersonRecordById.mockImplementation(async (id: number) =>
      people.find((person) => person.id === id || person.tmdbId === id) ?? null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (name: string) =>
      people.find((person) => normalizeName(person.name) === normalizeName(name)) ?? null,
    );
    indexedDbMock.getAllPersonRecords.mockResolvedValue(people);

    const preview = await resolveConnectionMatchupPreview({
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
    expect(preview?.counterpart.name).toBe("Counterpart Movie (2001)");
    expect(preview?.spoiler.name).toBe("Low Exclusive");
  });

  it("falls back to the selected movie when no exclusive spoiler exists", async () => {
    const avengersEndgame = makeFilmRecord({
      id: "avengers-endgame-2019",
      tmdbId: 299534,
      title: "Avengers: Endgame",
      year: "2019",
      popularity: 95,
      personConnectionKeys: ["robert downey jr", "chris evans"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          { id: 3223, name: "Robert Downey Jr.", order: 0, popularity: 90 },
          { id: 16828, name: "Chris Evans", order: 1, popularity: 85 },
        ],
        crew: [],
      },
    });
    const avengersInfinityWar = makeFilmRecord({
      id: "avengers-infinity-war-2018",
      tmdbId: 299536,
      title: "Avengers: Infinity War",
      year: "2018",
      popularity: 94,
      personConnectionKeys: ["robert downey jr", "chris evans"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          { id: 3223, name: "Robert Downey Jr.", order: 0, popularity: 90 },
          { id: 16828, name: "Chris Evans", order: 1, popularity: 85 },
        ],
        crew: [],
      },
    });
    const people = [
      makePersonRecord({
        id: 3223,
        tmdbId: 3223,
        name: "Robert Downey Jr.",
        movieConnectionKeys: ["avengers: endgame (2019)", "avengers: infinity war (2018)"],
        rawTmdbPerson: { id: 3223, name: "Robert Downey Jr.", popularity: 90 },
      }),
      makePersonRecord({
        id: 16828,
        tmdbId: 16828,
        name: "Chris Evans",
        movieConnectionKeys: ["avengers: endgame (2019)", "avengers: infinity war (2018)"],
        rawTmdbPerson: { id: 16828, name: "Chris Evans", popularity: 85 },
      }),
    ];

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      [avengersEndgame, avengersInfinityWar].find(
        (film) => film.title === title && film.year === year,
      ) ?? null,
    );
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockImplementation(async (personName: string) =>
      [avengersEndgame, avengersInfinityWar].filter((film) =>
        Array.isArray(film.personConnectionKeys) &&
        film.personConnectionKeys.some(
          (candidate) => typeof candidate === "string" && normalizeName(candidate) === normalizeName(personName),
        ),
      ),
    );
    indexedDbMock.getPersonRecordById.mockImplementation(async (id: number) =>
      people.find((person) => person.id === id || person.tmdbId === id) ?? null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (name: string) =>
      people.find((person) => normalizeName(person.name) === normalizeName(name)) ?? null,
    );
    indexedDbMock.getAllPersonRecords.mockResolvedValue(people);

    const preview = await resolveConnectionMatchupPreview({
      key: "movie:299534",
      kind: "movie",
      name: "Avengers: Endgame",
      year: "2019",
      popularity: 95,
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
    expect(preview?.counterpart.name).toBe("Avengers: Infinity War (2018)");
    expect(preview?.spoiler.name).toBe("Avengers: Endgame (2019)");
    expect(preview?.spoilerExplanation).toBe("selected");
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

  it("orders person spoilers by the selected person's dual-merge connections before falling back to popularity", async () => {
    const lowExclusiveMovie = makeFilmRecord({
      id: "low-exclusive-2010",
      tmdbId: 301,
      title: "Low Exclusive",
      year: "2010",
      popularity: 85,
    });
    const sharedCastMovie = makeFilmRecord({
      id: "shared-cast-2011",
      tmdbId: 302,
      title: "Shared Cast",
      year: "2011",
      popularity: 80,
    });
    const sharedCrewMovie = makeFilmRecord({
      id: "shared-crew-2012",
      tmdbId: 303,
      title: "Shared Crew",
      year: "2012",
      popularity: 70,
    });
    const highExclusiveMovie = makeFilmRecord({
      id: "high-exclusive-2013",
      tmdbId: 304,
      title: "High Exclusive",
      year: "2013",
      popularity: 95,
    });
    const selectedPerson = makePersonRecord({
      id: 401,
      tmdbId: 401,
      name: "Selected Person",
      movieConnectionKeys: [
        "low exclusive (2010)",
        "shared cast (2011)",
        "shared crew (2012)",
        "high exclusive (2013)",
      ],
      rawTmdbPerson: { id: 401, name: "Selected Person", popularity: 50 },
      rawTmdbMovieCreditsResponse: {
        cast: [
          { id: 301, title: "Low Exclusive", release_date: "2010-01-01", popularity: 85 },
          { id: 302, title: "Shared Cast", release_date: "2011-01-01", popularity: 80 },
        ],
        crew: [
          { id: 303, title: "Shared Crew", release_date: "2012-01-01", job: "Director", popularity: 70 },
          { id: 304, title: "High Exclusive", release_date: "2013-01-01", job: "Writer", popularity: 95 },
        ],
      },
    });
    const counterpartPerson = makePersonRecord({
      id: 402,
      tmdbId: 402,
      name: "Counterpart Person",
      movieConnectionKeys: ["shared cast (2011)", "shared crew (2012)"],
      rawTmdbPerson: { id: 402, name: "Counterpart Person", popularity: 45 },
    });

    indexedDbMock.getPersonRecordById.mockImplementation(async (id: number) => {
      if (id === 401) {
        return selectedPerson;
      }

      if (id === 402) {
        return counterpartPerson;
      }

      return null;
    });
    indexedDbMock.getPersonRecordByName.mockImplementation(async (name: string) => {
      if (normalizeName(name) === normalizeName("Selected Person")) {
        return selectedPerson;
      }

      if (normalizeName(name) === normalizeName("Counterpart Person")) {
        return counterpartPerson;
      }

      return null;
    });
    indexedDbMock.getPersonRecordsByMovieKey.mockImplementation(async (movieKey: string) => {
      if (movieKey === "shared cast (2011)" || movieKey === "shared crew (2012)") {
        return [selectedPerson, counterpartPerson];
      }

      if (movieKey === "low exclusive (2010)" || movieKey === "high exclusive (2013)") {
        return [selectedPerson];
      }

      return [];
    });
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) => {
      return [
        lowExclusiveMovie,
        sharedCastMovie,
        sharedCrewMovie,
        highExclusiveMovie,
      ].find((film) => film.title === title && film.year === year) ?? null;
    });
    indexedDbMock.getAllFilmRecords.mockResolvedValue([
      lowExclusiveMovie,
      sharedCastMovie,
      sharedCrewMovie,
      highExclusiveMovie,
    ]);

    const preview = await resolveConnectionMatchupPreview({
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
    expect(preview?.counterpart.name).toBe("Counterpart Person");
    expect(preview?.spoiler.name).toBe("Low Exclusive (2010)");
  });
});

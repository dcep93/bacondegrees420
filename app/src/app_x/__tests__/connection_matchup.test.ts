import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

type IndexedDbSnapshot = {
  people: Array<Record<string, unknown>>;
  films: Array<Record<string, unknown>>;
  searchableConnectionEntities: Array<Record<string, unknown>>;
};

const dumpPath = new URL("../generators/cinenerdle2/__tests__/dump.json", import.meta.url);
const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as IndexedDbSnapshot;

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

import { resolveConnectionMatchupPreview } from "../index";

describe("resolveConnectionMatchupPreview", () => {
  it("suggests a spoiler connected to the youngest selected movie", async () => {
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      dump.films.find(
        (film) => film.title === title && film.year === year,
      ) ?? null,
    );
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockImplementation(async (personName: string) =>
      dump.films.filter((film) =>
        Array.isArray(film.personConnectionKeys) &&
        film.personConnectionKeys.some(
          (candidate) => typeof candidate === "string" && normalizeName(candidate) === normalizeName(personName),
        ),
      ),
    );
    indexedDbMock.getAllPersonRecords.mockResolvedValue(dump.people);

    const preview = await resolveConnectionMatchupPreview({
      key: "movie:the amazing spider-man:2012",
      kind: "movie",
      name: "The Amazing Spider-Man",
      year: "2012",
      popularity: 0,
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
    expect(preview?.counterpart.tooltipText).toContain("Andrew Garfield");
    expect(preview?.counterpart.tooltipText).toContain("Emma Stone");
    expect(preview?.counterpart.tooltipText).toContain("Popularity: 22.4");
  });

  it("prefers starter display casing over normalized connection keys in counterpart tooltips", async () => {
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
});

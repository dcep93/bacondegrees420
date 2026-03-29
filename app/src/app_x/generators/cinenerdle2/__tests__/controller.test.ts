import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatMoviePathLabel } from "../utils";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeTmdbPersonSearchResult,
} from "./factories";

const indexedDbMock = vi.hoisted(() => ({
  getAllSearchableConnectionEntities: vi.fn(),
  getCinenerdleStarterFilmRecords: vi.fn(),
  getFilmRecordCountsByPersonConnectionKeys: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getFilmRecordsByIds: vi.fn(),
  getFilmRecordsByPersonConnectionKey: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordCountsByMovieKeys: vi.fn(),
  getPersonRecordByName: vi.fn(),
  getPersonRecordsByMovieKey: vi.fn(),
}));

const tmdbMock = vi.hoisted(() => ({
  fetchCinenerdleDailyStarterMovies: vi.fn(),
  hydrateCinenerdleDailyStarterMovies: vi.fn(),
  prepareSelectedMovie: vi.fn(),
  prepareSelectedPerson: vi.fn(),
}));

vi.mock("../indexed_db", async () => {
  const actual = await vi.importActual("../indexed_db");
  return {
    ...actual,
    ...indexedDbMock,
  };
});

vi.mock("../tmdb", async () => {
  const actual = await vi.importActual("../tmdb");
  return {
    ...actual,
    ...tmdbMock,
  };
});

import { buildBookmarkPreviewCardsFromHash, buildTreeFromHash } from "../controller";
import { ESCAPE_LABEL } from "../constants";

describe("buildBookmarkPreviewCardsFromHash", () => {
  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    Object.values(tmdbMock).forEach((mock) => mock.mockReset());

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([]);
    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([]);
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordsByMovieKey.mockResolvedValue([]);
    tmdbMock.fetchCinenerdleDailyStarterMovies.mockResolvedValue([]);
    tmdbMock.hydrateCinenerdleDailyStarterMovies.mockResolvedValue(undefined);
  });

  it("prefers the richer cached person record when movie-credit id and name lookups disagree", async () => {
    const staleAndyWeirRecord = makePersonRecord({
      id: 1352085,
      tmdbId: 1352085,
      name: "Andy Weir",
      movieConnectionKeys: ["project hail mary (2026)"],
      rawTmdbMovieCreditsResponse: {
        crew: [],
      },
    });
    const andyWeirRecord = makePersonRecord({
      id: 1352085,
      tmdbId: 1352085,
      name: "Andy Weir",
      movieConnectionKeys: ["project hail mary (2026)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 1352085,
        name: "Andy Weir",
        profile_path: "/andy-weir.jpg",
        popularity: 42,
      }),
      rawTmdbMovieCreditsResponse: {
        crew: [],
      },
    });
    const projectHailMary = makeFilmRecord({
      id: "project-hail-mary-2026",
      tmdbId: 123,
      title: "Project Hail Mary",
      year: "2026",
      personConnectionKeys: ["andy weir"],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [
          makePersonCredit({
            id: 999999,
            name: "Andy Weir",
            job: "Writer",
            popularity: 10,
            profile_path: null,
          }),
        ],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "Project Hail Mary" && year === "2026" ? projectHailMary : null,
    );
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockImplementation(async (personName: string) =>
      personName === "Andy Weir" ? [projectHailMary] : [],
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(staleAndyWeirRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Andy Weir" ? andyWeirRecord : null,
    );

    const previewCards = await buildBookmarkPreviewCardsFromHash(
      "#film|Project+Hail+Mary+(2026)|Andy+Weir",
    );

    expect(previewCards).toHaveLength(2);
    expect(previewCards[1]).toEqual(
      expect.objectContaining({
        kind: "person",
        name: "Andy Weir",
        imageUrl: expect.stringContaining("/andy-weir.jpg"),
        hasCachedTmdbSource: true,
      }),
    );
  });

  it("uses a cached person record when the movie credits omit that person", async () => {
    const andyWeirRecord = makePersonRecord({
      id: 1352085,
      tmdbId: 1352085,
      name: "Andy Weir",
      movieConnectionKeys: ["project hail mary (2026)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 1352085,
        name: "Andy Weir",
        profile_path: "/andy-weir.jpg",
        popularity: 42,
      }),
      rawTmdbMovieCreditsResponse: {
        crew: [],
      },
    });
    const projectHailMary = makeFilmRecord({
      id: "project-hail-mary-2026",
      tmdbId: 123,
      title: "Project Hail Mary",
      year: "2026",
      personConnectionKeys: ["andy weir"],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [
          makePersonCredit({
            id: 47506,
            name: "Drew Goddard",
            job: "Screenplay",
            popularity: 10,
          }),
        ],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "Project Hail Mary" && year === "2026" ? projectHailMary : null,
    );
    indexedDbMock.getFilmRecordsByPersonConnectionKey.mockResolvedValue([]);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Andy Weir" ? andyWeirRecord : null,
    );

    const previewCards = await buildBookmarkPreviewCardsFromHash(
      "#film|Project+Hail+Mary+(2026)|Andy+Weir",
    );

    expect(previewCards).toHaveLength(2);
    expect(previewCards[1]).toEqual(
      expect.objectContaining({
        kind: "person",
        key: "person:1352085",
        name: "Andy Weir",
        imageUrl: expect.stringContaining("/andy-weir.jpg"),
        hasCachedTmdbSource: true,
      }),
    );
  });

  it("keeps movie child rows in the alternating dual-merge sequence", async () => {
    const heatRecord = makeFilmRecord({
      id: "heat-1995",
      tmdbId: 50,
      title: "Heat",
      year: "1995",
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 1, name: "Al Pacino", order: 1, popularity: 50 }),
          makePersonCredit({ id: 2, name: "Robert De Niro", order: 0, popularity: 80 }),
        ],
        crew: [
          makePersonCredit({
            id: 3,
            name: "Aaron Sorkin",
            order: 10,
            creditType: undefined,
            character: undefined,
            job: "Screenplay",
            popularity: 60,
          }),
          makePersonCredit({
            id: 4,
            name: "Michael Mann",
            order: 11,
            creditType: undefined,
            character: undefined,
            job: "Director",
            popularity: 90,
          }),
        ],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "Heat" && year === "1995" ? heatRecord : null,
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);

    const tree = await buildTreeFromHash("#film|Heat+(1995)");
    const childCards = tree[1]?.map((node) => node.data) ?? [];

    expect(childCards.map((card) => card.name)).toEqual([
      "Robert De Niro",
      "Michael Mann",
      "Aaron Sorkin",
      "Al Pacino",
    ]);
    expect(childCards.map((card) => card.connectionOrder)).toEqual([1, 2, 3, 4]);
    expect(childCards.map((card) => card.connectionParentLabel)).toEqual([
      formatMoviePathLabel("Heat", "1995"),
      formatMoviePathLabel("Heat", "1995"),
      formatMoviePathLabel("Heat", "1995"),
      formatMoviePathLabel("Heat", "1995"),
    ]);
  });

  it("uses crew order before alternating movie child rows", async () => {
    const beauRecord = makeFilmRecord({
      id: "beau-is-afraid-2023",
      tmdbId: 798286,
      title: "Beau Is Afraid",
      year: "2023",
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 1, name: "Joaquin Phoenix", order: 0, popularity: 5 }),
          makePersonCredit({ id: 2, name: "Patti LuPone", order: 1, popularity: 2 }),
        ],
        crew: [
          makePersonCredit({
            id: 3,
            name: "Crew Later",
            order: 8,
            creditType: undefined,
            character: undefined,
            job: "Writer",
            popularity: 3,
          }),
          makePersonCredit({
            id: 4,
            name: "Ari Aster",
            order: 1,
            creditType: undefined,
            character: undefined,
            job: "Director",
            popularity: 6,
          }),
        ],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "Beau Is Afraid" && year === "2023" ? beauRecord : null,
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);

    const tree = await buildTreeFromHash("#film|Beau+Is+Afraid+(2023)");
    const childCards = tree[1]?.map((node) => node.data) ?? [];

    expect(childCards.map((card) => card.name)).toEqual([
      "Ari Aster",
      "Joaquin Phoenix",
      "Crew Later",
      "Patti LuPone",
    ]);
  });

  it("preserves escape segments as break preview cards", async () => {
    const firstManRecord = makeFilmRecord({
      title: "First Man",
      year: "2018",
      personConnectionKeys: ["kyle chandler"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 100,
            name: "Kyle Chandler",
          }),
        ],
        crew: [],
      },
    });

    tmdbMock.fetchCinenerdleDailyStarterMovies.mockResolvedValue([firstManRecord]);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(firstManRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Tom Hanks"
        ? makePersonRecord({
          name: "Tom Hanks",
        })
        : null,
    );

    const previewCards = await buildBookmarkPreviewCardsFromHash(
      "#cinenerdle|First+Man+(2018)|Kyle+Chandler||Tom+Hanks",
    );

    expect(previewCards.at(-2)).toEqual(
      expect.objectContaining({
        kind: "break",
        name: ESCAPE_LABEL,
      }),
    );
    expect(previewCards.at(-1)).toEqual(
      expect.objectContaining({
        kind: "person",
        name: "Tom Hanks",
      }),
    );
  });
});

describe("buildTreeFromHash", () => {
  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    Object.values(tmdbMock).forEach((mock) => mock.mockReset());

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue([]);
    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([]);
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordsByMovieKey.mockResolvedValue([]);
    tmdbMock.fetchCinenerdleDailyStarterMovies.mockResolvedValue([]);
    tmdbMock.hydrateCinenerdleDailyStarterMovies.mockResolvedValue(undefined);
  });

  it("keeps person child rows in the alternating dual-merge sequence and assigns connection order from that sequence", async () => {
    const heatRecord = makeFilmRecord({
      id: 101,
      tmdbId: 101,
      title: "Heat",
      year: "1995",
      popularity: 70,
      personConnectionKeys: ["al pacino", "robert de niro"],
    });
    const theInsiderRecord = makeFilmRecord({
      id: 102,
      tmdbId: 102,
      title: "The Insider",
      year: "1999",
      popularity: 40,
      personConnectionKeys: ["al pacino", "russell crowe"],
    });
    const insomniaRecord = makeFilmRecord({
      id: 103,
      tmdbId: 103,
      title: "Insomnia",
      year: "2002",
      popularity: 60,
      personConnectionKeys: ["al pacino", "hilary swank"],
    });
    const seaOfLoveRecord = makeFilmRecord({
      id: 104,
      tmdbId: 104,
      title: "Sea of Love",
      year: "1989",
      popularity: 90,
      personConnectionKeys: ["al pacino", "ellen barkin"],
    });
    const alPacinoRecord = makePersonRecord({
      id: 1,
      tmdbId: 1,
      name: "Al Pacino",
      movieConnectionKeys: [
        "heat (1995)",
        "the insider (1999)",
        "insomnia (2002)",
        "sea of love (1989)",
      ],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 101,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 70,
          }),
          makeMovieCredit({
            id: 102,
            title: "The Insider",
            release_date: "1999-11-05",
            popularity: 40,
          }),
        ],
        crew: [
          makeMovieCredit({
            id: 103,
            title: "Insomnia",
            release_date: "2002-05-24",
            popularity: 60,
            creditType: undefined,
            character: undefined,
            job: "Director",
          }),
          makeMovieCredit({
            id: 104,
            title: "Sea of Love",
            release_date: "1989-09-15",
            popularity: 90,
            creditType: undefined,
            character: undefined,
            job: "Writer",
          }),
        ],
      },
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(alPacinoRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Al Pacino" ? alPacinoRecord : null,
    );
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(
      new Map([
        [101, heatRecord],
        [102, theInsiderRecord],
        [103, insomniaRecord],
        [104, seaOfLoveRecord],
      ]),
    );

    const tree = await buildTreeFromHash("#person|Al+Pacino");
    const childCards = tree[1]?.map((node) => node.data) ?? [];

    expect(childCards.map((card) => card.name)).toEqual([
      "Heat",
      "Sea of Love",
      "Insomnia",
      "The Insider",
    ]);
    expect(childCards.map((card) => card.connectionOrder)).toEqual([1, 2, 3, 4]);
    expect(childCards.map((card) => card.connectionParentLabel)).toEqual([
      "Al Pacino",
      "Al Pacino",
      "Al Pacino",
      "Al Pacino",
    ]);
  });

  it("uses cast order before alternating person child rows", async () => {
    const beauRecord = makeFilmRecord({
      id: 201,
      tmdbId: 798286,
      title: "Beau Is Afraid",
      year: "2023",
      popularity: 10,
      personConnectionKeys: ["joaquin phoenix"],
    });
    const arrivalRecord = makeFilmRecord({
      id: 202,
      tmdbId: 329865,
      title: "Arrival",
      year: "2016",
      popularity: 20,
      personConnectionKeys: ["joaquin phoenix"],
    });
    const joaquinPhoenixRecord = makePersonRecord({
      id: 73421,
      tmdbId: 73421,
      name: "Joaquin Phoenix",
      movieConnectionKeys: [
        "beau is afraid (2023)",
        "arrival (2016)",
      ],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 202,
            title: "Arrival",
            release_date: "2016-11-11",
            order: 8,
            popularity: 20,
          }),
          makeMovieCredit({
            id: 201,
            title: "Beau Is Afraid",
            release_date: "2023-04-14",
            order: 0,
            popularity: 10,
          }),
        ],
        crew: [],
      },
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(joaquinPhoenixRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Joaquin Phoenix" ? joaquinPhoenixRecord : null,
    );
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(
      new Map([
        [201, beauRecord],
        [202, arrivalRecord],
      ]),
    );

    const tree = await buildTreeFromHash("#person|Joaquin+Phoenix");
    const childCards = tree[1]?.map((node) => node.data) ?? [];

    expect(childCards.map((card) => card.name)).toEqual([
      "Beau Is Afraid",
      "Arrival",
    ]);
  });

  it("does not leave a popular cast-only movie at the end of a person child row", async () => {
    const earlyLowRecord = makeFilmRecord({
      id: 301,
      tmdbId: 301,
      title: "Early Low",
      year: "2011",
      popularity: 10,
      personConnectionKeys: ["stephen mckinley henderson"],
    });
    const lincolnRecord = makeFilmRecord({
      id: 302,
      tmdbId: 302,
      title: "Lincoln",
      year: "2012",
      popularity: 80,
      personConnectionKeys: ["stephen mckinley henderson"],
    });
    const middleRecord = makeFilmRecord({
      id: 303,
      tmdbId: 303,
      title: "Middle",
      year: "2015",
      popularity: 30,
      personConnectionKeys: ["stephen mckinley henderson"],
    });
    const stephenRecord = makePersonRecord({
      id: 196179,
      tmdbId: 196179,
      name: "Stephen McKinley Henderson",
      movieConnectionKeys: [
        "early low (2011)",
        "lincoln (2012)",
        "middle (2015)",
      ],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 301,
            title: "Early Low",
            release_date: "2011-01-01",
            order: 0,
            popularity: 10,
          }),
          makeMovieCredit({
            id: 302,
            title: "Lincoln",
            release_date: "2012-11-16",
            order: 5,
            popularity: 80,
          }),
          makeMovieCredit({
            id: 303,
            title: "Middle",
            release_date: "2015-01-01",
            order: 2,
            popularity: 30,
          }),
        ],
        crew: [],
      },
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(stephenRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Stephen McKinley Henderson" ? stephenRecord : null,
    );
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(
      new Map([
        [301, earlyLowRecord],
        [302, lincolnRecord],
        [303, middleRecord],
      ]),
    );

    const tree = await buildTreeFromHash("#person|Stephen+McKinley+Henderson");
    const childCards = tree[1]?.map((node) => node.data) ?? [];

    expect(childCards.map((card) => card.name)).toEqual([
      "Early Low",
      "Lincoln",
      "Middle",
    ]);
  });

  it("inserts a separator row and starts a disconnected branch after an escape", async () => {
    const firstManRecord = makeFilmRecord({
      title: "First Man",
      year: "2018",
      personConnectionKeys: ["kyle chandler"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 100,
            name: "Kyle Chandler",
          }),
        ],
        crew: [],
      },
    });
    tmdbMock.fetchCinenerdleDailyStarterMovies.mockResolvedValue([firstManRecord]);
    const kyleChandlerRecord = makePersonRecord({
      id: 100,
      tmdbId: 100,
      name: "Kyle Chandler",
      movieConnectionKeys: ["game night (2018)"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 200,
            title: "Game Night",
            release_date: "2018-02-23",
          }),
        ],
        crew: [],
      },
    });
    const tomHanksRecord = makePersonRecord({
      id: 101,
      tmdbId: 101,
      name: "Tom Hanks",
      movieConnectionKeys: [],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "First Man" && year === "2018" ? firstManRecord : null,
    );
    indexedDbMock.getPersonRecordById.mockImplementation(async (personId: number) =>
      personId === 100 ? kyleChandlerRecord : personId === 101 ? tomHanksRecord : null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Kyle Chandler"
        ? kyleChandlerRecord
        : personName === "Tom Hanks"
          ? tomHanksRecord
          : null,
    );

    const tree = await buildTreeFromHash(
      "#cinenerdle|First+Man+(2018)|Kyle+Chandler||Tom+Hanks",
    );

    expect(tree.map((row) => row.find((node) => node.selected)?.data.kind ?? null)).toEqual([
      "cinenerdle",
      "movie",
      "person",
      "break",
      "person",
    ]);
    expect(tree[3]).toHaveLength(1);
    expect(tree[3]?.[0]).toEqual(
      expect.objectContaining({
        selected: true,
        disabled: true,
        data: expect.objectContaining({
          kind: "break",
          name: ESCAPE_LABEL,
        }),
      }),
    );
    expect(tree[4]).toHaveLength(1);
    expect(tree[4]?.[0]?.data).toEqual(
      expect.objectContaining({
        kind: "person",
        name: "Tom Hanks",
      }),
    );
  });

  it("builds the cinenerdle root from cached starter records without fetching starters", async () => {
    const firstManRecord = makeFilmRecord({
      id: "first-man-2018",
      title: "First Man",
      year: "2018",
      popularity: 22,
      rawCinenerdleDailyStarter: {
        title: "First Man (2018)",
      },
      isCinenerdleDailyStarter: 1,
    });

    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([firstManRecord]);

    const tree = await buildTreeFromHash("#cinenerdle", {
      dailyStarterSource: "cache",
    });

    expect(tmdbMock.fetchCinenerdleDailyStarterMovies).not.toHaveBeenCalled();
    expect(tree).toHaveLength(2);
    expect(tree[0]?.[0]?.data).toEqual(
      expect.objectContaining({
        kind: "cinenerdle",
      }),
    );
    expect(tree[1]?.[0]?.data).toEqual(
      expect.objectContaining({
        kind: "movie",
        name: "First Man",
      }),
    );
  });

  it("keeps a cache-only cinenerdle init on the root card until starters are available locally", async () => {
    const tree = await buildTreeFromHash("#cinenerdle|First+Man+(2018)", {
      dailyStarterSource: "cache",
    });

    expect(tmdbMock.fetchCinenerdleDailyStarterMovies).not.toHaveBeenCalled();
    expect(tree.map((row) => row.find((node) => node.selected)?.data.kind ?? null)).toEqual([
      "cinenerdle",
    ]);
  });
});

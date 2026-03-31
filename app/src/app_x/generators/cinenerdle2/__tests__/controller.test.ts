import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGeneratorState } from "../../generator_runtime";
import { formatMoviePathLabel } from "../utils";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
} from "./factories";

const indexedDbMock = vi.hoisted(() => ({
  getAllSearchableConnectionEntities: vi.fn(),
  getCinenerdleStarterFilmRecords: vi.fn(),
  getFilmRecordCountsByPersonConnectionKeys: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getFilmRecordsByIds: vi.fn(),
  getFilmRecordsByPersonConnectionKey: vi.fn(),
  getMoviePopularityByLabels: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordCountsByMovieKeys: vi.fn(),
  getPersonRecordByName: vi.fn(),
  getPersonRecordsByMovieKey: vi.fn(),
  getPersonPopularityByNames: vi.fn(),
}));

const tmdbMock = vi.hoisted(() => ({
  fetchCinenerdleDailyStarterMovies: vi.fn(),
  hydrateCinenerdleDailyStarterMovies: vi.fn(),
  prepareSelectedMovie: vi.fn(),
  prepareSelectedPerson: vi.fn(),
  setTmdbLogGeneration: vi.fn(),
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

import {
  buildBookmarkPreviewCardsFromHash,
  buildTreeFromHash,
  clearChildGenerationOrderingCache,
  ensureSelectedCardFullstate,
  getControllerInitMode,
  getCardPopularityTooltipText,
  hydrateYoungestSelectedCardInTree,
  reduceCinenerdleLifecycleEvent,
  shouldSkipDailyStarterGenerationRedraw,
  shouldDispatchSelectedCardBackgroundForceRefresh,
  shouldPrefetchPopularConnectionsOnInit,
  shouldForceRefreshSelectedPathOnInit,
} from "../controller";
import { ESCAPE_LABEL } from "../constants";
import type { CinenerdleCard } from "../view_types";

function makeMovieCard(
  overrides: Partial<Extract<CinenerdleCard, { kind: "movie" }>> = {},
): Extract<CinenerdleCard, { kind: "movie" }> {
  return {
    key: "movie:50",
    kind: "movie" as const,
    name: "Heat",
    year: "1995",
    popularity: 66,
    popularitySource: null,
    imageUrl: null,
    subtitle: "1995",
    subtitleDetail: "",
    connectionCount: 1,
    sources: [],
    status: null,
    voteAverage: null,
    voteCount: null,
    record: makeFilmRecord(),
    ...overrides,
  };
}

function makePersonCard(
  overrides: Partial<Extract<CinenerdleCard, { kind: "person" }>> = {},
): Extract<CinenerdleCard, { kind: "person" }> {
  return {
    key: "person:60",
    kind: "person" as const,
    name: "Al Pacino",
    popularity: 77,
    popularitySource: null,
    imageUrl: null,
    subtitle: "",
    subtitleDetail: "",
    connectionCount: 1,
    sources: [],
    status: null,
    record: makePersonRecord(),
    ...overrides,
  };
}

function makeCinenerdleRootCard(): Extract<CinenerdleCard, { kind: "cinenerdle" }> {
  return {
    key: "cinenerdle",
    kind: "cinenerdle",
    name: "cinenerdle",
    popularity: 0,
    popularitySource: null,
    imageUrl: null,
    subtitle: "",
    subtitleDetail: "Open today’s board",
    connectionCount: 1,
    sources: [],
    status: null,
    record: null,
  };
}

describe("shouldSkipDailyStarterGenerationRedraw", () => {
  it("skips the redraw when the refreshed root keeps the same starter cards", () => {
    const currentTree = [
      [{ selected: true, data: makeCinenerdleRootCard() }],
      [{ selected: false, data: makeMovieCard({ name: "First Man", year: "2018", popularity: 22 }) }],
    ];
    const refreshedTree = [
      [{ selected: true, data: makeCinenerdleRootCard() }],
      [{ selected: false, data: makeMovieCard({ name: "First Man", year: "2018", popularity: 99 }) }],
    ];

    expect(shouldSkipDailyStarterGenerationRedraw(currentTree, refreshedTree)).toBe(true);
  });

  it("does not skip the redraw when the refreshed starter row changes", () => {
    const currentTree = [
      [{ selected: true, data: makeCinenerdleRootCard() }],
      [{ selected: false, data: makeMovieCard({ name: "First Man", year: "2018" }) }],
    ];
    const refreshedTree = [
      [{ selected: true, data: makeCinenerdleRootCard() }],
      [{ selected: false, data: makeMovieCard({ name: "Heat", year: "1995" }) }],
    ];

    expect(shouldSkipDailyStarterGenerationRedraw(currentTree, refreshedTree)).toBe(false);
  });
});

describe("getCardPopularityTooltipText", () => {
  it("uses a cached movie record timestamp before ancestor fallbacks", () => {
    const movieFetchTimestamp = "2026-03-29T20:03:24.000Z";
    const parentPersonFetchTimestamp = "2026-03-29T18:00:00.000Z";

    expect(
      getCardPopularityTooltipText(
        makeMovieCard({
          record: makeFilmRecord({
            fetchTimestamp: movieFetchTimestamp,
            rawTmdbMovie: makeTmdbMovieSearchResult(),
          }),
        }),
        [
          makePersonCard({
            record: makePersonRecord({
              fetchTimestamp: parentPersonFetchTimestamp,
              rawTmdbPerson: makeTmdbPersonSearchResult(),
            }),
          }),
        ],
      ),
    ).toBe(`TMDb data fetched ${new Date(movieFetchTimestamp).toLocaleString()}.\nClick to refetch.`);
  });

  it("uses a cached person record timestamp before ancestor fallbacks", () => {
    const personFetchTimestamp = "2026-03-29T20:03:24.000Z";
    const parentMovieFetchTimestamp = "2026-03-29T18:00:00.000Z";

    expect(
      getCardPopularityTooltipText(
        makePersonCard({
          record: makePersonRecord({
            fetchTimestamp: personFetchTimestamp,
            rawTmdbPerson: makeTmdbPersonSearchResult(),
          }),
        }),
        [
          makeMovieCard({
            record: makeFilmRecord({
              fetchTimestamp: parentMovieFetchTimestamp,
              rawTmdbMovie: makeTmdbMovieSearchResult(),
            }),
          }),
        ],
      ),
    ).toBe(`TMDb data fetched ${new Date(personFetchTimestamp).toLocaleString()}.\nClick to refetch.`);
  });

  it("falls back to the selected parent person timestamp for credit-backed movie cards", () => {
    const parentPersonFetchTimestamp = "2026-03-29T19:41:16.347Z";

    expect(
      getCardPopularityTooltipText(
        makeMovieCard({
          record: makeFilmRecord({
            fetchTimestamp: undefined,
          }),
        }),
        [
          makePersonCard({
            record: makePersonRecord({
              fetchTimestamp: parentPersonFetchTimestamp,
              rawTmdbPerson: makeTmdbPersonSearchResult(),
            }),
          }),
        ],
      ),
    ).toBe(`TMDb data fetched ${new Date(parentPersonFetchTimestamp).toLocaleString()}.\nClick to refetch.`);
  });

  it("falls back to the selected parent movie credits timestamp for credit-backed person cards", () => {
    const parentMovieFetchTimestamp = "2026-03-29T20:03:23.096Z";

    expect(
      getCardPopularityTooltipText(
        makePersonCard({
          record: makePersonRecord({
            fetchTimestamp: undefined,
          }),
        }),
        [
          makeMovieCard({
            record: makeFilmRecord({
              fetchTimestamp: parentMovieFetchTimestamp,
              rawTmdbMovie: makeTmdbMovieSearchResult(),
            }),
          }),
        ],
      ),
    ).toBe(`TMDb data fetched ${new Date(parentMovieFetchTimestamp).toLocaleString()}.\nClick to refetch.`);
  });
});

describe("getControllerInitMode", () => {
  it("uses a cache-only redraw after records refreshes", () => {
    expect(getControllerInitMode(2, 1)).toBe("cache");
  });

  it("keeps full bootstrap behavior when the records refresh version is unchanged", () => {
    expect(getControllerInitMode(2, 2)).toBe("full");
  });
});

describe("shouldPrefetchPopularConnectionsOnInit", () => {
  it("skips popularity prefetch on records-refresh cache redraws", () => {
    expect(shouldPrefetchPopularConnectionsOnInit("cache")).toBe(false);
  });

  it("allows popularity prefetch on full init", () => {
    expect(shouldPrefetchPopularConnectionsOnInit("full")).toBe(true);
  });
});

describe("shouldForceRefreshSelectedPathOnInit", () => {
  it("skips selected-path force refresh on records-refresh cache redraws", () => {
    expect(shouldForceRefreshSelectedPathOnInit("cache")).toBe(false);
  });

  it("skips selected-path force refresh on full init too", () => {
    expect(shouldForceRefreshSelectedPathOnInit("full")).toBe(false);
  });
});

describe("shouldDispatchSelectedCardBackgroundForceRefresh", () => {
  it("never dispatches automatic background refetches", () => {
    expect(
      shouldDispatchSelectedCardBackgroundForceRefresh(
        "movie:old",
        makeMovieCard({
          key: "movie:new",
        }),
      ),
    ).toBe(false);
  });

  it("skips when the selected key is unchanged", () => {
    expect(
      shouldDispatchSelectedCardBackgroundForceRefresh(
        "person:60",
        makePersonCard({
          key: "person:60",
        }),
      ),
    ).toBe(false);
  });

  it("skips when there is no selected card", () => {
    expect(
      shouldDispatchSelectedCardBackgroundForceRefresh(null, null),
    ).toBe(false);
  });
});

describe("reduceCinenerdleLifecycleEvent", () => {
  it("uses a movie placeholder row after selecting a person card", () => {
    const state = createGeneratorState<CinenerdleCard, undefined>(undefined, [
      [
        {
          data: makeMovieCard({
            key: "movie:heat:1995",
          }),
          selected: true,
        },
      ],
      [
        {
          data: makePersonCard({
            key: "person:al-pacino",
          }),
          selected: true,
        },
      ],
    ]);

    const transition = reduceCinenerdleLifecycleEvent(state, {
      type: "select",
      row: 1,
      col: 0,
      optimisticSelection: true,
    });

    expect(transition.state.placeholderRowIndex).toBe(2);
    expect(transition.state.renderTreeOverride?.[2]?.[0]?.data).toEqual(
      expect.objectContaining({
        key: "placeholder:movie",
        kind: "movie",
        isPlaceholder: true,
        year: "",
      }),
    );
  });

  it("uses a person placeholder row after selecting a movie card", () => {
    const state = createGeneratorState<CinenerdleCard, undefined>(undefined, [
      [
        {
          data: makeCinenerdleRootCard(),
          selected: true,
        },
      ],
      [
        {
          data: makeMovieCard({
            key: "movie:heat:1995",
          }),
          selected: true,
        },
      ],
    ]);

    const transition = reduceCinenerdleLifecycleEvent(state, {
      type: "select",
      row: 1,
      col: 0,
      optimisticSelection: true,
    });

    expect(transition.state.placeholderRowIndex).toBe(2);
    expect(transition.state.renderTreeOverride?.[2]?.[0]?.data).toEqual(
      expect.objectContaining({
        key: "placeholder:person",
        kind: "person",
        isPlaceholder: true,
      }),
    );
  });
});

describe("ensureSelectedCardFullstate", () => {
  beforeEach(() => {
    Object.values(tmdbMock).forEach((mock) => mock.mockReset());
  });

  it("upgrades selected movies that only have connection minstate", async () => {
    const partialMovieCard = makeMovieCard({
      key: "movie:321",
      name: "Heat",
      year: "1995",
      record: makeFilmRecord({
        id: 321,
        tmdbId: 321,
        title: "Heat",
        year: "1995",
        rawTmdbMovie: undefined,
        rawTmdbMovieCreditsResponse: {
          cast: [],
          crew: [],
        },
      }),
    });
    const hydratedMovieRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });

    tmdbMock.prepareSelectedMovie.mockResolvedValue(hydratedMovieRecord);

    const result = await ensureSelectedCardFullstate(partialMovieCard);

    expect(tmdbMock.prepareSelectedMovie).toHaveBeenCalledWith("Heat", "1995", 321, {
      forceRefresh: undefined,
    });
    expect(result.card).toEqual(
      expect.objectContaining({
        key: "movie:321",
        record: hydratedMovieRecord,
      }),
    );
    expect(result.movieRecord).toBe(hydratedMovieRecord);
  });

  it("does not refetch selected movies that already have full tmdb state", async () => {
    const hydratedMovieRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const hydratedMovieCard = makeMovieCard({
      key: "movie:321",
      record: hydratedMovieRecord,
    });

    const result = await ensureSelectedCardFullstate(hydratedMovieCard);

    expect(tmdbMock.prepareSelectedMovie).not.toHaveBeenCalled();
    expect(result.card).toBe(hydratedMovieCard);
    expect(result.movieRecord).toBe(hydratedMovieRecord);
  });

  it("force refreshes selected movies even when full tmdb state already exists", async () => {
    const hydratedMovieRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const refreshedMovieRecord = makeFilmRecord({
      ...hydratedMovieRecord,
      popularity: 99,
    });
    const hydratedMovieCard = makeMovieCard({
      key: "movie:321",
      record: hydratedMovieRecord,
    });

    tmdbMock.prepareSelectedMovie.mockResolvedValue(refreshedMovieRecord);

    const result = await ensureSelectedCardFullstate(hydratedMovieCard, {
      forceRefresh: true,
    });

    expect(tmdbMock.prepareSelectedMovie).toHaveBeenCalledWith("Heat", "1995", 321, {
      forceRefresh: true,
    });
    expect(result.movieRecord).toBe(refreshedMovieRecord);
  });

  it("upgrades selected people that only have connection minstate", async () => {
    const partialPersonCard = makePersonCard({
      key: "person:60",
      name: "Al Pacino",
      record: makePersonRecord({
        id: 60,
        tmdbId: 60,
        name: "Al Pacino",
        rawTmdbPerson: undefined,
        rawTmdbMovieCreditsResponse: {
          cast: [],
          crew: [],
        },
      }),
    });
    const hydratedPersonRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });

    tmdbMock.prepareSelectedPerson.mockResolvedValue(hydratedPersonRecord);

    const result = await ensureSelectedCardFullstate(partialPersonCard);

    expect(tmdbMock.prepareSelectedPerson).toHaveBeenCalledWith("Al Pacino", 60, {
      forceRefresh: undefined,
    });
    expect(result.card).toEqual(
      expect.objectContaining({
        key: "person:60",
        record: hydratedPersonRecord,
      }),
    );
    expect(result.personRecord).toBe(hydratedPersonRecord);
  });

  it("force refreshes selected people even when full tmdb state already exists", async () => {
    const hydratedPersonRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const refreshedPersonRecord = makePersonRecord({
      ...hydratedPersonRecord,
      fetchTimestamp: "2026-03-30T05:00:00.000Z",
    });
    const hydratedPersonCard = makePersonCard({
      key: "person:60",
      record: hydratedPersonRecord,
    });

    tmdbMock.prepareSelectedPerson.mockResolvedValue(refreshedPersonRecord);

    const result = await ensureSelectedCardFullstate(hydratedPersonCard, {
      forceRefresh: true,
    });

    expect(tmdbMock.prepareSelectedPerson).toHaveBeenCalledWith("Al Pacino", 60, {
      forceRefresh: true,
    });
    expect(result.personRecord).toBe(refreshedPersonRecord);
  });
});

describe("hydrateYoungestSelectedCardInTree", () => {
  beforeEach(() => {
    Object.values(tmdbMock).forEach((mock) => mock.mockReset());
  });

  it("upgrades the youngest selected person in-place within the tree", async () => {
    const partialPersonCard = makePersonCard({
      key: "person:60",
      name: "Al Pacino",
      record: makePersonRecord({
        id: 60,
        tmdbId: 60,
        name: "Al Pacino",
        rawTmdbPerson: undefined,
        rawTmdbMovieCreditsResponse: {
          cast: [],
          crew: [],
        },
      }),
    });
    const hydratedPersonRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });

    tmdbMock.prepareSelectedPerson.mockResolvedValue(hydratedPersonRecord);

    const nextTree = await hydrateYoungestSelectedCardInTree([
      [
        {
          data: makeMovieCard(),
          selected: true,
        },
      ],
      [
        {
          data: partialPersonCard,
          selected: true,
        },
      ],
    ]);

    expect(tmdbMock.prepareSelectedPerson).toHaveBeenCalledWith("Al Pacino", 60, {
      forceRefresh: undefined,
    });
    expect(nextTree[1]?.[0]?.data).toEqual(
      expect.objectContaining({
        key: "person:60",
        record: hydratedPersonRecord,
      }),
    );
  });

  it("leaves the tree alone when the youngest selected card is already hydrated", async () => {
    const hydratedPersonRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });
    const tree = [
      [
        {
          data: makeMovieCard(),
          selected: true,
        },
      ],
      [
        {
          data: makePersonCard({
            key: "person:60",
            record: hydratedPersonRecord,
          }),
          selected: true,
        },
      ],
    ];

    const nextTree = await hydrateYoungestSelectedCardInTree(tree);

    expect(tmdbMock.prepareSelectedPerson).not.toHaveBeenCalled();
    expect(nextTree).toBe(tree);
  });
});

describe("buildBookmarkPreviewCardsFromHash", () => {
  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    Object.values(tmdbMock).forEach((mock) => mock.mockReset());
    clearChildGenerationOrderingCache();

    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([]);
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(new Map());
    indexedDbMock.getMoviePopularityByLabels.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordsByMovieKey.mockResolvedValue([]);
    indexedDbMock.getPersonPopularityByNames.mockResolvedValue(new Map());
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

  it("excludes stunt-only crew movie credits from a person's child row", async () => {
    const peterRecord = makePersonRecord({
      id: 2761654,
      tmdbId: 2761654,
      name: "Peter Jeremijenko",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 2761654,
        name: "Peter Jeremijenko",
        popularity: 0.2973,
        profile_path: null,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 495128,
            title: "Growing Young",
            release_date: "2015-05-13",
            character: "John",
            popularity: 0.6799,
          }),
        ],
        crew: [
          makeMovieCredit({
            id: 604,
            title: "The Matrix Reloaded",
            release_date: "2003-05-15",
            character: undefined,
            creditType: undefined,
            department: "Crew",
            job: "Stunts",
            popularity: 12.4412,
          }),
          makeMovieCredit({
            id: 605,
            title: "The Matrix Revolutions",
            release_date: "2003-11-05",
            character: undefined,
            creditType: undefined,
            department: "Crew",
            job: "Stunts",
            popularity: 9.1144,
          }),
        ],
      },
    });

    indexedDbMock.getPersonRecordById.mockImplementation(async (personId: number) =>
      personId === 2761654 ? peterRecord : null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Peter Jeremijenko" ? peterRecord : null,
    );
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
    indexedDbMock.getPersonPopularityByNames.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(new Map([
      ["growing young (2015)", 1],
    ]));

    const tree = await buildTreeFromHash("#person|Peter+Jeremijenko");
    const childCards = tree[1]?.map((node) => node.data) ?? [];

    expect(childCards.map((card) => card.name)).toEqual([
      "Growing Young",
    ]);
  });

  it("renders both cast and crew roles on a movie child-row person card when the same person appears twice in TMDb credits", async () => {
    const chuckLarryRecord = makeFilmRecord({
      id: 3563,
      tmdbId: 3563,
      title: "I Now Pronounce You Chuck & Larry",
      year: "2007",
      popularity: 3.5179,
      personConnectionKeys: ["adam sandler"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 19292,
            name: "Adam Sandler",
            popularity: 7.408,
            character: "Charles 'Chuck' Levine",
          }),
        ],
        crew: [
          makePersonCredit({
            id: 19292,
            name: "Adam Sandler",
            popularity: 7.408,
            creditType: undefined,
            character: undefined,
            job: "Producer",
            department: "Production",
            order: undefined,
          }),
        ],
      },
    });
    const adamSandlerRecord = makePersonRecord({
      id: 19292,
      tmdbId: 19292,
      name: "Adam Sandler",
      movieConnectionKeys: ["i now pronounce you chuck & larry (2007)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 19292,
        name: "Adam Sandler",
        popularity: 7.408,
      }),
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(chuckLarryRecord);
    indexedDbMock.getPersonRecordById.mockResolvedValue(adamSandlerRecord);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(adamSandlerRecord);

    const tree = await buildTreeFromHash("#film|I+Now+Pronounce+You+Chuck+%26+Larry+(2007)");
    const adamCard = tree[1]?.map((node) => node.data).find((card) =>
      card.kind === "person" && card.name === "Adam Sandler") as
      | Extract<CinenerdleCard, { kind: "person" }>
      | undefined;

    expect(adamCard).toEqual(expect.objectContaining({
      subtitle: "Cast as",
      subtitleDetail: "Charles 'Chuck' Levine",
      creditLines: [
        {
          subtitle: "Cast as",
          subtitleDetail: "Charles 'Chuck' Levine",
        },
        {
          subtitle: "Producer",
          subtitleDetail: "",
        },
      ],
    }));
  });

  it("keeps an existing movie child-row order stable across hydration rebuilds", async () => {
    const initialHeatRecord = makeFilmRecord({
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
    const hydratedHeatRecord = makeFilmRecord({
      ...initialHeatRecord,
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
            popularity: 95,
          }),
          makePersonCredit({
            id: 4,
            name: "Michael Mann",
            order: 11,
            creditType: undefined,
            character: undefined,
            job: "Director",
            popularity: 40,
          }),
        ],
      },
    });

    let recordVersion: "initial" | "hydrated" = "initial";
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "Heat" && year === "1995"
        ? recordVersion === "initial"
          ? initialHeatRecord
          : hydratedHeatRecord
        : null,
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);

    const initialTree = await buildTreeFromHash("#film|Heat+(1995)");
    const initialChildCards = initialTree[1]?.map((node) => node.data) ?? [];
    expect(initialChildCards.map((card) => card.name)).toEqual([
      "Robert De Niro",
      "Michael Mann",
      "Aaron Sorkin",
      "Al Pacino",
    ]);

    recordVersion = "hydrated";
    const hydratedTree = await buildTreeFromHash("#film|Heat+(1995)", {
      bypassInFlightCache: true,
    });
    const hydratedChildCards = hydratedTree[1]?.map((node) => node.data) ?? [];
    expect(hydratedChildCards.map((card) => card.name)).toEqual([
      "Robert De Niro",
      "Michael Mann",
      "Aaron Sorkin",
      "Al Pacino",
    ]);
  });

  it("keeps a movie child tied to the exact credited person when a same-name record exists", async () => {
    const theHotChick = makeFilmRecord({
      id: 11852,
      tmdbId: 11852,
      title: "The Hot Chick",
      year: "2002",
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 53714,
            name: "Rachel McAdams",
            order: 0,
            character: "Jessica",
            popularity: 10,
          }),
        ],
        crew: [
          makePersonCredit({
            id: 66512,
            name: "Tom Brady",
            order: 1,
            profile_path: "/director-tom-brady.jpg",
            creditType: undefined,
            character: undefined,
            job: "Director",
            popularity: 2,
          }),
        ],
      },
    });
    const nflTomBrady = makePersonRecord({
      id: 1223657,
      tmdbId: 1223657,
      name: "Tom Brady",
      movieConnectionKeys: ["ted 2 (2015)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 1223657,
        name: "Tom Brady",
        profile_path: "/nfl-tom-brady.jpg",
        popularity: 50,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
      fetchTimestamp: "2026-03-29T20:41:00.429Z",
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "The Hot Chick" && year === "2002" ? theHotChick : null,
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Tom Brady" ? nflTomBrady : null,
    );

    const tree = await buildTreeFromHash("#film|The+Hot+Chick+(2002)");
    const childCards = tree[1]?.map((node) => node.data) ?? [];
    const tomBradyCard = childCards.find(
      (card) => card.kind === "person" && card.name === "Tom Brady",
    );

    expect(tomBradyCard).toEqual(
      expect.objectContaining({
        key: "person:66512",
        imageUrl: expect.stringContaining("/director-tom-brady.jpg"),
        record: null,
      }),
    );
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
    clearChildGenerationOrderingCache();

    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([]);
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(new Map());
    indexedDbMock.getMoviePopularityByLabels.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(new Map());
    indexedDbMock.getPersonRecordsByMovieKey.mockResolvedValue([]);
    indexedDbMock.getPersonPopularityByNames.mockResolvedValue(new Map());
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

  it("renders both cast and crew roles on a person child-row movie card when the same movie appears twice in TMDb credits", async () => {
    const chuckLarryRecord = makeFilmRecord({
      id: 3563,
      tmdbId: 3563,
      title: "I Now Pronounce You Chuck & Larry",
      year: "2007",
      popularity: 3.5179,
      personConnectionKeys: ["adam sandler"],
    });
    const adamSandlerRecord = makePersonRecord({
      id: 19292,
      tmdbId: 19292,
      name: "Adam Sandler",
      movieConnectionKeys: ["i now pronounce you chuck & larry (2007)"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 3563,
            title: "I Now Pronounce You Chuck & Larry",
            release_date: "2007-07-12",
            popularity: 3.5179,
            character: "Charles 'Chuck' Levine",
          }),
        ],
        crew: [
          makeMovieCredit({
            id: 3563,
            title: "I Now Pronounce You Chuck & Larry",
            release_date: "2007-07-12",
            popularity: 3.5179,
            creditType: undefined,
            character: undefined,
            job: "Producer",
            department: "Production",
            order: undefined,
          }),
        ],
      },
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(adamSandlerRecord);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(adamSandlerRecord);
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map([[3563, chuckLarryRecord]]));

    const tree = await buildTreeFromHash("#person|Adam+Sandler");
    const chuckLarryCard = tree[1]?.map((node) => node.data).find((card) =>
      card.kind === "movie" && card.name === "I Now Pronounce You Chuck & Larry") as
      | Extract<CinenerdleCard, { kind: "movie" }>
      | undefined;

    expect(chuckLarryCard).toEqual(expect.objectContaining({
      subtitle: "2007 • Cast as",
      subtitleDetail: "Charles 'Chuck' Levine",
      creditLines: [
        {
          subtitle: "2007 • Cast as",
          subtitleDetail: "Charles 'Chuck' Levine",
        },
        {
          subtitle: "2007 • Producer",
          subtitleDetail: "",
        },
      ],
    }));
  });

  it("prefers indexeddb movie connection counts when cached film rows underreport them", async () => {
    const alPacinoRecord = makePersonRecord({
      id: 1,
      tmdbId: 1,
      name: "Al Pacino",
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 101,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 70,
          }),
        ],
        crew: [],
      },
    });
    const staleHeatRecord = makeFilmRecord({
      id: 101,
      tmdbId: 101,
      title: "Heat",
      year: "1995",
      popularity: 70,
      personConnectionKeys: [],
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(alPacinoRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Al Pacino" ? alPacinoRecord : null,
    );
    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map([[101, staleHeatRecord]]));
    indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(
      new Map([["heat (1995)", 12]]),
    );

    const tree = await buildTreeFromHash("#person|Al+Pacino");
    const childCards = tree[1]?.map((node) => node.data) ?? [];

    expect(childCards[0]).toEqual(
      expect.objectContaining({
        name: "Heat",
        connectionCount: 12,
      }),
    );
  });

  it("prefers indexeddb person connection counts when cached person rows underreport them", async () => {
    const heatRecord = makeFilmRecord({
      id: 101,
      tmdbId: 101,
      title: "Heat",
      year: "1995",
      personConnectionKeys: ["al pacino"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 1,
            name: "Al Pacino",
            popularity: 88,
          }),
        ],
        crew: [],
      },
    });
    const staleAlPacinoRecord = makePersonRecord({
      id: 1,
      tmdbId: 1,
      name: "Al Pacino",
      movieConnectionKeys: [],
    });

    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "Heat" && year === "1995" ? heatRecord : null,
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(staleAlPacinoRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Al Pacino" ? staleAlPacinoRecord : null,
    );
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(
      new Map([["al pacino", 8]]),
    );

    const tree = await buildTreeFromHash("#film|Heat+(1995)");
    const childCards = tree[1]?.map((node) => node.data) ?? [];

    expect(childCards[0]).toEqual(
      expect.objectContaining({
        name: "Al Pacino",
        connectionCount: 8,
      }),
    );
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

  it("uses cached starter film connection counts when building the live starter row", async () => {
    const fetchedStarterRecord = makeFilmRecord({
      id: "starter-first-man",
      title: "First Man",
      year: "2018",
      popularity: 22,
      personConnectionKeys: [],
    });
    const cachedStarterRecord = makeFilmRecord({
      id: "first-man-2018",
      tmdbId: 100,
      title: "First Man",
      year: "2018",
      popularity: 55,
      personConnectionKeys: ["ryan gosling", "damien chazelle", "josh singer"],
      rawTmdbMovieCreditsResponse: {
        cast: [],
        crew: [],
      },
    });

    tmdbMock.fetchCinenerdleDailyStarterMovies.mockResolvedValue([fetchedStarterRecord]);
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "First Man" && year === "2018" ? cachedStarterRecord : null,
    );

    const tree = await buildTreeFromHash("#cinenerdle");

    expect(tree[1]?.[0]?.data).toEqual(
      expect.objectContaining({
        kind: "movie",
        name: "First Man",
        connectionCount: 3,
      }),
    );
  });
});

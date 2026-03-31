import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGeneratorState } from "../../generator_runtime";
import { CINENERDLE_DAILY_STARTER_TITLES_STORAGE_KEY } from "../constants";
import {
  buildChildRowForCard,
  buildTreeFromHash,
  getCardTmdbRowTooltipText,
  reduceCinenerdleLifecycleEvent,
  useCinenerdleController,
} from "../controller";
import {
  makeFilmRecord,
  makePersonCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
} from "./factories";
import type { CinenerdleCard } from "../view_types";

const indexedDbMock = vi.hoisted(() => ({
  getCinenerdleStarterFilmRecords: vi.fn(),
  getFilmRecordById: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getFilmRecordCountsByPersonConnectionKeys: vi.fn(),
  getFilmRecordsByIds: vi.fn(),
  getMoviePopularityByLabels: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordByName: vi.fn(),
  getPersonRecordCountsByMovieKeys: vi.fn(),
  getPersonPopularityByNames: vi.fn(),
}));

const tmdbMock = vi.hoisted(() => ({
  fetchCinenerdleDailyStarterMovies: vi.fn(),
  hydrateCinenerdleDailyStarterMovies: vi.fn(),
  prefetchTopPopularUnhydratedConnections: vi.fn(),
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

let reloadMock: ReturnType<typeof vi.fn>;

function makeMovieCard(
  overrides: Partial<Extract<CinenerdleCard, { kind: "movie" }>> = {},
): Extract<CinenerdleCard, { kind: "movie" }> {
  return {
    key: "movie:50",
    kind: "movie",
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
    kind: "person",
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

function renderController(
  overrides: Partial<Parameters<typeof useCinenerdleController>[0]> = {},
) {
  let controller: ReturnType<typeof useCinenerdleController> | undefined;

  function Harness() {
    // eslint-disable-next-line react-hooks/globals
    controller = useCinenerdleController({
      readHash: () => "",
      recordsRefreshVersion: 0,
      writeHash: () => { },
      ...overrides,
    });

    return null;
  }

  renderToStaticMarkup(createElement(Harness));

  if (!controller) {
    throw new Error("Failed to render controller test harness");
  }

  return controller;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  const storage = new Map<string, string>();
  reloadMock = vi.fn();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    localStorage: {
      clear() {
        storage.clear();
      },
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
    },
    location: {
      pathname: "/",
      reload: reloadMock,
      search: "",
    },
    open: vi.fn(),
    removeEventListener: vi.fn(),
  });
  window.localStorage.clear();
  Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
  Object.values(tmdbMock).forEach((mock) => mock.mockReset());

  indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([]);
  indexedDbMock.getFilmRecordById.mockResolvedValue(null);
  indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
  indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(new Map());
  indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map());
  indexedDbMock.getMoviePopularityByLabels.mockResolvedValue(new Map());
  indexedDbMock.getPersonRecordById.mockResolvedValue(null);
  indexedDbMock.getPersonRecordByName.mockResolvedValue(null);
  indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(new Map());
  indexedDbMock.getPersonPopularityByNames.mockResolvedValue(new Map());

  tmdbMock.fetchCinenerdleDailyStarterMovies.mockResolvedValue([]);
  tmdbMock.hydrateCinenerdleDailyStarterMovies.mockResolvedValue(undefined);
  tmdbMock.prefetchTopPopularUnhydratedConnections.mockResolvedValue(undefined);
  tmdbMock.prepareSelectedMovie.mockResolvedValue(null);
  tmdbMock.prepareSelectedPerson.mockResolvedValue(null);
  tmdbMock.setTmdbLogGeneration.mockImplementation(() => { });
});

describe("reduceCinenerdleLifecycleEvent", () => {
  it("adds a movie placeholder row after selecting a person", () => {
    const state = createGeneratorState<CinenerdleCard, undefined>(undefined, [
      [{ data: makeMovieCard(), selected: true }],
      [{ data: makePersonCard(), selected: true }],
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
        kind: "movie",
        isPlaceholder: true,
      }),
    );
  });

  it("adds a person placeholder row after selecting a movie", () => {
    const state = createGeneratorState<CinenerdleCard, undefined>(undefined, [
      [{ data: makeCinenerdleRootCard(), selected: true }],
      [{ data: makeMovieCard(), selected: true }],
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
        kind: "person",
        isPlaceholder: true,
      }),
    );
  });
});

describe("buildChildRowForCard", () => {
  it("keeps simple sequential connection ordering for movie children", async () => {
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      personConnectionKeys: ["al pacino", "robert de niro"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 60, name: "Al Pacino", order: 1, popularity: 88 }),
          makePersonCredit({ id: 61, name: "Robert De Niro", order: 2, popularity: 87 }),
        ],
        crew: [],
      },
    });
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)"],
    });
    const deniroRecord = makePersonRecord({
      id: 61,
      tmdbId: 61,
      name: "Robert De Niro",
      movieConnectionKeys: ["heat (1995)"],
    });

    indexedDbMock.getFilmRecordById.mockResolvedValue(heatRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(heatRecord);
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(
      new Map([
        ["Al Pacino", 8],
        ["Robert De Niro", 7],
      ]),
    );
    indexedDbMock.getPersonRecordById.mockImplementation(async (personId: number) =>
      personId === 60 ? pacinoRecord : personId === 61 ? deniroRecord : null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Al Pacino"
        ? pacinoRecord
        : personName === "Robert De Niro"
          ? deniroRecord
          : null,
    );

    const childRow = await buildChildRowForCard(makeMovieCard({
      key: "movie:321",
      record: heatRecord,
    }));

    expect(childRow?.map((node) => node.data.name)).toEqual([
      "Al Pacino",
      "Robert De Niro",
    ]);
    expect(
      childRow?.map((node) =>
        node.data.kind === "person" ? node.data.connectionOrder : null),
    ).toEqual([1, 2]);
  });
});

describe("buildTreeFromHash", () => {
  it("stops on unresolved continuation nodes instead of reconstructing disconnected branches", async () => {
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      personConnectionKeys: ["al pacino"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 60, name: "Al Pacino", order: 1, popularity: 88 }),
        ],
        crew: [],
      },
    });
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)"],
    });

    window.localStorage.setItem(
      CINENERDLE_DAILY_STARTER_TITLES_STORAGE_KEY,
      JSON.stringify(["Heat (1995)"]),
    );
    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([heatRecord]);
    indexedDbMock.getFilmRecordById.mockResolvedValue(heatRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(heatRecord);
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(
      new Map([["Al Pacino", 8]]),
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(pacinoRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Al Pacino" ? pacinoRecord : null,
    );

    const tree = await buildTreeFromHash("#cinenerdle|Heat+(1995)|Someone+Else");

    expect(tree).toHaveLength(3);
    expect(tree[1]?.find((node) => node.selected)?.data).toEqual(
      expect.objectContaining({
        kind: "movie",
        name: "Heat",
      }),
    );
    expect(tree[2]?.map((node) => node.data.name)).toEqual(["Al Pacino"]);
    expect(tree[2]?.some((node) => node.selected)).toBe(false);
  });
});

describe("getCardTmdbRowTooltipText", () => {
  it("prefers the card's own fetched timestamp", () => {
    const movieFetchTimestamp = "2026-03-29T20:03:24.000Z";

    expect(
      getCardTmdbRowTooltipText(
        makeMovieCard({
          record: makeFilmRecord({
            fetchTimestamp: movieFetchTimestamp,
            rawTmdbMovie: makeTmdbMovieSearchResult(),
          }),
        }),
        [],
      ),
    ).toBe(`TMDb data fetched ${new Date(movieFetchTimestamp).toLocaleString()}.\nClick to refetch.`);
  });

  it("falls back to the selected parent timestamp when needed", () => {
    const parentMovieFetchTimestamp = "2026-03-29T20:03:23.096Z";

    expect(
      getCardTmdbRowTooltipText(
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

describe("useCinenerdleController", () => {
  it("renders cached starters first and hydrates matching fetched starters in the background", async () => {
    const starterRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
    });
    const controller = renderController();
    const applyUpdate = vi.fn();

    window.localStorage.setItem(
      CINENERDLE_DAILY_STARTER_TITLES_STORAGE_KEY,
      JSON.stringify(["Heat (1995)"]),
    );
    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([starterRecord]);
    tmdbMock.fetchCinenerdleDailyStarterMovies.mockResolvedValue([starterRecord]);

    await controller.runEffect(
      { type: "load-initial-tree" },
      {
        applyUpdate,
        getState: () => createGeneratorState<CinenerdleCard, undefined>(undefined),
        lifecycleId: 1,
        selectionId: 0,
      },
    );

    expect(applyUpdate).toHaveBeenCalledWith({
      tree: [
        [{ data: expect.objectContaining({ kind: "cinenerdle" }), selected: true, disabled: false }],
        [{ data: expect.objectContaining({ kind: "movie", name: "Heat" }), selected: false, disabled: false }],
      ],
    });

    await flushAsyncWork();

    expect(tmdbMock.fetchCinenerdleDailyStarterMovies).toHaveBeenCalledTimes(1);
    expect(tmdbMock.hydrateCinenerdleDailyStarterMovies).toHaveBeenCalledWith([starterRecord]);
    expect(tmdbMock.setTmdbLogGeneration).toHaveBeenCalledWith(1);
  });

  it("reloads the page when fetched daily starters differ from the cached titles", async () => {
    const cachedStarterRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
    });
    const fetchedStarterRecord = makeFilmRecord({
      id: 322,
      tmdbId: 322,
      title: "Zodiac",
      year: "2007",
    });
    const controller = renderController();

    window.localStorage.setItem(
      CINENERDLE_DAILY_STARTER_TITLES_STORAGE_KEY,
      JSON.stringify(["Heat (1995)"]),
    );
    indexedDbMock.getCinenerdleStarterFilmRecords.mockResolvedValue([cachedStarterRecord]);
    tmdbMock.fetchCinenerdleDailyStarterMovies.mockImplementation(async () => {
      window.localStorage.setItem(
        CINENERDLE_DAILY_STARTER_TITLES_STORAGE_KEY,
        JSON.stringify(["Zodiac (2007)"]),
      );
      return [fetchedStarterRecord];
    });

    await controller.runEffect(
      { type: "load-initial-tree" },
      {
        applyUpdate: vi.fn(),
        getState: () => createGeneratorState<CinenerdleCard, undefined>(undefined),
        lifecycleId: 1,
        selectionId: 0,
      },
    );

    await flushAsyncWork();

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(tmdbMock.hydrateCinenerdleDailyStarterMovies).not.toHaveBeenCalled();
  });

  it("builds the next row without calling tmdb selection fetches", async () => {
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      personConnectionKeys: ["al pacino"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 60, name: "Al Pacino", popularity: 88 }),
        ],
        crew: [],
      },
    });
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)"],
    });
    const writeHash = vi.fn();
    const controller = renderController({ writeHash });
    const applyUpdate = vi.fn();

    indexedDbMock.getFilmRecordById.mockResolvedValue(heatRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(heatRecord);
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(
      new Map([["Al Pacino", 8]]),
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(pacinoRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Al Pacino" ? pacinoRecord : null,
    );

    await controller.runEffect(
      {
        type: "load-selected-card",
        removedDescendantRows: false,
        row: 1,
        col: 0,
        tree: [
          [{ data: makeCinenerdleRootCard(), selected: true }],
          [{ data: makeMovieCard({ key: "movie:321", record: heatRecord }), selected: true }],
        ],
      },
      {
        applyUpdate,
        getState: () => createGeneratorState<CinenerdleCard, undefined>(undefined),
        lifecycleId: 1,
        selectionId: 1,
      },
    );

    await flushAsyncWork();

    expect(tmdbMock.prepareSelectedMovie).not.toHaveBeenCalled();
    expect(tmdbMock.prepareSelectedPerson).not.toHaveBeenCalled();
    expect(writeHash).toHaveBeenCalledWith("#cinenerdle|Heat+(1995)", "selection");
    expect(applyUpdate).toHaveBeenCalledWith({
      tree: [
        [{ data: makeCinenerdleRootCard(), selected: true }],
        [{ data: makeMovieCard({ key: "movie:321", record: heatRecord }), selected: true }],
        [expect.objectContaining({
          data: expect.objectContaining({
            kind: "person",
            name: "Al Pacino",
          }),
        })],
      ],
    });
  });
});

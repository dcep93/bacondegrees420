import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGeneratorState } from "../../generator_runtime";
import { CINENERDLE_DAILY_STARTER_TITLES_STORAGE_KEY } from "../constants";
import {
  buildChildRowForCard,
  buildTreeFromHash,
  type CinenerdleTreeMeta,
  getCardTmdbRowTooltipText,
  getConnectedItemAttrChildSourceCards,
  getConnectedItemAttrSourceCards,
  resetConnectedItemAttrChildSourcesCache,
  reduceCinenerdleLifecycleEvent,
  useCinenerdleController,
} from "../controller";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createControllerState(
  tree: NonNullable<ReturnType<typeof createGeneratorState<CinenerdleCard, CinenerdleTreeMeta>>["tree"]> | null = null,
) {
  return createGeneratorState<CinenerdleCard, CinenerdleTreeMeta>(
    {
      itemAttrsSnapshot: {
        film: {},
        person: {},
      },
    },
    tree,
  );
}

beforeEach(() => {
  resetConnectedItemAttrChildSourcesCache();
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
  it("keeps previous descendants visible until the effect replaces them", () => {
    const tree = [
      [{ data: makeMovieCard(), selected: true }],
      [
        { data: makeMovieCard({ key: "movie:321" }), selected: true },
        { data: makeMovieCard({ key: "movie:322", name: "Scarface", year: "1983" }), selected: false },
      ],
      [{ data: makePersonCard(), selected: true }],
    ];
    const state = createGeneratorState<CinenerdleCard, undefined>(undefined, tree);

    const transition = reduceCinenerdleLifecycleEvent(state, {
      type: "select",
      row: 1,
      col: 1,
    });

    expect(transition.state.tree).toEqual([
      [{ data: makeMovieCard(), selected: true }],
      [
        { data: makeMovieCard({ key: "movie:321" }), selected: false },
        { data: makeMovieCard({ key: "movie:322", name: "Scarface", year: "1983" }), selected: true },
      ],
      [{ data: makePersonCard(), selected: false }],
    ]);
    expect(transition.effects).toEqual([
      expect.objectContaining({
        type: "load-selected-card",
        isReselection: false,
        removedDescendantRows: true,
        row: 1,
        col: 1,
      }),
    ]);
    expect(transition.state.tree?.[0]).toBe(tree[0]);
    expect(transition.state.tree?.[1]).not.toBe(tree[1]);
    expect(transition.state.tree?.[2]).not.toBe(tree[2]);
  });

  it("preserves the existing subtree when selecting an already selected card", () => {
    const tree: NonNullable<ReturnType<typeof createGeneratorState<CinenerdleCard, undefined>>["tree"]> = [
      [{ data: makeCinenerdleRootCard(), selected: true }],
      [{ data: makeMovieCard(), selected: true }],
      [{ data: makePersonCard(), selected: true }],
    ];
    const state = createGeneratorState<CinenerdleCard, undefined>(undefined, tree);

    const transition = reduceCinenerdleLifecycleEvent(state, {
      type: "select",
      row: 1,
      col: 0,
    });

    expect(transition.state).toBe(state);
    expect(transition.state.tree).toEqual(tree);
    expect(transition.effects).toEqual([{
      type: "load-selected-card",
      isReselection: true,
      removedDescendantRows: true,
      row: 1,
      col: 0,
      tree,
    }]);
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
      personName.toLowerCase() === "al pacino"
        ? pacinoRecord
        : personName.toLowerCase() === "robert de niro"
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

  it("reuses a primed person parent record for later child-row builds", async () => {
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)", "scarface (1983)"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 321, title: "Heat", release_date: "1995-12-15", order: 0 }),
          makeMovieCredit({ id: 322, title: "Scarface", release_date: "1983-12-09", order: 1 }),
        ],
        crew: [],
      },
    });
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      personConnectionKeys: ["al pacino"],
    });
    const scarfaceRecord = makeFilmRecord({
      id: 322,
      tmdbId: 322,
      title: "Scarface",
      year: "1983",
      personConnectionKeys: ["al pacino"],
    });
    const sparsePacinoCard = makePersonCard({
      key: "person:60",
      name: "Al Pacino",
      record: null,
    });

    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(
      new Map([
        [321, heatRecord],
        [322, scarfaceRecord],
      ]),
    );
    indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(
      new Map([
        ["heat (1995)", 8],
        ["scarface (1983)", 6],
      ]),
    );

    const primedRow = await buildChildRowForCard(sparsePacinoCard, {
      personRecord: pacinoRecord,
    });
    const cachedRow = await buildChildRowForCard(sparsePacinoCard);

    expect(primedRow?.map((node) => node.data.name)).toEqual([
      "Heat",
      "Scarface",
    ]);
    expect(cachedRow?.map((node) => node.data.name)).toEqual([
      "Heat",
      "Scarface",
    ]);
    expect(indexedDbMock.getPersonRecordById).not.toHaveBeenCalled();
    expect(indexedDbMock.getPersonRecordByName).not.toHaveBeenCalled();
  });

  it("reuses a primed movie parent record for later child-row builds", async () => {
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
    const sparseHeatCard = makeMovieCard({
      key: "movie:321",
      name: "Heat",
      year: "1995",
      record: null,
    });

    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(
      new Map([
        ["Al Pacino", 8],
        ["Robert De Niro", 7],
      ]),
    );
    indexedDbMock.getPersonRecordById.mockImplementation(async (personId: number) =>
      personId === 60 ? pacinoRecord : personId === 61 ? deniroRecord : null,
    );

    const primedRow = await buildChildRowForCard(sparseHeatCard, {
      movieRecord: heatRecord,
    });
    const cachedRow = await buildChildRowForCard(sparseHeatCard);

    expect(primedRow?.map((node) => node.data.name)).toEqual([
      "Al Pacino",
      "Robert De Niro",
    ]);
    expect(cachedRow?.map((node) => node.data.name)).toEqual([
      "Al Pacino",
      "Robert De Niro",
    ]);
    expect(indexedDbMock.getFilmRecordById).not.toHaveBeenCalled();
    expect(indexedDbMock.getFilmRecordByTitleAndYear).not.toHaveBeenCalled();
  });
});

describe("buildTreeFromHash", () => {
  it("keeps unresolved continuation nodes visible as standalone selected rows", async () => {
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

    expect(tree).toHaveLength(4);
    expect(tree[1]?.find((node) => node.selected)?.data).toEqual(
      expect.objectContaining({
        kind: "movie",
        name: "Heat",
      }),
    );
    expect(tree[2]?.map((node) => node.data.name)).toEqual(["Al Pacino"]);
    expect(tree[2]?.some((node) => node.selected)).toBe(false);
    expect(tree[3]?.find((node) => node.selected)?.data).toEqual(
      expect.objectContaining({
        kind: "person",
        name: "Someone Else",
        subtitle: "Crew",
      }),
    );
  });
});

describe("getConnectedItemAttrSourceCards", () => {
  it("includes the selected card's nearest ancestor and descendant entity connections", () => {
    const currentPerson = makePersonCard({
      key: "person:17605",
      name: "Idris Elba",
      record: makePersonRecord({
        id: 17605,
        name: "Idris Elba",
        movieConnectionKeys: ["zootopia (2016)", "zootopia 2 (2025)"],
        rawTmdbMovieCreditsResponse: {
          cast: [
            makeMovieCredit({ id: 269149, title: "Zootopia", release_date: "2016-03-04" }),
            makeMovieCredit({ id: 1084242, title: "Zootopia 2", release_date: "2025-11-26" }),
          ],
          crew: [],
        },
      }),
    });
    const previousMovie = makeMovieCard({
      key: "movie:zootopia:2016",
      name: "Zootopia",
      year: "2016",
      record: makeFilmRecord({
        id: 269149,
        tmdbId: 269149,
        title: "Zootopia",
        year: "2016",
        rawTmdbMovie: makeTmdbMovieSearchResult({
          id: 269149,
          title: "Zootopia",
          release_date: "2016-03-04",
        }),
      }),
    });
    const nextMovie = makeMovieCard({
      key: "movie:zootopia-2:2025",
      name: "Zootopia 2",
      year: "2025",
      record: makeFilmRecord({
        id: 1084242,
        tmdbId: 1084242,
        title: "Zootopia 2",
        year: "2025",
        rawTmdbMovie: makeTmdbMovieSearchResult({
          id: 1084242,
          title: "Zootopia 2",
          release_date: "2025-11-26",
        }),
      }),
    });

    expect(getConnectedItemAttrSourceCards({
      card: currentPerson,
      isSelected: true,
      selectedAncestorCards: [makeCinenerdleRootCard(), previousMovie],
      selectedChildCard: nextMovie,
      selectedDescendantCards: [nextMovie],
      selectedParentCard: previousMovie,
    })).toEqual([previousMovie, nextMovie]);
  });

  it("does not include descendant connections for non-selected sibling cards", () => {
    const currentPerson = makePersonCard({
      key: "person:17605",
      name: "Idris Elba",
      record: makePersonRecord({
        id: 17605,
        name: "Idris Elba",
        movieConnectionKeys: ["zootopia (2016)", "zootopia 2 (2025)"],
        rawTmdbMovieCreditsResponse: {
          cast: [
            makeMovieCredit({ id: 269149, title: "Zootopia", release_date: "2016-03-04" }),
            makeMovieCredit({ id: 1084242, title: "Zootopia 2", release_date: "2025-11-26" }),
          ],
          crew: [],
        },
      }),
    });
    const previousMovie = makeMovieCard({
      key: "movie:zootopia:2016",
      name: "Zootopia",
      year: "2016",
      record: makeFilmRecord({
        id: 269149,
        tmdbId: 269149,
        title: "Zootopia",
        year: "2016",
        rawTmdbMovie: makeTmdbMovieSearchResult({
          id: 269149,
          title: "Zootopia",
          release_date: "2016-03-04",
        }),
      }),
    });
    const nextMovie = makeMovieCard({
      key: "movie:zootopia-2:2025",
      name: "Zootopia 2",
      year: "2025",
      record: makeFilmRecord({
        id: 1084242,
        tmdbId: 1084242,
        title: "Zootopia 2",
        year: "2025",
        rawTmdbMovie: makeTmdbMovieSearchResult({
          id: 1084242,
          title: "Zootopia 2",
          release_date: "2025-11-26",
        }),
      }),
    });

    expect(getConnectedItemAttrSourceCards({
      card: currentPerson,
      isSelected: false,
      selectedAncestorCards: [makeCinenerdleRootCard(), previousMovie],
      selectedChildCard: nextMovie,
      selectedDescendantCards: [nextMovie],
      selectedParentCard: previousMovie,
    })).toEqual([previousMovie]);
  });

  it("falls back to the nearest selected descendant entity when the immediate child row has no selection", () => {
    const currentPerson = makePersonCard({
      key: "person:17605",
      name: "Idris Elba",
      record: makePersonRecord({
        id: 17605,
        name: "Idris Elba",
        movieConnectionKeys: ["zootopia (2016)", "zootopia 2 (2025)"],
        rawTmdbMovieCreditsResponse: {
          cast: [
            makeMovieCredit({ id: 269149, title: "Zootopia", release_date: "2016-03-04" }),
            makeMovieCredit({ id: 1084242, title: "Zootopia 2", release_date: "2025-11-26" }),
          ],
          crew: [],
        },
      }),
    });
    const previousMovie = makeMovieCard({
      key: "movie:zootopia:2016",
      name: "Zootopia",
      year: "2016",
      record: makeFilmRecord({
        id: 269149,
        tmdbId: 269149,
        title: "Zootopia",
        year: "2016",
        rawTmdbMovie: makeTmdbMovieSearchResult({
          id: 269149,
          title: "Zootopia",
          release_date: "2016-03-04",
        }),
      }),
    });
    const descendantMovie = makeMovieCard({
      key: "movie:zootopia-2:2025",
      name: "Zootopia 2",
      year: "2025",
      record: makeFilmRecord({
        id: 1084242,
        tmdbId: 1084242,
        title: "Zootopia 2",
        year: "2025",
        rawTmdbMovie: makeTmdbMovieSearchResult({
          id: 1084242,
          title: "Zootopia 2",
          release_date: "2025-11-26",
        }),
      }),
    });

    expect(getConnectedItemAttrSourceCards({
      card: currentPerson,
      isSelected: true,
      selectedAncestorCards: [makeCinenerdleRootCard(), previousMovie],
      selectedChildCard: null,
      selectedDescendantCards: [descendantMovie],
      selectedParentCard: previousMovie,
    })).toEqual([previousMovie, descendantMovie]);
  });

  it("includes older selected ancestor entities when they are still directly connected", () => {
    const currentPerson = makePersonCard({
      key: "person:17605",
      name: "Idris Elba",
      record: makePersonRecord({
        id: 17605,
        name: "Idris Elba",
        movieConnectionKeys: ["zootopia (2016)", "zootopia 2 (2025)"],
        rawTmdbMovieCreditsResponse: {
          cast: [
            makeMovieCredit({ id: 269149, title: "Zootopia", release_date: "2016-03-04" }),
            makeMovieCredit({ id: 1084242, title: "Zootopia 2", release_date: "2025-11-26" }),
          ],
          crew: [],
        },
      }),
    });
    const olderMovie = makeMovieCard({
      key: "movie:zootopia:2016",
      name: "Zootopia",
      year: "2016",
      record: makeFilmRecord({
        id: 269149,
        tmdbId: 269149,
        title: "Zootopia",
        year: "2016",
        rawTmdbMovie: makeTmdbMovieSearchResult({
          id: 269149,
          title: "Zootopia",
          release_date: "2016-03-04",
        }),
      }),
    });
    const nearestMovie = makeMovieCard({
      key: "movie:zootopia-2:2025",
      name: "Zootopia 2",
      year: "2025",
      record: makeFilmRecord({
        id: 1084242,
        tmdbId: 1084242,
        title: "Zootopia 2",
        year: "2025",
        rawTmdbMovie: makeTmdbMovieSearchResult({
          id: 1084242,
          title: "Zootopia 2",
          release_date: "2025-11-26",
        }),
      }),
    });

    expect(getConnectedItemAttrSourceCards({
      card: currentPerson,
      isSelected: true,
      selectedAncestorCards: [
        makeCinenerdleRootCard(),
        olderMovie,
        currentPerson,
        nearestMovie,
      ],
      selectedChildCard: null,
      selectedDescendantCards: [],
      selectedParentCard: nearestMovie,
    })).toEqual([olderMovie, nearestMovie]);
  });

  it("matches movie connections by tmdb credit id when the person card name differs from the movie alias", () => {
    const currentPerson = makePersonCard({
      key: "person:1234",
      name: "Ginnifer Goodwin",
      record: null,
    });
    const previousMovie = makeMovieCard({
      key: "movie:zootopia:2016",
      name: "Zootopia",
      year: "2016",
      record: makeFilmRecord({
        title: "Zootopia",
        year: "2016",
        personConnectionKeys: ["jennifer goodwin"],
        rawTmdbMovieCreditsResponse: {
          cast: [
            makePersonCredit({
              id: 1234,
              name: "Jennifer Goodwin",
            }),
          ],
          crew: [],
        },
      }),
    });

    expect(getConnectedItemAttrSourceCards({
      card: currentPerson,
      isSelected: false,
      selectedAncestorCards: [makeCinenerdleRootCard(), previousMovie],
      selectedChildCard: null,
      selectedDescendantCards: [],
      selectedParentCard: previousMovie,
    })).toEqual([previousMovie]);
  });
});

describe("getConnectedItemAttrChildSourceCards", () => {
  it("loads direct child entity connections for non-selected cards", async () => {
    const zootopiaRecord = makeFilmRecord({
      id: 269149,
      tmdbId: 269149,
      title: "Zootopia",
      year: "2016",
      popularity: 88,
      personConnectionKeys: ["idris elba"],
    });
    const zootopia2Record = makeFilmRecord({
      id: 1084242,
      tmdbId: 1084242,
      title: "Zootopia 2",
      year: "2025",
      popularity: 99,
      personConnectionKeys: ["idris elba"],
    });
    const idrisRecord = makePersonRecord({
      id: 17605,
      tmdbId: 17605,
      name: "Idris Elba",
      movieConnectionKeys: ["zootopia (2016)", "zootopia 2 (2025)"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 269149, title: "Zootopia", release_date: "2016-03-04" }),
          makeMovieCredit({ id: 1084242, title: "Zootopia 2", release_date: "2025-11-26" }),
        ],
        crew: [],
      },
    });
    const idrisCard = makePersonCard({
      key: "person:17605",
      name: "Idris Elba",
      record: idrisRecord,
    });

    indexedDbMock.getPersonRecordById.mockResolvedValue(idrisRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName.toLowerCase() === "idris elba" ? idrisRecord : null,
    );
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(
      async (movieName: string, movieYear: string) => {
        const movieLabel = `${movieName} (${movieYear})`.toLowerCase();
        if (movieLabel === "zootopia (2016)") {
          return zootopiaRecord;
        }

        if (movieLabel === "zootopia 2 (2025)") {
          return zootopia2Record;
        }

        return null;
      },
    );

    const childSources = await getConnectedItemAttrChildSourceCards(idrisCard);

    expect(childSources.map((card) => card.key)).toEqual([
      "movie:269149",
      "movie:1084242",
    ]);
    expect(childSources.map((card) => card.name)).toEqual([
      "Zootopia",
      "Zootopia 2",
    ]);
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
    ).toBe(`Data connected ${new Date(parentMovieFetchTimestamp).toLocaleString()}.\nClick to refetch.`);
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
        getState: () => createControllerState(),
        lifecycleId: 1,
        selectionId: 0,
        scrollGenerationIntoVerticalView: vi.fn(),
        scrollGenerationLikeBubble: vi.fn(),
      },
    );

    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(applyUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      meta: {
        itemAttrsSnapshot: {
          film: {},
          person: {},
        },
      },
      tree: [
        [expect.objectContaining({
          data: expect.objectContaining({ kind: "cinenerdle" }),
          selected: true,
          disabled: false,
        })],
        [expect.objectContaining({
          data: expect.objectContaining({ kind: "movie", name: "Heat" }),
          selected: false,
          disabled: false,
        })],
      ],
    }));

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
        getState: () => createControllerState(),
        lifecycleId: 1,
        selectionId: 0,
        scrollGenerationIntoVerticalView: vi.fn(),
        scrollGenerationLikeBubble: vi.fn(),
      },
    );

    await flushAsyncWork();

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(tmdbMock.hydrateCinenerdleDailyStarterMovies).not.toHaveBeenCalled();
  });

  it("builds the next row and skips force hydration for directly hydrated cards", async () => {
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
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
    const scrollGenerationIntoVerticalView = vi.fn();
    const scrollGenerationLikeBubble = vi.fn();

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
        isReselection: false,
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
        getState: () => createControllerState(),
        lifecycleId: 1,
        selectionId: 1,
        scrollGenerationIntoVerticalView,
        scrollGenerationLikeBubble,
      },
    );

    await flushAsyncWork();

    expect(tmdbMock.prepareSelectedMovie).not.toHaveBeenCalled();
    expect(tmdbMock.prepareSelectedPerson).not.toHaveBeenCalled();
    expect(indexedDbMock.getMoviePopularityByLabels).not.toHaveBeenCalled();
    expect(indexedDbMock.getFilmRecordById).not.toHaveBeenCalled();
    expect(indexedDbMock.getFilmRecordByTitleAndYear).not.toHaveBeenCalled();
    expect(tmdbMock.prefetchTopPopularUnhydratedConnections).toHaveBeenCalledTimes(1);
    expect(tmdbMock.prefetchTopPopularUnhydratedConnections).toHaveBeenCalledWith(
      makeMovieCard({ key: "movie:321", record: heatRecord }),
    );
    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(writeHash).toHaveBeenCalledWith("#cinenerdle|Heat+(1995)", "selection");
    expect(scrollGenerationLikeBubble).toHaveBeenCalledTimes(1);
    expect(scrollGenerationLikeBubble).toHaveBeenCalledWith(2);
    expect(scrollGenerationIntoVerticalView).toHaveBeenCalledWith(2, {
      alignRowHorizontally: false,
    });
    expect(applyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tree: expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              kind: "person",
              name: "Al Pacino",
            }),
          }),
        ]),
      ]),
    }));
  });

  it("does not block selection updates on background prefetch work", async () => {
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
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
    const controller = renderController({ writeHash: vi.fn() });

    indexedDbMock.getFilmRecordById.mockResolvedValue(heatRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(heatRecord);
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(
      new Map([["Al Pacino", 8]]),
    );
    indexedDbMock.getPersonRecordById.mockResolvedValue(pacinoRecord);
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "Al Pacino" ? pacinoRecord : null,
    );
    tmdbMock.prefetchTopPopularUnhydratedConnections.mockReturnValue(new Promise(() => { }));

    const outcome = await Promise.race([
      controller.runEffect(
        {
          type: "load-selected-card",
          isReselection: false,
          removedDescendantRows: false,
          row: 1,
          col: 0,
          tree: [
            [{ data: makeCinenerdleRootCard(), selected: true }],
            [{ data: makeMovieCard({ key: "movie:321", record: heatRecord }), selected: true }],
          ],
        },
        {
          applyUpdate: vi.fn(),
          getState: () => createControllerState(),
          lifecycleId: 1,
          selectionId: 1,
          scrollGenerationIntoVerticalView: vi.fn(),
          scrollGenerationLikeBubble: vi.fn(),
        },
      ).then(() => "resolved"),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("timeout"), 25);
      }),
    ]);

    expect(outcome).toBe("resolved");
    await flushAsyncWork();
    expect(tmdbMock.prefetchTopPopularUnhydratedConnections).toHaveBeenCalledTimes(1);
  });

  it("builds the next row and still prefetches for directly hydrated person cards", async () => {
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      popularity: 66,
      personConnectionKeys: ["al pacino"],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
    });
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 88,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({ id: 321, title: "Heat", release_date: "1995-12-15", popularity: 66 }),
        ],
        crew: [],
      },
    });
    const controller = renderController({ writeHash: vi.fn() });
    const applyUpdate = vi.fn();
    const scrollGenerationIntoVerticalView = vi.fn();
    const scrollGenerationLikeBubble = vi.fn();

    indexedDbMock.getFilmRecordsByIds.mockResolvedValue(new Map([[321, heatRecord]]));
    indexedDbMock.getPersonPopularityByNames.mockResolvedValue(new Map([["al pacino", 88]]));
    indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(new Map([["heat (1995)", 8]]));

    await controller.runEffect(
      {
        type: "load-selected-card",
        isReselection: false,
        removedDescendantRows: false,
        row: 1,
        col: 0,
        tree: [
          [{ data: makeCinenerdleRootCard(), selected: true }],
          [{ data: makePersonCard({ key: "person:60", record: pacinoRecord }), selected: true }],
        ],
      },
      {
        applyUpdate,
        getState: () => createControllerState(),
        lifecycleId: 1,
        selectionId: 1,
        scrollGenerationIntoVerticalView,
        scrollGenerationLikeBubble,
      },
    );

    await flushAsyncWork();

    expect(tmdbMock.prepareSelectedMovie).not.toHaveBeenCalled();
    expect(tmdbMock.prepareSelectedPerson).not.toHaveBeenCalled();
    expect(indexedDbMock.getPersonPopularityByNames).not.toHaveBeenCalled();
    expect(indexedDbMock.getPersonRecordById).not.toHaveBeenCalled();
    expect(indexedDbMock.getPersonRecordByName).not.toHaveBeenCalled();
    expect(tmdbMock.prefetchTopPopularUnhydratedConnections).toHaveBeenCalledTimes(1);
    expect(tmdbMock.prefetchTopPopularUnhydratedConnections).toHaveBeenCalledWith(
      makePersonCard({ key: "person:60", record: pacinoRecord }),
    );
    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(scrollGenerationLikeBubble).toHaveBeenCalledTimes(1);
    expect(scrollGenerationLikeBubble).toHaveBeenCalledWith(2);
    expect(scrollGenerationIntoVerticalView).toHaveBeenCalledWith(2, {
      alignRowHorizontally: false,
    });
    expect(applyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tree: expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              kind: "movie",
              name: "Heat",
              record: heatRecord,
            }),
          }),
        ]),
      ]),
    }));
  });

  it("renders a DB-backed movie subtree before force hydrating a connection-derived selection", async () => {
    const connectionDerivedHeatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      personConnectionKeys: ["al pacino"],
    });
    const locallyCachedHeatRecord = makeFilmRecord({
      ...connectionDerivedHeatRecord,
      popularity: 88,
      personConnectionKeys: ["al pacino", "robert de niro"],
    });
    const hydratedHeatRecord = makeFilmRecord({
      ...locallyCachedHeatRecord,
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        popularity: 99,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 60, name: "Al Pacino", order: 0, popularity: 88 }),
          makePersonCredit({ id: 61, name: "Robert De Niro", order: 1, popularity: 87 }),
        ],
        crew: [],
      },
    });
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 88,
      }),
    });
    const deniroRecord = makePersonRecord({
      id: 61,
      tmdbId: 61,
      name: "Robert De Niro",
      movieConnectionKeys: ["heat (1995)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 61,
        name: "Robert De Niro",
        popularity: 87,
      }),
    });
    const controller = renderController({ writeHash: vi.fn() });
    const applyUpdate = vi.fn();
    const scrollGenerationIntoVerticalView = vi.fn();
    const scrollGenerationLikeBubble = vi.fn();

    indexedDbMock.getFilmRecordById.mockResolvedValue(locallyCachedHeatRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(locallyCachedHeatRecord);
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(
      new Map([
        ["al pacino", 8],
        ["robert de niro", 7],
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
    tmdbMock.prepareSelectedMovie.mockResolvedValue(hydratedHeatRecord);

    await controller.runEffect(
      {
        type: "load-selected-card",
        isReselection: false,
        removedDescendantRows: true,
        row: 1,
        col: 0,
        tree: [
          [{ data: makeCinenerdleRootCard(), selected: true }],
          [{ data: makeMovieCard({ key: "movie:321", record: connectionDerivedHeatRecord }), selected: true }],
          [{ data: makePersonCard(), selected: false }],
        ],
      },
      {
        applyUpdate,
        getState: () => createControllerState(),
        lifecycleId: 1,
        selectionId: 1,
        scrollGenerationIntoVerticalView,
        scrollGenerationLikeBubble,
      },
    );

    await flushAsyncWork();

    expect(tmdbMock.prepareSelectedMovie).toHaveBeenCalledWith("Heat", "1995", 321, {
      forceRefresh: true,
    });
    expect(applyUpdate).toHaveBeenCalledTimes(2);
    expect(scrollGenerationLikeBubble).toHaveBeenCalledTimes(1);
    expect(scrollGenerationLikeBubble).toHaveBeenCalledWith(2);
    expect(scrollGenerationIntoVerticalView).toHaveBeenCalledWith(2, {
      alignRowHorizontally: false,
    });
    const firstTree = applyUpdate.mock.calls[0]?.[0]?.tree;
    const secondTree = applyUpdate.mock.calls[1]?.[0]?.tree;

    expect(firstTree?.[1]?.[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        kind: "movie",
        name: "Heat",
        record: locallyCachedHeatRecord,
      }),
      selected: true,
    }));
    expect(firstTree?.[2]?.map((node: { data: CinenerdleCard }) => node.data.name)).toEqual([
      "Al Pacino",
      "Robert De Niro",
    ]);
    expect(secondTree?.[1]?.[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        kind: "movie",
        name: "Heat",
        record: hydratedHeatRecord,
      }),
      selected: true,
    }));
    expect(secondTree?.[2]?.map((node: { data: CinenerdleCard }) => node.data.name)).toEqual([
      "Al Pacino",
      "Robert De Niro",
    ]);
  });

  it("scrolls the initial child row before a slow movie hydration finishes", async () => {
    const connectionDerivedHeatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      personConnectionKeys: ["al pacino"],
    });
    const locallyCachedHeatRecord = makeFilmRecord({
      ...connectionDerivedHeatRecord,
      popularity: 88,
      personConnectionKeys: ["al pacino", "robert de niro"],
    });
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 88,
      }),
    });
    const deniroRecord = makePersonRecord({
      id: 61,
      tmdbId: 61,
      name: "Robert De Niro",
      movieConnectionKeys: ["heat (1995)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 61,
        name: "Robert De Niro",
        popularity: 87,
      }),
    });
    const hydrationDeferred = createDeferred<ReturnType<typeof makeFilmRecord> | null>();
    const controller = renderController({ writeHash: vi.fn() });
    const applyUpdate = vi.fn();
    const scrollGenerationIntoVerticalView = vi.fn();
    const scrollGenerationLikeBubble = vi.fn();

    indexedDbMock.getFilmRecordById.mockResolvedValue(locallyCachedHeatRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(locallyCachedHeatRecord);
    indexedDbMock.getFilmRecordCountsByPersonConnectionKeys.mockResolvedValue(
      new Map([
        ["al pacino", 8],
        ["robert de niro", 7],
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
    tmdbMock.prepareSelectedMovie.mockReturnValue(hydrationDeferred.promise);

    await controller.runEffect(
      {
        type: "load-selected-card",
        isReselection: false,
        removedDescendantRows: true,
        row: 1,
        col: 0,
        tree: [
          [{ data: makeCinenerdleRootCard(), selected: true }],
          [{ data: makeMovieCard({ key: "movie:321", record: connectionDerivedHeatRecord }), selected: true }],
          [{ data: makePersonCard(), selected: false }],
        ],
      },
      {
        applyUpdate,
        getState: () => createControllerState(),
        lifecycleId: 1,
        selectionId: 1,
        scrollGenerationIntoVerticalView,
        scrollGenerationLikeBubble,
      },
    );

    await flushAsyncWork();

    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(scrollGenerationLikeBubble).not.toHaveBeenCalled();
    expect(scrollGenerationIntoVerticalView).toHaveBeenCalledWith(2, {
      alignRowHorizontally: false,
    });

    hydrationDeferred.resolve(locallyCachedHeatRecord);
    await flushAsyncWork();

    expect(scrollGenerationLikeBubble).toHaveBeenCalledTimes(1);
    expect(scrollGenerationLikeBubble).toHaveBeenCalledWith(2);
  });

  it("renders a DB-backed person subtree before force hydrating a connection-derived selection", async () => {
    const sparsePacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)"],
    });
    const locallyCachedPacinoRecord = makePersonRecord({
      ...sparsePacinoRecord,
      fetchTimestamp: "2026-03-31T12:00:00.000Z",
      movieConnectionKeys: ["heat (1995)", "scarface (1983)"],
    });
    const hydratedPacinoRecord = makePersonRecord({
      ...locallyCachedPacinoRecord,
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 88,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 66,
            order: 1,
          }),
          makeMovieCredit({
            id: 322,
            title: "Scarface",
            release_date: "1983-12-09",
            popularity: 92,
            order: 0,
          }),
        ],
        crew: [],
      },
    });
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      popularity: 66,
      personConnectionKeys: ["al pacino"],
    });
    const scarfaceRecord = makeFilmRecord({
      id: 322,
      tmdbId: 322,
      title: "Scarface",
      year: "1983",
      popularity: 92,
      personConnectionKeys: ["al pacino"],
    });
    const controller = renderController({ writeHash: vi.fn() });
    const applyUpdate = vi.fn();
    const scrollGenerationIntoVerticalView = vi.fn();
    const scrollGenerationLikeBubble = vi.fn();

    indexedDbMock.getPersonRecordById.mockResolvedValue(locallyCachedPacinoRecord);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(locallyCachedPacinoRecord);
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title.toLowerCase() === "heat" && year === "1995"
        ? heatRecord
        : title.toLowerCase() === "scarface" && year === "1983"
          ? scarfaceRecord
          : null,
    );
    indexedDbMock.getPersonRecordCountsByMovieKeys.mockResolvedValue(
      new Map([
        ["heat (1995)", 8],
        ["scarface (1983)", 6],
      ]),
    );
    indexedDbMock.getPersonPopularityByNames.mockResolvedValue(
      new Map([["al pacino", 88]]),
    );
    tmdbMock.prepareSelectedPerson.mockResolvedValue(hydratedPacinoRecord);

    await controller.runEffect(
      {
        type: "load-selected-card",
        isReselection: false,
        removedDescendantRows: true,
        row: 1,
        col: 0,
        tree: [
          [{ data: makeCinenerdleRootCard(), selected: true }],
          [{ data: makePersonCard({ key: "person:60", record: sparsePacinoRecord }), selected: true }],
          [{ data: makeMovieCard(), selected: false }],
        ],
      },
      {
        applyUpdate,
        getState: () => createControllerState(),
        lifecycleId: 1,
        selectionId: 1,
        scrollGenerationIntoVerticalView,
        scrollGenerationLikeBubble,
      },
    );

    await flushAsyncWork();

    expect(tmdbMock.prepareSelectedPerson).toHaveBeenCalledWith("Al Pacino", 60, {
      forceRefresh: true,
    });
    expect(indexedDbMock.getPersonRecordById).toHaveBeenCalledTimes(1);
    expect(indexedDbMock.getPersonRecordByName).not.toHaveBeenCalled();
    expect(applyUpdate).toHaveBeenCalledTimes(2);
    expect(scrollGenerationLikeBubble).toHaveBeenCalledTimes(1);
    expect(scrollGenerationLikeBubble).toHaveBeenCalledWith(2);
    expect(scrollGenerationIntoVerticalView).toHaveBeenCalledWith(2, {
      alignRowHorizontally: false,
    });
    const firstTree = applyUpdate.mock.calls[0]?.[0]?.tree;
    const secondTree = applyUpdate.mock.calls[1]?.[0]?.tree;

    expect(firstTree?.[1]?.[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        kind: "person",
        name: "Al Pacino",
        record: locallyCachedPacinoRecord,
      }),
      selected: true,
    }));
    expect(firstTree?.[2]?.map((node: { data: CinenerdleCard }) => node.data.name)).toEqual([
      "Scarface",
      "Heat",
    ]);
    expect(secondTree?.[1]?.[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        kind: "person",
        name: "Al Pacino",
        record: hydratedPacinoRecord,
      }),
      selected: true,
    }));
    expect(secondTree?.[2]?.map((node: { data: CinenerdleCard }) => node.data.name)).toEqual([
      "Scarface",
      "Heat",
    ]);
  });

  it("scrolls the finalized existing child row on same-card reselect", async () => {
    const writeHash = vi.fn();
    const controller = renderController({ writeHash });
    const applyUpdate = vi.fn();
    const scrollGenerationIntoVerticalView = vi.fn();
    const scrollGenerationLikeBubble = vi.fn();
    const hydratedHeatRecord = makeFilmRecord({
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({ id: 60, name: "Al Pacino", popularity: 88 }),
        ],
        crew: [],
      },
      personConnectionKeys: ["al pacino"],
      tmdbId: 321,
      id: 321,
    });
    const tree: NonNullable<ReturnType<typeof createGeneratorState<CinenerdleCard, undefined>>["tree"]> = [
      [{ data: makeCinenerdleRootCard(), selected: true }],
      [{ data: makeMovieCard({ key: "movie:321", record: hydratedHeatRecord }), selected: true }],
      [{ data: makePersonCard(), selected: true }],
    ];

    await controller.runEffect(
      {
        type: "load-selected-card",
        isReselection: true,
        removedDescendantRows: true,
        row: 1,
        col: 0,
        tree,
      },
      {
        applyUpdate,
        getState: () => createControllerState(),
        lifecycleId: 1,
        selectionId: 1,
        scrollGenerationIntoVerticalView,
        scrollGenerationLikeBubble,
      },
    );

    await flushAsyncWork();

    expect(applyUpdate).not.toHaveBeenCalled();
    expect(tmdbMock.prepareSelectedMovie).not.toHaveBeenCalled();
    expect(tmdbMock.prepareSelectedPerson).not.toHaveBeenCalled();
    expect(tmdbMock.prefetchTopPopularUnhydratedConnections).toHaveBeenCalledTimes(1);
    expect(tmdbMock.prefetchTopPopularUnhydratedConnections).toHaveBeenCalledWith(
      makeMovieCard({ key: "movie:321", record: hydratedHeatRecord }),
    );
    expect(writeHash).toHaveBeenCalledWith("#cinenerdle|Heat+(1995)|Al+Pacino", "selection");
    expect(scrollGenerationLikeBubble).toHaveBeenCalledTimes(1);
    expect(scrollGenerationLikeBubble).toHaveBeenCalledWith(2);
    expect(scrollGenerationIntoVerticalView).toHaveBeenCalledWith(2, {
      alignRowHorizontally: false,
    });
  });
});

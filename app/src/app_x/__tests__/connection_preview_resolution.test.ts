import { beforeEach, describe, expect, it, vi } from "vitest";

const indexedDbMock = vi.hoisted(() => ({
  batchCinenerdleRecordsUpdatedEvents: vi.fn(async (callback: () => Promise<unknown>) => callback()),
  getFilmRecordById: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordByName: vi.fn(),
}));

const tmdbMock = vi.hoisted(() => ({
  hasMovieFullState: vi.fn((record: { full?: boolean } | null | undefined) => Boolean(record?.full)),
  hasPersonFullState: vi.fn((record: { full?: boolean } | null | undefined) => Boolean(record?.full)),
  prepareConnectionEntityForPreview: vi.fn(async (...args: [{ key: string }]) => {
    void args;
    return null;
  }),
}));

const boostPreviewMock = vi.hoisted(() => ({
  resolveConnectionBoostPreview: vi.fn(),
}));

const matchupPreviewMock = vi.hoisted(() => ({
  resolveConnectionMatchupPreview: vi.fn(),
}));

vi.mock("../generators/cinenerdle2/indexed_db", () => indexedDbMock);
vi.mock("../generators/cinenerdle2/tmdb", () => tmdbMock);
vi.mock("../connection_boost_preview", () => boostPreviewMock);
vi.mock("../connection_matchup_preview", () => matchupPreviewMock);

import { resolveStableConnectionPreviews } from "../connection_preview_resolution";

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeName(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function makeMovieEntity(key: string, name: string) {
  return {
    key,
    kind: "movie" as const,
    name,
    imageUrl: null,
    popularity: 0,
    tooltipText: name,
  };
}

function makePersonEntity(key: string, name: string) {
  return {
    key,
    kind: "person" as const,
    name,
    imageUrl: null,
    popularity: 0,
    tooltipText: name,
  };
}

function expectHydrationCall(
  callIndex: number,
  entity: {
    key: string;
    kind: "movie" | "person";
    name: string;
  },
) {
  expect(tmdbMock.prepareConnectionEntityForPreview).toHaveBeenNthCalledWith(
    callIndex,
    {
      key: entity.key,
      kind: entity.kind,
      name: entity.name,
    },
  );
}

function makeSelectedMovieCard() {
  return {
    key: "movie:selected movie:2000",
    kind: "movie" as const,
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
  };
}

describe("resolveStableConnectionPreviews", () => {
  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    Object.values(tmdbMock).forEach((mock) => mock.mockReset());
    Object.values(boostPreviewMock).forEach((mock) => mock.mockReset());
    Object.values(matchupPreviewMock).forEach((mock) => mock.mockReset());

    const hydratedKeys = new Set<string>();
    indexedDbMock.batchCinenerdleRecordsUpdatedEvents.mockImplementation(
      async (callback: () => Promise<unknown>) => callback(),
    );
    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) => ({
      full: hydratedKeys.has(`movie:${normalizeName(title)}:${year}`),
    }));
    indexedDbMock.getPersonRecordByName.mockImplementation(async (name: string) => ({
      full: hydratedKeys.has(`person:${normalizeName(name)}`),
    }));
    tmdbMock.hasMovieFullState.mockImplementation(
      (record: { full?: boolean } | null | undefined) => Boolean(record?.full),
    );
    tmdbMock.hasPersonFullState.mockImplementation(
      (record: { full?: boolean } | null | undefined) => Boolean(record?.full),
    );
    tmdbMock.prepareConnectionEntityForPreview.mockImplementation(async (target: { key: string }) => {
      hydratedKeys.add(target.key);
      return null;
    });
  });

  it("hydrates all unique entities selected across boost and matchup bubbles", async () => {
    const firstMovie = makeMovieEntity("movie:first preview:2001", "First Preview (2001)");
    const secondPerson = makePersonEntity("person:person beta", "Person Beta");
    const thirdPerson = makePersonEntity("person:person gamma", "Person Gamma");

    boostPreviewMock.resolveConnectionBoostPreview
      .mockResolvedValueOnce({
        distanceTwo: firstMovie,
        sharedConnection: secondPerson,
      })
      .mockResolvedValueOnce({
        distanceTwo: firstMovie,
        sharedConnection: secondPerson,
      });
    matchupPreviewMock.resolveConnectionMatchupPreview
      .mockResolvedValueOnce({
        kind: "versus",
        counterpart: firstMovie,
        spoiler: thirdPerson,
      })
      .mockResolvedValueOnce({
        kind: "versus",
        counterpart: firstMovie,
        spoiler: thirdPerson,
      });

    await resolveStableConnectionPreviews(makeSelectedMovieCard());

    expect(tmdbMock.prepareConnectionEntityForPreview).toHaveBeenCalledTimes(3);
    expectHydrationCall(1, firstMovie);
    expectHydrationCall(2, secondPerson);
    expectHydrationCall(3, thirdPerson);
  });

  it("re-resolves and keeps hydrating until preview selections become stable", async () => {
    const firstMovie = makeMovieEntity("movie:first preview:2001", "First Preview (2001)");
    const secondMovie = makeMovieEntity("movie:second preview:2002", "Second Preview (2002)");

    boostPreviewMock.resolveConnectionBoostPreview.mockResolvedValue(null);
    matchupPreviewMock.resolveConnectionMatchupPreview
      .mockResolvedValueOnce({
        kind: "counterpart-placeholder",
        counterpart: firstMovie,
        placeholderExplanation: "none",
        placeholderLabel: "none",
      })
      .mockResolvedValueOnce({
        kind: "counterpart-placeholder",
        counterpart: secondMovie,
        placeholderExplanation: "none",
        placeholderLabel: "none",
      })
      .mockResolvedValueOnce({
        kind: "counterpart-placeholder",
        counterpart: secondMovie,
        placeholderExplanation: "none",
        placeholderLabel: "none",
      });

    await resolveStableConnectionPreviews(makeSelectedMovieCard());

    expect(tmdbMock.prepareConnectionEntityForPreview).toHaveBeenCalledTimes(2);
    expectHydrationCall(1, firstMovie);
    expectHydrationCall(2, secondMovie);
  });

  it("stops at the hard pass cap and returns the latest resolved previews", async () => {
    const firstMovie = makeMovieEntity("movie:first preview:2001", "First Preview (2001)");
    const secondMovie = makeMovieEntity("movie:second preview:2002", "Second Preview (2002)");
    const thirdMovie = makeMovieEntity("movie:third preview:2003", "Third Preview (2003)");

    boostPreviewMock.resolveConnectionBoostPreview.mockResolvedValue(null);
    matchupPreviewMock.resolveConnectionMatchupPreview
      .mockResolvedValueOnce({
        kind: "counterpart-placeholder",
        counterpart: firstMovie,
        placeholderExplanation: "none",
        placeholderLabel: "none",
      })
      .mockResolvedValueOnce({
        kind: "counterpart-placeholder",
        counterpart: secondMovie,
        placeholderExplanation: "none",
        placeholderLabel: "none",
      })
      .mockResolvedValueOnce({
        kind: "counterpart-placeholder",
        counterpart: thirdMovie,
        placeholderExplanation: "none",
        placeholderLabel: "none",
      });

    const resolution = await resolveStableConnectionPreviews(makeSelectedMovieCard(), {
      maxPasses: 2,
    });

    expect(tmdbMock.prepareConnectionEntityForPreview).toHaveBeenCalledTimes(2);
    expect(resolution.matchupPreview).toEqual({
      kind: "counterpart-placeholder",
      counterpart: thirdMovie,
      placeholderExplanation: "none",
      placeholderLabel: "none",
    });
  });

  it("skips placeholder spoiler hydration and only fetches the counterpart", async () => {
    const counterpartMovie = makeMovieEntity("movie:counterpart:2001", "Counterpart (2001)");

    boostPreviewMock.resolveConnectionBoostPreview.mockResolvedValue(null);
    matchupPreviewMock.resolveConnectionMatchupPreview
      .mockResolvedValueOnce({
        kind: "counterpart-placeholder",
        counterpart: counterpartMovie,
        placeholderExplanation: "none",
        placeholderLabel: "none",
      })
      .mockResolvedValueOnce({
        kind: "counterpart-placeholder",
        counterpart: counterpartMovie,
        placeholderExplanation: "none",
        placeholderLabel: "none",
      });

    await resolveStableConnectionPreviews(makeSelectedMovieCard());

    expect(tmdbMock.prepareConnectionEntityForPreview).toHaveBeenCalledTimes(1);
    expectHydrationCall(1, counterpartMovie);
  });

  it("stops scheduling new hydration work after cancellation between passes", async () => {
    let shouldCancel = false;
    const firstMovie = makeMovieEntity("movie:first preview:2001", "First Preview (2001)");
    const secondMovie = makeMovieEntity("movie:second preview:2002", "Second Preview (2002)");

    boostPreviewMock.resolveConnectionBoostPreview.mockResolvedValue(null);
    matchupPreviewMock.resolveConnectionMatchupPreview
      .mockResolvedValueOnce({
        kind: "counterpart-placeholder",
        counterpart: firstMovie,
        placeholderExplanation: "none",
        placeholderLabel: "none",
      })
      .mockResolvedValueOnce({
        kind: "counterpart-placeholder",
        counterpart: secondMovie,
        placeholderExplanation: "none",
        placeholderLabel: "none",
      });
    tmdbMock.prepareConnectionEntityForPreview.mockImplementationOnce(async (...args: [{ key: string }]) => {
      void args;
      shouldCancel = true;
      return null;
    });

    await resolveStableConnectionPreviews(makeSelectedMovieCard(), {
      shouldCancel: () => shouldCancel,
    });

    expect(tmdbMock.prepareConnectionEntityForPreview).toHaveBeenCalledTimes(1);
    expectHydrationCall(1, firstMovie);
    expect(matchupPreviewMock.resolveConnectionMatchupPreview).toHaveBeenCalledTimes(1);
  });
});

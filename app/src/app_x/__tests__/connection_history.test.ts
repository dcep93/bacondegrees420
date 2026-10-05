import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionEntity } from "../generators/cinenerdle2/connection_graph";
import { getConnectionEdgeKey, createConnectionEntityFromMovieRecord } from "../generators/cinenerdle2/connection_graph";
import { makeFilmRecord } from "../generators/cinenerdle2/__tests__/factories";
import { useConnectionSearchState, type ConnectionSuggestion } from "../connection_search_state";

// Persistent hook harness: render after actions while keeping state/ref slots.
const harness = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as Array<() => void> }));
const search = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.slots)) harness.slots[index] = initial;
    return [harness.slots[index], (next: unknown) => {
      harness.slots[index] = typeof next === "function" ? next(harness.slots[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.slots)) harness.slots[index] = { current: initial };
    return harness.slots[index];
  },
  useCallback: (callback: unknown) => callback,
  useDeferredValue: (value: unknown) => value,
  useEffect: (effect: () => void) => { harness.effects.push(effect); },
}));
vi.mock("../generators/cinenerdle2/connection_graph", async (importOriginal) => ({
  ...await importOriginal<typeof import("../generators/cinenerdle2/connection_graph")>(),
  hydrateConnectionEntityFromKey: vi.fn().mockRejectedValue(new Error("No cached presentation")),
  findConnectionPathBidirectional: search,
}));
vi.mock("../generators/cinenerdle2/indexed_db", async (importOriginal) => ({
  ...await importOriginal<typeof import("../generators/cinenerdle2/indexed_db")>(),
  getFilmRecordByTitleAndYear: vi.fn().mockResolvedValue(null),
}));
vi.mock("../generators/cinenerdle2/tmdb", async (importOriginal) => ({
  ...await importOriginal<typeof import("../generators/cinenerdle2/tmdb")>(),
  prepareSelectedMovie: vi.fn().mockResolvedValue(null),
}));
vi.mock("../connection_path_ranks", () => ({
  annotateDirectionalConnectionPathRanks: (path: ConnectionEntity[]) => path,
}));

function renderSearch(preserveConnectionSessionHistory = true) {
  harness.index = 0;
  harness.effects = [];
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Hooks run through the persistent test harness above.
  return useConnectionSearchState({
    hashValue: "#film|Fast+Break+(1979)", isSearchablePersistencePending: false,
    onSelectConnectedSuggestionAsYoungest: vi.fn(), preserveConnectionSessionHistory,
    selectConnectedSuggestionsAsYoungest: false, youngestSelectedCard: null,
  });
}
function suggestion(title: string): ConnectionSuggestion {
  return {
    ...createConnectionEntityFromMovieRecord(makeFilmRecord({ title })),
    kind: "movie", popularity: 10, sortScore: 10,
    isConnectedToYoungestSelection: false, connectionOrderToYoungestSelection: null,
  };
}

beforeEach(() => {
  harness.slots = [];
  search.mockReset().mockImplementation(async (left: ConnectionEntity, right: ConnectionEntity) => ({
    status: "found", path: [left, right], elapsedMs: 1,
  }));
});

describe("retained guess arrows", () => {
  it("clears retained sessions on reset and ignores an earlier in-flight resolution", async () => {
    let finishSearch: ((result: { status: "found"; path: ConnectionEntity[]; elapsedMs: number }) => void) | undefined;
    search.mockImplementation(() => new Promise((resolve) => { finishSearch = resolve; }));
    const state = renderSearch();
    const click = { preventDefault: vi.fn() } as unknown as Parameters<typeof state.handleConnectionSuggestionClick>[0];
    state.handleConnectionSuggestionClick(click, suggestion("Heat"));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    const pending = renderSearch().connectionSessions[0];
    renderSearch(false);
    // The location/mode effect clears the active and retained sessions on normal-app reset.
    harness.effects[0]();
    expect(renderSearch().connectionSessions).toEqual([]);
    finishSearch!({ status: "found", path: [pending.left, pending.right], elapsedMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renderSearch().connectionSessions).toEqual([]);
    expect(renderSearch().connectionSession).toBeNull();
  });

  it("adds, finishes, and removes an older guess alternative while preserving the latest guess", async () => {
    let state = renderSearch();
    const click = { preventDefault: vi.fn() } as unknown as Parameters<typeof state.handleConnectionSuggestionClick>[0];
    state.handleConnectionSuggestionClick(click, suggestion("Heat"));
    await vi.waitFor(() => expect(renderSearch().connectionSession?.rows[0].status).toBe("found"));
    state = renderSearch();
    state.handleConnectionSuggestionClick(click, suggestion("The Matrix"));
    await vi.waitFor(() => {
      state = renderSearch();
      expect(state.connectionSessions).toHaveLength(2);
      expect(state.connectionSession?.rows[0].status).toBe("found");
    });
    const [older, latest] = state.connectionSessions;
    const parent = older.rows[0];
    const edgeKey = getConnectionEdgeKey(parent.path[0].key, parent.path[1].key);
    state.spawnAlternativeConnectionRow(parent.id, { kind: "edge", edgeKey });
    state = renderSearch();
    expect(state.connectionSessions[0].rows).toHaveLength(2);
    expect(state.connectionSessions[0].rows[0].childDisallowedEdgeKeys).toContain(edgeKey);
    expect(state.connectionSession?.id).toBe(latest.id);
    await vi.waitFor(() => expect(renderSearch().connectionSessions[0].rows[1].status).toBe("found"));
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Heat" }),
      expect.objectContaining({ name: "Fast Break" }), expect.objectContaining({ excludedEdgeKeys: new Set([edgeKey]) }));
    state = renderSearch();
    state.spawnAlternativeConnectionRow(parent.id, { kind: "edge", edgeKey });
    state = renderSearch();
    expect(state.connectionSessions[0].rows).toHaveLength(1);
    expect(state.connectionSessions[0].rows[0].childDisallowedEdgeKeys).toEqual([]);
    expect(state.connectionSessions[1]).toEqual(latest);
    expect(state.connectionSession?.id).toBe(latest.id);
  });
});

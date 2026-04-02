import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clickConnectionSuggestion,
  selectConnectionSuggestion,
  selectHighlightedConnectionSuggestion,
  type ConnectionSuggestion,
} from "../connection_search_state";
import { createFallbackConnectionEntity } from "../generators/cinenerdle2/connection_graph";

function makeConnectionSuggestion(
  overrides: Partial<ConnectionSuggestion> = {},
): ConnectionSuggestion {
  return {
    key: "movie:heat:1995",
    kind: "movie",
    name: "Heat",
    year: "1995",
    tmdbId: 10,
    label: "Heat (1995)",
    connectionCount: 12,
    hasCachedTmdbSource: true,
    imageUrl: null,
    connectionParentLabel: null,
    popularity: 62.46,
    connectionRank: null,
    isConnectedToYoungestSelection: false,
    connectionOrderToYoungestSelection: null,
    sortScore: 10,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("connection dropdown suggestion selection", () => {
  it("routes highlighted disconnected suggestions into the connection search flow without alerting", async () => {
    const alertMock = vi.fn();
    vi.stubGlobal("window", { alert: alertMock });
    const clearConnectionInputState = vi.fn();
    const onSelectConnectedSuggestionAsYoungest = vi.fn();
    const openConnectionRowsForEntity = vi.fn().mockResolvedValue(undefined);
    const suggestion = makeConnectionSuggestion({
      isConnectedToYoungestSelection: false,
      key: "person:al-pacino",
      kind: "person",
      label: "Al Pacino",
      name: "Al Pacino",
      tmdbId: null,
      year: "",
    });

    const handled = await selectHighlightedConnectionSuggestion({
      connectionSuggestions: [suggestion],
      onSelectSuggestion: (nextSuggestion) =>
        selectConnectionSuggestion({
          clearConnectionInputState,
          onSelectConnectedSuggestionAsYoungest,
          openConnectionRowsForEntity,
          suggestion: nextSuggestion,
        }),
      selectedSuggestionIndex: 0,
    });

    expect(handled).toBe(true);
    expect(openConnectionRowsForEntity).toHaveBeenCalledTimes(1);
    expect(openConnectionRowsForEntity).toHaveBeenCalledWith(
      createFallbackConnectionEntity(suggestion),
    );
    expect(clearConnectionInputState).not.toHaveBeenCalled();
    expect(onSelectConnectedSuggestionAsYoungest).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("routes clicked disconnected suggestions into the connection search flow without alerting", async () => {
    const alertMock = vi.fn();
    vi.stubGlobal("window", { alert: alertMock });
    const clearConnectionInputState = vi.fn();
    const onSelectConnectedSuggestionAsYoungest = vi.fn();
    const openConnectionRowsForEntity = vi.fn().mockResolvedValue(undefined);
    const preventDefault = vi.fn();
    const suggestion = makeConnectionSuggestion({
      isConnectedToYoungestSelection: false,
      key: "movie:insomnia:2002",
      label: "Insomnia (2002)",
      name: "Insomnia",
      year: "2002",
    });

    await clickConnectionSuggestion({
      event: { preventDefault },
      onSelectSuggestion: (nextSuggestion) =>
        selectConnectionSuggestion({
          clearConnectionInputState,
          onSelectConnectedSuggestionAsYoungest,
          openConnectionRowsForEntity,
          suggestion: nextSuggestion,
        }),
      suggestion,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(openConnectionRowsForEntity).toHaveBeenCalledTimes(1);
    expect(openConnectionRowsForEntity).toHaveBeenCalledWith(
      createFallbackConnectionEntity(suggestion),
    );
    expect(clearConnectionInputState).not.toHaveBeenCalled();
    expect(onSelectConnectedSuggestionAsYoungest).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("keeps connected suggestions on the youngest-selection path", async () => {
    const clearConnectionInputState = vi.fn();
    const onSelectConnectedSuggestionAsYoungest = vi.fn();
    const openConnectionRowsForEntity = vi.fn().mockResolvedValue(undefined);
    const suggestion = makeConnectionSuggestion({
      connectionOrderToYoungestSelection: 1,
      isConnectedToYoungestSelection: true,
      key: "person:robert-de-niro",
      kind: "person",
      label: "Robert De Niro",
      name: "Robert De Niro",
      tmdbId: null,
      year: "",
    });

    await selectConnectionSuggestion({
      clearConnectionInputState,
      onSelectConnectedSuggestionAsYoungest,
      openConnectionRowsForEntity,
      suggestion,
    });

    expect(clearConnectionInputState).toHaveBeenCalledTimes(1);
    expect(onSelectConnectedSuggestionAsYoungest).toHaveBeenCalledTimes(1);
    expect(onSelectConnectedSuggestionAsYoungest).toHaveBeenCalledWith(suggestion);
    expect(openConnectionRowsForEntity).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchableConnectionEntityRecord } from "../generators/cinenerdle2/types";

const indexedDbMock = vi.hoisted(() => ({
  getAllSearchableConnectionEntities: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getFilmRecordsByPersonConnectionKey: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordByName: vi.fn(),
  getPersonRecordsByMovieKey: vi.fn(),
}));

const connectionGraphMock = vi.hoisted(() => ({
  createFallbackConnectionEntity: vi.fn(),
  findConnectionPathBidirectional: vi.fn(),
  hydrateConnectionEntityFromKey: vi.fn(),
  hydrateConnectionEntityFromSearchRecord: vi.fn(),
  isConnectionEntityAllowedInGraph: vi.fn(),
}));

vi.mock("../generators/cinenerdle2/indexed_db", () => indexedDbMock);
vi.mock("../generators/cinenerdle2/connection_graph", () => connectionGraphMock);

import { buildConnectionSuggestions } from "../connection_search_state";

describe("buildConnectionSuggestions", () => {
  beforeEach(() => {
    Object.values(indexedDbMock).forEach((mock) => mock.mockReset());
    Object.values(connectionGraphMock).forEach((mock) => mock.mockReset());
    connectionGraphMock.createFallbackConnectionEntity.mockImplementation((entity: unknown) => entity);
  });

  it("hides graph-ineligible direct neighbors from connection suggestions", async () => {
    const searchableRecords: SearchableConnectionEntityRecord[] = [
      {
        key: "movie:overnight:2003",
        type: "movie",
        nameLower: "overnight (2003)",
        popularity: 90,
      },
      {
        key: "movie:spider-man:2002",
        type: "movie",
        nameLower: "spider-man (2002)",
        popularity: 80,
      },
    ];

    indexedDbMock.getAllSearchableConnectionEntities.mockResolvedValue(searchableRecords);
    connectionGraphMock.hydrateConnectionEntityFromSearchRecord.mockImplementation(
      async (record: SearchableConnectionEntityRecord) =>
        record.key === "movie:overnight:2003"
          ? {
              key: "movie:overnight:2003",
              kind: "movie",
              name: "Overnight",
              year: "2003",
              tmdbId: 27007,
              label: "Overnight (2003)",
              connectionCount: 1,
              hasCachedTmdbSource: true,
              imageUrl: null,
            }
          : {
              key: "movie:spider-man:2002",
              kind: "movie",
              name: "Spider-Man",
              year: "2002",
              tmdbId: 557,
              label: "Spider-Man (2002)",
              connectionCount: 1,
              hasCachedTmdbSource: true,
              imageUrl: null,
            },
    );
    connectionGraphMock.isConnectionEntityAllowedInGraph.mockImplementation(
      async (entity: { key: string }) => entity.key !== "movie:overnight:2003",
    );

    const suggestions = await buildConnectionSuggestions({
      query: "200",
      isStale: () => false,
      youngestSelectedConnectionOrders: {
        "movie:overnight:2003": 1,
        "movie:spider-man:2002": 2,
      },
    });

    expect(suggestions).toEqual([
      expect.objectContaining({
        key: "movie:spider-man:2002",
        isConnectedToYoungestSelection: true,
        connectionOrderToYoungestSelection: 2,
      }),
    ]);
    expect(suggestions.map((suggestion) => suggestion.key)).not.toContain("movie:overnight:2003");
    expect(connectionGraphMock.isConnectionEntityAllowedInGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "movie:overnight:2003",
      }),
    );
  });
});

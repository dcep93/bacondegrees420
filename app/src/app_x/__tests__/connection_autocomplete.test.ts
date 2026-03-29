import { describe, expect, it } from "vitest";
import {
  compareRankedConnectionSuggestions,
  compareRankedSearchableConnectionEntityRecords,
  type RankedConnectionSuggestion,
  type RankedSearchableConnectionEntityRecord,
} from "../connection_autocomplete";
import type { SearchableConnectionEntityRecord } from "../generators/cinenerdle2/types";

function makeSearchRecord(
  overrides: Partial<SearchableConnectionEntityRecord> & Pick<SearchableConnectionEntityRecord, "key">,
): SearchableConnectionEntityRecord {
  return {
    key: overrides.key,
    type: overrides.type ?? "movie",
    nameLower: overrides.nameLower ?? overrides.key,
    popularity: overrides.popularity ?? 0,
  };
}

function makeRankedSearchRecord(
  overrides: Partial<RankedSearchableConnectionEntityRecord> & {
    record: SearchableConnectionEntityRecord;
  },
): RankedSearchableConnectionEntityRecord {
  return {
    record: overrides.record,
    sortScore: overrides.sortScore ?? 0,
    isConnectedToYoungestSelection: overrides.isConnectedToYoungestSelection ?? false,
  };
}

function makeSuggestion(
  overrides: Partial<RankedConnectionSuggestion> & Pick<RankedConnectionSuggestion, "key">,
): RankedConnectionSuggestion {
  return {
    key: overrides.key,
    kind: overrides.kind ?? "movie",
    label: overrides.label ?? overrides.key,
    popularity: overrides.popularity ?? 0,
    sortScore: overrides.sortScore ?? 0,
    isConnectedToYoungestSelection: overrides.isConnectedToYoungestSelection ?? false,
  };
}

describe("connection autocomplete ranking", () => {
  it("ranks direct connections ahead of more popular unrelated suggestions", () => {
    const suggestions = [
      makeSuggestion({
        key: "movie:popular",
        label: "Popular Movie",
        popularity: 99,
        sortScore: 300,
        isConnectedToYoungestSelection: false,
      }),
      makeSuggestion({
        key: "person:connected",
        kind: "person",
        label: "Connected Person",
        popularity: 10,
        sortScore: 200,
        isConnectedToYoungestSelection: true,
      }),
    ];

    expect([...suggestions].sort(compareRankedConnectionSuggestions).map((item) => item.key)).toEqual([
      "person:connected",
      "movie:popular",
    ]);
  });

  it("keeps directly connected raw candidates inside the pre-hydration cap", () => {
    const disconnectedCandidates = Array.from({ length: 26 }, (_, index) =>
      makeRankedSearchRecord({
        record: makeSearchRecord({
          key: `movie:disconnected-${index}`,
          nameLower: `disconnected ${index}`,
          popularity: 100 - index,
        }),
        sortScore: 100,
        isConnectedToYoungestSelection: false,
      }));
    const connectedCandidate = makeRankedSearchRecord({
      record: makeSearchRecord({
        key: "person:connected",
        type: "person",
        nameLower: "connected person",
        popularity: 1,
      }),
      sortScore: 100,
      isConnectedToYoungestSelection: true,
    });

    const rankedKeys = [...disconnectedCandidates, connectedCandidate]
      .sort(compareRankedSearchableConnectionEntityRecords)
      .slice(0, 24)
      .map((item) => item.record.key);

    expect(rankedKeys).toContain("person:connected");
    expect(rankedKeys[0]).toBe("person:connected");
  });

  it("keeps connected suggestions ordered by popularity, then score, then kind, then label", () => {
    const suggestions = [
      makeSuggestion({
        key: "movie:alphabetical-last",
        kind: "movie",
        label: "Zulu",
        popularity: 50,
        sortScore: 200,
        isConnectedToYoungestSelection: true,
      }),
      makeSuggestion({
        key: "person:alphabetical-first",
        kind: "person",
        label: "Alpha",
        popularity: 50,
        sortScore: 200,
        isConnectedToYoungestSelection: true,
      }),
      makeSuggestion({
        key: "movie:high-score",
        kind: "movie",
        label: "Bravo",
        popularity: 50,
        sortScore: 300,
        isConnectedToYoungestSelection: true,
      }),
      makeSuggestion({
        key: "movie:high-popularity",
        kind: "movie",
        label: "Charlie",
        popularity: 70,
        sortScore: 100,
        isConnectedToYoungestSelection: true,
      }),
    ];

    expect([...suggestions].sort(compareRankedConnectionSuggestions).map((item) => item.key)).toEqual([
      "movie:high-popularity",
      "movie:high-score",
      "person:alphabetical-first",
      "movie:alphabetical-last",
    ]);
  });

  it("falls back to the previous ordering when no suggestions are directly connected", () => {
    const suggestions = [
      makeSuggestion({
        key: "movie:low-popularity",
        kind: "movie",
        label: "Zulu",
        popularity: 20,
        sortScore: 400,
      }),
      makeSuggestion({
        key: "movie:high-popularity",
        kind: "movie",
        label: "Alpha",
        popularity: 90,
        sortScore: 100,
      }),
      makeSuggestion({
        key: "person:tiebreak-person",
        kind: "person",
        label: "Bravo",
        popularity: 50,
        sortScore: 200,
      }),
      makeSuggestion({
        key: "movie:tiebreak-movie",
        kind: "movie",
        label: "Charlie",
        popularity: 50,
        sortScore: 200,
      }),
    ];

    expect([...suggestions].sort(compareRankedConnectionSuggestions).map((item) => item.key)).toEqual([
      "movie:high-popularity",
      "person:tiebreak-person",
      "movie:tiebreak-movie",
      "movie:low-popularity",
    ]);
  });
});

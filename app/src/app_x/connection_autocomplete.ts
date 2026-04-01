import type { SearchableConnectionEntityRecord } from "./generators/cinenerdle2/types";
import { normalizeWhitespace } from "./generators/cinenerdle2/utils";

export type RankedSearchableConnectionEntityRecord = {
  record: SearchableConnectionEntityRecord;
  sortScore: number;
  isConnectedToYoungestSelection: boolean;
};

export type RankedConnectionSuggestion = {
  key: string;
  kind: "person" | "movie";
  label: string;
  popularity: number;
  sortScore: number;
  isConnectedToYoungestSelection: boolean;
};

type RankedConnectionLike = {
  isConnectedToYoungestSelection: boolean;
  popularity: number;
  sortScore: number;
  kind: "person" | "movie";
  label: string;
};

function compareConnectionPriority(
  leftIsConnected: boolean,
  rightIsConnected: boolean,
): number {
  if (leftIsConnected !== rightIsConnected) {
    return Number(rightIsConnected) - Number(leftIsConnected);
  }

  return 0;
}

function comparePopularity(leftPopularity: number, rightPopularity: number): number {
  return rightPopularity - leftPopularity;
}

function compareSortScore(leftSortScore: number, rightSortScore: number): number {
  return rightSortScore - leftSortScore;
}

function compareKind(leftKind: "person" | "movie", rightKind: "person" | "movie"): number {
  if (leftKind !== rightKind) {
    return leftKind === "person" ? -1 : 1;
  }

  return 0;
}

function compareRankedConnectionLike(
  left: RankedConnectionLike,
  right: RankedConnectionLike,
): number {
  const connectionPriority = compareConnectionPriority(
    left.isConnectedToYoungestSelection,
    right.isConnectedToYoungestSelection,
  );
  if (connectionPriority !== 0) {
    return connectionPriority;
  }

  const popularityDifference = comparePopularity(left.popularity, right.popularity);
  if (popularityDifference !== 0) {
    return popularityDifference;
  }

  const sortScoreDifference = compareSortScore(left.sortScore, right.sortScore);
  if (sortScoreDifference !== 0) {
    return sortScoreDifference;
  }

  const kindDifference = compareKind(left.kind, right.kind);
  if (kindDifference !== 0) {
    return kindDifference;
  }

  return left.label.localeCompare(right.label);
}

export function compareRankedSearchableConnectionEntityRecords(
  left: RankedSearchableConnectionEntityRecord,
  right: RankedSearchableConnectionEntityRecord,
): number {
  return compareRankedConnectionLike(
    {
      isConnectedToYoungestSelection: left.isConnectedToYoungestSelection,
      popularity: left.record.popularity ?? 0,
      sortScore: left.sortScore,
      kind: left.record.type,
      label: left.record.nameLower,
    },
    {
      isConnectedToYoungestSelection: right.isConnectedToYoungestSelection,
      popularity: right.record.popularity ?? 0,
      sortScore: right.sortScore,
      kind: right.record.type,
      label: right.record.nameLower,
    },
  );
}

export function compareRankedConnectionSuggestions(
  left: RankedConnectionSuggestion,
  right: RankedConnectionSuggestion,
): number {
  return compareRankedConnectionLike(left, right);
}

function stripSearchDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getDirectSuggestionScore(normalizedQuery: string, normalizedLabel: string): number {
  if (!normalizedQuery || !normalizedLabel.includes(normalizedQuery)) {
    return -1;
  }

  if (normalizedLabel === normalizedQuery) {
    return 400;
  }

  if (normalizedLabel.startsWith(normalizedQuery)) {
    return 300;
  }

  if (normalizedLabel.split(/\s+/).some((word) => word.startsWith(normalizedQuery))) {
    return 200;
  }

  return 100;
}

export function getConnectionSuggestionScore(query: string, label: string): number {
  const normalizedQuery = normalizeWhitespace(query).toLocaleLowerCase();
  const normalizedLabel = normalizeWhitespace(label).toLocaleLowerCase();
  const directScore = getDirectSuggestionScore(normalizedQuery, normalizedLabel);

  if (directScore >= 0) {
    return directScore;
  }

  const foldedQuery = stripSearchDiacritics(normalizedQuery);
  if (foldedQuery !== normalizedQuery) {
    return -1;
  }

  return getDirectSuggestionScore(
    foldedQuery,
    stripSearchDiacritics(normalizedLabel),
  );
}

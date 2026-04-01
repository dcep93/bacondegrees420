import { createMovieRootCard, createPersonRootCard } from "./cards";
import { TMDB_ICON_URL } from "./constants";
import { isExcludedFilmRecord, isExcludedPersonRecord } from "./exclusion";
import { getResolvedPersonMovieConnectionKeys } from "./records";
import { hasDirectTmdbMovieSource, hasDirectTmdbPersonSource } from "./tmdb_provenance";
import type { FilmRecord, PersonRecord } from "./types";
import {
  getFilmKey,
  getMovieKeyFromCredit,
  getValidTmdbEntityId,
  normalizeName,
  normalizeTitle,
} from "./utils";
import type { CinenerdleCard, CinenerdleCardViewModel } from "./view_types";
import type { GeneratorTree } from "../../types/generator";

function hasCachedTmdbSource(card: CinenerdleCard) {
  if (card.kind === "movie") {
    return hasDirectTmdbMovieSource(card.record);
  }

  if (card.kind === "person") {
    return hasDirectTmdbPersonSource(card.record);
  }

  return false;
}

function isExcludedCard(card: CinenerdleCard): boolean {
  if (card.kind === "movie") {
    return isExcludedFilmRecord(card.record);
  }

  if (card.kind === "person") {
    return isExcludedPersonRecord(card.record);
  }

  return false;
}

export function getSelectedAncestorCards(
  tree: GeneratorTree<CinenerdleCard>,
  row: number,
): CinenerdleCard[] {
  return tree
    .slice(0, row)
    .map((ancestorRow) => ancestorRow.find((node) => node.selected)?.data ?? null)
    .filter((card): card is CinenerdleCard => card !== null);
}

export function cardsMatch(left: CinenerdleCard, right: CinenerdleCard) {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "cinenerdle" && right.kind === "cinenerdle") {
    return true;
  }

  if (left.kind === "movie" && right.kind === "movie") {
    const leftTmdbId = getValidTmdbEntityId(left.record?.tmdbId ?? left.record?.id);
    const rightTmdbId = getValidTmdbEntityId(right.record?.tmdbId ?? right.record?.id);
    if (leftTmdbId !== null && rightTmdbId !== null) {
      return leftTmdbId === rightTmdbId;
    }

    return (
      normalizeTitle(left.name) === normalizeTitle(right.name) &&
      left.year === right.year
    );
  }

  if (left.kind === "person" && right.kind === "person") {
    const leftTmdbId = getValidTmdbEntityId(left.record?.tmdbId ?? left.record?.id);
    const rightTmdbId = getValidTmdbEntityId(right.record?.tmdbId ?? right.record?.id);
    if (leftTmdbId !== null && rightTmdbId !== null) {
      return leftTmdbId === rightTmdbId;
    }

    return normalizeName(left.name) === normalizeName(right.name);
  }

  return false;
}

function getNearestSelectedPersonAncestor(
  ancestorCards: CinenerdleCard[],
): Extract<CinenerdleCard, { kind: "person" }> | null {
  for (let index = ancestorCards.length - 1; index >= 0; index -= 1) {
    const ancestorCard = ancestorCards[index];
    if (ancestorCard?.kind === "person") {
      return ancestorCard;
    }
  }

  return null;
}

function getNearestSelectedMovieAncestor(
  ancestorCards: CinenerdleCard[],
): Extract<CinenerdleCard, { kind: "movie" }> | null {
  for (let index = ancestorCards.length - 1; index >= 0; index -= 1) {
    const ancestorCard = ancestorCards[index];
    if (ancestorCard?.kind === "movie") {
      return ancestorCard;
    }
  }

  return null;
}

function isTmdbSourceLabel(label: string) {
  return label.trim().toLowerCase() === "tmdb";
}

function formatPopularityFetchedAt(fetchTimestamp: string | null | undefined): string | null {
  if (!fetchTimestamp) {
    return null;
  }

  const fetchTimestampDate = new Date(fetchTimestamp);
  if (Number.isNaN(fetchTimestampDate.valueOf())) {
    return null;
  }

  return fetchTimestampDate.toLocaleString();
}

function getCardPopularityTimestamp(
  card: Extract<CinenerdleCard, { kind: "movie" | "person" }>,
  ancestorCards: CinenerdleCard[],
): string | null {
  if (
    (card.kind === "movie" && hasDirectTmdbMovieSource(card.record) && card.record?.fetchTimestamp) ||
    (card.kind === "person" && hasDirectTmdbPersonSource(card.record) && card.record?.fetchTimestamp)
  ) {
    return card.record.fetchTimestamp;
  }

  if (card.kind === "movie") {
    const ancestorRecord = getNearestSelectedPersonAncestor(ancestorCards)?.record;
    return hasDirectTmdbPersonSource(ancestorRecord) ? ancestorRecord?.fetchTimestamp ?? null : null;
  }

  const ancestorRecord = getNearestSelectedMovieAncestor(ancestorCards)?.record;
  return hasDirectTmdbMovieSource(ancestorRecord) ? ancestorRecord?.fetchTimestamp ?? null : null;
}

export function getCardTmdbRowTooltipText(
  card: Extract<CinenerdleCard, { kind: "movie" | "person" }>,
  ancestorCards: CinenerdleCard[],
): string {
  const formattedFetchedAt = formatPopularityFetchedAt(
    getCardPopularityTimestamp(card, ancestorCards),
  );

  return formattedFetchedAt
    ? `TMDb data fetched ${formattedFetchedAt}.\nClick to refetch.`
    : "Not fetched from TMDb yet.\nClick to fetch.";
}

function getRenderableSources(card: CinenerdleCard) {
  if (card.kind === "break") {
    return [];
  }

  return (card.sources ?? []).filter(
    (source) => source.iconUrl === TMDB_ICON_URL || isTmdbSourceLabel(source.label),
  );
}

function getOrdinalRank<T>(
  items: T[],
  isTarget: (item: T) => boolean,
  compare: (left: T, right: T) => number,
): number | null {
  const rankIndex = [...items].sort(compare).findIndex(isTarget);
  return rankIndex >= 0 ? rankIndex + 1 : null;
}

export function getParentPersonRankForMovie(
  movieRecord: FilmRecord | null,
  parentPersonRecord: PersonRecord | null,
  popularityByPersonName: Map<string, number>,
): number | null {
  if (!movieRecord || !parentPersonRecord) {
    return null;
  }

  const parentPersonName = normalizeName(parentPersonRecord.name);
  const linkedPersonNames = Array.from(
    new Set(movieRecord.personConnectionKeys.map(normalizeName).filter(Boolean)),
  );
  if (!parentPersonName || !linkedPersonNames.includes(parentPersonName)) {
    return null;
  }

  popularityByPersonName.set(
    parentPersonName,
    Math.max(
      popularityByPersonName.get(parentPersonName) ?? 0,
      parentPersonRecord.rawTmdbPerson?.popularity ?? 0,
    ),
  );

  return getOrdinalRank(
    linkedPersonNames,
    (personName) => personName === parentPersonName,
    (left, right) => {
      const popularityDifference =
        (popularityByPersonName.get(right) ?? 0) - (popularityByPersonName.get(left) ?? 0);
      if (popularityDifference !== 0) {
        return popularityDifference;
      }

      return left.localeCompare(right);
    },
  );
}

export function getParentMovieRankForPerson(
  parentMovieRecord: FilmRecord | null,
  personRecord: PersonRecord | null,
  popularityByMovieKey: Map<string, number>,
): number | null {
  if (!parentMovieRecord || !personRecord) {
    return null;
  }

  const parentMovieKey = getFilmKey(parentMovieRecord.title, parentMovieRecord.year);
  const linkedMovieKeys = getResolvedPersonMovieConnectionKeys(personRecord);
  if (!linkedMovieKeys.includes(parentMovieKey)) {
    return null;
  }

  popularityByMovieKey.set(
    parentMovieKey,
    Math.max(popularityByMovieKey.get(parentMovieKey) ?? 0, parentMovieRecord.popularity ?? 0),
  );

  return getOrdinalRank(
    linkedMovieKeys,
    (movieKey) => movieKey === parentMovieKey,
    (left, right) => {
      const popularityDifference =
        (popularityByMovieKey.get(right) ?? 0) - (popularityByMovieKey.get(left) ?? 0);
      if (popularityDifference !== 0) {
        return popularityDifference;
      }

      return left.localeCompare(right);
    },
  );
}

export function getResolvedMovieConnectionCount(
  credit: { title?: string; release_date?: string },
  movieRecord: FilmRecord | null,
  connectionCounts: Map<string, number>,
) {
  return Math.max(
    movieRecord?.personConnectionKeys.length ?? 0,
    connectionCounts.get(getMovieKeyFromCredit(credit)) ?? 0,
    1,
  );
}

export function getResolvedPersonConnectionCount(
  personName: string,
  personRecord: PersonRecord | null,
  connectionCounts: Map<string, number>,
) {
  return Math.max(
    personRecord?.movieConnectionKeys.length ?? 0,
    connectionCounts.get(normalizeName(personName)) ?? 0,
    1,
  );
}

export function replaceSelectedCardInLastRow(
  tree: GeneratorTree<CinenerdleCard>,
  nextSelectedCard: CinenerdleCard,
): GeneratorTree<CinenerdleCard> {
  const lastRow = tree[tree.length - 1];
  if (!lastRow) {
    return tree;
  }

  return [
    ...tree.slice(0, -1),
    lastRow.map((node) =>
      node.selected
        ? {
            ...node,
            data: nextSelectedCard,
          }
        : node,
    ),
  ];
}

export function refreshSelectedMovieCard(
  card: Extract<CinenerdleCard, { kind: "movie" }>,
  movieRecord: FilmRecord,
): Extract<CinenerdleCard, { kind: "movie" }> {
  const rootCard = createMovieRootCard(movieRecord, card.name);

  return {
    ...card,
    name: rootCard.name,
    year: rootCard.year,
    popularity: rootCard.popularity,
    popularitySource: rootCard.popularitySource,
    imageUrl: rootCard.imageUrl,
    connectionCount: rootCard.connectionCount,
    voteAverage: rootCard.voteAverage,
    voteCount: rootCard.voteCount,
    sources: rootCard.sources,
    record: movieRecord,
  };
}

export function refreshSelectedPersonCard(
  card: Extract<CinenerdleCard, { kind: "person" }>,
  personRecord: PersonRecord,
): Extract<CinenerdleCard, { kind: "person" }> {
  const rootCard = createPersonRootCard(personRecord, card.name);

  return {
    ...card,
    name: rootCard.name,
    popularity: rootCard.popularity,
    popularitySource: rootCard.popularitySource,
    imageUrl: rootCard.imageUrl,
    connectionCount: rootCard.connectionCount,
    sources: rootCard.sources,
    record: personRecord,
  };
}

export function createCardViewModel(
  card: CinenerdleCard,
  options: {
    isSelected: boolean;
    isLocked?: boolean;
    isAncestorSelected?: boolean;
  },
): CinenerdleCardViewModel {
  const sharedFields = {
    key: card.key,
    kind: card.kind,
    name: card.name,
    imageUrl: card.imageUrl,
    subtitle: card.subtitle,
    subtitleDetail: card.subtitleDetail,
    creditLines: card.creditLines ?? null,
    popularity: card.popularity,
    popularitySource: card.popularitySource,
    connectionCount: card.connectionCount,
    connectionRank: card.connectionRank ?? null,
    connectionOrder: card.connectionOrder ?? null,
    connectionParentLabel: card.connectionParentLabel ?? null,
    sources: getRenderableSources(card),
    status: card.status,
    isSelected: options.isSelected,
    isLocked: options.isLocked ?? false,
    isAncestorSelected: options.isAncestorSelected ?? false,
    hasCachedTmdbSource: hasCachedTmdbSource(card),
    isExcluded: isExcludedCard(card),
  };

  if (card.kind === "dbinfo") {
    return {
      ...sharedFields,
      kind: "dbinfo",
      body: card.body,
      recordKind: card.recordKind,
      summaryItems: card.summaryItems,
    };
  }

  if (card.kind === "movie") {
    return {
      ...sharedFields,
      kind: "movie",
      voteAverage: card.voteAverage,
      voteCount: card.voteCount,
    };
  }

  if (card.kind === "break") {
    return {
      ...sharedFields,
      kind: "break",
    };
  }

  return {
    ...sharedFields,
    kind: card.kind,
  };
}

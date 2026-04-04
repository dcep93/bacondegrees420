import { useCallback, useLayoutEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { didRequestNewTabNavigation } from "../../index_helpers";
import { measureAsync } from "../../perf";
import { createGeneratorState, reduceGeneratorLifecycleEvent } from "../generator_runtime";
import type {
  GeneratorController,
  GeneratorLifecycleEvent,
  GeneratorLifecycleEffect,
  GeneratorNode,
  GeneratorState,
  GeneratorTransition,
  GeneratorTree,
} from "../../types/generator";
import {
  createCinenerdleOnlyPersonCard,
  createCinenerdleRootCard,
  createDailyStarterMovieCard,
  createMovieAssociationCard,
  createMovieRootCard,
  createPersonAssociationCard,
  createPersonRootCard,
} from "./cards";
import { TMDB_ICON_URL } from "./constants";
import {
  buildPathNodesFromSegments,
  createPathNode,
  parseHashSegments,
  serializePathNodes,
} from "./hash";
import {
  getCinenerdleStarterFilmRecords,
  getFilmRecordById,
  getFilmRecordByTitleAndYear,
  getFilmRecordCountsByPersonConnectionKeys,
  getFilmRecordsByIds,
  getMoviePopularityByLabels,
  getPersonRecordById,
  getPersonRecordByName,
  getPersonRecordCountsByMovieKeys,
  getPersonPopularityByNames,
} from "./indexed_db";
import {
  createEmptyItemAttrs,
  readCinenerdleItemAttrs,
  type CinenerdleItemAttrs,
} from "./item_attrs";
import { enrichCinenerdleTreeWithItemAttrs } from "./card_item_attrs";
import { addCinenerdleDebugLog } from "./debug_log";
import { pickBestPersonRecord } from "./records";
import { renderBreakCard, renderDbInfoCard, renderLoggedCinenerdleCard } from "./render_card";
import { readCinenerdleDailyStarterTitles } from "./starter_storage";
import {
  fetchCinenerdleDailyStarterMovies,
  hydrateHashPath,
  hydrateCinenerdleDailyStarterMovies,
  prefetchTopPopularUnhydratedConnections,
  prepareSelectedMovie,
  prepareSelectedPerson,
  setTmdbLogGeneration,
} from "./tmdb";
import type { FilmRecord, PersonRecord } from "./types";
import {
  getAssociatedPeopleFromMovieCredits,
  formatFallbackPersonDisplayName,
  formatMoviePathLabel,
  getAssociatedMovieCreditGroupsFromPersonCredits,
  getAssociatedPersonCreditGroupsFromMovieCredits,
  getFilmKey,
  getMovieKeyFromCredit,
  getValidTmdbEntityId,
  isAllowedBfsTmdbMovieCredit,
  normalizeName,
  normalizeTitle,
  parseMoviePathLabel,
} from "./utils";
import {
  cardsMatch,
  createCardViewModel,
  getCardTmdbRowTooltipText,
  getParentMovieRankForPerson,
  getParentPersonRankForMovie,
  getResolvedMovieConnectionCount,
  getResolvedPersonConnectionCount,
  refreshSelectedMovieCard,
  refreshSelectedPersonCard,
} from "./view_model";
import { hasDirectTmdbMovieSource, hasDirectTmdbPersonSource } from "./tmdb_provenance";
import type { CinenerdleCard, CinenerdlePathNode } from "./view_types";

export { getCardTmdbRowTooltipText } from "./view_model";

type ConnectedItemAttrSourceCard = Extract<CinenerdleCard, { kind: "movie" | "person" }>;

const connectedItemAttrChildSourcesCache = new Map<
  string,
  Promise<ConnectedItemAttrSourceCard[]>
>();
const resolvedConnectedItemAttrChildSourcesCache = new Map<
  string,
  ConnectedItemAttrSourceCard[]
>();
const resolvedMovieParentRecordCache = new Map<string, Promise<FilmRecord | null>>();
const resolvedPersonParentRecordCache = new Map<string, Promise<PersonRecord | null>>();
const MAX_LONG_TASK_SAMPLES = 120;
const recentLongTaskSamples: Array<{
  attribution: Array<Record<string, unknown>>;
  durationMs: number;
  endTimeMs: number;
  name: string;
  startTimeMs: number;
}> = [];
let cinenerdleLongTaskObserverInitialized = false;
let cinenerdleLongTaskObserverSupported = false;

function areCardsDirectlyConnected(
  card: ConnectedItemAttrSourceCard,
  candidate: ConnectedItemAttrSourceCard,
): boolean {
  if (card.kind === candidate.kind) {
    return false;
  }

  const movieCard = card.kind === "movie" ? card : candidate.kind === "movie" ? candidate : null;
  const personCard = card.kind === "person" ? card : candidate.kind === "person" ? candidate : null;
  if (!movieCard || !personCard) {
    return false;
  }

  const movieTmdbId = getValidTmdbEntityId(
    movieCard.record?.rawTmdbMovie?.id ??
    movieCard.record?.tmdbId ??
    movieCard.record?.id ??
    movieCard.key.match(/^movie:(\d+)$/)?.[1],
  );
  const personTmdbId = getPersonTmdbIdFromCard(personCard);
  if (movieTmdbId === null || personTmdbId === null) {
    return false;
  }

  const personMovieTmdbIds = personCard.record
    ? getAssociatedMovieCreditGroupsFromPersonCredits(personCard.record)
      .flatMap((creditGroup) => creditGroup)
      .map((credit) => getValidTmdbEntityId(credit.id))
      .filter((tmdbId): tmdbId is number => tmdbId !== null)
    : [];
  const movieCreditGroups = movieCard.record
    ? getAssociatedPersonCreditGroupsFromMovieCredits(movieCard.record)
    : [];
  const moviePersonTmdbIds = movieCreditGroups
    .flatMap((creditGroup) => creditGroup)
    .map((credit) => getValidTmdbEntityId(credit.id))
    .filter((tmdbId): tmdbId is number => tmdbId !== null);

  return (
    personMovieTmdbIds.includes(movieTmdbId) ||
    moviePersonTmdbIds.includes(personTmdbId)
  );
}

function dedupeConnectedItemAttrSourceCards(
  sources: ConnectedItemAttrSourceCard[],
): ConnectedItemAttrSourceCard[] {
  return sources.filter((card, index) =>
    sources.findIndex((candidate) => candidate.key === card.key) === index,
  );
}

function getCinenerdleDebugNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function roundCinenerdleDebugElapsedMs(value: number): number {
  return Number(value.toFixed(1));
}

function trimRecentLongTaskSamples(): void {
  if (recentLongTaskSamples.length <= MAX_LONG_TASK_SAMPLES) {
    return;
  }

  recentLongTaskSamples.splice(0, recentLongTaskSamples.length - MAX_LONG_TASK_SAMPLES);
}

function ensureCinenerdleLongTaskObserver(): boolean {
  if (cinenerdleLongTaskObserverInitialized) {
    return cinenerdleLongTaskObserverSupported;
  }

  cinenerdleLongTaskObserverInitialized = true;

  if (
    !import.meta.env.DEV ||
    typeof window === "undefined" ||
    typeof PerformanceObserver === "undefined"
  ) {
    return false;
  }

  const supportedEntryTypes = Array.isArray(PerformanceObserver.supportedEntryTypes)
    ? PerformanceObserver.supportedEntryTypes
    : [];
  if (!supportedEntryTypes.includes("longtask")) {
    return false;
  }

  try {
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        const longTaskEntry = entry as PerformanceEntry & {
          attribution?: Array<Record<string, unknown>>;
        };
        recentLongTaskSamples.push({
          attribution: Array.isArray(longTaskEntry.attribution)
            ? longTaskEntry.attribution.slice(0, 3).map((attribution) => ({
                containerId: attribution.containerId,
                containerName: attribution.containerName,
                containerSrc: attribution.containerSrc,
                containerType: attribution.containerType,
                name: attribution.name,
              }))
            : [],
          durationMs: roundCinenerdleDebugElapsedMs(entry.duration),
          endTimeMs: roundCinenerdleDebugElapsedMs(entry.startTime + entry.duration),
          name: entry.name,
          startTimeMs: roundCinenerdleDebugElapsedMs(entry.startTime),
        });
      });
      trimRecentLongTaskSamples();
    });

    observer.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
    cinenerdleLongTaskObserverSupported = true;
  } catch {
    cinenerdleLongTaskObserverSupported = false;
  }

  return cinenerdleLongTaskObserverSupported;
}

function getCinenerdleLongTaskSamplesOverlapping(
  startedAt: number,
  endedAt: number,
): Array<{
  attribution: Array<Record<string, unknown>>;
  durationMs: number;
  endTimeMs: number;
  name: string;
  overlapDurationMs: number;
  startTimeMs: number;
}> {
  return recentLongTaskSamples
    .filter((sample) => sample.startTimeMs <= endedAt && sample.endTimeMs >= startedAt)
    .map((sample) => ({
      ...sample,
      overlapDurationMs: roundCinenerdleDebugElapsedMs(
        Math.min(sample.endTimeMs, endedAt) - Math.max(sample.startTimeMs, startedAt),
      ),
    }));
}

function logCinenerdleLongTasksForWindow(
  event: string,
  startedAt: number,
  endedAt: number,
  details?: Record<string, unknown>,
): void {
  const longTaskObserverSupported = ensureCinenerdleLongTaskObserver();
  const overlappingLongTasks = longTaskObserverSupported
    ? getCinenerdleLongTaskSamplesOverlapping(startedAt, endedAt)
    : [];

  addCinenerdleDebugLog(event, {
    ...details,
    longTaskCount: overlappingLongTasks.length,
    longTaskObserverSupported,
    longTaskSamples: overlappingLongTasks.slice(-5),
    longestLongTaskMs: overlappingLongTasks.reduce(
      (longestDuration, sample) => Math.max(longestDuration, sample.durationMs),
      0,
    ),
    totalLongTaskOverlapMs: roundCinenerdleDebugElapsedMs(
      overlappingLongTasks.reduce((totalDuration, sample) => totalDuration + sample.overlapDurationMs, 0),
    ),
    windowElapsedMs: roundCinenerdleDebugElapsedMs(endedAt - startedAt),
  });
}

async function prepareTreeForRender(
  tree: GeneratorTree<CinenerdleCard>,
  itemAttrsSnapshot: CinenerdleItemAttrs,
): Promise<GeneratorTree<CinenerdleCard>> {
  return enrichCinenerdleTreeWithItemAttrs(tree, itemAttrsSnapshot);
}

async function prepareTreeRowsForRender(
  tree: GeneratorTree<CinenerdleCard>,
  itemAttrsSnapshot: CinenerdleItemAttrs,
  generationIndexes: number[],
): Promise<GeneratorTree<CinenerdleCard>> {
  return enrichCinenerdleTreeWithItemAttrs(tree, itemAttrsSnapshot, {
    generationIndexes,
  });
}

function createUncachedMovieCard(name: string, year: string): Extract<CinenerdleCard, { kind: "movie" }> {
  return {
    key: `movie:${normalizeTitle(name)}:${year}`,
    kind: "movie",
    name,
    year,
    popularity: 0,
    popularitySource: "Movie details are not cached yet, so popularity is unavailable.",
    imageUrl: null,
    subtitle: "Movie",
    subtitleDetail: "Not cached yet",
    connectionCount: null,
    sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
    status: null,
    voteAverage: null,
    voteCount: null,
    record: null,
  };
}

type CinenerdleControllerOptions = {
  onItemAttrMutationRequested?: (
    request: {
      action: "add" | "remove";
      card: Extract<CinenerdleCard, { kind: "movie" | "person" }>;
      itemAttr: string;
    },
  ) => void;
  onItemAttrsSnapshotChange?: (itemAttrsSnapshot: CinenerdleItemAttrs) => void;
  onExplicitTmdbRowClick?: () => void;
  recordsRefreshVersion?: number;
  readHash: () => string;
  writeHash: (nextHash: string, mode?: "selection" | "navigation") => void;
};

type BuildTreeOptions = {
  bypassInFlightCache?: boolean;
  itemAttrsSnapshot?: CinenerdleItemAttrs;
};

export type CinenerdleTreeMeta = {
  itemAttrsSnapshot: CinenerdleItemAttrs;
};

type CinenerdleTreeSession = {
  itemAttrsSnapshot: CinenerdleItemAttrs;
  tree: GeneratorTree<CinenerdleCard>;
};

const inFlightTreeBuilds = new Map<string, Promise<CinenerdleTreeSession>>();
let syncDailyStartersWithCachePromise: Promise<void> | null = null;

export function resetInitialViewportSettled(): void {
  // The initial viewport gate used to coordinate staged tree preparation.
  // It is now a no-op because tree initialization applies the fully prepared tree immediately.
}

export function markInitialViewportSettled(): void {
  // No-op. The prepared tree is committed immediately during initialization.
}

function createNode(
  data: CinenerdleCard,
  selected = false,
  disabled = false,
  rowOrderMetadata?: GeneratorNode<CinenerdleCard>["rowOrderMetadata"],
): GeneratorNode<CinenerdleCard> {
  return {
    selected,
    disabled,
    data,
    rowOrderMetadata,
  };
}

function getPersonIdentityKey(personName: string, personTmdbId?: number | string | null): string {
  const validTmdbId = getValidTmdbEntityId(personTmdbId);
  return validTmdbId ? `tmdb:${validTmdbId}` : `name:${normalizeName(personName)}`;
}

function createRow(cards: CinenerdleCard[], selectedKey?: string) {
  return cards.map((card) => createNode(card, selectedKey === card.key));
}

function getItemAttrsSnapshotFromGeneratorState(
  state: GeneratorState<CinenerdleCard, CinenerdleTreeMeta | undefined>,
): CinenerdleItemAttrs | null {
  return state.meta?.itemAttrsSnapshot ?? null;
}

export function reduceCinenerdleLifecycleEvent<TMeta = undefined>(
  state: GeneratorState<CinenerdleCard, TMeta>,
  event: GeneratorLifecycleEvent,
): GeneratorTransition<CinenerdleCard, TMeta, GeneratorLifecycleEffect<CinenerdleCard>> {
  if (event.type === "select") {
    const tree = state.tree;
    const selectedRow = tree?.[event.row];
    const selectedNode = selectedRow?.[event.col];

    if (tree && selectedRow && selectedNode?.selected) {
      return {
        state,
        effects: [{
          type: "load-selected-card",
          isReselection: true,
          removedDescendantRows: tree.length > event.row + 1,
          row: event.row,
          col: event.col,
          tree,
        }],
      };
    }
  }

  return reduceGeneratorLifecycleEvent(state, event);
}

function sortCardsByPopularity(cards: CinenerdleCard[]) {
  return [...cards].sort((left, right) => {
    const popularityDifference = right.popularity - left.popularity;
    if (popularityDifference !== 0) {
      return popularityDifference;
    }

    const nameDifference = normalizeTitle(left.name).localeCompare(
      normalizeTitle(right.name),
    );
    if (nameDifference !== 0) {
      return nameDifference;
    }

    if (left.kind === "movie" && right.kind === "movie") {
      return Number(right.year || 0) - Number(left.year || 0);
    }

    return 0;
  });
}

function getTreeBuildCacheKey(hashValue: string): string {
  return hashValue;
}

function getSelectedCard(tree: GeneratorTree<CinenerdleCard>, rowIndex: number) {
  return tree[rowIndex]?.find((node) => node.selected)?.data ?? null;
}

function getSelectedPathNodes(tree: GeneratorTree<CinenerdleCard>): CinenerdlePathNode[] {
  return tree
    .map((row) => row.find((node) => node.selected)?.data ?? null)
    .filter((card): card is CinenerdleCard => card !== null)
    .map((card) => getPathNodeFromCard(card));
}

function shouldHydrateHashPathOnInit(hashValue: string): boolean {
  const entityNodeCount = buildPathNodesFromSegments(parseHashSegments(hashValue)).filter(
    (pathNode) => pathNode.kind === "movie" || pathNode.kind === "person",
  ).length;

  return entityNodeCount === 1 || entityNodeCount >= 3;
}

function getPersonTmdbIdFromCard(
  card: Extract<CinenerdleCard, { kind: "person" }>,
): number | null {
  const recordTmdbId = getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id);
  if (recordTmdbId) {
    return recordTmdbId;
  }

  const keyMatch = card.key.match(/^person:(\d+)$/);
  return keyMatch ? getValidTmdbEntityId(keyMatch[1]) : null;
}

function getPathNodeFromCard(card: CinenerdleCard): CinenerdlePathNode {
  if (card.kind === "cinenerdle") {
    return createPathNode("cinenerdle", "cinenerdle");
  }

  if (card.kind === "break" || card.kind === "dbinfo") {
    return createPathNode("break", "");
  }

  if (card.kind === "movie") {
    return createPathNode("movie", card.name, card.year);
  }

  return createPathNode(
    "person",
    card.name,
    "",
    getPersonTmdbIdFromCard(card),
  );
}

async function getLocalPersonRecord(
  personName: string,
  personTmdbId?: number | null,
): Promise<PersonRecord | null> {
  const validPersonTmdbId = getValidTmdbEntityId(personTmdbId);
  if (validPersonTmdbId) {
    return getPersonRecordById(validPersonTmdbId);
  }

  return personName ? getPersonRecordByName(personName) : null;
}

function cacheResolvedMovieParentRecord(
  card: Extract<CinenerdleCard, { kind: "movie" }>,
  ...records: Array<FilmRecord | null | undefined>
): FilmRecord | null {
  const resolvedMovieRecord = pickBestMovieRecord(...records);
  resolvedMovieParentRecordCache.set(card.key, Promise.resolve(resolvedMovieRecord));
  return resolvedMovieRecord;
}

function cacheResolvedPersonParentRecord(
  card: Extract<CinenerdleCard, { kind: "person" }>,
  ...records: Array<PersonRecord | null | undefined>
): PersonRecord | null {
  const resolvedPersonRecord = pickBestPersonRecord(...records);
  resolvedPersonParentRecordCache.set(card.key, Promise.resolve(resolvedPersonRecord));
  return resolvedPersonRecord;
}

function getMovieRecordQualityScore(movieRecord: FilmRecord | null | undefined): number {
  if (!movieRecord) {
    return -1;
  }

  let score = 0;

  if (hasDirectTmdbMovieSource(movieRecord)) {
    score += 16;
  }

  if (movieRecord.rawTmdbMovieCreditsResponse) {
    score += 8;
  }

  if (movieRecord.rawTmdbMovie?.poster_path) {
    score += 4;
  }

  if (movieRecord.personConnectionKeys.length > 0) {
    score += 2;
  }

  if (movieRecord.fetchTimestamp) {
    score += 1;
  }

  return score;
}

function pickBestMovieRecord(
  ...records: Array<FilmRecord | null | undefined>
): FilmRecord | null {
  return records
    .filter((record): record is FilmRecord => Boolean(record))
    .sort((left, right) => {
      const qualityDifference =
        getMovieRecordQualityScore(right) - getMovieRecordQualityScore(left);
      if (qualityDifference !== 0) {
        return qualityDifference;
      }

      const popularityDifference = (right.popularity ?? 0) - (left.popularity ?? 0);
      if (popularityDifference !== 0) {
        return popularityDifference;
      }

      return formatMoviePathLabel(left.title, left.year).localeCompare(
        formatMoviePathLabel(right.title, right.year),
      );
    })[0] ?? null;
}

async function getLocalMovieRecord(
  movieName: string,
  movieYear = "",
  movieId?: number | string | null,
): Promise<FilmRecord | null> {
  const validMovieTmdbId = getValidTmdbEntityId(movieId);
  if (validMovieTmdbId) {
    return getFilmRecordById(validMovieTmdbId);
  }

  return movieName ? getFilmRecordByTitleAndYear(movieName, movieYear) : null;
}

async function resolveMovieParentRecord(
  card: Extract<CinenerdleCard, { kind: "movie" }>,
  movieRecordOverride?: FilmRecord | null,
): Promise<FilmRecord | null> {
  const resolveStartedAt = getCinenerdleDebugNow();
  if (movieRecordOverride !== undefined) {
    const resolvedMovieRecord = cacheResolvedMovieParentRecord(card, movieRecordOverride, card.record);
    addCinenerdleDebugLog("perf:controller.resolveMovieParentRecord", {
      elapsedMs: roundCinenerdleDebugElapsedMs(getCinenerdleDebugNow() - resolveStartedAt),
      hasCardRecord: Boolean(card.record),
      hasOverride: true,
      overrideHasCredits: Boolean(movieRecordOverride?.rawTmdbMovieCreditsResponse),
      path: "override",
      resolvedHasCredits: Boolean(resolvedMovieRecord?.rawTmdbMovieCreditsResponse),
      selectedCardKey: card.key,
    });
    return resolvedMovieRecord;
  }

  if (card.record?.rawTmdbMovieCreditsResponse) {
    const resolvedMovieRecord = cacheResolvedMovieParentRecord(card, card.record);
    addCinenerdleDebugLog("perf:controller.resolveMovieParentRecord", {
      elapsedMs: roundCinenerdleDebugElapsedMs(getCinenerdleDebugNow() - resolveStartedAt),
      hasCardRecord: true,
      hasOverride: false,
      path: "card-record",
      resolvedHasCredits: Boolean(resolvedMovieRecord?.rawTmdbMovieCreditsResponse),
      selectedCardKey: card.key,
    });
    return resolvedMovieRecord;
  }

  const cachedMovieRecordPromise = resolvedMovieParentRecordCache.get(card.key);
  if (cachedMovieRecordPromise) {
    const cachedAwaitStartedAt = getCinenerdleDebugNow();
    const cachedMovieRecord = await cachedMovieRecordPromise;
    const resolvedMovieRecord = cacheResolvedMovieParentRecord(card, cachedMovieRecord, card.record);
    addCinenerdleDebugLog("perf:controller.resolveMovieParentRecord", {
      awaitCachedRecordElapsedMs: roundCinenerdleDebugElapsedMs(
        getCinenerdleDebugNow() - cachedAwaitStartedAt,
      ),
      elapsedMs: roundCinenerdleDebugElapsedMs(getCinenerdleDebugNow() - resolveStartedAt),
      hasCardRecord: Boolean(card.record),
      hasOverride: false,
      path: "cache-hit",
      resolvedHasCredits: Boolean(resolvedMovieRecord?.rawTmdbMovieCreditsResponse),
      selectedCardKey: card.key,
    });
    return resolvedMovieRecord;
  }

  const lookupStartedAt = getCinenerdleDebugNow();
  const nextMovieRecordPromise = getLocalMovieRecord(
    card.name,
    card.year,
    card.record?.tmdbId ?? card.record?.id ?? null,
  ).then((localMovieRecord) =>
    cacheResolvedMovieParentRecord(card, card.record, localMovieRecord)
  );

  resolvedMovieParentRecordCache.set(card.key, nextMovieRecordPromise);

  try {
    const resolvedMovieRecord = await nextMovieRecordPromise;
    addCinenerdleDebugLog("perf:controller.resolveMovieParentRecord", {
      elapsedMs: roundCinenerdleDebugElapsedMs(getCinenerdleDebugNow() - resolveStartedAt),
      hasCardRecord: Boolean(card.record),
      hasOverride: false,
      lookupElapsedMs: roundCinenerdleDebugElapsedMs(getCinenerdleDebugNow() - lookupStartedAt),
      lookupStrategy: getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id ?? null) !== null
        ? "id"
        : card.name
          ? "title-year"
          : "none",
      path: "lookup",
      resolvedHasCredits: Boolean(resolvedMovieRecord?.rawTmdbMovieCreditsResponse),
      selectedCardKey: card.key,
    });
    return resolvedMovieRecord;
  } catch (error) {
    if (resolvedMovieParentRecordCache.get(card.key) === nextMovieRecordPromise) {
      resolvedMovieParentRecordCache.delete(card.key);
    }

    throw error;
  }
}

async function resolvePersonParentRecord(
  card: Extract<CinenerdleCard, { kind: "person" }>,
  personRecordOverride?: PersonRecord | null,
): Promise<PersonRecord | null> {
  const resolveStartedAt = getCinenerdleDebugNow();
  if (personRecordOverride !== undefined) {
    const resolvedPersonRecord = cacheResolvedPersonParentRecord(card, personRecordOverride, card.record);
    addCinenerdleDebugLog("perf:controller.resolvePersonParentRecord", {
      elapsedMs: roundCinenerdleDebugElapsedMs(getCinenerdleDebugNow() - resolveStartedAt),
      hasCardRecord: Boolean(card.record),
      hasOverride: true,
      overrideHasCredits: Boolean(personRecordOverride?.rawTmdbMovieCreditsResponse),
      path: "override",
      resolvedHasCredits: Boolean(resolvedPersonRecord?.rawTmdbMovieCreditsResponse),
      selectedCardKey: card.key,
    });
    return resolvedPersonRecord;
  }

  if (card.record?.rawTmdbMovieCreditsResponse) {
    const resolvedPersonRecord = cacheResolvedPersonParentRecord(card, card.record);
    addCinenerdleDebugLog("perf:controller.resolvePersonParentRecord", {
      elapsedMs: roundCinenerdleDebugElapsedMs(getCinenerdleDebugNow() - resolveStartedAt),
      hasCardRecord: true,
      hasOverride: false,
      path: "card-record",
      resolvedHasCredits: Boolean(resolvedPersonRecord?.rawTmdbMovieCreditsResponse),
      selectedCardKey: card.key,
    });
    return resolvedPersonRecord;
  }

  const cachedPersonRecordPromise = resolvedPersonParentRecordCache.get(card.key);
  if (cachedPersonRecordPromise) {
    const cachedAwaitStartedAt = getCinenerdleDebugNow();
    const cachedPersonRecord = await cachedPersonRecordPromise;
    const resolvedPersonRecord = cacheResolvedPersonParentRecord(card, cachedPersonRecord, card.record);
    addCinenerdleDebugLog("perf:controller.resolvePersonParentRecord", {
      awaitCachedRecordElapsedMs: roundCinenerdleDebugElapsedMs(
        getCinenerdleDebugNow() - cachedAwaitStartedAt,
      ),
      elapsedMs: roundCinenerdleDebugElapsedMs(getCinenerdleDebugNow() - resolveStartedAt),
      hasCardRecord: Boolean(card.record),
      hasOverride: false,
      path: "cache-hit",
      resolvedHasCredits: Boolean(resolvedPersonRecord?.rawTmdbMovieCreditsResponse),
      selectedCardKey: card.key,
    });
    return resolvedPersonRecord;
  }

  const lookupStartedAt = getCinenerdleDebugNow();
  const nextPersonRecordPromise = getLocalPersonRecord(
    card.name,
    getPersonTmdbIdFromCard(card),
  ).then((localPersonRecord) =>
    cacheResolvedPersonParentRecord(card, card.record, localPersonRecord)
  );

  resolvedPersonParentRecordCache.set(card.key, nextPersonRecordPromise);

  try {
    const resolvedPersonRecord = await nextPersonRecordPromise;
    addCinenerdleDebugLog("perf:controller.resolvePersonParentRecord", {
      elapsedMs: roundCinenerdleDebugElapsedMs(getCinenerdleDebugNow() - resolveStartedAt),
      hasCardRecord: Boolean(card.record),
      hasOverride: false,
      lookupElapsedMs: roundCinenerdleDebugElapsedMs(getCinenerdleDebugNow() - lookupStartedAt),
      lookupStrategy: getPersonTmdbIdFromCard(card) !== null
        ? "id"
        : card.name
          ? "name"
          : "none",
      path: "lookup",
      resolvedHasCredits: Boolean(resolvedPersonRecord?.rawTmdbMovieCreditsResponse),
      selectedCardKey: card.key,
    });
    return resolvedPersonRecord;
  } catch (error) {
    if (resolvedPersonParentRecordCache.get(card.key) === nextPersonRecordPromise) {
      resolvedPersonParentRecordCache.delete(card.key);
    }

    throw error;
  }
}

async function createDailyStarterRow() {
  const starterFilms = await getCinenerdleStarterFilmRecords();
  if (starterFilms.length === 0) {
    return null;
  }

  const cards = sortCardsByPopularity(starterFilms.map(createDailyStarterMovieCard));
  return createRow(cards);
}

function isCinenerdleRootTree(tree: GeneratorTree<CinenerdleCard>) {
  return getSelectedCard(tree, 0)?.kind === "cinenerdle";
}

function getSelectedPathTree(
  tree: GeneratorTree<CinenerdleCard>,
  rowIndex: number,
): GeneratorTree<CinenerdleCard> {
  return tree.slice(0, rowIndex + 1);
}

function replaceTreeNodeCard(
  tree: GeneratorTree<CinenerdleCard>,
  rowIndex: number,
  colIndex: number,
  card: CinenerdleCard,
): GeneratorTree<CinenerdleCard> {
  return tree.map((row, currentRowIndex) =>
    currentRowIndex === rowIndex
      ? row.map((node, currentColIndex) =>
          currentColIndex === colIndex
            ? {
                ...node,
                data: card,
              }
            : node)
      : row,
  );
}

function appendChildRow(
  tree: GeneratorTree<CinenerdleCard>,
  childRow: GeneratorNode<CinenerdleCard>[] | null,
): GeneratorTree<CinenerdleCard> {
  return childRow && childRow.length > 0 ? [...tree, childRow] : tree;
}

function getPopularityByPersonNameFromFilmRecords(
  filmRecords: Iterable<FilmRecord>,
): Map<string, number> {
  const popularityByPersonName = new Map<string, number>();

  Array.from(filmRecords).forEach((filmRecord) => {
    getAssociatedPeopleFromMovieCredits(filmRecord).forEach((credit) => {
      const personName = normalizeName(credit.name ?? "");
      if (!personName) {
        return;
      }

      popularityByPersonName.set(
        personName,
        Math.max(
          popularityByPersonName.get(personName) ?? 0,
          credit.popularity ?? 0,
        ),
      );
    });
  });

  return popularityByPersonName;
}

function scheduleConnectionPrefetch(
  card: Extract<CinenerdleCard, { kind: "movie" | "person" }>,
): void {
  void prefetchTopPopularUnhydratedConnections(card).catch(() => { });
}

async function refreshCardFromTmdb(
  card: Extract<CinenerdleCard, { kind: "movie" | "person" }>,
  options: {
    skipIfAlreadyHydrated: boolean;
  },
): Promise<{
  didRefresh: boolean;
  refreshedCard: Extract<CinenerdleCard, { kind: "movie" | "person" }>;
}> {
  if (card.kind === "movie") {
    const alreadyHydrated = hasDirectTmdbMovieSource(card.record);
    if (options.skipIfAlreadyHydrated && alreadyHydrated) {
      scheduleConnectionPrefetch(card);
      return {
        didRefresh: false,
        refreshedCard: card,
      };
    }

    const refreshedMovieRecord = await prepareSelectedMovie(
      card.name,
      card.year,
      card.record?.tmdbId ?? card.record?.id ?? null,
      {
        forceRefresh: true,
      },
    );
    const refreshedMovieCard = refreshedMovieRecord
      ? refreshSelectedMovieCard(card, refreshedMovieRecord)
      : card;

    scheduleConnectionPrefetch(refreshedMovieCard);
    return {
      didRefresh: true,
      refreshedCard: refreshedMovieCard,
    };
  }

  const alreadyHydrated = hasDirectTmdbPersonSource(card.record);
  if (options.skipIfAlreadyHydrated && alreadyHydrated) {
    scheduleConnectionPrefetch(card);
    return {
      didRefresh: false,
      refreshedCard: card,
    };
  }

  const refreshedPersonRecord = await prepareSelectedPerson(
    card.name,
    getPersonTmdbIdFromCard(card),
    {
      forceRefresh: true,
    },
  );
  const refreshedPersonCard = refreshedPersonRecord
    ? refreshSelectedPersonCard(card, refreshedPersonRecord)
    : card;

  scheduleConnectionPrefetch(refreshedPersonCard);
  return {
    didRefresh: true,
    refreshedCard: refreshedPersonCard,
  };
}

function normalizeDailyStarterTitles(titles: string[]): string[] {
  return titles
    .map((title) => normalizeTitle(title))
    .filter(Boolean);
}

function doDailyStarterTitlesMatch(left: string[], right: string[]): boolean {
  const normalizedLeft = normalizeDailyStarterTitles(left);
  const normalizedRight = normalizeDailyStarterTitles(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((title, index) => title === normalizedRight[index]);
}

async function syncDailyStartersWithCache(): Promise<void> {
  if (syncDailyStartersWithCachePromise) {
    return syncDailyStartersWithCachePromise;
  }

  syncDailyStartersWithCachePromise = (async () => {
    const cachedStarterTitles = readCinenerdleDailyStarterTitles();
    const fetchedStarterFilms = await fetchCinenerdleDailyStarterMovies();
    const nextStarterTitles = readCinenerdleDailyStarterTitles();

    if (!doDailyStarterTitlesMatch(cachedStarterTitles, nextStarterTitles)) {
      window.location.reload();
      return;
    }

    await hydrateCinenerdleDailyStarterMovies(fetchedStarterFilms);
  })().finally(() => {
    syncDailyStartersWithCachePromise = null;
  });

  return syncDailyStartersWithCachePromise;
}

async function buildChildRowForPersonCard(
  card: Extract<CinenerdleCard, { kind: "person" }>,
  personRecordOverride?: PersonRecord | null,
): Promise<GeneratorNode<CinenerdleCard>[] | null> {
  return measureAsync(
    "controller.buildChildRowForPersonCard",
    async () => {
      const buildStartedAt = getCinenerdleDebugNow();
      const resolveParentRecordStartedAt = getCinenerdleDebugNow();
      const personRecord = await resolvePersonParentRecord(card, personRecordOverride);
      const resolveParentRecordElapsedMs = roundCinenerdleDebugElapsedMs(
        getCinenerdleDebugNow() - resolveParentRecordStartedAt,
      );
      if (!personRecord) {
        return null;
      }
      const movieCreditGroups = getAssociatedMovieCreditGroupsFromPersonCredits(personRecord)
        .filter((creditGroup) => creditGroup.some((credit) => isAllowedBfsTmdbMovieCredit(credit)));
      if (movieCreditGroups.length === 0) {
        const movieKeys = Array.from(
          new Set(personRecord.movieConnectionKeys.map((movieKey) => normalizeTitle(movieKey)).filter(Boolean)),
        );
        if (movieKeys.length === 0) {
          return null;
        }

        const fallbackFilmsStartedAt = getCinenerdleDebugNow();
        const fallbackFilms = await Promise.all(
          movieKeys.map(async (movieKey) => {
            const parsedMovie = parseMoviePathLabel(movieKey);
            return {
              movieKey,
              parsedMovie,
              movieRecord: await getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year),
            };
          }),
        );
        const fallbackFilmsElapsedMs = roundCinenerdleDebugElapsedMs(
          getCinenerdleDebugNow() - fallbackFilmsStartedAt,
        );
        const popularityLookupStartedAt = getCinenerdleDebugNow();
        const popularityByPersonName = await getPersonPopularityByNames(
          fallbackFilms.flatMap(({ movieRecord }) => movieRecord?.personConnectionKeys ?? []),
        );
        const popularityLookupElapsedMs = roundCinenerdleDebugElapsedMs(
          getCinenerdleDebugNow() - popularityLookupStartedAt,
        );
        const connectionCountsStartedAt = getCinenerdleDebugNow();
        const connectionCounts = await getPersonRecordCountsByMovieKeys(movieKeys);
        const connectionCountsElapsedMs = roundCinenerdleDebugElapsedMs(
          getCinenerdleDebugNow() - connectionCountsStartedAt,
        );
        const connectionParentLabel = card.name;
        const childCardAssemblyStartedAt = getCinenerdleDebugNow();
        const childCards = sortCardsByPopularity(
          fallbackFilms.map(({ movieKey, parsedMovie, movieRecord }) => ({
            ...(movieRecord
              ? createMovieRootCard(movieRecord, parsedMovie.name)
              : createUncachedMovieCard(parsedMovie.name, parsedMovie.year)),
            connectionCount: Math.max(
              movieRecord?.personConnectionKeys.length ?? 0,
              connectionCounts.get(movieKey) ?? 0,
              1,
            ),
            connectionRank: getParentPersonRankForMovie(
              movieRecord,
              personRecord,
              popularityByPersonName,
            ),
            connectionParentLabel,
          })),
        ).map((childCard, index) => ({
          ...childCard,
          connectionOrder: index + 1,
        }));
        addCinenerdleDebugLog("perf:controller.buildChildRowForPersonCard.breakdown", {
          childCount: childCards.length,
          childCardAssemblyElapsedMs: roundCinenerdleDebugElapsedMs(
            getCinenerdleDebugNow() - childCardAssemblyStartedAt,
          ),
          connectionCountsElapsedMs,
          overrideProvided: personRecordOverride !== undefined,
          movieCreditGroupCount: movieCreditGroups.length,
          movieKeyCount: movieKeys.length,
          path: "fallback",
          popularityLookupElapsedMs,
          resolveParentRecordElapsedMs,
          selectedCardKey: card.key,
          totalElapsedMs: roundCinenerdleDebugElapsedMs(
            getCinenerdleDebugNow() - buildStartedAt,
          ),
          fallbackFilmsElapsedMs,
        });

        return createRow(childCards);
      }

      const movieCredits = movieCreditGroups.map((group) => group[0]).filter(Boolean);
      const filmRecordsByIdStartedAt = getCinenerdleDebugNow();
      const filmRecordsById = await getFilmRecordsByIds(
        movieCredits
          .map((credit) => credit.id)
          .filter((creditId): creditId is number => typeof creditId === "number"),
      );
      const filmRecordsByIdElapsedMs = roundCinenerdleDebugElapsedMs(
        getCinenerdleDebugNow() - filmRecordsByIdStartedAt,
      );
      const popularityLookupStartedAt = getCinenerdleDebugNow();
      const popularityByPersonName = getPopularityByPersonNameFromFilmRecords(
        filmRecordsById.values(),
      );
      const popularityLookupElapsedMs = roundCinenerdleDebugElapsedMs(
        getCinenerdleDebugNow() - popularityLookupStartedAt,
      );
      const connectionCountsStartedAt = getCinenerdleDebugNow();
      const connectionCounts = await getPersonRecordCountsByMovieKeys(
        movieCredits.map((credit) => getMovieKeyFromCredit(credit)),
      );
      const connectionCountsElapsedMs = roundCinenerdleDebugElapsedMs(
        getCinenerdleDebugNow() - connectionCountsStartedAt,
      );
      const parentPersonRecord = personRecord;
      const connectionParentLabel = card.name;
      const childCardAssemblyStartedAt = getCinenerdleDebugNow();
      const childCards = movieCreditGroups.map((creditGroup, index) => {
        const credit = creditGroup[0];
        if (!credit) {
          return null;
        }
        const movieRecord = (credit.id ? filmRecordsById.get(credit.id) : null) ?? null;
        const movieCard = createMovieAssociationCard(
          creditGroup,
          movieRecord,
          getResolvedMovieConnectionCount(credit, movieRecord, connectionCounts),
        );
        const connectionOrder = index + 1;
        const cardWithOrdering = {
          ...movieCard,
          connectionRank: getParentPersonRankForMovie(
            movieRecord,
            parentPersonRecord,
            popularityByPersonName,
          ),
          connectionOrder,
          connectionParentLabel,
        } as Extract<CinenerdleCard, { kind: "movie" }>;
        return cardWithOrdering;
      }).filter((child): child is NonNullable<typeof child> => child !== null);
        addCinenerdleDebugLog("perf:controller.buildChildRowForPersonCard.breakdown", {
          childCount: childCards.length,
          childCardAssemblyElapsedMs: roundCinenerdleDebugElapsedMs(
            getCinenerdleDebugNow() - childCardAssemblyStartedAt,
          ),
          connectionCountsElapsedMs,
          filmRecordCount: filmRecordsById.size,
          filmRecordsByIdElapsedMs,
          movieCreditGroupCount: movieCreditGroups.length,
          overrideProvided: personRecordOverride !== undefined,
          path: "tmdb-credits",
          popularityLookupElapsedMs,
          resolveParentRecordElapsedMs,
        selectedCardKey: card.key,
        totalElapsedMs: roundCinenerdleDebugElapsedMs(
          getCinenerdleDebugNow() - buildStartedAt,
        ),
      });

      return createRow(childCards);
    },
    {
      details: {
        cardKey: card.key,
      },
      slowThresholdMs: 15,
      summarizeResult: (row) => ({
        childCount: row?.length ?? 0,
      }),
    },
  );
}

async function buildChildRowForMovieCard(
  card: Extract<CinenerdleCard, { kind: "movie" }>,
  movieRecordOverride?: FilmRecord | null,
): Promise<GeneratorNode<CinenerdleCard>[] | null> {
  return measureAsync(
    "controller.buildChildRowForMovieCard",
    async () => {
      const buildStartedAt = getCinenerdleDebugNow();
      const resolveParentRecordStartedAt = getCinenerdleDebugNow();
      const movieRecord = await resolveMovieParentRecord(card, movieRecordOverride);
      const resolveParentRecordElapsedMs = roundCinenerdleDebugElapsedMs(
        getCinenerdleDebugNow() - resolveParentRecordStartedAt,
      );
      if (!movieRecord) {
        return null;
      }

      const tmdbCreditGroups = getAssociatedPersonCreditGroupsFromMovieCredits(movieRecord);
      if (tmdbCreditGroups.length === 0) {
        const personNames = Array.from(
          new Set(movieRecord.personConnectionKeys.map((personName) => normalizeName(personName)).filter(Boolean)),
        );
        if (personNames.length === 0) {
          return null;
        }

        const cachedPersonRecordsStartedAt = getCinenerdleDebugNow();
        const cachedPersonRecords = await Promise.all(
          personNames.map(async (personName) => [
            personName,
            await getLocalPersonRecord(personName),
          ] as const),
        );
        const cachedPersonRecordsElapsedMs = roundCinenerdleDebugElapsedMs(
          getCinenerdleDebugNow() - cachedPersonRecordsStartedAt,
        );
        const movieLabels = Array.from(
          new Set(
            cachedPersonRecords.flatMap(([, personRecord]) =>
              personRecord
                ? personRecord.movieConnectionKeys.map((movieKey) => {
                    const parsedMovie = parseMoviePathLabel(movieKey);
                    return formatMoviePathLabel(parsedMovie.name, parsedMovie.year);
                  })
              : [],
            ),
          ),
        );
        const moviePopularityStartedAt = getCinenerdleDebugNow();
        const moviePopularityByLabel = await getMoviePopularityByLabels(movieLabels);
        const moviePopularityElapsedMs = roundCinenerdleDebugElapsedMs(
          getCinenerdleDebugNow() - moviePopularityStartedAt,
        );
        const popularityByMovieKey = new Map(
          movieLabels.map((movieLabel) => {
            const parsedMovie = parseMoviePathLabel(movieLabel);
            return [
              getFilmKey(parsedMovie.name, parsedMovie.year),
              moviePopularityByLabel.get(normalizeTitle(movieLabel)) ?? 0,
            ] as const;
          }),
        );
        const connectionCountsStartedAt = getCinenerdleDebugNow();
        const filmConnectionCounts = await getFilmRecordCountsByPersonConnectionKeys(personNames);
        const connectionCountsElapsedMs = roundCinenerdleDebugElapsedMs(
          getCinenerdleDebugNow() - connectionCountsStartedAt,
        );
        const connectionParentLabel = formatMoviePathLabel(card.name, card.year);
        const childCardAssemblyStartedAt = getCinenerdleDebugNow();
        const childCards = sortCardsByPopularity(
          cachedPersonRecords.map(([personName, personRecord]) => {
            const displayName =
              personRecord?.name ?? formatFallbackPersonDisplayName(personName);
            return {
              ...(personRecord
                ? createPersonRootCard(personRecord, displayName)
                : {
                    key: `person:${normalizeName(displayName)}`,
                    kind: "person" as const,
                    name: displayName,
                    popularity: 0,
                    popularitySource: "Popularity is unavailable, so this card falls back to 0.",
                    imageUrl: null,
                    subtitle: "",
                    subtitleDetail: "",
                    connectionCount: 1,
                    sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
                    status: null,
                    record: null,
                  }),
              connectionCount: getResolvedPersonConnectionCount(
                displayName,
                personRecord,
                filmConnectionCounts,
              ),
              connectionRank: getParentMovieRankForPerson(
                movieRecord,
                personRecord,
                popularityByMovieKey,
              ),
              connectionParentLabel,
            };
          }),
        ).map((childCard, index) => ({
          ...childCard,
          connectionOrder: index + 1,
        }));
        addCinenerdleDebugLog("perf:controller.buildChildRowForMovieCard.breakdown", {
          cachedPersonRecordCount: cachedPersonRecords.length,
          cachedPersonRecordsElapsedMs,
          childCardAssemblyElapsedMs: roundCinenerdleDebugElapsedMs(
            getCinenerdleDebugNow() - childCardAssemblyStartedAt,
          ),
          childCount: childCards.length,
          connectionCountsElapsedMs,
          moviePopularityElapsedMs,
          overrideProvided: movieRecordOverride !== undefined,
          path: "fallback",
          personNameCount: personNames.length,
          resolveParentRecordElapsedMs,
          selectedCardKey: card.key,
          totalElapsedMs: roundCinenerdleDebugElapsedMs(
            getCinenerdleDebugNow() - buildStartedAt,
          ),
        });

        return createRow(childCards);
      }

      const tmdbCredits = tmdbCreditGroups.map((group) => group[0]).filter(Boolean);
      const connectionCountsStartedAt = getCinenerdleDebugNow();
      const filmConnectionCounts = await getFilmRecordCountsByPersonConnectionKeys(
        tmdbCredits.map((credit) => credit.name ?? ""),
      );
      const connectionCountsElapsedMs = roundCinenerdleDebugElapsedMs(
        getCinenerdleDebugNow() - connectionCountsStartedAt,
      );
      const cachedPersonRecordsStartedAt = getCinenerdleDebugNow();
      const cachedPersonRecords = await Promise.all(
        tmdbCredits.map(async (credit) => {
          const personName = credit.name ?? "";
          return [
            getPersonIdentityKey(personName, credit.id),
            personName,
            await getLocalPersonRecord(
              personName,
              getValidTmdbEntityId(credit.id),
            ),
          ] as const;
        }),
      );
      const cachedPersonRecordsElapsedMs = roundCinenerdleDebugElapsedMs(
        getCinenerdleDebugNow() - cachedPersonRecordsStartedAt,
      );
      const personDetailsStartedAt = getCinenerdleDebugNow();
      const personDetails = new Map(
        cachedPersonRecords.map(([personKey, personName, cachedPersonRecord]) => [
          personKey,
          {
            connectionCount: getResolvedPersonConnectionCount(
              personName,
              cachedPersonRecord,
              filmConnectionCounts,
            ),
            connectionRank: null,
            personRecord: cachedPersonRecord,
          },
        ]),
      );
      const personDetailsElapsedMs = roundCinenerdleDebugElapsedMs(
        getCinenerdleDebugNow() - personDetailsStartedAt,
      );

      const connectionParentLabel = formatMoviePathLabel(card.name, card.year);
      const childCardAssemblyStartedAt = getCinenerdleDebugNow();
      const childCards = tmdbCreditGroups.map((creditGroup, index) => {
        const credit = creditGroup[0];
        if (!credit) {
          return null;
        }
        const personName = credit.name ?? "";
        const cachedPersonRecord =
          cachedPersonRecords.find(([personKey]) =>
            personKey === getPersonIdentityKey(personName, credit.id))?.[2] ?? null;
        const personDetail =
          personDetails.get(getPersonIdentityKey(personName, credit.id)) ?? {
            connectionCount: getResolvedPersonConnectionCount(
              personName,
              cachedPersonRecord,
              filmConnectionCounts,
            ),
            connectionRank: null,
            personRecord: cachedPersonRecord,
          };
        const connectionOrder = index + 1;
        const cardWithOrdering = {
          ...createPersonAssociationCard(
            creditGroup,
            personDetail?.connectionCount ?? 1,
            personDetail?.personRecord ?? null,
          ),
          connectionRank: personDetail?.connectionRank ?? null,
          connectionOrder,
          connectionParentLabel,
        } as Extract<CinenerdleCard, { kind: "person" }>;
        return cardWithOrdering;
      }).filter((child): child is NonNullable<typeof child> => child !== null);
      addCinenerdleDebugLog("perf:controller.buildChildRowForMovieCard.breakdown", {
        cachedPersonRecordCount: cachedPersonRecords.length,
        cachedPersonRecordsElapsedMs,
        childCardAssemblyElapsedMs: roundCinenerdleDebugElapsedMs(
          getCinenerdleDebugNow() - childCardAssemblyStartedAt,
        ),
        childCount: childCards.length,
        connectionCountsElapsedMs,
        overrideProvided: movieRecordOverride !== undefined,
        path: "tmdb-credits",
        personDetailsElapsedMs,
        resolveParentRecordElapsedMs,
        selectedCardKey: card.key,
        tmdbCreditCount: tmdbCredits.length,
        totalElapsedMs: roundCinenerdleDebugElapsedMs(
          getCinenerdleDebugNow() - buildStartedAt,
        ),
      });

      return createRow(childCards);
    },
    {
      details: {
        cardKey: card.key,
      },
      slowThresholdMs: 15,
      summarizeResult: (row) => ({
        childCount: row?.length ?? 0,
      }),
    },
  );
}

export async function buildChildRowForCard(
  card: CinenerdleCard,
  options?: {
    personRecord?: PersonRecord | null;
    movieRecord?: FilmRecord | null;
  },
): Promise<GeneratorNode<CinenerdleCard>[] | null> {
  let childRow: GeneratorNode<CinenerdleCard>[] | null = null;

  if (card.kind === "cinenerdle") {
    childRow = await createDailyStarterRow();
  } else if (card.kind === "person") {
    childRow = await buildChildRowForPersonCard(card, options?.personRecord);
  } else if (card.kind === "movie") {
    childRow = await buildChildRowForMovieCard(card, options?.movieRecord);
  }

  return childRow;
}

async function resolveInitialSelectedCard(
  card: Extract<CinenerdleCard, { kind: "movie" | "person" }>,
): Promise<{
  selectedCard: Extract<CinenerdleCard, { kind: "movie" | "person" }>;
  movieRecord?: FilmRecord | null;
  personRecord?: PersonRecord | null;
}> {
  if (card.kind === "movie") {
    if (hasDirectTmdbMovieSource(card.record)) {
      return {
        selectedCard: card,
        movieRecord: card.record,
      };
    }

    const localMovieRecord = await getLocalMovieRecord(
      card.name,
      card.year,
      card.record?.tmdbId ?? card.record?.id ?? null,
    );
    const movieRecord =
      localMovieRecord &&
      localMovieRecord.personConnectionKeys.length > (card.record?.personConnectionKeys.length ?? 0)
        ? localMovieRecord
        : await resolveMovieParentRecord(card, localMovieRecord);
    return {
      selectedCard:
        movieRecord && !hasDirectTmdbMovieSource(card.record)
          ? refreshSelectedMovieCard(card, movieRecord)
          : card,
      movieRecord,
    };
  }

  if (hasDirectTmdbPersonSource(card.record)) {
    return {
      selectedCard: card,
      personRecord: card.record,
    };
  }

  const localPersonRecord = await getLocalPersonRecord(
    card.name,
    getPersonTmdbIdFromCard(card),
  );
  const personRecord =
    localPersonRecord &&
    localPersonRecord.movieConnectionKeys.length > (card.record?.movieConnectionKeys.length ?? 0)
      ? localPersonRecord
      : await resolvePersonParentRecord(card, localPersonRecord);
  return {
    selectedCard:
      personRecord && !hasDirectTmdbPersonSource(card.record)
        ? refreshSelectedPersonCard(card, personRecord)
        : card,
    personRecord,
  };
}

async function createCinenerdleRootTree(
): Promise<GeneratorTree<CinenerdleCard>> {
  const starterRow = await createDailyStarterRow();
  const starterCount = starterRow?.length ?? 0;
  const tree: GeneratorTree<CinenerdleCard> = [
    [createNode(createCinenerdleRootCard(Math.max(starterCount, 1)), true)],
  ];

  if (starterRow && starterRow.length > 0) {
    tree.push(starterRow);
  }

  return tree;
}

async function createSelectedCardFromPathNode(
  pathNode: Extract<CinenerdlePathNode, { kind: "movie" | "person" }>,
): Promise<Extract<CinenerdleCard, { kind: "movie" | "person" }>> {
  if (pathNode.kind === "person") {
    const personRecord = await getLocalPersonRecord(pathNode.name, pathNode.tmdbId);
    return personRecord
      ? createPersonRootCard(personRecord, pathNode.name)
      : createCinenerdleOnlyPersonCard(pathNode.name, "database only") as Extract<
          CinenerdleCard,
          { kind: "person" }
        >;
  }

  const movieRecord = await getLocalMovieRecord(pathNode.name, pathNode.year);
  return movieRecord
    ? createMovieRootCard(movieRecord, pathNode.name)
    : createUncachedMovieCard(pathNode.name, pathNode.year) as Extract<
        CinenerdleCard,
        { kind: "movie" }
      >;
}

async function createSelectedTreeFromPathNode(
  pathNode: Extract<CinenerdlePathNode, { kind: "movie" | "person" }>,
): Promise<GeneratorTree<CinenerdleCard>> {
  const selectedCard = await createSelectedCardFromPathNode(pathNode);
  const tree: GeneratorTree<CinenerdleCard> = [[createNode(selectedCard, true)]];
  const childRow = await buildChildRowForCard(selectedCard);

  if (childRow && childRow.length > 0) {
    tree.push(childRow);
  }

  return tree;
}

async function appendStandaloneSelectedPathNode(
  tree: GeneratorTree<CinenerdleCard>,
  pathNode: Extract<CinenerdlePathNode, { kind: "movie" | "person" }>,
  nextPathNode?: Extract<CinenerdlePathNode, { kind: "movie" | "person" }>,
): Promise<GeneratorTree<CinenerdleCard>> {
  const selectedCard = await createSelectedCardFromPathNode(pathNode);
  const nextTree: GeneratorTree<CinenerdleCard> = [
    ...tree,
    [createNode(selectedCard, true)],
  ];
  const childRow = await buildChildRowForCard(selectedCard);

  if (
    childRow &&
    childRow.length > 0 &&
    nextPathNode &&
    findCardIndex(childRow, nextPathNode) >= 0
  ) {
    nextTree.push(childRow);
  }

  return nextTree;
}

async function createRootTreeFromPathNode(
  pathNode: Extract<CinenerdlePathNode, { kind: "cinenerdle" | "movie" | "person" }>,
): Promise<GeneratorTree<CinenerdleCard> | null> {
  if (pathNode.kind === "cinenerdle") {
    return createCinenerdleRootTree();
  }

  return createSelectedTreeFromPathNode(pathNode);
}

function findCardIndex(
  row: GeneratorNode<CinenerdleCard>[],
  pathNode: Extract<CinenerdlePathNode, { kind: "movie" | "person" }>,
): number {
  return row.findIndex((node) => {
    if (node.data.kind !== pathNode.kind) {
      return false;
    }

    if (pathNode.kind === "movie" && node.data.kind === "movie") {
      return (
        normalizeTitle(node.data.name) === normalizeTitle(pathNode.name) &&
        node.data.year === pathNode.year
      );
    }

    if (pathNode.kind === "person" && node.data.kind === "person") {
      const nodePersonTmdbId = getPersonTmdbIdFromCard(node.data);

      if (pathNode.tmdbId && nodePersonTmdbId) {
        return nodePersonTmdbId === pathNode.tmdbId;
      }
    }

    return normalizeName(node.data.name) === normalizeName(pathNode.name);
  });
}

function selectCardInRow(
  row: GeneratorNode<CinenerdleCard>[],
  selectedIndex: number,
) {
  return row.map((node, index) => ({
    ...node,
    selected: index === selectedIndex,
  }));
}

async function buildTreeFromHashBase(
  hashValue: string,
): Promise<GeneratorTree<CinenerdleCard>> {
  const pathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue));

  if (pathNodes.length === 0) {
    return await createCinenerdleRootTree();
  }

  const [rootNode, ...continuationPathNodes] = pathNodes;
  if (!rootNode || rootNode.kind === "break") {
    return await createCinenerdleRootTree();
  }

  const rootTree = await createRootTreeFromPathNode(rootNode);
  if (!rootTree) {
    return await createCinenerdleRootTree();
  }

  let tree = rootTree;

  for (let index = 0; index < continuationPathNodes.length; index += 1) {
    const pathNode = continuationPathNodes[index];
    if (pathNode.kind === "break") {
      continue;
    }

    if (pathNode.kind !== "movie" && pathNode.kind !== "person") {
      continue;
    }

    const nextPathNode = continuationPathNodes
      .slice(index + 1)
      .find((candidate): candidate is Extract<CinenerdlePathNode, { kind: "movie" | "person" }> =>
        candidate.kind === "movie" || candidate.kind === "person");

    const lastRow = tree[tree.length - 1];
    if (!lastRow) {
      tree = await appendStandaloneSelectedPathNode(tree, pathNode, nextPathNode);
      continue;
    }

    const selectedIndex = findCardIndex(lastRow, pathNode);
    if (selectedIndex < 0) {
      tree = await appendStandaloneSelectedPathNode(tree, pathNode, nextPathNode);
      continue;
    }

    const nextRow = selectCardInRow(lastRow, selectedIndex);
    tree = [...tree.slice(0, -1), nextRow];
    const selectedCard = nextRow[selectedIndex]?.data ?? null;
    if (!selectedCard || selectedCard.kind === "break" || selectedCard.kind === "dbinfo") {
      break;
    }

    const childRow = await buildChildRowForCard(selectedCard);
    if (childRow && childRow.length > 0) {
      tree = [...tree, childRow];
    }
  }

  return tree;
}

export async function buildTreeFromHash(
  hashValue: string,
  options?: BuildTreeOptions,
): Promise<GeneratorTree<CinenerdleCard>> {
  const treeSession = await buildTreeSessionFromHash(hashValue, options);
  return treeSession.tree;
}

async function buildTreeSessionFromHash(
  hashValue: string,
  options?: BuildTreeOptions,
): Promise<CinenerdleTreeSession> {
  const cacheKey = getTreeBuildCacheKey(hashValue);
  const cachedPromise =
    options?.bypassInFlightCache || options?.itemAttrsSnapshot
      ? null
      : inFlightTreeBuilds.get(cacheKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  let treeBuildPromise: Promise<CinenerdleTreeSession>;
  treeBuildPromise = measureAsync(
    "controller.buildTreeFromHash",
    async () => {
      const itemAttrsSnapshot = options?.itemAttrsSnapshot ?? readCinenerdleItemAttrs();
      const tree = await buildTreeFromHashBase(hashValue);
      const preparedTree = await prepareTreeForRender(tree, itemAttrsSnapshot);
      return {
        itemAttrsSnapshot,
        tree: preparedTree,
      };
    },
    {
      always: true,
      details: {
        hash: hashValue,
      },
      summarizeResult: (treeSession) => ({
        rowCount: treeSession.tree.length,
      }),
    },
  );
  treeBuildPromise = treeBuildPromise.finally(() => {
    if (inFlightTreeBuilds.get(cacheKey) === treeBuildPromise) {
      inFlightTreeBuilds.delete(cacheKey);
    }
  });
  inFlightTreeBuilds.set(cacheKey, treeBuildPromise);
  return treeBuildPromise;
}

function renderCinenerdleCard(
  node: GeneratorNode<CinenerdleCard>,
  isViewportPriorityRow: boolean,
  selectedAncestorCards: CinenerdleCard[],
  onItemAttrMutationRequested: CinenerdleControllerOptions["onItemAttrMutationRequested"],
  writeHash: (nextHash: string, mode?: "selection" | "navigation") => void,
  onExplicitTmdbRowClick?: () => void,
) {
  const card = node.data;
  const viewModel = createCardViewModel(card, {
    isSelected: node.selected,
    isLocked: false,
    isAncestorSelected: selectedAncestorCards.some((ancestorCard) =>
      cardsMatch(card, ancestorCard),
    ),
  });

  if (viewModel.kind === "dbinfo") {
    return renderDbInfoCard(viewModel);
  }

  if (viewModel.kind === "break") {
    return renderBreakCard(viewModel.name);
  }

  const rootHash = serializePathNodes([getPathNodeFromCard(card)]);
  const isCinenerdleLaunchCard = card.kind === "cinenerdle";
  const rootHref = `${window.location.pathname}${window.location.search}${rootHash}`;
  const imageLoading =
    node.selected || isViewportPriorityRow
      ? "eager"
      : "lazy";
  const imageFetchPriority =
    node.selected || isViewportPriorityRow
      ? "high"
      : "auto";

  function handleCinenerdleCardClick(event: ReactMouseEvent<HTMLElement>) {
    if (!isCinenerdleLaunchCard) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    window.open("https://www.cinenerdle2.app/battle", "_blank", "noopener,noreferrer");
  }

  const tmdbRowClickHandler =
    card.kind === "movie" || card.kind === "person"
      ? async () => {
          onExplicitTmdbRowClick?.();
          await refreshCardFromTmdb(card, {
            skipIfAlreadyHydrated: false,
          });
        }
      : null;

  const renderableViewModel = {
    ...viewModel,
    onExplicitTmdbRowClick:
      card.kind === "movie" || card.kind === "person"
        ? onExplicitTmdbRowClick ?? null
        : null,
    onTmdbRowClick: tmdbRowClickHandler,
    tmdbTooltipText:
      card.kind === "movie" || card.kind === "person"
        ? getCardTmdbRowTooltipText(card, selectedAncestorCards)
        : null,
  };

  return renderLoggedCinenerdleCard({
    imageFetchPriority,
    imageLoading,
    onAddItemAttr:
      card.kind === "movie" || card.kind === "person"
        ? (nextChar) => {
            onItemAttrMutationRequested?.({
              action: "add",
              card,
              itemAttr: nextChar,
            });
          }
        : null,
    onCardClick: handleCinenerdleCardClick,
    onRemoveItemAttr:
      card.kind === "movie" || card.kind === "person"
        ? (itemAttr) => {
            onItemAttrMutationRequested?.({
              action: "remove",
              card,
              itemAttr,
            });
          }
        : null,
    onTitleClick: (event) => {
      if (isCinenerdleLaunchCard) {
        window.open("https://www.cinenerdle2.app/battle", "_blank", "noopener,noreferrer");
        return;
      }

      if (didRequestNewTabNavigation(event)) {
        window.open(rootHref, "_blank", "noopener,noreferrer");
        return;
      }

      writeHash(rootHash, "navigation");
    },
    viewModel: renderableViewModel,
  });
}

export function getConnectedItemAttrSourceCards({
  card,
  isSelected,
  selectedAncestorCards,
  selectedChildCard,
  selectedDescendantCards,
  selectedParentCard,
}: {
  card: Extract<CinenerdleCard, { kind: "movie" | "person" }>;
  isSelected: boolean;
  selectedAncestorCards: CinenerdleCard[];
  selectedChildCard: CinenerdleCard | null;
  selectedDescendantCards: CinenerdleCard[];
  selectedParentCard: CinenerdleCard | null;
}): Array<Extract<CinenerdleCard, { kind: "movie" | "person" }>> {
  const sources = [
    ...selectedAncestorCards,
    selectedParentCard,
    isSelected ? selectedChildCard : null,
    ...(isSelected ? selectedDescendantCards : []),
  ].filter((candidate): candidate is Extract<CinenerdleCard, { kind: "movie" | "person" }> =>
    candidate !== null &&
    (candidate.kind === "movie" || candidate.kind === "person") &&
    areCardsDirectlyConnected(card, candidate),
  );

  return dedupeConnectedItemAttrSourceCards(sources);
}

export function resetConnectedItemAttrChildSourcesCache(): void {
  connectedItemAttrChildSourcesCache.clear();
  resolvedConnectedItemAttrChildSourcesCache.clear();
  resolvedMovieParentRecordCache.clear();
  resolvedPersonParentRecordCache.clear();
}

export async function getConnectedItemAttrChildSourceCards(
  card: ConnectedItemAttrSourceCard,
): Promise<ConnectedItemAttrSourceCard[]> {
  const cachedSources = connectedItemAttrChildSourcesCache.get(card.key);
  if (cachedSources) {
    return cachedSources;
  }

  const nextSourcesPromise = buildChildRowForCard(card)
    .then((childRow) =>
      dedupeConnectedItemAttrSourceCards(
        (childRow ?? [])
          .map((node) => node.data)
          .filter((candidate): candidate is ConnectedItemAttrSourceCard =>
            (candidate.kind === "movie" || candidate.kind === "person") &&
            areCardsDirectlyConnected(card, candidate),
          ),
      ),
    )
    .then((sources) => {
      resolvedConnectedItemAttrChildSourcesCache.set(card.key, sources);
      return sources;
    })
    .catch(() => {
      resolvedConnectedItemAttrChildSourcesCache.set(card.key, []);
      return [];
    });

  connectedItemAttrChildSourcesCache.set(card.key, nextSourcesPromise);
  return nextSourcesPromise;
}

export function useCinenerdleController({
  onItemAttrMutationRequested,
  onItemAttrsSnapshotChange,
  onExplicitTmdbRowClick,
  recordsRefreshVersion = 0,
  readHash,
  writeHash,
}: CinenerdleControllerOptions): GeneratorController<
  CinenerdleCard,
  CinenerdleTreeMeta,
  GeneratorLifecycleEffect<CinenerdleCard>
> {
  const latestRecordsRefreshVersionRef = useRef(recordsRefreshVersion);
  const lastHandledRecordsRefreshVersionRef = useRef(recordsRefreshVersion);
  const latestItemAttrsSnapshotRef = useRef<CinenerdleItemAttrs>(createEmptyItemAttrs());

  useLayoutEffect(() => {
    resetConnectedItemAttrChildSourcesCache();
  }, [recordsRefreshVersion]);

  useLayoutEffect(() => {
    latestRecordsRefreshVersionRef.current = recordsRefreshVersion;
  }, [recordsRefreshVersion]);

  const updateLatestItemAttrsSnapshot = useCallback((itemAttrsSnapshot: CinenerdleItemAttrs) => {
    latestItemAttrsSnapshotRef.current = itemAttrsSnapshot;
    onItemAttrsSnapshotChange?.(itemAttrsSnapshot);
  }, [onItemAttrsSnapshotChange]);

  return useMemo(
    () => ({
      createInitialState() {
        return createGeneratorState<CinenerdleCard, CinenerdleTreeMeta>({
          itemAttrsSnapshot: createEmptyItemAttrs(),
        });
      },
      reduce: reduceCinenerdleLifecycleEvent,
      async runEffect(
        effect,
        {
          applyUpdate,
          applyUrgentUpdate,
          getState,
          scrollGenerationIntoVerticalView,
          scrollGenerationLikeBubble,
          selectionId,
        },
      ) {
        const commitSelectionUpdate = applyUrgentUpdate ?? applyUpdate;

        if (effect.type === "load-initial-tree") {
          const initialHash = readHash();
          const shouldBypassInFlightCache =
            latestRecordsRefreshVersionRef.current !== lastHandledRecordsRefreshVersionRef.current;
          lastHandledRecordsRefreshVersionRef.current = latestRecordsRefreshVersionRef.current;

          await measureAsync(
            "controller.initTree",
            async () => {
              const itemAttrsSnapshot = readCinenerdleItemAttrs();

              try {
                const treeSession = await buildTreeSessionFromHash(initialHash, {
                  bypassInFlightCache: shouldBypassInFlightCache,
                  itemAttrsSnapshot,
                });
                updateLatestItemAttrsSnapshot(treeSession.itemAttrsSnapshot);
                applyUpdate({
                  meta: {
                    itemAttrsSnapshot: treeSession.itemAttrsSnapshot,
                  },
                  tree: treeSession.tree,
                });
                setTmdbLogGeneration(Math.max(0, treeSession.tree.length - 1));
                if (shouldHydrateHashPathOnInit(initialHash)) {
                  void hydrateHashPath(initialHash).catch(() => { });
                }
                if (isCinenerdleRootTree(treeSession.tree)) {
                  void syncDailyStartersWithCache().catch(() => { });
                }
              } catch {
                const fallbackTree = await prepareTreeForRender(
                  await createCinenerdleRootTree(),
                  itemAttrsSnapshot,
                );
                updateLatestItemAttrsSnapshot(itemAttrsSnapshot);
                applyUpdate({
                  meta: {
                    itemAttrsSnapshot,
                  },
                  tree: fallbackTree,
                });
                setTmdbLogGeneration(Math.max(0, fallbackTree.length - 1));
                if (shouldHydrateHashPathOnInit(initialHash)) {
                  void hydrateHashPath(initialHash).catch(() => { });
                }
                if (isCinenerdleRootTree(fallbackTree)) {
                  void syncDailyStartersWithCache().catch(() => { });
                }
              }
            },
            {
              always: true,
              details: {
                initialHash,
                shouldBypassInFlightCache,
              },
            },
          );
          return;
        }

        const tree = effect.tree;
        const selectedEffectRow = effect.row;
        const selectedEffectCol = effect.col;
        const selectedPathNodes = getSelectedPathNodes(tree);
        const nextHash = serializePathNodes(selectedPathNodes);
        const selectedCard = tree[selectedEffectRow]?.[selectedEffectCol]?.data ?? null;
        const selectedPathTree = getSelectedPathTree(tree, selectedEffectRow);
        const childGenerationIndex = selectedEffectRow + 1;
        const existingChildRow = tree[childGenerationIndex] ?? null;
        const itemAttrsSnapshot =
          getItemAttrsSnapshotFromGeneratorState(
            getState() as GeneratorState<CinenerdleCard, CinenerdleTreeMeta | undefined>,
          ) ?? latestItemAttrsSnapshotRef.current;

        if (effect.isReselection) {
          if (
            existingChildRow &&
            existingChildRow.length > 0 &&
            selectedCard &&
            (selectedCard.kind === "cinenerdle" ||
              selectedCard.kind === "movie" ||
              selectedCard.kind === "person")
          ) {
            void measureAsync(
              "controller.afterCardReselected",
              async () => {
                await scrollGenerationIntoVerticalView(childGenerationIndex, {
                  alignRowHorizontally: false,
                });

                if (selectedCard.kind === "movie" || selectedCard.kind === "person") {
                  scheduleConnectionPrefetch(selectedCard);
                }
                void scrollGenerationLikeBubble(childGenerationIndex).catch(() => { });
                return existingChildRow;
              },
              {
                always: true,
                details: {
                  hash: nextHash,
                  selectedCardKey: selectedCard.key,
                  selectedCardKind: selectedCard.kind,
                },
                summarizeResult: (resolvedChildRow) => ({
                  childCount: resolvedChildRow?.length ?? 0,
                }),
              },
            ).catch(() => { });
          }
          writeHash(nextHash, "selection");
          return;
        }

        if (
          selectedCard &&
          (selectedCard.kind === "cinenerdle" ||
            selectedCard.kind === "movie" ||
            selectedCard.kind === "person")
        ) {
          void measureAsync(
            "controller.afterCardSelected",
            async () => {
              let didRevealChildGeneration = false;
              const selectionStartedAt = getCinenerdleDebugNow();
              function logNewRowDebug(
                event: string,
                details?: Record<string, unknown>,
              ) {
                addCinenerdleDebugLog(event, {
                  childGenerationIndex,
                  row: selectedEffectRow,
                  selectedCardKey: selectedCard.key,
                  selectedCardKind: selectedCard.kind,
                  selectionId,
                  totalElapsedMs: roundCinenerdleDebugElapsedMs(
                    getCinenerdleDebugNow() - selectionStartedAt,
                  ),
                  ...details,
                });
              }

              async function revealChildGenerationVertically(
                childRow: GeneratorNode<CinenerdleCard>[] | null,
              ) {
                if (!childRow || childRow.length === 0 || didRevealChildGeneration) {
                  return;
                }

                const revealStartedAt = getCinenerdleDebugNow();
                await scrollGenerationIntoVerticalView(childGenerationIndex, {
                  alignRowHorizontally: false,
                });
                didRevealChildGeneration = true;
                logNewRowDebug("perf:controller.newRowRevealed", {
                  childCount: childRow.length,
                  revealElapsedMs: roundCinenerdleDebugElapsedMs(
                    getCinenerdleDebugNow() - revealStartedAt,
                  ),
                });
              }

              async function scrollFinalizedChildGenerationHorizontally(
                childRow: GeneratorNode<CinenerdleCard>[] | null,
              ) {
                if (!childRow || childRow.length === 0) {
                  return;
                }

                await revealChildGenerationVertically(childRow);
                await scrollGenerationLikeBubble(childGenerationIndex);
              }

              const initialSelectionResolveStartedAt = getCinenerdleDebugNow();
              const initialSelection =
                selectedCard.kind === "movie" || selectedCard.kind === "person"
                  ? await resolveInitialSelectedCard(selectedCard)
                  : {
                      selectedCard,
                      movieRecord: undefined,
                      personRecord: undefined,
                    };
              const initialSelectionResolveElapsedMs = roundCinenerdleDebugElapsedMs(
                getCinenerdleDebugNow() - initialSelectionResolveStartedAt,
              );
              const initialMovieRecord =
                initialSelection.selectedCard.kind === "movie"
                  ? initialSelection.movieRecord ?? null
                  : undefined;
              const initialPersonRecord =
                initialSelection.selectedCard.kind === "person"
                  ? initialSelection.personRecord ?? null
                  : undefined;
              const initialSelectedTreeBase =
                initialSelection.selectedCard === selectedCard
                  ? selectedPathTree
                  : replaceTreeNodeCard(
                      selectedPathTree,
                      selectedEffectRow,
                      selectedEffectCol,
                      initialSelection.selectedCard,
                    );
              const initialChildRowBuildStartedAt = getCinenerdleDebugNow();
              const initialLongTaskObserverSupported = ensureCinenerdleLongTaskObserver();
              logNewRowDebug("perf:controller.selectedChildRowBuildRequested", {
                hasMovieRecordOverride: initialMovieRecord !== undefined,
                hasPersonRecordOverride: initialPersonRecord !== undefined,
                longTaskObserverSupported: initialLongTaskObserverSupported,
                movieOverrideHasCredits: Boolean(initialMovieRecord?.rawTmdbMovieCreditsResponse),
                personOverrideHasCredits: Boolean(initialPersonRecord?.rawTmdbMovieCreditsResponse),
              });
              const initialChildRow = await buildChildRowForCard(initialSelection.selectedCard, {
                movieRecord: initialMovieRecord,
                personRecord: initialPersonRecord,
              });
              const initialChildRowBuildEndedAt = getCinenerdleDebugNow();
              const initialChildRowBuildElapsedMs = roundCinenerdleDebugElapsedMs(
                initialChildRowBuildEndedAt - initialChildRowBuildStartedAt,
              );
              logCinenerdleLongTasksForWindow(
                "perf:controller.selectedChildRowBuildLongTasks",
                initialChildRowBuildStartedAt,
                initialChildRowBuildEndedAt,
                {
                  childCount: initialChildRow?.length ?? 0,
                  hasMovieRecordOverride: initialMovieRecord !== undefined,
                  hasPersonRecordOverride: initialPersonRecord !== undefined,
                },
              );
              const initialSelectedTree = appendChildRow(
                initialSelectedTreeBase,
                initialChildRow,
              );
              const initialPrepareTreeStartedAt = getCinenerdleDebugNow();
              const preparedInitialTree = await prepareTreeRowsForRender(
                initialSelectedTree,
                itemAttrsSnapshot,
                [
                  ...(initialSelection.selectedCard === selectedCard ? [] : [selectedEffectRow]),
                  ...(initialChildRow && initialChildRow.length > 0 ? [childGenerationIndex] : []),
                ],
              );
              const initialPrepareTreeElapsedMs = roundCinenerdleDebugElapsedMs(
                getCinenerdleDebugNow() - initialPrepareTreeStartedAt,
              );
              const initialCommitStartedAt = getCinenerdleDebugNow();
              commitSelectionUpdate({
                meta: {
                  itemAttrsSnapshot,
                },
                tree: preparedInitialTree,
              });
              logNewRowDebug("perf:controller.localTreeCommitted", {
                childCount: initialChildRow?.length ?? 0,
                commitElapsedMs: roundCinenerdleDebugElapsedMs(
                  getCinenerdleDebugNow() - initialCommitStartedAt,
                ),
                prepareTreeElapsedMs: initialPrepareTreeElapsedMs,
                rowCount: preparedInitialTree.length,
                resolveSelectedCardElapsedMs: initialSelectionResolveElapsedMs,
                resolvedCardKey: initialSelection.selectedCard.key,
                resolvedCardKind: initialSelection.selectedCard.kind,
                selectedChildRowBuildElapsedMs: initialChildRowBuildElapsedMs,
              });

              setTmdbLogGeneration(Math.max(0, preparedInitialTree.length - 1));
              await revealChildGenerationVertically(initialChildRow);

              if (
                initialSelection.selectedCard.kind !== "movie" &&
                initialSelection.selectedCard.kind !== "person"
              ) {
                void scrollFinalizedChildGenerationHorizontally(initialChildRow).catch(() => { });
                return initialChildRow;
              }

              const tmdbRefreshStartedAt = getCinenerdleDebugNow();
              const refreshResult = await refreshCardFromTmdb(initialSelection.selectedCard, {
                skipIfAlreadyHydrated: true,
              });
              logNewRowDebug("perf:controller.tmdbRefreshCompleted", {
                didRefresh: refreshResult.didRefresh,
                refreshElapsedMs: roundCinenerdleDebugElapsedMs(
                  getCinenerdleDebugNow() - tmdbRefreshStartedAt,
                ),
                refreshedCardKey: refreshResult.refreshedCard.key,
                refreshedCardKind: refreshResult.refreshedCard.kind,
              });
              if (!refreshResult.didRefresh) {
                void scrollFinalizedChildGenerationHorizontally(initialChildRow).catch(() => { });
                return initialChildRow;
              }

              const refreshedSelectedTreeBase = replaceTreeNodeCard(
                initialSelectedTreeBase,
                selectedEffectRow,
                selectedEffectCol,
                refreshResult.refreshedCard,
              );
              const refreshedChildRowBuildStartedAt = getCinenerdleDebugNow();
              const refreshedLongTaskObserverSupported = ensureCinenerdleLongTaskObserver();
              logNewRowDebug("perf:controller.refreshedChildRowBuildRequested", {
                hasMovieRecordOverride: refreshResult.refreshedCard.kind === "movie",
                hasPersonRecordOverride: refreshResult.refreshedCard.kind === "person",
                longTaskObserverSupported: refreshedLongTaskObserverSupported,
                movieOverrideHasCredits: Boolean(
                  refreshResult.refreshedCard.kind === "movie"
                    ? refreshResult.refreshedCard.record?.rawTmdbMovieCreditsResponse
                    : false,
                ),
                personOverrideHasCredits: Boolean(
                  refreshResult.refreshedCard.kind === "person"
                    ? refreshResult.refreshedCard.record?.rawTmdbMovieCreditsResponse
                    : false,
                ),
              });
              const refreshedChildRow = await buildChildRowForCard(refreshResult.refreshedCard, {
                movieRecord:
                  refreshResult.refreshedCard.kind === "movie"
                    ? refreshResult.refreshedCard.record
                    : undefined,
                personRecord:
                  refreshResult.refreshedCard.kind === "person"
                    ? refreshResult.refreshedCard.record
                    : undefined,
              });
              const refreshedChildRowBuildEndedAt = getCinenerdleDebugNow();
              const refreshedChildRowBuildElapsedMs = roundCinenerdleDebugElapsedMs(
                refreshedChildRowBuildEndedAt - refreshedChildRowBuildStartedAt,
              );
              logCinenerdleLongTasksForWindow(
                "perf:controller.refreshedChildRowBuildLongTasks",
                refreshedChildRowBuildStartedAt,
                refreshedChildRowBuildEndedAt,
                {
                  childCount: refreshedChildRow?.length ?? 0,
                  refreshedCardKey: refreshResult.refreshedCard.key,
                  refreshedCardKind: refreshResult.refreshedCard.kind,
                },
              );
              const refreshedTree = appendChildRow(
                refreshedSelectedTreeBase,
                refreshedChildRow,
              );
              const refreshedPrepareTreeStartedAt = getCinenerdleDebugNow();
              const preparedRefreshedTree = await prepareTreeRowsForRender(
                refreshedTree,
                itemAttrsSnapshot,
                [
                  selectedEffectRow,
                  ...(refreshedChildRow && refreshedChildRow.length > 0 ? [childGenerationIndex] : []),
                ],
              );
              const refreshedPrepareTreeElapsedMs = roundCinenerdleDebugElapsedMs(
                getCinenerdleDebugNow() - refreshedPrepareTreeStartedAt,
              );
              const refreshedCommitStartedAt = getCinenerdleDebugNow();
              commitSelectionUpdate({
                meta: {
                  itemAttrsSnapshot,
                },
                tree: preparedRefreshedTree,
              });
              logNewRowDebug("perf:controller.tmdbTreeCommitted", {
                childCount: refreshedChildRow?.length ?? 0,
                commitElapsedMs: roundCinenerdleDebugElapsedMs(
                  getCinenerdleDebugNow() - refreshedCommitStartedAt,
                ),
                prepareTreeElapsedMs: refreshedPrepareTreeElapsedMs,
                refreshedCardKey: refreshResult.refreshedCard.key,
                rowCount: preparedRefreshedTree.length,
                selectedChildRowBuildElapsedMs: refreshedChildRowBuildElapsedMs,
              });

              setTmdbLogGeneration(Math.max(0, preparedRefreshedTree.length - 1));
              void scrollFinalizedChildGenerationHorizontally(refreshedChildRow).catch(() => { });

              return refreshedChildRow;
            },
            {
              always: true,
              details: {
                hash: nextHash,
                selectedCardKey: selectedCard.key,
                selectedCardKind: selectedCard.kind,
              },
              summarizeResult: (resolvedChildRow) => ({
                childCount: resolvedChildRow?.length ?? 0,
              }),
            },
          )
            .catch(() => {
              applyUpdate({
                meta: {
                  itemAttrsSnapshot,
                },
                tree: selectedPathTree,
              });
            });
        } else {
          applyUpdate({
            meta: {
              itemAttrsSnapshot,
            },
            tree: selectedPathTree,
          });
        }

        writeHash(nextHash, "selection");
      },
      renderCard({
        node,
        isViewportPriorityRow,
        selectedAncestorData,
      }) {
        return renderCinenerdleCard(
          node,
          isViewportPriorityRow,
          selectedAncestorData,
          onItemAttrMutationRequested,
          writeHash,
          onExplicitTmdbRowClick,
        );
      },
    }),
    [
      onExplicitTmdbRowClick,
      onItemAttrMutationRequested,
      readHash,
      updateLatestItemAttrsSnapshot,
      writeHash,
    ],
  );
}

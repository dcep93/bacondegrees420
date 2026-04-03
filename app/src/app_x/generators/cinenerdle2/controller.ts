import { useLayoutEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
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
import { getCinenerdleItemAttrCounts } from "./entity_card_ordering";
import {
  getCinenerdleItemAttrTargetFromCard,
  getItemAttrsForTarget,
  readCinenerdleItemAttrs,
  type CinenerdleItemAttrs,
  type CinenerdleItemAttrTarget,
} from "./item_attrs";
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

async function preloadConnectedItemAttrChildSourcesForTree(
  tree: GeneratorTree<CinenerdleCard>,
): Promise<number> {
  const entityCards = dedupeConnectedItemAttrSourceCards(
    tree.flatMap((row) =>
      row
        .map((node) => node.data)
        .filter((card): card is ConnectedItemAttrSourceCard =>
          card.kind === "movie" || card.kind === "person"),
    ),
  );

  if (entityCards.length === 0) {
    return 0;
  }

  let batchCount = 0;

  for (let index = 0; index < entityCards.length; index += CONNECTED_ITEM_ATTR_PRELOAD_BATCH_SIZE) {
    const batch = entityCards.slice(index, index + CONNECTED_ITEM_ATTR_PRELOAD_BATCH_SIZE);
    batchCount += 1;
    await Promise.all(
      batch.map((card) => getConnectedItemAttrChildSourceCards(card)),
    );

    if (index + CONNECTED_ITEM_ATTR_PRELOAD_BATCH_SIZE < entityCards.length) {
      await waitForBackgroundPrepareYield();
    }
  }

  return batchCount;
}

function getConnectedItemAttrSourcesForRenderContext({
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
}): ConnectedItemAttrSourceCard[] {
  return dedupeConnectedItemAttrSourceCards([
    ...getConnectedItemAttrSourceCards({
      card,
      isSelected,
      selectedAncestorCards,
      selectedChildCard,
      selectedDescendantCards,
      selectedParentCard,
    }),
    ...(resolvedConnectedItemAttrChildSourcesCache.get(card.key) ?? []),
  ]);
}

type RowOrderMetadataSeedProfile = {
  connectedSourceCountTotal: number;
  connectedSourceLookupElapsedMs: number;
  countBuildElapsedMs: number;
  entityCardCount: number;
  inheritedItemAttrBuildElapsedMs: number;
  itemAttrLookupCallCount: number;
  itemAttrLookupElapsedMs: number;
  maxConnectedSourceCount: number;
  maxInheritedItemAttrCount: number;
  metadataCallCount: number;
  passiveItemAttrCountTotal: number;
  targetResolveElapsedMs: number;
};

function getItemAttrsForTargetFromSnapshot(
  itemAttrsSnapshot: CinenerdleItemAttrs | null | undefined,
  target: CinenerdleItemAttrTarget,
): string[] {
  if (!itemAttrsSnapshot) {
    return getItemAttrsForTarget(target);
  }

  return itemAttrsSnapshot[target.bucket][target.id] ?? [];
}

function getCardRowOrderMetadata({
  card,
  itemAttrsSnapshot,
  profile,
  isSelected,
  selectedAncestorCards,
  selectedChildCard,
  selectedDescendantCards,
  selectedParentCard,
}: {
  card: CinenerdleCard;
  itemAttrsSnapshot?: CinenerdleItemAttrs | null;
  profile?: RowOrderMetadataSeedProfile;
  isSelected: boolean;
  selectedAncestorCards: CinenerdleCard[];
  selectedChildCard: CinenerdleCard | null;
  selectedDescendantCards: CinenerdleCard[];
  selectedParentCard: CinenerdleCard | null;
}): GeneratorNode<CinenerdleCard>["rowOrderMetadata"] {
  if (profile) {
    profile.metadataCallCount += 1;
  }

  if (card.kind !== "movie" && card.kind !== "person") {
    return null;
  }

  if (profile) {
    profile.entityCardCount += 1;
  }

  const targetResolveStartedAt = profile ? getCinenerdleDebugNow() : 0;
  const itemAttrTarget = getCinenerdleItemAttrTargetFromCard(card);
  if (profile) {
    profile.targetResolveElapsedMs += getCinenerdleDebugNow() - targetResolveStartedAt;
  }
  if (!itemAttrTarget) {
    return null;
  }

  const itemAttrsStartedAt = profile ? getCinenerdleDebugNow() : 0;
  const itemAttrs = getItemAttrsForTargetFromSnapshot(itemAttrsSnapshot, itemAttrTarget);
  if (profile) {
    profile.itemAttrLookupCallCount += 1;
    profile.itemAttrLookupElapsedMs += getCinenerdleDebugNow() - itemAttrsStartedAt;
  }

  const connectedSourcesStartedAt = profile ? getCinenerdleDebugNow() : 0;
  const connectedSources = getConnectedItemAttrSourcesForRenderContext({
    card,
    isSelected,
    selectedAncestorCards,
    selectedChildCard,
    selectedDescendantCards,
    selectedParentCard,
  });
  if (profile) {
    profile.connectedSourceLookupElapsedMs += getCinenerdleDebugNow() - connectedSourcesStartedAt;
    profile.connectedSourceCountTotal += connectedSources.length;
    profile.maxConnectedSourceCount = Math.max(
      profile.maxConnectedSourceCount,
      connectedSources.length,
    );
  }

  const inheritedItemAttrsStartedAt = profile ? getCinenerdleDebugNow() : 0;
  const inheritedItemAttrs = connectedSources.reduce<string[]>((allItemAttrs, source) => {
    const sourceTarget = getCinenerdleItemAttrTargetFromCard(source);
    if (!sourceTarget) {
      return allItemAttrs;
    }

    const sourceItemAttrsStartedAt = profile ? getCinenerdleDebugNow() : 0;
    getItemAttrsForTargetFromSnapshot(itemAttrsSnapshot, sourceTarget).forEach((itemAttr) => {
      if (!itemAttrs.includes(itemAttr) && !allItemAttrs.includes(itemAttr)) {
        allItemAttrs.push(itemAttr);
      }
    });
    if (profile) {
      profile.itemAttrLookupCallCount += 1;
      profile.itemAttrLookupElapsedMs += getCinenerdleDebugNow() - sourceItemAttrsStartedAt;
    }
    return allItemAttrs;
  }, []);
  if (profile) {
    profile.inheritedItemAttrBuildElapsedMs += getCinenerdleDebugNow() - inheritedItemAttrsStartedAt;
    profile.maxInheritedItemAttrCount = Math.max(
      profile.maxInheritedItemAttrCount,
      inheritedItemAttrs.length,
    );
    profile.passiveItemAttrCountTotal += inheritedItemAttrs.length;
  }

  const countBuildStartedAt = profile ? getCinenerdleDebugNow() : 0;
  const counts = getCinenerdleItemAttrCounts(itemAttrs, inheritedItemAttrs);
  if (profile) {
    profile.countBuildElapsedMs += getCinenerdleDebugNow() - countBuildStartedAt;
  }

  return counts;
}

function seedTreeRowOrderMetadata(
  tree: GeneratorTree<CinenerdleCard>,
): GeneratorTree<CinenerdleCard> {
  const itemAttrsSnapshot = readCinenerdleItemAttrs();
  const profile: RowOrderMetadataSeedProfile = {
    connectedSourceCountTotal: 0,
    connectedSourceLookupElapsedMs: 0,
    countBuildElapsedMs: 0,
    entityCardCount: 0,
    inheritedItemAttrBuildElapsedMs: 0,
    itemAttrLookupCallCount: 0,
    itemAttrLookupElapsedMs: 0,
    maxConnectedSourceCount: 0,
    maxInheritedItemAttrCount: 0,
    metadataCallCount: 0,
    passiveItemAttrCountTotal: 0,
    targetResolveElapsedMs: 0,
  };
  const selectedAncestorCards: CinenerdleCard[] = [];
  const selectedDescendantCardsByGeneration: CinenerdleCard[][] = tree.map(() => []);
  const selectedDescendantCards: CinenerdleCard[] = [];

  for (let generationIndex = tree.length - 1; generationIndex >= 0; generationIndex -= 1) {
    selectedDescendantCardsByGeneration[generationIndex] = [...selectedDescendantCards];
    const selectedNode = tree[generationIndex]?.find((node) => node.selected);
    if (selectedNode) {
      selectedDescendantCards.unshift(selectedNode.data);
    }
  }

  const seededTree = tree.map((row, generationIndex) => {
    const rowStartedAt = getCinenerdleDebugNow();
    const profileSnapshot = { ...profile };
    const selectedParentCard =
      generationIndex > 0
        ? tree[generationIndex - 1]?.find((node) => node.selected)?.data ?? null
        : null;
    const selectedChildCard =
      tree[generationIndex + 1]?.find((node) => node.selected)?.data ?? null;
    const selectedDescendantCardsForGeneration =
      selectedDescendantCardsByGeneration[generationIndex] ?? [];
    const nextRow = row.map((node) => createNode(
      node.data,
      node.selected,
      node.disabled ?? false,
      getCardRowOrderMetadata({
        card: node.data,
        itemAttrsSnapshot,
        profile,
        isSelected: node.selected,
        selectedAncestorCards,
        selectedChildCard,
        selectedDescendantCards: selectedDescendantCardsForGeneration,
        selectedParentCard,
      }),
    ));

    const selectedNode = row.find((node) => node.selected);
    if (selectedNode) {
      selectedAncestorCards.push(selectedNode.data);
    }

    void profileSnapshot;
    void rowStartedAt;

    return nextRow;
  });

  return seededTree;
}

async function prepareTreeForRender(
  tree: GeneratorTree<CinenerdleCard>,
): Promise<GeneratorTree<CinenerdleCard>> {
  const preparedTree = await prepareTreeForRenderWithTimings(tree);
  return preparedTree.tree;
}

type PreparedTreeForRenderResult = {
  entityCardCount: number;
  preloadBatchCount: number;
  preloadElapsedMs: number;
  seedElapsedMs: number;
  tree: GeneratorTree<CinenerdleCard>;
};

async function prepareTreeForRenderWithTimings(
  tree: GeneratorTree<CinenerdleCard>,
): Promise<PreparedTreeForRenderResult> {
  const startedAt = getCinenerdleDebugNow();
  const entityCardCount = tree.flatMap((row) => row)
    .filter((node) => node.data.kind === "movie" || node.data.kind === "person")
    .length;
  const preloadStartedAt = getCinenerdleDebugNow();
  const preloadBatchCount = await preloadConnectedItemAttrChildSourcesForTree(tree);
  const preloadElapsedMs = roundCinenerdleDebugElapsedMs(
    getCinenerdleDebugNow() - preloadStartedAt,
  );
  const seedStartedAt = getCinenerdleDebugNow();
  const preparedTree = seedTreeRowOrderMetadata(tree);
  const seedElapsedMs = roundCinenerdleDebugElapsedMs(
    getCinenerdleDebugNow() - seedStartedAt,
  );
  void startedAt;

  return {
    entityCardCount,
    preloadBatchCount,
    preloadElapsedMs,
    seedElapsedMs,
    tree: preparedTree,
  };
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
  onExplicitTmdbRowClick?: () => void;
  recordsRefreshVersion?: number;
  readHash: () => string;
  writeHash: (nextHash: string, mode?: "selection" | "navigation") => void;
};

type BuildTreeOptions = {
  bypassInFlightCache?: boolean;
};

const inFlightTreeBuilds = new Map<string, Promise<GeneratorTree<CinenerdleCard>>>();
let syncDailyStartersWithCachePromise: Promise<void> | null = null;
const CONNECTED_ITEM_ATTR_PRELOAD_BATCH_SIZE = 24;
const INITIAL_VIEWPORT_SETTLE_TIMEOUT_MS = 2500;
let resolveInitialViewportSettledPromise: (() => void) | null = null;
let initialViewportSettledPromise: Promise<void> = Promise.resolve();

function createInitialViewportSettledPromise(): Promise<void> {
  return new Promise<void>((resolve) => {
    resolveInitialViewportSettledPromise = () => {
      resolveInitialViewportSettledPromise = null;
      resolve();
    };
  });
}

export function resetInitialViewportSettled(): void {
  resolveInitialViewportSettledPromise?.();
  initialViewportSettledPromise = createInitialViewportSettledPromise();
}

export function markInitialViewportSettled(): void {
  resolveInitialViewportSettledPromise?.();
}

async function waitForBrowserPaint(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  if (typeof window.requestAnimationFrame !== "function") {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    return;
  }

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

async function waitForInitialViewportSettled(timeoutMs = INITIAL_VIEWPORT_SETTLE_TIMEOUT_MS): Promise<void> {
  if (timeoutMs <= 0) {
    return;
  }

  const scheduleTimeout =
    typeof window !== "undefined" && typeof window.setTimeout === "function"
      ? window.setTimeout.bind(window)
      : setTimeout;
  const viewportSettledPromise = initialViewportSettledPromise;

  await Promise.race([
    viewportSettledPromise,
    new Promise<void>((resolve) => {
      scheduleTimeout(() => {
        resolve();
      }, timeoutMs);
    }),
  ]);
}

async function waitForBackgroundPrepareYield(): Promise<void> {
  if (typeof window === "undefined") {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    return;
  }

  if (typeof window.requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        resolve();
      });
    });
    return;
  }

  const scheduleTimeout =
    typeof window.setTimeout === "function"
      ? window.setTimeout.bind(window)
      : setTimeout;

  await new Promise<void>((resolve) => {
    scheduleTimeout(() => {
      resolve();
    }, 0);
  });
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

export function reduceCinenerdleLifecycleEvent(
  state: GeneratorState<CinenerdleCard, undefined>,
  event: GeneratorLifecycleEvent,
): GeneratorTransition<CinenerdleCard, undefined, GeneratorLifecycleEffect<CinenerdleCard>> {
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
  const [personRecordById, personRecordByName] = await Promise.all([
    validPersonTmdbId ? getPersonRecordById(validPersonTmdbId) : Promise.resolve(null),
    personName ? getPersonRecordByName(personName) : Promise.resolve(null),
  ]);
  const personRecordByIdTmdbId = getValidTmdbEntityId(
    personRecordById?.tmdbId ?? personRecordById?.id,
  );
  const personRecordByNameTmdbId = getValidTmdbEntityId(
    personRecordByName?.tmdbId ?? personRecordByName?.id,
  );

  if (
    validPersonTmdbId &&
    personRecordByIdTmdbId === validPersonTmdbId &&
    personRecordByNameTmdbId !== validPersonTmdbId
  ) {
    return personRecordById;
  }

  if (
    validPersonTmdbId &&
    !personRecordById &&
    personRecordByName &&
    personRecordByNameTmdbId !== validPersonTmdbId
  ) {
    return null;
  }

  const chosenRecord = pickBestPersonRecord(personRecordById, personRecordByName);

  return chosenRecord;
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
  const [movieRecordById, movieRecordByTitleAndYear] = await Promise.all([
    validMovieTmdbId ? getFilmRecordById(validMovieTmdbId) : Promise.resolve(null),
    movieName ? getFilmRecordByTitleAndYear(movieName, movieYear) : Promise.resolve(null),
  ]);

  return pickBestMovieRecord(movieRecordById, movieRecordByTitleAndYear);
}

async function resolveMovieParentRecord(
  card: Extract<CinenerdleCard, { kind: "movie" }>,
  movieRecordOverride?: FilmRecord | null,
): Promise<FilmRecord | null> {
  const localMovieRecord = await getLocalMovieRecord(
    card.name,
    card.year,
    card.record?.tmdbId ?? card.record?.id ?? null,
  );

  return pickBestMovieRecord(movieRecordOverride, card.record, localMovieRecord);
}

async function resolvePersonParentRecord(
  card: Extract<CinenerdleCard, { kind: "person" }>,
  personRecordOverride?: PersonRecord | null,
): Promise<PersonRecord | null> {
  const localPersonRecord = await getLocalPersonRecord(
    card.name,
    getPersonTmdbIdFromCard(card),
  );

  return pickBestPersonRecord(personRecordOverride, card.record, localPersonRecord);
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

function replaceOrAppendChildRow(
  tree: GeneratorTree<CinenerdleCard>,
  childRowIndex: number,
  childRow: GeneratorNode<CinenerdleCard>[] | null,
): GeneratorTree<CinenerdleCard> {
  if (!childRow || childRow.length === 0) {
    return tree;
  }

  if (!tree[childRowIndex]) {
    return [...tree, childRow];
  }

  return tree.map((row, index) => (
    index === childRowIndex ? childRow : row
  ));
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
      const personRecord = await resolvePersonParentRecord(card, personRecordOverride);
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
        const popularityByPersonName = await getPersonPopularityByNames(
          fallbackFilms.flatMap(({ movieRecord }) => movieRecord?.personConnectionKeys ?? []),
        );
        const connectionCounts = await getPersonRecordCountsByMovieKeys(movieKeys);
        const connectionParentLabel = card.name;
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

        return createRow(childCards);
      }

      const movieCredits = movieCreditGroups.map((group) => group[0]).filter(Boolean);
      const filmRecordsById = await getFilmRecordsByIds(
        movieCredits
          .map((credit) => credit.id)
          .filter((creditId): creditId is number => typeof creditId === "number"),
      );
      const popularityByPersonName = await getPersonPopularityByNames(
        Array.from(filmRecordsById.values()).flatMap((filmRecord) => filmRecord.personConnectionKeys),
      );
      const connectionCounts = await getPersonRecordCountsByMovieKeys(
        movieCredits.map((credit) => getMovieKeyFromCredit(credit)),
      );
      const parentPersonRecord = personRecord;
      const connectionParentLabel = card.name;
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
      const movieRecord = await resolveMovieParentRecord(card, movieRecordOverride);
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

        const cachedPersonRecords = await Promise.all(
          personNames.map(async (personName) => [
            personName,
            await getLocalPersonRecord(personName),
          ] as const),
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
        const moviePopularityByLabel = await getMoviePopularityByLabels(movieLabels);
        const popularityByMovieKey = new Map(
          movieLabels.map((movieLabel) => {
            const parsedMovie = parseMoviePathLabel(movieLabel);
            return [
              getFilmKey(parsedMovie.name, parsedMovie.year),
              moviePopularityByLabel.get(normalizeTitle(movieLabel)) ?? 0,
            ] as const;
          }),
        );
        const filmConnectionCounts = await getFilmRecordCountsByPersonConnectionKeys(personNames);
        const connectionParentLabel = formatMoviePathLabel(card.name, card.year);
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

        return createRow(childCards);
      }

      const tmdbCredits = tmdbCreditGroups.map((group) => group[0]).filter(Boolean);
      const filmConnectionCounts = await getFilmRecordCountsByPersonConnectionKeys(
        tmdbCredits.map((credit) => credit.name ?? ""),
      );
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
      const movieLabels = Array.from(
        new Set(
          cachedPersonRecords.flatMap(([, , personRecord]) =>
            personRecord
              ? personRecord.movieConnectionKeys.map((movieKey) => {
                  const parsedMovie = parseMoviePathLabel(movieKey);
                  return formatMoviePathLabel(parsedMovie.name, parsedMovie.year);
                })
              : []),
        ),
      );
      const moviePopularityByLabel = await getMoviePopularityByLabels(movieLabels);
      const popularityByMovieKey = new Map(
        movieLabels.map((movieLabel) => {
          const parsedMovie = parseMoviePathLabel(movieLabel);
          return [
            getFilmKey(parsedMovie.name, parsedMovie.year),
            moviePopularityByLabel.get(normalizeTitle(movieLabel)) ?? 0,
          ] as const;
        }),
      );
      const personDetails = new Map(
        cachedPersonRecords.map(([personKey, personName, cachedPersonRecord]) => [
          personKey,
          {
            connectionCount: getResolvedPersonConnectionCount(
              personName,
              cachedPersonRecord,
              filmConnectionCounts,
            ),
            connectionRank: getParentMovieRankForPerson(
              movieRecord,
              cachedPersonRecord,
              popularityByMovieKey,
            ),
            personRecord: cachedPersonRecord,
          },
        ]),
      );

      const connectionParentLabel = formatMoviePathLabel(card.name, card.year);
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
            connectionRank: getParentMovieRankForPerson(
              movieRecord,
              cachedPersonRecord,
              popularityByMovieKey,
            ),
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
  const cacheKey = getTreeBuildCacheKey(hashValue);
  const cachedPromise =
    options?.bypassInFlightCache
      ? null
      : inFlightTreeBuilds.get(cacheKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  let treeBuildPromise: Promise<GeneratorTree<CinenerdleCard>>;
  treeBuildPromise = measureAsync(
    "controller.buildTreeFromHash",
    async () => {
      const tree = await buildTreeFromHashBase(hashValue);
      const preparedTreeResult = await prepareTreeForRenderWithTimings(tree);
      return preparedTreeResult.tree;
    },
    {
      always: true,
      details: {
        hash: hashValue,
      },
      summarizeResult: (tree) => ({
        rowCount: tree.length,
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
  rowIndex: number,
  rowCount: number,
  selectedAncestorCards: CinenerdleCard[],
  selectedChildCard: CinenerdleCard | null,
  selectedDescendantCards: CinenerdleCard[],
  selectedParentCard: CinenerdleCard | null,
  reportRowOrderMetadata: ((metadata: { activeCount: number; passiveCount: number; } | null) => void) | undefined,
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
  const connectedItemAttrSources =
    card.kind === "movie" || card.kind === "person"
      ? getConnectedItemAttrSourcesForRenderContext({
        card,
        isSelected: node.selected,
        selectedAncestorCards,
        selectedChildCard,
        selectedDescendantCards,
        selectedParentCard,
      })
      : [];
  const isInitialViewportPriorityRow = rowIndex >= Math.max(0, rowCount - 2);
  const imageLoading =
    node.selected || isInitialViewportPriorityRow
      ? "eager"
      : "lazy";
  const imageFetchPriority =
    node.selected || isInitialViewportPriorityRow
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
    connectedItemAttrSources,
    imageFetchPriority,
    imageLoading,
    onItemAttrCountsChange: reportRowOrderMetadata ?? null,
    onCardClick: handleCinenerdleCardClick,
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
  onExplicitTmdbRowClick,
  recordsRefreshVersion = 0,
  readHash,
  writeHash,
}: CinenerdleControllerOptions): GeneratorController<
  CinenerdleCard,
  undefined,
  GeneratorLifecycleEffect<CinenerdleCard>
> {
  const latestRecordsRefreshVersionRef = useRef(recordsRefreshVersion);
  const lastHandledRecordsRefreshVersionRef = useRef(recordsRefreshVersion);

  useLayoutEffect(() => {
    resetConnectedItemAttrChildSourcesCache();
  }, [recordsRefreshVersion]);

  useLayoutEffect(() => {
    latestRecordsRefreshVersionRef.current = recordsRefreshVersion;
  }, [recordsRefreshVersion]);

  return useMemo(
    () => ({
      createInitialState() {
        return createGeneratorState<CinenerdleCard, undefined>(undefined);
      },
      reduce: reduceCinenerdleLifecycleEvent,
      async runEffect(
        effect,
        {
          applyUpdate,
          applyUrgentUpdate,
          scrollGenerationIntoVerticalView,
          scrollGenerationLikeBubble,
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
              try {
                const baseTree = await buildTreeFromHashBase(initialHash);
                applyUpdate({
                  tree: baseTree,
                });
                setTmdbLogGeneration(Math.max(0, baseTree.length - 1));
                if (shouldHydrateHashPathOnInit(initialHash)) {
                  void hydrateHashPath(initialHash).catch(() => { });
                }
                if (isCinenerdleRootTree(baseTree)) {
                  void syncDailyStartersWithCache().catch(() => { });
                }

                await waitForBrowserPaint();
                await waitForInitialViewportSettled();

                const preparedTreeResult = await prepareTreeForRenderWithTimings(baseTree);
                const hydratedNextTree = preparedTreeResult.tree;
                applyUpdate({
                  tree: hydratedNextTree,
                });
              } catch {
                const fallbackTree = await prepareTreeForRender(await createCinenerdleRootTree());
                applyUpdate({
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

                if (
                  selectedCard.kind !== "movie" &&
                  selectedCard.kind !== "person"
                ) {
                  await scrollGenerationLikeBubble(childGenerationIndex);
                  return existingChildRow;
                }

                const refreshResult = await refreshCardFromTmdb(selectedCard, {
                  skipIfAlreadyHydrated: true,
                });
                const refreshedChildRow = refreshResult.didRefresh
                  ? await buildChildRowForCard(refreshResult.refreshedCard)
                  : existingChildRow;
                const finalizedChildRow =
                  refreshedChildRow && refreshedChildRow.length > 0
                    ? refreshedChildRow
                    : existingChildRow;

                if (
                  refreshResult.refreshedCard !== selectedCard ||
                  finalizedChildRow !== existingChildRow
                ) {
                  const refreshedTreeBase = replaceTreeNodeCard(
                    tree,
                    effect.row,
                    effect.col,
                    refreshResult.refreshedCard,
                  );
                  const refreshedTree =
                    finalizedChildRow === existingChildRow
                      ? refreshedTreeBase
                      : replaceOrAppendChildRow(
                        refreshedTreeBase,
                        childGenerationIndex,
                        finalizedChildRow,
                      );
                  const preparedRefreshedTree = await prepareTreeForRender(refreshedTree);
                  commitSelectionUpdate({
                    tree: preparedRefreshedTree,
                  });
                  setTmdbLogGeneration(Math.max(0, preparedRefreshedTree.length - 1));
                }

                await scrollGenerationLikeBubble(childGenerationIndex);
                return finalizedChildRow;
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
              function logAfterSelectionStage(
                stage: string,
                details?: Record<string, unknown>,
              ) {
                void stage;
                void details;
              }

              async function revealChildGenerationVertically(
                childRow: GeneratorNode<CinenerdleCard>[] | null,
              ) {
                if (!childRow || childRow.length === 0 || didRevealChildGeneration) {
                  return;
                }

                await scrollGenerationIntoVerticalView(childGenerationIndex, {
                  alignRowHorizontally: false,
                });
                didRevealChildGeneration = true;
              }

              async function scrollFinalizedChildGenerationHorizontally(
                childRow: GeneratorNode<CinenerdleCard>[] | null,
              ) {
                if (!childRow || childRow.length === 0) {
                  logAfterSelectionStage("child-row-horizontal-scroll-skipped", {
                    childCount: childRow?.length ?? 0,
                  });
                  return;
                }

                await revealChildGenerationVertically(childRow);
                logAfterSelectionStage("child-row-horizontal-scroll-requested", {
                  childCount: childRow.length,
                });
                await scrollGenerationLikeBubble(childGenerationIndex);
                logAfterSelectionStage("child-row-horizontal-scroll-completed", {
                  childCount: childRow.length,
                });
              }

              logAfterSelectionStage("initial-selection-resolve-started");
              const initialSelection =
                selectedCard.kind === "movie" || selectedCard.kind === "person"
                  ? await resolveInitialSelectedCard(selectedCard)
                  : {
                      selectedCard,
                      movieRecord: undefined,
                      personRecord: undefined,
                    };
              logAfterSelectionStage("initial-selection-resolved", {
                resolvedCardKey: initialSelection.selectedCard.key,
                resolvedCardKind: initialSelection.selectedCard.kind,
              });
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
              logAfterSelectionStage("initial-child-row-build-started");
              const initialChildRow = await buildChildRowForCard(initialSelection.selectedCard, {
                movieRecord: initialMovieRecord,
                personRecord: initialPersonRecord,
              });
              logAfterSelectionStage("initial-child-row-built", {
                childCount: initialChildRow?.length ?? 0,
              });
              const initialSelectedTree = appendChildRow(
                initialSelectedTreeBase,
                initialChildRow,
              );
              commitSelectionUpdate({
                tree: initialSelectedTree,
              });
              logAfterSelectionStage("initial-tree-applied", {
                childCount: initialChildRow?.length ?? 0,
                rowCount: initialSelectedTree.length,
              });

              setTmdbLogGeneration(Math.max(0, initialSelectedTree.length - 1));
              await revealChildGenerationVertically(initialChildRow);

              if (
                initialSelection.selectedCard.kind !== "movie" &&
                initialSelection.selectedCard.kind !== "person"
              ) {
                await scrollFinalizedChildGenerationHorizontally(initialChildRow);
                logAfterSelectionStage("background-prepare-started", {
                  source: "initial",
                });
                await waitForBackgroundPrepareYield();
                const preparedInitialTree = await prepareTreeForRender(initialSelectedTree);
                applyUpdate({
                  tree: preparedInitialTree,
                });
                setTmdbLogGeneration(Math.max(0, preparedInitialTree.length - 1));
                logAfterSelectionStage("background-prepare-completed", {
                  rowCount: preparedInitialTree.length,
                  source: "initial",
                });
                return initialChildRow;
              }

              logAfterSelectionStage("tmdb-refresh-started", {
                source: "selected-card",
              });
              const refreshResult = await refreshCardFromTmdb(initialSelection.selectedCard, {
                skipIfAlreadyHydrated: true,
              });
              logAfterSelectionStage("tmdb-refresh-completed", {
                didRefresh: refreshResult.didRefresh,
                refreshedCardKey: refreshResult.refreshedCard.key,
              });
              if (!refreshResult.didRefresh) {
                await scrollFinalizedChildGenerationHorizontally(initialChildRow);
                logAfterSelectionStage("background-prepare-started", {
                  source: "initial",
                });
                await waitForBackgroundPrepareYield();
                const preparedInitialTree = await prepareTreeForRender(initialSelectedTree);
                applyUpdate({
                  tree: preparedInitialTree,
                });
                setTmdbLogGeneration(Math.max(0, preparedInitialTree.length - 1));
                logAfterSelectionStage("background-prepare-completed", {
                  rowCount: preparedInitialTree.length,
                  source: "initial",
                });
                return initialChildRow;
              }

              const refreshedSelectedTreeBase = replaceTreeNodeCard(
                initialSelectedTreeBase,
                selectedEffectRow,
                selectedEffectCol,
                refreshResult.refreshedCard,
              );
              logAfterSelectionStage("refreshed-child-row-build-started");
              const refreshedChildRow = await buildChildRowForCard(refreshResult.refreshedCard);
              logAfterSelectionStage("refreshed-child-row-built", {
                childCount: refreshedChildRow?.length ?? 0,
              });
              const refreshedTree = appendChildRow(
                refreshedSelectedTreeBase,
                refreshedChildRow,
              );
              commitSelectionUpdate({
                tree: refreshedTree,
              });
              logAfterSelectionStage("refreshed-tree-applied", {
                childCount: refreshedChildRow?.length ?? 0,
                rowCount: refreshedTree.length,
              });

              setTmdbLogGeneration(Math.max(0, refreshedTree.length - 1));
              await scrollFinalizedChildGenerationHorizontally(refreshedChildRow);
              logAfterSelectionStage("background-prepare-started", {
                source: "refreshed",
              });
              await waitForBackgroundPrepareYield();
              const preparedRefreshedTree = await prepareTreeForRender(refreshedTree);
              applyUpdate({
                tree: preparedRefreshedTree,
              });
              setTmdbLogGeneration(Math.max(0, preparedRefreshedTree.length - 1));
              logAfterSelectionStage("background-prepare-completed", {
                rowCount: preparedRefreshedTree.length,
                source: "refreshed",
              });

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
                tree: selectedPathTree,
              });
            });
        } else {
          applyUpdate({
            tree: selectedPathTree,
          });
        }

        writeHash(nextHash, "selection");
      },
      renderCard({
        node,
        reportRowOrderMetadata,
        row,
        rowCount,
        selectedAncestorData,
        selectedChildData,
        selectedDescendantData,
        selectedParentData,
      }) {
        return renderCinenerdleCard(
          node,
          row,
          rowCount,
          selectedAncestorData,
          selectedChildData,
          selectedDescendantData,
          selectedParentData,
          reportRowOrderMetadata,
          writeHash,
          onExplicitTmdbRowClick,
        );
      },
    }),
    [onExplicitTmdbRowClick, readHash, writeHash],
  );
}

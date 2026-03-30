import { useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { createBookmarkPreviewCard, type BookmarkPreviewCard } from "../../components/bookmark_preview";
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
import { ESCAPE_LABEL, TMDB_ICON_URL } from "./constants";
import {
  buildPathNodesFromSegments,
  createPathNode,
  parseHashSegments,
  serializePathNodes,
} from "./hash";
import {
  getCinenerdleStarterFilmRecords,
  getFilmRecordByTitleAndYear,
  getFilmRecordCountsByPersonConnectionKeys,
  getFilmRecordsByIds,
  getMoviePopularityByLabels,
  getPersonRecordById,
  getPersonRecordByName,
  getPersonRecordCountsByMovieKeys,
  getPersonPopularityByNames,
} from "./indexed_db";
import { pickBestPersonRecord } from "./records";
import { renderBreakCard, renderDbInfoCard, renderLoggedCinenerdleCard } from "./render_card";
import {
  fetchCinenerdleDailyStarterMovies,
  hydrateCinenerdleDailyStarterMovies,
  prefetchBestConnectionForYoungestSelectedCard,
  prefetchTopPopularUnhydratedConnections,
  prepareSelectedMovie,
  prepareSelectedPerson,
  setTmdbLogGeneration,
} from "./tmdb";
import type { FilmRecord, PersonRecord } from "./types";
import {
  formatMoviePathLabel,
  getAssociatedMovieCreditGroupsFromPersonCredits,
  getAssociatedPeopleFromMovieCredits,
  getAssociatedPersonCreditGroupsFromMovieCredits,
  getFilmKey,
  getMovieKeyFromCredit,
  getValidTmdbEntityId,
  normalizeName,
  normalizeTitle,
  parseMoviePathLabel,
} from "./utils";
import {
  cardsMatch,
  createCardViewModel,
  getCardPopularityRefreshHandler,
  getCardPopularityTooltipText,
  getParentMovieRankForPerson,
  getParentPersonRankForMovie,
  getResolvedMovieConnectionCount,
  getResolvedPersonConnectionCount,
  getSelectedAncestorCards,
  refreshSelectedMovieCard,
  refreshSelectedPersonCard,
  replaceSelectedCardInLastRow,
} from "./view_model";
import { hasDirectTmdbMovieSource, hasDirectTmdbPersonSource } from "./tmdb_provenance";
import type { CinenerdleCard, CinenerdlePathNode } from "./view_types";

export { getCardPopularityTooltipText } from "./view_model";

type SelectedCardFullstateResolution =
  | {
      card: Extract<CinenerdleCard, { kind: "movie" }>;
      movieRecord: FilmRecord | null;
      personRecord?: never;
    }
  | {
      card: Extract<CinenerdleCard, { kind: "person" }>;
      movieRecord?: never;
      personRecord: PersonRecord | null;
    };

type SelectedCardFullstateOptions = {
  forceRefresh?: boolean;
};

type SelectedPathHydrationOptions = {
  forceRefresh?: boolean;
};

type SelectedPathRedrawOptions = {
  forceRefreshSelectedPath?: boolean;
};

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
  onExplicitFooterTopRefreshClick?: () => void;
  recordsRefreshVersion?: number;
  readHash: () => string;
  writeHash: (nextHash: string, mode?: "selection" | "navigation") => void;
};

type SelectedEntityPathNode = Extract<CinenerdlePathNode, { kind: "movie" | "person" }>;

type SelectedPathHydrationTask = {
  key: string;
  kind: SelectedEntityPathNode["kind"];
  index: number;
  label: string;
  run: () => Promise<FilmRecord | PersonRecord | null>;
};

type BuildTreeOptions = {
  dailyStarterSource?: "cache" | "network";
  bypassInFlightCache?: boolean;
};

const inFlightTreeBuilds = new Map<string, Promise<GeneratorTree<CinenerdleCard>>>();
const childGenerationOrderingCache = new Map<string, string[]>();

export function getControllerInitMode(
  recordsRefreshVersion: number,
  lastHandledRecordsRefreshVersion: number,
): "cache" | "full" {
  return recordsRefreshVersion !== lastHandledRecordsRefreshVersion ? "cache" : "full";
}

export function shouldPrefetchPopularConnectionsOnInit(
  initMode: "cache" | "full",
): boolean {
  return initMode === "full";
}

export function shouldForceRefreshSelectedPathOnInit(
  initMode: "cache" | "full",
): boolean {
  void initMode;
  return false;
}

export function shouldDispatchSelectedCardBackgroundForceRefresh(
  previousSelectedCardKey: string | null,
  selectedCard: Extract<CinenerdleCard, { kind: "movie" | "person" }> | null,
): boolean {
  void previousSelectedCardKey;
  void selectedCard;
  return false;
}

export function clearChildGenerationOrderingCache(): void {
  childGenerationOrderingCache.clear();
}

function createBreakCard(): Extract<CinenerdleCard, { kind: "break" }> {
  return {
    key: "break",
    kind: "break",
    name: ESCAPE_LABEL,
    popularity: 0,
    popularitySource: null,
    imageUrl: null,
    subtitle: "",
    subtitleDetail: "",
    connectionCount: null,
    sources: [],
    status: null,
    record: null,
  };
}

function createNode(
  data: CinenerdleCard,
  selected = false,
  disabled = false,
): GeneratorNode<CinenerdleCard> {
  return {
    selected,
    disabled,
    data,
  };
}

function getPersonIdentityKey(personName: string, personTmdbId?: number | string | null): string {
  const validTmdbId = getValidTmdbEntityId(personTmdbId);
  return validTmdbId ? `tmdb:${validTmdbId}` : `name:${normalizeName(personName)}`;
}

function createRow(cards: CinenerdleCard[], selectedKey?: string) {
  return cards.map((card) => createNode(card, selectedKey === card.key));
}

type PlaceholderChildCardKind = "movie" | "person";

function getOptimisticPlaceholderChildKind(
  card: CinenerdleCard,
): PlaceholderChildCardKind | null {
  if (card.kind === "cinenerdle" || card.kind === "person") {
    return "movie";
  }

  if (card.kind === "movie") {
    return "person";
  }

  return null;
}

function createCinenerdlePlaceholderCard(
  kind: PlaceholderChildCardKind,
): Extract<CinenerdleCard, { kind: "movie" | "person" }> {
  if (kind === "movie") {
    return {
      key: "placeholder:movie",
      kind: "movie",
      name: "Loading",
      year: "",
      isPlaceholder: true,
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

  return {
    key: "placeholder:person",
    kind: "person",
    name: "Loading",
    isPlaceholder: true,
    popularity: 0,
    popularitySource: null,
    imageUrl: null,
    subtitle: "",
    subtitleDetail: "",
    connectionCount: null,
    sources: [],
    status: null,
    record: null,
  };
}

function createCinenerdlePlaceholderRow(
  kind: PlaceholderChildCardKind,
): GeneratorNode<CinenerdleCard>[] {
  return [createNode(createCinenerdlePlaceholderCard(kind))];
}

export function reduceCinenerdleLifecycleEvent(
  state: GeneratorState<CinenerdleCard, undefined>,
  event: GeneratorLifecycleEvent,
): GeneratorTransition<CinenerdleCard, undefined, GeneratorLifecycleEffect<CinenerdleCard>> {
  const transition = reduceGeneratorLifecycleEvent(state, event);

  if (
    event.type !== "select" ||
    !event.optimisticSelection ||
    transition.state.placeholderRowIndex === null ||
    !transition.state.tree
  ) {
    return transition;
  }

  const selectedCard = transition.state.tree[event.row]?.[event.col]?.data;
  if (!selectedCard) {
    return transition;
  }

  const placeholderChildKind = getOptimisticPlaceholderChildKind(selectedCard);
  if (!placeholderChildKind) {
    return transition;
  }

  return {
    ...transition,
    state: {
      ...transition.state,
      renderTreeOverride: [
        ...transition.state.tree,
        createCinenerdlePlaceholderRow(placeholderChildKind),
      ],
    },
  };
}

type ChildGenerationOrderingDebugItem = {
  key: string;
  label: string;
  connectionOrder: number;
  creditType: "cast" | "crew" | null;
  creditOrder: number | null;
  creditPopularity: number | null;
  cardPopularity: number;
  connectionCount: number | null;
  connectionRank: number | null;
};

type ChildGenerationOrderingEntry<TCard extends Extract<CinenerdleCard, { kind: "movie" | "person" }>> = {
  card: TCard;
  debugItem: ChildGenerationOrderingDebugItem;
};

function getChildGenerationOrderingCacheKey(
  parentCard: Extract<CinenerdleCard, { kind: "movie" | "person" }>,
): string {
  return `${parentCard.kind}:${parentCard.key}`;
}

function stabilizeChildGenerationOrdering<
  TCard extends Extract<CinenerdleCard, { kind: "movie" | "person" }>,
>(
  parentCard: Extract<CinenerdleCard, { kind: "movie" | "person" }>,
  orderedChildren: ChildGenerationOrderingEntry<TCard>[],
): ChildGenerationOrderingEntry<TCard>[] {
  const cacheKey = getChildGenerationOrderingCacheKey(parentCard);
  const cachedOrdering = childGenerationOrderingCache.get(cacheKey);

  let stabilizedChildren = orderedChildren;
  if (cachedOrdering && orderedChildren.length > 1) {
    const cachedIndexByKey = new Map(
      cachedOrdering.map((key, index) => [key, index] as const),
    );

    stabilizedChildren = [...orderedChildren].sort((left, right) => {
      const leftCachedIndex = cachedIndexByKey.get(left.card.key);
      const rightCachedIndex = cachedIndexByKey.get(right.card.key);

      if (
        typeof leftCachedIndex === "number" &&
        typeof rightCachedIndex === "number"
      ) {
        return leftCachedIndex - rightCachedIndex;
      }

      if (typeof leftCachedIndex === "number") {
        return -1;
      }

      if (typeof rightCachedIndex === "number") {
        return 1;
      }

      return left.debugItem.connectionOrder - right.debugItem.connectionOrder;
    });
  }

  const normalizedChildren = stabilizedChildren.map((child, index) => {
    const connectionOrder = index + 1;

    return {
      card: {
        ...child.card,
        connectionOrder,
      },
      debugItem: {
        ...child.debugItem,
        connectionOrder,
      },
    };
  });

  childGenerationOrderingCache.set(
    cacheKey,
    normalizedChildren.map((child) => child.card.key),
  );
  return normalizedChildren;
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

function getTreeBuildCacheKey(
  hashValue: string,
  dailyStarterSource: NonNullable<BuildTreeOptions["dailyStarterSource"]>,
): string {
  return `${dailyStarterSource}:${hashValue}`;
}

function shouldUseNetworkStarterSourceForHash(hashValue: string): boolean {
  const pathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue));
  return pathNodes.length === 0 || pathNodes[0]?.kind === "cinenerdle";
}

function getSelectedCard(tree: GeneratorTree<CinenerdleCard>, rowIndex: number) {
  return tree[rowIndex]?.find((node) => node.selected)?.data ?? null;
}

export async function ensureSelectedCardFullstate(
  selectedCard: Extract<CinenerdleCard, { kind: "movie" | "person" }>,
  options: SelectedCardFullstateOptions = {},
): Promise<SelectedCardFullstateResolution> {
  if (selectedCard.kind === "movie") {
    const selectedMovieRecord = selectedCard.record ?? null;
    const needsFullstate =
      options.forceRefresh === true || !hasDirectTmdbMovieSource(selectedMovieRecord);

    if (!needsFullstate) {
      return {
        card: selectedCard,
        movieRecord: selectedMovieRecord,
      };
    }

    const hydratedMovieRecord = await prepareSelectedMovie(
      selectedCard.name,
      selectedCard.year,
      selectedCard.record?.tmdbId ?? selectedCard.record?.id ?? null,
      {
        forceRefresh: options.forceRefresh,
      },
    );

    return {
      card: hydratedMovieRecord
        ? refreshSelectedMovieCard(selectedCard, hydratedMovieRecord)
        : selectedCard,
      movieRecord: hydratedMovieRecord,
    };
  }

  const selectedPersonRecord = selectedCard.record ?? null;
  const personTmdbId = getPersonTmdbIdFromCard(selectedCard);
  const needsFullstate =
    options.forceRefresh === true || !hasDirectTmdbPersonSource(selectedPersonRecord);

  if (!needsFullstate) {
    return {
      card: selectedCard,
      personRecord: selectedPersonRecord,
    };
  }

  const hydratedPersonRecord = await prepareSelectedPerson(
    selectedCard.name,
    personTmdbId,
    {
      forceRefresh: options.forceRefresh,
    },
  );

  return {
    card: hydratedPersonRecord
      ? refreshSelectedPersonCard(selectedCard, hydratedPersonRecord)
      : selectedCard,
    personRecord: hydratedPersonRecord,
  };
}

export async function hydrateYoungestSelectedCardInTree(
  tree: GeneratorTree<CinenerdleCard>,
  options: SelectedCardFullstateOptions = {},
): Promise<GeneratorTree<CinenerdleCard>> {
  const selectedCard = getSelectedCard(tree, tree.length - 1);

  if (
    !selectedCard ||
    (selectedCard.kind !== "movie" && selectedCard.kind !== "person")
  ) {
    return tree;
  }

  const fullstateResolution = await ensureSelectedCardFullstate(selectedCard, options);

  if (fullstateResolution.card === selectedCard) {
    return tree;
  }

  return replaceSelectedCardInLastRow(tree, fullstateResolution.card);
}

function getSelectedPathNodes(tree: GeneratorTree<CinenerdleCard>): CinenerdlePathNode[] {
  return tree
    .map((row) => row.find((node) => node.selected)?.data ?? null)
    .filter((card): card is CinenerdleCard => card !== null)
    .map((card) => getPathNodeFromCard(card));
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

function getSelectedEntityPathNodes(hashValue: string): SelectedEntityPathNode[] {
  return buildPathNodesFromSegments(parseHashSegments(hashValue)).filter(
    (pathNode): pathNode is SelectedEntityPathNode =>
      pathNode.kind === "movie" || pathNode.kind === "person",
  );
}

function getSelectedHydrationPathNodes(
  hashValue: string,
): Extract<CinenerdlePathNode, { kind: "movie" | "person" | "break" }>[] {
  return buildPathNodesFromSegments(parseHashSegments(hashValue)).filter(
    (pathNode): pathNode is Extract<CinenerdlePathNode, { kind: "movie" | "person" | "break" }> =>
      pathNode.kind === "movie" || pathNode.kind === "person" || pathNode.kind === "break",
  );
}

function getMoviePathNodeHydrationKey(
  pathNode: Extract<SelectedEntityPathNode, { kind: "movie" }>,
): string {
  return `movie:${normalizeTitle(pathNode.name)}:${pathNode.year}`;
}

function didResolvedPersonIdentityChange(
  originalPathNode: Extract<SelectedEntityPathNode, { kind: "person" }>,
  resolvedPathNode: Extract<SelectedEntityPathNode, { kind: "person" }>,
): boolean {
  return (
    normalizeName(originalPathNode.name) !== normalizeName(resolvedPathNode.name) ||
    getValidTmdbEntityId(originalPathNode.tmdbId) !== getValidTmdbEntityId(resolvedPathNode.tmdbId)
  );
}

async function buildSelectedPathHydrationTasks(
  selectedPathNodes: SelectedEntityPathNode[],
  options: SelectedPathHydrationOptions = {},
): Promise<SelectedPathHydrationTask[]> {
  const tasksByKey = new Map<string, SelectedPathHydrationTask>();

  await Promise.all(
    selectedPathNodes.map(async (pathNode, index) => {
      if (pathNode.kind === "person") {
        const existingPersonRecord = await getLocalPersonRecord(pathNode.name, pathNode.tmdbId);
        if (!options.forceRefresh && hasDirectTmdbPersonSource(existingPersonRecord)) {
          return;
        }

        const taskKey = getPersonIdentityKey(pathNode.name, pathNode.tmdbId);
        if (tasksByKey.has(taskKey)) {
          return;
        }

        tasksByKey.set(taskKey, {
          key: taskKey,
          kind: "person",
          index,
          label: pathNode.name,
          run: () => prepareSelectedPerson(pathNode.name, pathNode.tmdbId, {
            forceRefresh: options.forceRefresh,
          }),
        });
        return;
      }

      const existingMovieRecord = await getFilmRecordByTitleAndYear(
        pathNode.name,
        pathNode.year,
      );
      if (!options.forceRefresh && hasDirectTmdbMovieSource(existingMovieRecord)) {
        return;
      }

      const taskKey = getMoviePathNodeHydrationKey(pathNode);
      if (tasksByKey.has(taskKey)) {
        return;
      }

      tasksByKey.set(taskKey, {
        key: taskKey,
        kind: "movie",
        index,
        label: pathNode.year ? `${pathNode.name} (${pathNode.year})` : pathNode.name,
        run: () => prepareSelectedMovie(pathNode.name, pathNode.year, null, {
          forceRefresh: options.forceRefresh,
        }),
      });
    }),
  );

  return Array.from(tasksByKey.values()).sort((left, right) => left.index - right.index);
}

async function resolveSelectedPathNodesForHydration(
  selectedPathNodes: Extract<CinenerdlePathNode, { kind: "movie" | "person" | "break" }>[],
): Promise<SelectedEntityPathNode[]> {
  const resolvedPathNodes: SelectedEntityPathNode[] = [];
  let previousMovieCard: Extract<CinenerdleCard, { kind: "movie" }> | null = null;

  for (const pathNode of selectedPathNodes) {
    if (pathNode.kind === "break") {
      previousMovieCard = null;
      continue;
    }

    const resolvedPathNode: SelectedEntityPathNode =
      pathNode.kind === "person" && previousMovieCard
        ? await resolvePersonPathNodeFromMovieContext(pathNode, previousMovieCard)
        : pathNode;

    resolvedPathNodes.push(resolvedPathNode);
    previousMovieCard =
      resolvedPathNode.kind === "movie"
        ? createUncachedMovieCard(resolvedPathNode.name, resolvedPathNode.year)
        : null;
  }

  return resolvedPathNodes;
}

async function buildCorrectivePersonHydrationTasks(
  originalSelectedPathNodes: SelectedEntityPathNode[],
  tree: GeneratorTree<CinenerdleCard>,
  options: SelectedPathHydrationOptions = {},
): Promise<SelectedPathHydrationTask[]> {
  const resolvedSelectedPathNodes = getSelectedPathNodes(tree).filter(
    (pathNode): pathNode is SelectedEntityPathNode =>
      pathNode.kind === "movie" || pathNode.kind === "person",
  );
  const tasksByKey = new Map<string, SelectedPathHydrationTask>();

  await Promise.all(
    resolvedSelectedPathNodes.map(async (resolvedPathNode, index) => {
      const originalPathNode = originalSelectedPathNodes[index];
      if (
        !originalPathNode ||
        originalPathNode.kind !== "person" ||
        resolvedPathNode.kind !== "person" ||
        !didResolvedPersonIdentityChange(originalPathNode, resolvedPathNode)
      ) {
        return;
      }

      const existingResolvedPersonRecord = await getLocalPersonRecord(
        resolvedPathNode.name,
        resolvedPathNode.tmdbId,
      );
      if (!options.forceRefresh && hasDirectTmdbPersonSource(existingResolvedPersonRecord)) {
        return;
      }

      const taskKey = getPersonIdentityKey(resolvedPathNode.name, resolvedPathNode.tmdbId);
      if (tasksByKey.has(taskKey)) {
        return;
      }

      tasksByKey.set(taskKey, {
        key: taskKey,
        kind: "person",
        index,
        label: resolvedPathNode.name,
        run: () => prepareSelectedPerson(resolvedPathNode.name, resolvedPathNode.tmdbId, {
          forceRefresh: options.forceRefresh,
        }),
      });
    }),
  );

  return Array.from(tasksByKey.values()).sort((left, right) => left.index - right.index);
}
async function resolvePersonPathNodeFromMovieContext(
  pathNode: Extract<CinenerdlePathNode, { kind: "person" }>,
  movieCard: Extract<CinenerdleCard, { kind: "movie" }> | null,
): Promise<Extract<CinenerdlePathNode, { kind: "person" }>> {
  if (!movieCard) {
    return pathNode;
  }

  const movieRecord =
    movieCard.record ?? (await getFilmRecordByTitleAndYear(movieCard.name, movieCard.year));
  if (!movieRecord) {
    return pathNode;
  }

  const matchingCredits = getAssociatedPeopleFromMovieCredits(movieRecord).filter(
    (credit) => normalizeName(credit.name ?? "") === normalizeName(pathNode.name),
  );
  const matchingCreditIds = matchingCredits
    .map((credit) => getValidTmdbEntityId(credit.id))
    .filter((creditId): creditId is number => Boolean(creditId));
  const resolvedTmdbId = matchingCreditIds[0] ?? null;
  const shouldOverrideTmdbId =
    Boolean(resolvedTmdbId) &&
    (!pathNode.tmdbId || !matchingCreditIds.includes(pathNode.tmdbId));
  return shouldOverrideTmdbId
    ? createPathNode("person", pathNode.name, "", resolvedTmdbId)
    : pathNode;
}

async function hydrateStarterFilmsWithCachedRecords(starterFilms: FilmRecord[]) {
  return Promise.all(
    starterFilms.map(async (starterFilm) => {
      const cachedFilmRecord = await getFilmRecordByTitleAndYear(
        starterFilm.title,
        starterFilm.year,
      );

      if (!cachedFilmRecord) {
        return starterFilm;
      }

      return {
        ...starterFilm,
        id: cachedFilmRecord.id,
        tmdbId: cachedFilmRecord.tmdbId,
        popularity: cachedFilmRecord.popularity,
        personConnectionKeys: cachedFilmRecord.personConnectionKeys,
        rawTmdbMovie: cachedFilmRecord.rawTmdbMovie,
        rawTmdbMovieSearchResponse: cachedFilmRecord.rawTmdbMovieSearchResponse,
        rawTmdbMovieCreditsResponse: cachedFilmRecord.rawTmdbMovieCreditsResponse,
        fetchTimestamp: cachedFilmRecord.fetchTimestamp,
      };
    }),
  );
}

async function createDailyStarterRow(
  options?: Pick<BuildTreeOptions, "dailyStarterSource">,
) {
  const starterFilms =
    options?.dailyStarterSource === "cache"
      ? await getCinenerdleStarterFilmRecords()
      : await fetchCinenerdleDailyStarterMovies();
  const hydratedStarterFilms =
    options?.dailyStarterSource === "cache"
      ? starterFilms
      : await hydrateStarterFilmsWithCachedRecords(starterFilms);

  if (hydratedStarterFilms.length === 0) {
    return null;
  }

  const cards = sortCardsByPopularity(hydratedStarterFilms.map(createDailyStarterMovieCard));
  return createRow(cards);
}

function isCinenerdleRootTree(tree: GeneratorTree<CinenerdleCard>) {
  return getSelectedCard(tree, 0)?.kind === "cinenerdle";
}

async function hydrateDailyStartersAndRedraw(
  setTree: (nextTree: GeneratorTree<CinenerdleCard>) => void,
  readHash: () => string,
) {
  await measureAsync(
    "controller.hydrateDailyStartersAndRedraw",
    async () => {
      const starterFilms = await fetchCinenerdleDailyStarterMovies();
      if (starterFilms.length === 0) {
        return;
      }

      await hydrateCinenerdleDailyStarterMovies(starterFilms);

      const refreshedTree = await buildTreeFromHash(readHash());
      setTree(refreshedTree);
    },
    {
      always: true,
      details: {
        hash: readHash(),
      },
    },
  );
}

async function hydrateMissingSelectedPathItemsAndRedraw(
  setTree: (nextTree: GeneratorTree<CinenerdleCard>) => void,
  readHash: () => string,
  options: SelectedPathRedrawOptions = {},
) {
  await measureAsync(
    "controller.hydrateMissingSelectedPathItemsAndRedraw",
    async () => {
      const initialHash = readHash();
      const originalSelectedPathNodes = getSelectedEntityPathNodes(initialHash);
      if (originalSelectedPathNodes.length === 0) {
        return {
          correctiveTaskCount: 0,
          hydrationTaskCount: 0,
        };
      }

      const selectedPathNodes = await resolveSelectedPathNodesForHydration(
        getSelectedHydrationPathNodes(initialHash),
      );
      const hydrationTasks = await buildSelectedPathHydrationTasks(selectedPathNodes, {
        forceRefresh: options.forceRefreshSelectedPath,
      });
      if (hydrationTasks.length === 0) {
        return {
          correctiveTaskCount: 0,
          hydrationTaskCount: 0,
        };
      }

      await Promise.allSettled(
        hydrationTasks.map((task) => task.run()),
      );
      if (readHash() !== initialHash) {
        return {
          correctiveTaskCount: 0,
          hydrationTaskCount: hydrationTasks.length,
        };
      }

      let refreshedTree = await buildTreeFromHash(readHash());
      setTree(refreshedTree);

      const correctiveTasks = await buildCorrectivePersonHydrationTasks(
        originalSelectedPathNodes,
        refreshedTree,
        {
          forceRefresh: options.forceRefreshSelectedPath,
        },
      );
      if (correctiveTasks.length === 0) {
        return {
          correctiveTaskCount: 0,
          hydrationTaskCount: hydrationTasks.length,
        };
      }

      await Promise.allSettled(
        correctiveTasks.map((task) => task.run()),
      );
      if (readHash() !== initialHash) {
        return {
          correctiveTaskCount: correctiveTasks.length,
          hydrationTaskCount: hydrationTasks.length,
        };
      }

      refreshedTree = await buildTreeFromHash(readHash());
      setTree(refreshedTree);

      return {
        correctiveTaskCount: correctiveTasks.length,
        hydrationTaskCount: hydrationTasks.length,
      };
    },
    {
      always: true,
      details: {
        hash: readHash(),
      },
      summarizeResult: (result) => result,
    },
  );
}

export async function hydrateSelectedPathAndPrefetchPopularConnections(
  setTree: (nextTree: GeneratorTree<CinenerdleCard>) => void,
  readHash: () => string,
  selectedCard: Extract<CinenerdleCard, { kind: "movie" | "person" }> | null = null,
  options: SelectedPathRedrawOptions = {},
): Promise<void> {
  await measureAsync(
    "controller.hydrateSelectedPathAndPrefetchPopularConnections",
    async () => {
      await hydrateMissingSelectedPathItemsAndRedraw(setTree, readHash, options);
      await prefetchTopPopularUnhydratedConnections(selectedCard);
    },
    {
      always: true,
      details: {
        hash: readHash(),
      },
    },
  );
}

async function buildChildRowForPersonCard(
  card: Extract<CinenerdleCard, { kind: "person" }>,
  personRecordOverride?: PersonRecord | null,
): Promise<GeneratorNode<CinenerdleCard>[] | null> {
  return measureAsync(
    "controller.buildChildRowForPersonCard",
    async () => {
      const personRecord =
        personRecordOverride ??
        card.record ??
        (await getLocalPersonRecord(card.name, getPersonTmdbIdFromCard(card)));
      if (!personRecord) {
        return null;
      }

      const movieCreditGroups = getAssociatedMovieCreditGroupsFromPersonCredits(personRecord);
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
      const orderedChildren = movieCreditGroups.map((creditGroup, index) => {
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

        return {
          card: cardWithOrdering,
          debugItem: {
            key: cardWithOrdering.key,
            label: formatMoviePathLabel(cardWithOrdering.name, cardWithOrdering.year),
            connectionOrder,
            creditType: credit.creditType ?? null,
            creditOrder: typeof credit.order === "number" ? credit.order : null,
            creditPopularity: typeof credit.popularity === "number" ? credit.popularity : null,
            cardPopularity: cardWithOrdering.popularity,
            connectionCount: cardWithOrdering.connectionCount,
            connectionRank: cardWithOrdering.connectionRank ?? null,
          },
        };
      }).filter((child): child is NonNullable<typeof child> => child !== null);

      const stabilizedChildren = stabilizeChildGenerationOrdering(
        card,
        orderedChildren,
      );

      return createRow(stabilizedChildren.map((child) => child.card));
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
      const movieRecord =
        movieRecordOverride ??
        card.record ??
        (await getFilmRecordByTitleAndYear(card.name, card.year));
      if (!movieRecord) {
        return null;
      }

      const tmdbCreditGroups = getAssociatedPersonCreditGroupsFromMovieCredits(movieRecord);
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
      const orderedChildren = tmdbCreditGroups.map((creditGroup, index) => {
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
        return {
          card: cardWithOrdering,
          debugItem: {
            key: cardWithOrdering.key,
            label: cardWithOrdering.name,
            connectionOrder,
            creditType: credit.creditType ?? null,
            creditOrder: typeof credit.order === "number" ? credit.order : null,
            creditPopularity: typeof credit.popularity === "number" ? credit.popularity : null,
            cardPopularity: cardWithOrdering.popularity,
            connectionCount: cardWithOrdering.connectionCount,
            connectionRank: cardWithOrdering.connectionRank ?? null,
          },
        };
      }).filter((child): child is NonNullable<typeof child> => child !== null);

      const stabilizedChildren = stabilizeChildGenerationOrdering(
        card,
        orderedChildren,
      );

      return createRow(stabilizedChildren.map((child) => child.card));
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

async function buildChildRowForCard(
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

async function createCinenerdleRootTree(
  options?: Pick<BuildTreeOptions, "dailyStarterSource">,
): Promise<GeneratorTree<CinenerdleCard>> {
  const starterRow = await createDailyStarterRow(options);
  const starterCount = starterRow?.length ?? 0;
  const tree: GeneratorTree<CinenerdleCard> = [
    [createNode(createCinenerdleRootCard(Math.max(starterCount, 1)), true)],
  ];

  if (starterRow && starterRow.length > 0) {
    tree.push(starterRow);
  }

  return tree;
}

async function createRootTreeFromPathNode(
  pathNode: Extract<CinenerdlePathNode, { kind: "cinenerdle" | "movie" | "person" }>,
  options?: Pick<BuildTreeOptions, "dailyStarterSource">,
): Promise<GeneratorTree<CinenerdleCard> | null> {
  if (pathNode.kind === "cinenerdle") {
    return createCinenerdleRootTree(options);
  }

  if (pathNode.kind === "person") {
    const personRecord = await getLocalPersonRecord(pathNode.name, pathNode.tmdbId);
    const rootCard = personRecord
      ? createPersonRootCard(personRecord, pathNode.name)
      : createCinenerdleOnlyPersonCard(pathNode.name, "database only");

    const tree: GeneratorTree<CinenerdleCard> = [[createNode(rootCard, true)]];
    const childRow = await buildChildRowForCard(rootCard);

    if (childRow && childRow.length > 0) {
      tree.push(childRow);
    }

    return tree;
  }

  const movieRecord = await getFilmRecordByTitleAndYear(pathNode.name, pathNode.year);
  const rootCard = movieRecord
    ? createMovieRootCard(movieRecord, pathNode.name)
    : createUncachedMovieCard(pathNode.name, pathNode.year);
  const tree: GeneratorTree<CinenerdleCard> = [[createNode(rootCard, true)]];
  const childRow = await buildChildRowForCard(rootCard);

  if (childRow && childRow.length > 0) {
    tree.push(childRow);
  }

  return tree;
}

async function createDisconnectedRow(
  pathNode: Extract<CinenerdlePathNode, { kind: "movie" | "person" }>,
): Promise<GeneratorNode<CinenerdleCard>[] | null> {
  if (pathNode.kind === "person") {
    const personRecord = await getLocalPersonRecord(pathNode.name, pathNode.tmdbId);
    const personCard = personRecord
      ? createPersonRootCard(personRecord, pathNode.name)
      : createCinenerdleOnlyPersonCard(pathNode.name, "database only");

    return createRow([personCard], personCard.key);
  }

  const movieRecord = await getFilmRecordByTitleAndYear(pathNode.name, pathNode.year);
  const movieCard = movieRecord
    ? createMovieRootCard(movieRecord, pathNode.name)
    : createUncachedMovieCard(pathNode.name, pathNode.year);

  return createRow([movieCard], movieCard.key);
}

function createBreakRow(): GeneratorNode<CinenerdleCard>[] {
  return [createNode(createBreakCard(), true, true)];
}

function rowHasSelectedNode(row: GeneratorNode<CinenerdleCard>[] | undefined) {
  return row?.some((node) => node.selected) ?? false;
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

export async function buildTreeFromHash(
  hashValue: string,
  options?: BuildTreeOptions,
): Promise<GeneratorTree<CinenerdleCard>> {
  const dailyStarterSource = options?.dailyStarterSource ?? "network";
  const cacheKey = getTreeBuildCacheKey(hashValue, dailyStarterSource);
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
      const pathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue));

      if (pathNodes.length === 0) {
        return createCinenerdleRootTree({ dailyStarterSource });
      }

      const [rootNode, ...continuationPathNodes] = pathNodes;
      if (!rootNode || rootNode.kind === "break") {
        return createCinenerdleRootTree({ dailyStarterSource });
      }

      const rootTree = await createRootTreeFromPathNode(
        rootNode,
        { dailyStarterSource },
      );
      if (!rootTree) {
        return createCinenerdleRootTree({ dailyStarterSource });
      }

      let tree = rootTree;
      let shouldStartDisconnectedBranch = false;

      if (
        dailyStarterSource === "cache" &&
        rootNode.kind === "cinenerdle" &&
        tree.length < 2 &&
        continuationPathNodes.length > 0
      ) {
        return tree;
      }

      for (const originalPathNode of continuationPathNodes) {
        if (originalPathNode.kind === "break") {
          if (!rowHasSelectedNode(tree[tree.length - 1])) {
            tree = tree.slice(0, -1);
          }

          tree = [...tree, createBreakRow()];
          shouldStartDisconnectedBranch = true;
          continue;
        }

        if (originalPathNode.kind !== "movie" && originalPathNode.kind !== "person") {
          continue;
        }

        if (tree.length === 0) {
          break;
        }

        let selectedCard: CinenerdleCard | null = null;

        if (shouldStartDisconnectedBranch) {
          const disconnectedRow = await createDisconnectedRow(originalPathNode);
          if (!disconnectedRow) {
            break;
          }

          tree = [...tree, disconnectedRow];
          selectedCard = disconnectedRow[0]?.data ?? null;
          shouldStartDisconnectedBranch = false;
        } else {
          const lastRow = tree[tree.length - 1];
          if (!lastRow) {
            break;
          }

          const parentSelectedCard =
            tree.length >= 2 ? getSelectedCard(tree, tree.length - 2) : getSelectedCard(tree, 0);
          const pathNode =
            originalPathNode.kind === "person" && parentSelectedCard?.kind === "movie"
              ? await resolvePersonPathNodeFromMovieContext(originalPathNode, parentSelectedCard)
              : originalPathNode;

          let nextRow = lastRow;
          let selectedIndex = findCardIndex(lastRow, pathNode);

          if (selectedIndex >= 0) {
            nextRow = selectCardInRow(lastRow, selectedIndex);
            tree = [...tree.slice(0, -1), nextRow];
          } else {
            const disconnectedRow = await createDisconnectedRow(pathNode);
            if (!disconnectedRow) {
              break;
            }

            nextRow = disconnectedRow;
            tree = [...tree.slice(0, -1), disconnectedRow];
            selectedIndex = 0;
          }

          selectedCard = nextRow[selectedIndex]?.data ?? null;
        }

        if (!selectedCard || selectedCard.kind === "break" || selectedCard.kind === "dbinfo") {
          break;
        }

        const childRow = await buildChildRowForCard(selectedCard);
        if (childRow && childRow.length > 0) {
          tree = [...tree, childRow];
        }
      }

      return tree;
    },
    {
      always: true,
      details: {
        dailyStarterSource: options?.dailyStarterSource ?? "network",
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

export async function buildBookmarkPreviewCardsFromHash(
  hashValue: string,
): Promise<BookmarkPreviewCard[]> {
  return measureAsync(
    "controller.buildBookmarkPreviewCardsFromHash",
    async () => {
      const tree = await buildTreeFromHash(hashValue);

      return tree
        .map((row) => row.find((node) => node.selected)?.data ?? null)
        .filter((card): card is Exclude<CinenerdleCard, { kind: "dbinfo" }> =>
          card !== null && card.kind !== "dbinfo",
        )
        .map((card) => createBookmarkPreviewCard(card));
    },
    {
      always: true,
      details: {
        hash: hashValue,
      },
      summarizeResult: (previewCards) => ({
        previewCardCount: previewCards.length,
      }),
    },
  );
}

function renderCinenerdleCard(
  row: number,
  col: number,
  tree: GeneratorTree<CinenerdleCard>,
  writeHash: (nextHash: string, mode?: "selection" | "navigation") => void,
  onExplicitFooterTopRefreshClick?: () => void,
) {
  const card = tree[row][col].data;
  const ancestorCards = getSelectedAncestorCards(tree, row);
  const viewModel = createCardViewModel(card, {
    isSelected: tree[row][col].selected,
    isLocked: false,
    isAncestorSelected: ancestorCards.some((ancestorCard) =>
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

  function handleCinenerdleCardClick(event: ReactMouseEvent<HTMLElement>) {
    if (!isCinenerdleLaunchCard) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    window.open("https://www.cinenerdle2.app/battle", "_blank", "noopener,noreferrer");
  }

  const renderableViewModel = {
    ...viewModel,
    onExplicitFooterTopRefreshClick:
      card.kind === "movie" || card.kind === "person"
        ? onExplicitFooterTopRefreshClick ?? null
        : null,
    onPopularityClick:
      card.kind === "movie" || card.kind === "person"
        ? getCardPopularityRefreshHandler(card)
        : null,
    popularityTooltipText:
      card.kind === "movie" || card.kind === "person"
        ? getCardPopularityTooltipText(card, ancestorCards)
        : null,
  };

  return renderLoggedCinenerdleCard({
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

export function useCinenerdleController({
  onExplicitFooterTopRefreshClick,
  recordsRefreshVersion = 0,
  readHash,
  writeHash,
}: CinenerdleControllerOptions): GeneratorController<
  CinenerdleCard,
  undefined,
  GeneratorLifecycleEffect<CinenerdleCard>
> {
  const lastHandledRecordsRefreshVersionRef = useRef(recordsRefreshVersion);

  return useMemo(
    () => ({
      createInitialState() {
        return createGeneratorState<CinenerdleCard, undefined>(undefined);
      },
      reduce: reduceCinenerdleLifecycleEvent,
      async runEffect(effect, { applyUpdate }) {
        if (effect.type === "load-initial-tree") {
          const initialHash = readHash();
          const initMode = getControllerInitMode(
            recordsRefreshVersion,
            lastHandledRecordsRefreshVersionRef.current,
          );
          const isRecordsRefreshInit = initMode === "cache";
          lastHandledRecordsRefreshVersionRef.current = recordsRefreshVersion;

          await measureAsync(
            "controller.initTree",
            async () => {
              try {
                if (isRecordsRefreshInit) {
                  const refreshedHash = readHash();
                  const dailyStarterSource = shouldUseNetworkStarterSourceForHash(refreshedHash)
                    ? "network"
                    : "cache";
                  const refreshedTree = await buildTreeFromHash(readHash(), {
                    bypassInFlightCache: true,
                    dailyStarterSource,
                  });
                  applyUpdate({
                    tree: refreshedTree,
                  });
                  setTmdbLogGeneration(Math.max(0, refreshedTree.length - 1));
                  void hydrateMissingSelectedPathItemsAndRedraw(
                    (nextTreeUpdate) => {
                      applyUpdate({
                        tree: nextTreeUpdate,
                      });
                    },
                    readHash,
                    {
                      forceRefreshSelectedPath: false,
                    },
                  ).catch(() => { });
                  return;
                }

                try {
                  if (!shouldUseNetworkStarterSourceForHash(initialHash)) {
                    const cachedTree = await buildTreeFromHash(initialHash, {
                      dailyStarterSource: "cache",
                    });
                    applyUpdate({
                      tree: cachedTree,
                    });
                  }
                } catch (error: unknown) {
                  void error;
                }

                const nextTree = await buildTreeFromHash(readHash());
                const hydratedNextTree = await hydrateYoungestSelectedCardInTree(nextTree, {
                  forceRefresh: shouldForceRefreshSelectedPathOnInit(initMode),
                });
                applyUpdate({
                  tree: hydratedNextTree,
                });
                setTmdbLogGeneration(Math.max(0, hydratedNextTree.length - 1));
                const hydratedYoungestSelectedCard = getSelectedCard(
                  hydratedNextTree,
                  hydratedNextTree.length - 1,
                );
                if (shouldPrefetchPopularConnectionsOnInit(initMode)) {
                  void hydrateSelectedPathAndPrefetchPopularConnections(
                    (nextTreeUpdate) => {
                      applyUpdate({
                        tree: nextTreeUpdate,
                      });
                    },
                    readHash,
                    hydratedYoungestSelectedCard &&
                      (hydratedYoungestSelectedCard.kind === "movie" ||
                        hydratedYoungestSelectedCard.kind === "person")
                      ? hydratedYoungestSelectedCard
                      : null,
                    {
                      forceRefreshSelectedPath: shouldForceRefreshSelectedPathOnInit(initMode),
                    },
                  ).catch(() => { });
                }
                if (isCinenerdleRootTree(nextTree)) {
                  void hydrateDailyStartersAndRedraw(
                    (nextTreeUpdate) => {
                      applyUpdate({
                        tree: nextTreeUpdate,
                      });
                    },
                    readHash,
                  ).catch(() => { });
                }
              } catch {
                const fallbackTree = await createCinenerdleRootTree();
                applyUpdate({
                  tree: fallbackTree,
                });
                setTmdbLogGeneration(Math.max(0, fallbackTree.length - 1));
                if (shouldPrefetchPopularConnectionsOnInit(initMode)) {
                  void hydrateSelectedPathAndPrefetchPopularConnections(
                    (nextTreeUpdate) => {
                      applyUpdate({
                        tree: nextTreeUpdate,
                      });
                    },
                    readHash,
                    null,
                    {
                      forceRefreshSelectedPath: shouldForceRefreshSelectedPathOnInit(initMode),
                    },
                  ).catch(() => { });
                }
                if (isCinenerdleRootTree(fallbackTree)) {
                  void hydrateDailyStartersAndRedraw(
                    (nextTreeUpdate) => {
                      applyUpdate({
                        tree: nextTreeUpdate,
                      });
                    },
                    readHash,
                  ).catch(() => { });
                }
              }
            },
            {
              always: true,
              details: {
                initialHash,
                initMode,
              },
            },
          );
          return;
        }

        const tree = effect.tree;
        const selectedPathNodes = getSelectedPathNodes(tree);
        const nextHash = serializePathNodes(selectedPathNodes);
        const selectedCard = getSelectedCard(tree, tree.length - 1);

        if (
          selectedCard &&
          (selectedCard.kind === "cinenerdle" ||
            selectedCard.kind === "movie" ||
            selectedCard.kind === "person")
        ) {
          void measureAsync(
            "controller.afterCardSelected",
            async () => {
              setTmdbLogGeneration(Math.max(0, tree.length - 1));
              let refreshedSelectedCard = selectedCard;
              let resolvedChildRow: GeneratorNode<CinenerdleCard>[] | null = null;

              if (selectedCard.kind === "movie" || selectedCard.kind === "person") {
                const fullstateResolution = await ensureSelectedCardFullstate(selectedCard);
                refreshedSelectedCard = fullstateResolution.card;
                resolvedChildRow = await buildChildRowForCard(refreshedSelectedCard, {
                  movieRecord:
                    fullstateResolution.card.kind === "movie"
                      ? fullstateResolution.movieRecord
                      : undefined,
                  personRecord:
                    fullstateResolution.card.kind === "person"
                      ? fullstateResolution.personRecord
                      : undefined,
                });
              } else {
                resolvedChildRow = await buildChildRowForCard(selectedCard);
              }

              const nextTree = refreshedSelectedCard === selectedCard
                ? tree
                : replaceSelectedCardInLastRow(tree, refreshedSelectedCard);
              applyUpdate({
                tree: resolvedChildRow && resolvedChildRow.length > 0
                  ? [...nextTree, resolvedChildRow]
                  : nextTree,
              });
              if (
                refreshedSelectedCard.kind === "movie" ||
                refreshedSelectedCard.kind === "person"
              ) {
                void prefetchBestConnectionForYoungestSelectedCard(refreshedSelectedCard).catch(() => { });
              }

              return resolvedChildRow;
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
                tree,
              });
            });
        } else {
          applyUpdate({
            tree,
          });
        }

        writeHash(nextHash, "selection");
      },
      renderCard({ row, col, tree }) {
        return renderCinenerdleCard(
          row,
          col,
          tree,
          writeHash,
          onExplicitFooterTopRefreshClick,
        );
      },
    }),
    [onExplicitFooterTopRefreshClick, readHash, recordsRefreshVersion, writeHash],
  );
}

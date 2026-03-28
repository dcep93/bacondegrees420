import { useMemo, type CSSProperties, type MouseEvent } from "react";
import { createBookmarkPreviewCard, type BookmarkPreviewCard } from "../../components/bookmark_preview";
import type { GeneratorController, GeneratorNode, GeneratorTree } from "../../types/generator";
import { addCinenerdleDebugLog } from "./debug";
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
  getFilmRecordByTitleAndYear,
  getFilmRecordsByIds,
  getFilmRecordsByPersonConnectionKey,
  getPersonRecordById,
  getPersonRecordByName,
  getPersonRecordsByMovieKey,
} from "./indexed_db";
import {
  fetchCinenerdleDailyStarterMovies,
  hydrateCinenerdleDailyStarterMovies,
  prepareSelectedMovie,
  prepareSelectedPerson,
} from "./tmdb";
import { pickBestPersonRecord } from "./records";
import type { FilmRecord, PersonRecord } from "./types";
import {
  getAssociatedPeopleFromMovieCredits,
  getMovieKeyFromCredit,
  getSnapshotPeopleByRole,
  getUniqueSortedTmdbMovieCredits,
  getValidTmdbEntityId,
  normalizeName,
  normalizeTitle,
} from "./utils";
import type { CinenerdleCard, CinenerdleCardViewModel, CinenerdlePathNode } from "./view_types";

function createUncachedMovieCard(name: string, year: string): Extract<CinenerdleCard, { kind: "movie" }> {
  return {
    key: `movie:${normalizeTitle(name)}:${year}`,
    kind: "movie",
    name,
    year,
    popularity: 0,
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

function createNode(data: CinenerdleCard, selected = false): GeneratorNode<CinenerdleCard> {
  return {
    selected,
    data,
  };
}

function getPersonIdentityKey(personName: string, personTmdbId?: number | string | null): string {
  const validTmdbId = getValidTmdbEntityId(personTmdbId);
  return validTmdbId ? `tmdb:${validTmdbId}` : `name:${normalizeName(personName)}`;
}

function shouldLogProjectHailMaryPersonDebug(
  movieRecord: FilmRecord | null | undefined,
  fallbackTitle = "",
): boolean {
  const title = movieRecord?.title || fallbackTitle;
  return normalizeTitle(title) === "project hail mary";
}

function logProjectHailMaryPersonDebug(event: string, details: unknown): void {
  console.debug("cinenerdle2.personCase", event, details);
  addCinenerdleDebugLog(`personCase:${event}`, details);
}

function createRow(cards: CinenerdleCard[], selectedKey?: string) {
  return cards.map((card) => createNode(card, selectedKey === card.key));
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

function getSelectedCard(tree: GeneratorTree<CinenerdleCard>, rowIndex: number) {
  return tree[rowIndex]?.find((node) => node.selected)?.data ?? null;
}

function hasMovieCredits(
  movieRecord: FilmRecord | null | undefined,
): movieRecord is FilmRecord & {
  rawTmdbMovieCreditsResponse: NonNullable<FilmRecord["rawTmdbMovieCreditsResponse"]>;
} {
  return Boolean(movieRecord?.rawTmdbMovieCreditsResponse);
}

function hasPersonMovieCredits(
  personRecord: PersonRecord | null | undefined,
): personRecord is PersonRecord & {
  rawTmdbMovieCreditsResponse: NonNullable<PersonRecord["rawTmdbMovieCreditsResponse"]>;
} {
  return Boolean(personRecord?.rawTmdbMovieCreditsResponse);
}

function hasCachedTmdbSource(card: CinenerdleCard) {
  if (card.kind === "movie") {
    return Boolean(
      card.record?.tmdbCreditsSavedAt ||
      card.record?.rawTmdbMovieCreditsResponse,
    );
  }

  if (card.kind === "person") {
    return Boolean(
      card.record?.savedAt ||
      card.record?.rawTmdbPerson ||
      card.record?.rawTmdbPersonSearchResponse ||
      card.record?.rawTmdbMovieCreditsResponse,
    );
  }

  return false;
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

  if (card.kind === "dbinfo") {
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
  const personRecordById = personTmdbId ? await getPersonRecordById(personTmdbId) : null;
  const personRecordByName = personName ? await getPersonRecordByName(personName) : null;
  return pickBestPersonRecord(personRecordById, personRecordByName);
}

function getSelectedEntityPathNodes(hashValue: string): SelectedEntityPathNode[] {
  return buildPathNodesFromSegments(parseHashSegments(hashValue)).filter(
    (pathNode): pathNode is SelectedEntityPathNode =>
      pathNode.kind === "movie" || pathNode.kind === "person",
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
): Promise<SelectedPathHydrationTask[]> {
  const tasksByKey = new Map<string, SelectedPathHydrationTask>();

  await Promise.all(
    selectedPathNodes.map(async (pathNode, index) => {
      if (pathNode.kind === "person") {
        const existingPersonRecord = await getLocalPersonRecord(pathNode.name, pathNode.tmdbId);
        if (hasPersonMovieCredits(existingPersonRecord)) {
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
          run: () => prepareSelectedPerson(pathNode.name, pathNode.tmdbId),
        });
        return;
      }

      const existingMovieRecord = await getFilmRecordByTitleAndYear(
        pathNode.name,
        pathNode.year,
      );
      if (hasMovieCredits(existingMovieRecord)) {
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
        run: () => prepareSelectedMovie(pathNode.name, pathNode.year),
      });
    }),
  );

  return Array.from(tasksByKey.values()).sort((left, right) => left.index - right.index);
}

async function resolveSelectedPathNodesForHydration(
  selectedPathNodes: SelectedEntityPathNode[],
): Promise<SelectedEntityPathNode[]> {
  const resolvedPathNodes: SelectedEntityPathNode[] = [];
  let previousMovieCard: Extract<CinenerdleCard, { kind: "movie" }> | null = null;

  for (const pathNode of selectedPathNodes) {
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
      if (hasPersonMovieCredits(existingResolvedPersonRecord)) {
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
        run: () => prepareSelectedPerson(resolvedPathNode.name, resolvedPathNode.tmdbId),
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

async function createDailyStarterRow() {
  const starterFilms = await fetchCinenerdleDailyStarterMovies();
  const hydratedStarterFilms = await Promise.all(
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
        rawTmdbMovie: cachedFilmRecord.rawTmdbMovie,
        rawTmdbMovieSearchResponse: cachedFilmRecord.rawTmdbMovieSearchResponse,
        rawTmdbMovieCreditsResponse: cachedFilmRecord.rawTmdbMovieCreditsResponse,
        tmdbSavedAt: cachedFilmRecord.tmdbSavedAt,
        tmdbCreditsSavedAt: cachedFilmRecord.tmdbCreditsSavedAt,
      };
    }),
  );

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
  const starterFilms = await fetchCinenerdleDailyStarterMovies();
  if (starterFilms.length === 0) {
    return;
  }

  await hydrateCinenerdleDailyStarterMovies(starterFilms);

  const refreshedTree = await buildTreeFromHash(readHash());
  setTree(refreshedTree);
}

async function hydrateMissingSelectedPathItemsAndRedraw(
  setTree: (nextTree: GeneratorTree<CinenerdleCard>) => void,
  readHash: () => string,
) {
  const initialHash = readHash();
  const originalSelectedPathNodes = getSelectedEntityPathNodes(initialHash);
  if (originalSelectedPathNodes.length === 0) {
    return;
  }

  const selectedPathNodes = await resolveSelectedPathNodesForHydration(originalSelectedPathNodes);
  const hydrationTasks = await buildSelectedPathHydrationTasks(selectedPathNodes);
  if (hydrationTasks.length === 0) {
    return;
  }

  await Promise.allSettled(
    hydrationTasks.map((task) => task.run()),
  );
  if (readHash() !== initialHash) {
    return;
  }

  let refreshedTree = await buildTreeFromHash(readHash());
  setTree(refreshedTree);

  const correctiveTasks = await buildCorrectivePersonHydrationTasks(
    originalSelectedPathNodes,
    refreshedTree,
  );
  if (correctiveTasks.length === 0) {
    return;
  }

  await Promise.allSettled(
    correctiveTasks.map((task) => task.run()),
  );
  if (readHash() !== initialHash) {
    return;
  }

  refreshedTree = await buildTreeFromHash(readHash());
  setTree(refreshedTree);
}

async function buildChildRowForPersonCard(
  card: Extract<CinenerdleCard, { kind: "person" }>,
  personRecordOverride?: PersonRecord | null,
): Promise<GeneratorNode<CinenerdleCard>[] | null> {
  const personRecord =
    personRecordOverride ??
    card.record ??
    (await getLocalPersonRecord(card.name, getPersonTmdbIdFromCard(card)));
  if (!personRecord) {
    return null;
  }

  const movieCredits = getUniqueSortedTmdbMovieCredits(personRecord);
  const filmRecordsById = await getFilmRecordsByIds(
    movieCredits.map((credit) => credit.id),
  );
  const connectionCounts = new Map(
    await Promise.all(
      movieCredits.map(async (credit) => {
        const movieKey = getMovieKeyFromCredit(credit);
        const matchingPeople = await getPersonRecordsByMovieKey(movieKey);
        return [movieKey, Math.max(matchingPeople.length, 1)] as const;
      }),
    ),
  );

  return createRow(
    sortCardsByPopularity(
      movieCredits.map((credit) =>
        createMovieAssociationCard(
          credit,
          (credit.id ? filmRecordsById.get(credit.id) : null) ?? null,
          connectionCounts.get(getMovieKeyFromCredit(credit)) ?? 1,
        ),
      ),
    ),
  );
}

async function buildChildRowForMovieCard(
  card: Extract<CinenerdleCard, { kind: "movie" }>,
  movieRecordOverride?: FilmRecord | null,
): Promise<GeneratorNode<CinenerdleCard>[] | null> {
  const movieRecord =
    movieRecordOverride ??
    card.record ??
    (await getFilmRecordByTitleAndYear(card.name, card.year));
  if (!movieRecord) {
    return null;
  }

  const shouldLogPersonCase = shouldLogProjectHailMaryPersonDebug(movieRecord, card.name);
  const tmdbCredits = getAssociatedPeopleFromMovieCredits(movieRecord);
  if (shouldLogPersonCase) {
    logProjectHailMaryPersonDebug("movie_row_start", {
      cardName: card.name,
      cardYear: card.year,
      movieRecordTitle: movieRecord.title,
      movieRecordYear: movieRecord.year,
      starterPeopleByRole: movieRecord.starterPeopleByRole ?? null,
      tmdbCreditNames: tmdbCredits.map((credit) => ({
        name: credit.name ?? "",
        id: credit.id ?? null,
        job: credit.job ?? null,
        department: credit.department ?? null,
        creditType: credit.creditType ?? null,
      })),
    });
  }
  const personDetails = new Map(
    await Promise.all(
      tmdbCredits.map(async (credit) => {
        const personName = credit.name ?? "";
        const matchingFilms = await getFilmRecordsByPersonConnectionKey(personName);
        const cachedPersonRecord = pickBestPersonRecord(
          credit.id ? await getPersonRecordById(credit.id) : null,
          personName ? await getPersonRecordByName(personName) : null,
        );

        if (shouldLogPersonCase && normalizeName(personName) === "andy weir") {
          logProjectHailMaryPersonDebug("tmdb_credit_resolution", {
            creditName: personName,
            creditId: credit.id ?? null,
            cachedPersonRecordName: cachedPersonRecord?.name ?? null,
            cachedPersonRecordTmdbId:
              getValidTmdbEntityId(cachedPersonRecord?.tmdbId ?? cachedPersonRecord?.id),
            matchingFilmCount: matchingFilms.length,
          });
        }

        return [
          getPersonIdentityKey(personName, credit.id),
          {
            connectionCount: Math.max(matchingFilms.length, 1),
            personRecord: cachedPersonRecord,
          },
        ] as const;
      }),
    ),
  );

  const cards = tmdbCredits.map((credit) =>
    createPersonAssociationCard(
      credit,
      personDetails.get(getPersonIdentityKey(credit.name ?? "", credit.id))?.connectionCount ?? 1,
      personDetails.get(getPersonIdentityKey(credit.name ?? "", credit.id))?.personRecord ?? null,
    ),
  );
  const seenPeople = new Set(cards.map((personCard) => normalizeName(personCard.name)));
  const snapshotPeople = getSnapshotPeopleByRole(movieRecord);

  (
    Object.entries(snapshotPeople) as Array<
      [keyof typeof snapshotPeople, string[]]
    >
  ).forEach(([role, people]) => {
    people.forEach((personName) => {
      const normalizedPersonName = normalizeName(personName);
      if (seenPeople.has(normalizedPersonName)) {
        if (shouldLogPersonCase && normalizedPersonName === "andy weir") {
          logProjectHailMaryPersonDebug("snapshot_person_skipped", {
            role,
            snapshotName: personName,
            reason: "already_seen",
          });
        }
        return;
      }

      const fallbackCard = createCinenerdleOnlyPersonCard(personName, role);
      cards.push(fallbackCard);
      seenPeople.add(normalizedPersonName);

      if (shouldLogPersonCase && normalizedPersonName === "andy weir") {
        logProjectHailMaryPersonDebug("snapshot_person_added", {
          role,
          snapshotName: personName,
          renderedCardName: fallbackCard.name,
          renderedCardKey: fallbackCard.key,
        });
      }
    });
  });

  if (shouldLogPersonCase) {
    logProjectHailMaryPersonDebug("movie_row_final_cards", {
      cardNames: cards.map((personCard) => ({
        name: personCard.name,
        key: personCard.key,
        sourceLabels: personCard.sources.map((source) => source.label),
      })),
      andyWeirCards: cards
        .filter((personCard) => normalizeName(personCard.name) === "andy weir")
        .map((personCard) => ({
          name: personCard.name,
          key: personCard.key,
          sourceLabels: personCard.sources.map((source) => source.label),
          recordName:
            personCard.kind === "person"
              ? personCard.record?.name ?? null
              : null,
        })),
    });
  }

  return createRow(sortCardsByPopularity(cards));
}

async function buildChildRowForCard(
  card: CinenerdleCard,
  options?: {
    personRecord?: PersonRecord | null;
    movieRecord?: FilmRecord | null;
  },
): Promise<GeneratorNode<CinenerdleCard>[] | null> {
  if (card.kind === "cinenerdle") {
    return createDailyStarterRow();
  }

  if (card.kind === "person") {
    return buildChildRowForPersonCard(card, options?.personRecord);
  }

  if (card.kind === "movie") {
    return buildChildRowForMovieCard(card, options?.movieRecord);
  }

  return null;
}

async function createCinenerdleRootTree(): Promise<GeneratorTree<CinenerdleCard>> {
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

async function createRootTreeFromPathNode(
  pathNode: Extract<CinenerdlePathNode, { kind: "cinenerdle" | "movie" | "person" }>,
): Promise<GeneratorTree<CinenerdleCard> | null> {
  if (pathNode.kind === "cinenerdle") {
    return createCinenerdleRootTree();
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

async function buildTreeFromHash(
  hashValue: string,
): Promise<GeneratorTree<CinenerdleCard>> {
  const pathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue));

  if (pathNodes.length === 0) {
    return createCinenerdleRootTree();
  }

  const [rootNode, ...continuationPathNodes] = pathNodes;
  if (!rootNode || rootNode.kind === "break") {
    return createCinenerdleRootTree();
  }

  const rootTree = await createRootTreeFromPathNode(rootNode);
  if (!rootTree) {
    return createCinenerdleRootTree();
  }

  let tree = rootTree;
  for (const originalPathNode of continuationPathNodes.filter(
    (node): node is Extract<CinenerdlePathNode, { kind: "movie" | "person" }> =>
      node.kind === "movie" || node.kind === "person",
  )) {
    if (tree.length === 0) {
      break;
    }

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

    const selectedCard = nextRow[selectedIndex]?.data;

    if (!selectedCard) {
      break;
    }

    const childRow = await buildChildRowForCard(selectedCard);
    if (childRow && childRow.length > 0) {
      tree = [...tree, childRow];
    }
  }

  return tree;
}

export async function buildBookmarkPreviewCardsFromHash(
  hashValue: string,
): Promise<BookmarkPreviewCard[]> {
  const tree = await buildTreeFromHash(hashValue);

  return tree
    .map((row) => row.find((node) => node.selected)?.data ?? null)
    .filter((card): card is Exclude<CinenerdleCard, { kind: "dbinfo" }> =>
      card !== null && card.kind !== "dbinfo",
    )
    .map((card) => createBookmarkPreviewCard(card));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatHeatMetricValue(label: "Popularity" | "Votes" | "Rating", value: number) {
  if (label === "Popularity" || label === "Rating") {
    return Number(value.toFixed(2));
  }

  return value;
}

function createHeatChipStyle(value: number, maxValue: number): CSSProperties {
  const normalizedValue = clampNumber(value / maxValue, 0, 1);
  const hue = 210 - normalizedValue * 210;
  const backgroundLightness = 20 + normalizedValue * 12;
  const borderLightness = 34 + normalizedValue * 18;

  return {
    backgroundColor: `hsl(${hue} 55% ${backgroundLightness}%)`,
    border: `1px solid hsl(${hue} 70% ${borderLightness}%)`,
    color: "#eff6ff",
  };
}

function getSelectedAncestorCards(
  tree: GeneratorTree<CinenerdleCard>,
  row: number,
): CinenerdleCard[] {
  return tree
    .slice(0, row)
    .map((ancestorRow) => ancestorRow.find((node) => node.selected)?.data ?? null)
    .filter((card): card is CinenerdleCard => card !== null);
}

function cardsMatch(left: CinenerdleCard, right: CinenerdleCard) {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "cinenerdle" && right.kind === "cinenerdle") {
    return true;
  }

  if (left.kind === "movie" && right.kind === "movie") {
    return (
      normalizeTitle(left.name) === normalizeTitle(right.name) &&
      left.year === right.year
    );
  }

  return normalizeName(left.name) === normalizeName(right.name);
}

function isTmdbSourceLabel(label: string) {
  return label.trim().toLowerCase() === "tmdb";
}

function getRenderableSources(card: CinenerdleCard) {
  return (card.sources ?? []).filter(
    (source) => source.iconUrl === TMDB_ICON_URL || isTmdbSourceLabel(source.label),
  );
}

function createCardViewModel(
  card: CinenerdleCard,
  options: {
    isSelected: boolean;
    isLocked?: boolean;
    isAncestorSelected?: boolean;
  },
): CinenerdleCardViewModel {
  const sharedFields = {
    kind: card.kind,
    name: card.name,
    imageUrl: card.imageUrl,
    subtitle: card.subtitle,
    subtitleDetail: card.subtitleDetail,
    popularity: card.popularity,
    connectionCount: card.connectionCount,
    sources: getRenderableSources(card),
    status: card.status,
    isSelected: options.isSelected,
    isLocked: options.isLocked ?? false,
    isAncestorSelected: options.isAncestorSelected ?? false,
    hasCachedTmdbSource: hasCachedTmdbSource(card),
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

  return {
    ...sharedFields,
    kind: card.kind,
  };
}

function renderHeatChip(
  label: "Popularity" | "Votes" | "Rating",
  value: number | null | undefined,
  maxValue: number,
  className = "cinenerdle-card-chip",
  style?: CSSProperties,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return (
    <span
      className={className}
      style={{
        ...createHeatChipStyle(value, maxValue),
        ...style,
      }}
    >
      {`${label} ${formatHeatMetricValue(label, value)}`}
    </span>
  );
}

function renderStatusChip(viewModel: CinenerdleCardViewModel) {
  if (!viewModel.status?.text) {
    return null;
  }

  return (
    <span
      className={`cinenerdle-card-chip cinenerdle-card-status cinenerdle-card-status-${viewModel.status.tone}`}
    >
      {viewModel.status.text}
    </span>
  );
}

function renderFooter(viewModel: CinenerdleCardViewModel) {
  if (viewModel.kind === "dbinfo") {
    return null;
  }

  const hasTopLeftContent =
    typeof viewModel.connectionCount === "number" || viewModel.sources.length > 0;
  const statusChip = renderStatusChip(viewModel);
  const voteCountChip =
    viewModel.kind === "movie"
      ? renderHeatChip("Votes", viewModel.voteCount, 20000)
      : null;
  const ratingChip =
    viewModel.kind === "movie"
      ? renderHeatChip(
        "Rating",
        viewModel.voteAverage,
        10,
        "cinenerdle-card-chip",
        typeof viewModel.voteCount === "number" &&
          Number.isFinite(viewModel.voteCount)
          ? { marginLeft: "auto" }
          : undefined,
      )
      : null;
  const shouldRenderBottomRow =
    viewModel.kind === "movie" || Boolean(statusChip);

  return (
    <footer className="cinenerdle-card-footer">
      <div className="cinenerdle-card-footer-top">
        {hasTopLeftContent ? (
          <div className="cinenerdle-card-footer-left">
            {typeof viewModel.connectionCount === "number" ? (
              <span className="cinenerdle-card-count">{viewModel.connectionCount}</span>
            ) : null}
            {viewModel.sources.length > 0 ? (
              <div className="cinenerdle-card-sources">
                {viewModel.sources.map((source) => (
                  <img
                    alt={source.label}
                    aria-label={source.label}
                    className="cinenerdle-card-source-icon"
                    key={`${source.iconUrl}:${source.label}`}
                    src={source.iconUrl}
                    style={
                      viewModel.hasCachedTmdbSource
                        ? undefined
                        : {
                          filter: "grayscale(1)",
                          opacity: 0.9,
                        }
                    }
                    title={source.label}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="cinenerdle-card-footer-spacer" />
        )}
        {viewModel.kind === "cinenerdle"
          ? null
          : renderHeatChip("Popularity", viewModel.popularity, 100)}
      </div>
      {shouldRenderBottomRow ? (
        <div className="cinenerdle-card-footer-bottom">
          {voteCountChip}
          {ratingChip}
          {statusChip}
        </div>
      ) : null}
    </footer>
  );
}

function renderDbInfoCard(viewModel: Extract<CinenerdleCardViewModel, { kind: "dbinfo" }>) {
  function handleCopy(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!import.meta.env.DEV) {
      return;
    }

    if (!navigator.clipboard?.writeText) {
      return;
    }

    void navigator.clipboard
      .writeText(viewModel.body)
      .catch(() => { });
  }

  return (
    <article className="cinenerdle-card cinenerdle-db-card" onClick={handleCopy}>
      <div className="cinenerdle-card-image-shell cinenerdle-db-card-image-shell">
        <div className="cinenerdle-db-card-kicker">
          {viewModel.recordKind === "movie" ? "Movie DB" : "Person DB"}
        </div>
      </div>

      <div className="cinenerdle-card-copy cinenerdle-db-card-copy">
        <p className="cinenerdle-card-title cinenerdle-db-card-title">{viewModel.name}</p>
        <div className="cinenerdle-card-secondary cinenerdle-db-card-secondary">
          <p className="cinenerdle-card-subtitle">{viewModel.subtitle}</p>
          {viewModel.subtitleDetail ? (
            <p className="cinenerdle-card-detail">{viewModel.subtitleDetail}</p>
          ) : null}
        </div>
        <div className="cinenerdle-db-card-summary">
          {viewModel.summaryItems.map((item) => (
            <div className="cinenerdle-db-card-summary-item" key={item.label}>
              <span className="cinenerdle-db-card-summary-label">{item.label}</span>
              <span className="cinenerdle-db-card-summary-value">{item.value}</span>
            </div>
          ))}
        </div>
        <p className="cinenerdle-db-card-hint">Click card to copy JSON summary</p>
      </div>
    </article>
  );
}

function renderCinenerdleCard(
  row: number,
  col: number,
  tree: GeneratorTree<CinenerdleCard>,
  writeHash: (nextHash: string, mode?: "selection" | "navigation") => void,
) {
  const card = tree[row][col].data;
  const viewModel = createCardViewModel(card, {
    isSelected: tree[row][col].selected,
    isLocked: false,
    isAncestorSelected: getSelectedAncestorCards(tree, row).some((ancestorCard) =>
      cardsMatch(card, ancestorCard),
    ),
  });

  if (viewModel.kind === "dbinfo") {
    return renderDbInfoCard(viewModel);
  }

  const rootHash = serializePathNodes([getPathNodeFromCard(card)]);
  const isCinenerdleLaunchCard = card.kind === "cinenerdle";

  function handleCinenerdleCardClick(event: MouseEvent<HTMLElement>) {
    if (!isCinenerdleLaunchCard) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    window.open("https://www.cinenerdle2.app/battle", "_blank", "noopener,noreferrer");
  }

  function handleTitleClick(event: MouseEvent<HTMLParagraphElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (isCinenerdleLaunchCard) {
      window.open("https://www.cinenerdle2.app/battle", "_blank", "noopener,noreferrer");
      return;
    }

    writeHash(rootHash, "navigation");
  }

  return (
    <article
      onClick={handleCinenerdleCardClick}
      className={[
        "cinenerdle-card",
        viewModel.isSelected ? "cinenerdle-card-selected" : "",
        viewModel.isLocked ? "cinenerdle-card-locked" : "",
        viewModel.isAncestorSelected ? "cinenerdle-card-ancestor-selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="cinenerdle-card-image-shell">
        {viewModel.imageUrl ? (
          <img
            alt={viewModel.name}
            className="cinenerdle-card-image"
            loading="lazy"
            src={viewModel.imageUrl}
          />
        ) : (
          <div className="cinenerdle-card-image cinenerdle-card-image-fallback">
            {viewModel.name}
          </div>
        )}
      </div>

      <div className="cinenerdle-card-copy">
        <p className="cinenerdle-card-title" onClick={handleTitleClick}>
          {viewModel.name}
        </p>
        <div className="cinenerdle-card-copy-spacer" />
        <div className="cinenerdle-card-secondary">
          <p className="cinenerdle-card-subtitle">{viewModel.subtitle}</p>
          {viewModel.subtitleDetail ? (
            <p className="cinenerdle-card-detail">{viewModel.subtitleDetail}</p>
          ) : null}
        </div>
        {renderFooter(viewModel)}
      </div>
    </article>
  );
}

export function useCinenerdleController({
  readHash,
  writeHash,
}: CinenerdleControllerOptions): GeneratorController<CinenerdleCard> {
  return useMemo(
    () => ({
      initTree(setTree) {
        void (async () => {
          try {
            const nextTree = await buildTreeFromHash(readHash());
            setTree(nextTree);
            void hydrateMissingSelectedPathItemsAndRedraw(setTree, readHash).catch(() => { });
            if (isCinenerdleRootTree(nextTree)) {
              void hydrateDailyStartersAndRedraw(setTree, readHash).catch(() => { });
            }
          } catch {
            const fallbackTree = await createCinenerdleRootTree();
            setTree(fallbackTree);
            void hydrateMissingSelectedPathItemsAndRedraw(setTree, readHash).catch(() => { });
            if (isCinenerdleRootTree(fallbackTree)) {
              void hydrateDailyStartersAndRedraw(setTree, readHash).catch(() => { });
            }
          }
        })();
      },
      afterCardSelected({ tree }) {
        const nextHash = serializePathNodes(getSelectedPathNodes(tree));
        writeHash(nextHash, "selection");
      },
      renderCard(row, col, tree) {
        return renderCinenerdleCard(row, col, tree, writeHash);
      },
    }),
    [readHash, writeHash],
  );
}

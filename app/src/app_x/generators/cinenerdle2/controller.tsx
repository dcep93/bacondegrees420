import { useMemo, type CSSProperties, type MouseEvent } from "react";
import type { GeneratorController, GeneratorNode, GeneratorTree } from "../../types/generator";
import {
  createCinenerdleOnlyPersonCard,
  createCinenerdleRootCard,
  createDailyStarterMovieCard,
  createMovieAssociationCard,
  createMovieRootCard,
  createPersonAssociationCard,
  createPersonRootCard,
} from "./cards";
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
  getPersonRecordByName,
  getPersonRecordsByMovieKey,
} from "./indexed_db";
import {
  fetchCinenerdleDailyStarterMovies,
  hydrateCinenerdleDailyStarterMovies,
  prepareSelectedMovie,
  prepareSelectedPerson,
} from "./tmdb";
import { TMDB_ICON_URL } from "./constants";
import { logCinenerdleDebug } from "./debug";
import {
  getAssociatedPeopleFromMovieCredits,
  getMovieKeyFromCredit,
  getSnapshotPeopleByRole,
  getUniqueSortedTmdbMovieCredits,
  isAllowedBfsTmdbMovieCredit,
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
    sources: [],
    status: null,
    voteAverage: null,
    voteCount: null,
    record: null,
  };
}

type CinenerdleControllerOptions = {
  readHash: () => string;
  writeHash: (nextHash: string) => void;
};

function summarizeMovieRecord(card: Extract<CinenerdleCard, { kind: "movie" }>) {
  return {
    key: card.key,
    name: card.name,
    year: card.year,
    popularity: card.popularity,
    hasImageUrl: Boolean(card.imageUrl),
    recordId: card.record?.id ?? null,
    recordTmdbId: card.record?.tmdbId ?? null,
    hasRawTmdbMovie: Boolean(card.record?.rawTmdbMovie),
    castCount: card.record?.rawTmdbMovieCreditsResponse?.cast?.length ?? 0,
    crewCount: card.record?.rawTmdbMovieCreditsResponse?.crew?.length ?? 0,
  };
}

function summarizePersonCard(card: Extract<CinenerdleCard, { kind: "person" }>) {
  return {
    key: card.key,
    name: card.name,
    popularity: card.popularity,
    hasImageUrl: Boolean(card.imageUrl),
    connectionCount: card.connectionCount,
    subtitle: card.subtitle,
    subtitleDetail: card.subtitleDetail,
  };
}

function createNode(data: CinenerdleCard, selected = false): GeneratorNode<CinenerdleCard> {
  return {
    selected,
    data,
  };
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

function hasCachedTmdbSource(card: CinenerdleCard) {
  if (card.kind === "movie") {
    return Boolean(
      card.record?.tmdbSavedAt ||
      card.record?.tmdbCreditsSavedAt ||
      card.record?.rawTmdbMovieSearchResponse ||
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

function getPathNodeFromCard(card: CinenerdleCard): CinenerdlePathNode {
  if (card.kind === "cinenerdle") {
    return createPathNode("cinenerdle", "cinenerdle");
  }

  if (card.kind === "movie") {
    return createPathNode("movie", card.name, card.year);
  }

  return createPathNode("person", card.name);
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

  return createRow(
    sortCardsByPopularity(hydratedStarterFilms.map(createDailyStarterMovieCard)),
  );
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
  logCinenerdleDebug("controller.hydrateDailyStartersAndRedraw.setTree", {
    hash: readHash(),
    rows: refreshedTree.length,
  });
  setTree(refreshedTree);
}

async function hydrateMissingSelectedPathItemsAndRedraw(
  setTree: (nextTree: GeneratorTree<CinenerdleCard>) => void,
  readHash: () => string,
) {
  const initialHash = readHash();
  const selectedPathNodes = buildPathNodesFromSegments(parseHashSegments(initialHash)).filter(
    (pathNode): pathNode is Extract<CinenerdlePathNode, { kind: "movie" | "person" }> =>
      pathNode.kind === "movie" || pathNode.kind === "person",
  );

  logCinenerdleDebug("controller.hydrateMissingSelectedPathItemsAndRedraw.start", {
    hash: initialHash,
    selectedPathNodes: selectedPathNodes.map((pathNode) => ({
      kind: pathNode.kind,
      name: pathNode.name,
      year: pathNode.kind === "movie" ? pathNode.year : "",
    })),
  });

  for (const pathNode of selectedPathNodes) {
    if (readHash() !== initialHash) {
      logCinenerdleDebug("controller.hydrateMissingSelectedPathItemsAndRedraw.abortHashChanged", {
        initialHash,
        currentHash: readHash(),
      });
      return;
    }

    if (pathNode.kind === "person") {
      const existingPersonRecord = await getPersonRecordByName(pathNode.name);
      if (existingPersonRecord) {
        continue;
      }

      const fetchedPersonRecord = await prepareSelectedPerson(pathNode.name);
      logCinenerdleDebug("controller.hydrateMissingSelectedPathItemsAndRedraw.personFetched", {
        name: pathNode.name,
        found: Boolean(fetchedPersonRecord),
      });

      if (!fetchedPersonRecord) {
        continue;
      }
    } else {
      const existingMovieRecord = await getFilmRecordByTitleAndYear(
        pathNode.name,
        pathNode.year,
      );
      if (existingMovieRecord) {
        continue;
      }

      const fetchedMovieRecord = await prepareSelectedMovie(pathNode.name, pathNode.year);
      logCinenerdleDebug("controller.hydrateMissingSelectedPathItemsAndRedraw.movieFetched", {
        name: pathNode.name,
        year: pathNode.year,
        found: Boolean(fetchedMovieRecord),
      });

      if (!fetchedMovieRecord) {
        continue;
      }
    }

    const refreshedTree = await buildTreeFromHash(readHash());
    logCinenerdleDebug("controller.hydrateMissingSelectedPathItemsAndRedraw.setTree", {
      hash: readHash(),
      rows: refreshedTree.length,
      selectedItem:
        pathNode.kind === "movie" ? `${pathNode.name} (${pathNode.year})` : pathNode.name,
    });
    setTree(refreshedTree);
  }
}

async function buildChildRowForCard(
  card: CinenerdleCard,
): Promise<GeneratorNode<CinenerdleCard>[] | null> {
  logCinenerdleDebug("controller.buildChildRowForCard.start", {
    kind: card.kind,
    key: card.key,
    name: card.name,
    year: card.kind === "movie" ? card.year : "",
    hasRecord: Boolean(card.record),
  });

  if (card.kind === "cinenerdle") {
    return createDailyStarterRow();
  }

  if (card.kind === "person") {
    const personRecord =
      card.record ?? (await getPersonRecordByName(card.name));
    if (!personRecord) {
      return null;
    }

    const movieCredits = getUniqueSortedTmdbMovieCredits(personRecord).filter(
      isAllowedBfsTmdbMovieCredit,
    );
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

    const row = createRow(
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

    logCinenerdleDebug("controller.buildChildRowForCard.person.complete", {
      sourcePerson: card.name,
      movieCreditsCount: movieCredits.length,
      renderedCards: row.length,
      preview: row
        .slice(0, 8)
        .map((node) => node.data)
        .filter((entry): entry is Extract<CinenerdleCard, { kind: "movie" }> => entry.kind === "movie")
        .map((movieCard) => summarizeMovieRecord(movieCard)),
    });

    return row;
  }

  const movieRecord = card.record ?? (await getFilmRecordByTitleAndYear(card.name, card.year));
  if (!movieRecord) {
    logCinenerdleDebug("controller.buildChildRowForCard.movie.missingRecord", {
      name: card.name,
      year: card.year,
    });
    return null;
  }

  const tmdbCredits = getAssociatedPeopleFromMovieCredits(movieRecord);
  const personDetails = new Map(
    await Promise.all(
      tmdbCredits.map(async (credit) => {
        const personName = credit.name ?? "";
        const matchingFilms = await getFilmRecordsByPersonConnectionKey(personName);
        const cachedPersonRecord = await getPersonRecordByName(personName);
        return [
          normalizeName(personName),
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
      personDetails.get(normalizeName(credit.name ?? ""))?.connectionCount ?? 1,
      personDetails.get(normalizeName(credit.name ?? ""))?.personRecord ?? null,
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
        return;
      }

      cards.push(createCinenerdleOnlyPersonCard(personName, role));
      seenPeople.add(normalizedPersonName);
    });
  });

  const row = createRow(sortCardsByPopularity(cards));
  logCinenerdleDebug("controller.buildChildRowForCard.movie.complete", {
    sourceMovie: {
      title: movieRecord.title,
      year: movieRecord.year,
      id: movieRecord.id,
      tmdbId: movieRecord.tmdbId,
      popularity: movieRecord.popularity,
      hasRawTmdbMovie: Boolean(movieRecord.rawTmdbMovie),
      castCount: movieRecord.rawTmdbMovieCreditsResponse?.cast?.length ?? 0,
      crewCount: movieRecord.rawTmdbMovieCreditsResponse?.crew?.length ?? 0,
    },
    tmdbCreditsCount: tmdbCredits.length,
    snapshotPeopleCount:
      snapshotPeople.cast.length +
      snapshotPeople.directors.length +
      snapshotPeople.writers.length +
      snapshotPeople.composers.length,
    renderedCards: row.length,
    preview: row
      .slice(0, 12)
      .map((node) => node.data)
      .filter((entry): entry is Extract<CinenerdleCard, { kind: "person" }> => entry.kind === "person")
      .map((personCard) => summarizePersonCard(personCard)),
  });

  return row;
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
    const personRecord = await getPersonRecordByName(pathNode.name);
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
    const personRecord = await getPersonRecordByName(pathNode.name);
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
  for (const pathNode of continuationPathNodes.filter(
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
        {renderHeatChip("Popularity", viewModel.popularity, 100)}
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

function renderCinenerdleCard(
  row: number,
  col: number,
  tree: GeneratorTree<CinenerdleCard>,
  writeHash: (nextHash: string) => void,
) {
  const card = tree[row][col].data;
  const viewModel = createCardViewModel(card, {
    isSelected: tree[row][col].selected,
    isLocked: false,
    isAncestorSelected: getSelectedAncestorCards(tree, row).some((ancestorCard) =>
      cardsMatch(card, ancestorCard),
    ),
  });
  const rootHash = serializePathNodes([getPathNodeFromCard(card)]);

  function handleTitleClick(event: MouseEvent<HTMLParagraphElement>) {
    event.preventDefault();
    event.stopPropagation();
    writeHash(rootHash);
  }

  return (
    <article
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
            logCinenerdleDebug("controller.initTree.start", {
              hash: readHash(),
            });
            const nextTree = await buildTreeFromHash(readHash());
            logCinenerdleDebug("controller.initTree.setTree", {
              rows: nextTree.length,
            });
            setTree(nextTree);
            void hydrateMissingSelectedPathItemsAndRedraw(setTree, readHash).catch((error) => {
              console.error("cinenerdle2.hydrateMissingSelectedPathItems", error);
              logCinenerdleDebug("controller.hydrateMissingSelectedPathItemsAndRedraw.error", {
                message: error instanceof Error ? error.message : String(error),
              });
            });
            if (isCinenerdleRootTree(nextTree)) {
              void hydrateDailyStartersAndRedraw(setTree, readHash).catch((error) => {
                console.error("cinenerdle2.hydrateDailyStarters", error);
                logCinenerdleDebug("controller.hydrateDailyStartersAndRedraw.error", {
                  message: error instanceof Error ? error.message : String(error),
                });
              });
            }
          } catch (error) {
            console.error("cinenerdle2.initTree", error);
            logCinenerdleDebug("controller.initTree.error", {
              message: error instanceof Error ? error.message : String(error),
            });
            const fallbackTree = await createCinenerdleRootTree();
            setTree(fallbackTree);
            void hydrateMissingSelectedPathItemsAndRedraw(setTree, readHash).catch((nestedError) => {
              console.error("cinenerdle2.hydrateMissingSelectedPathItems", nestedError);
              logCinenerdleDebug("controller.hydrateMissingSelectedPathItemsAndRedraw.error", {
                message:
                  nestedError instanceof Error
                    ? nestedError.message
                    : String(nestedError),
              });
            });
            if (isCinenerdleRootTree(fallbackTree)) {
              void hydrateDailyStartersAndRedraw(setTree, readHash).catch((nestedError) => {
                console.error("cinenerdle2.hydrateDailyStarters", nestedError);
                logCinenerdleDebug("controller.hydrateDailyStartersAndRedraw.error", {
                  message:
                    nestedError instanceof Error
                      ? nestedError.message
                      : String(nestedError),
                });
              });
            }
          }
        })();
      },
      afterCardSelected({ row, col, tree, setTree }) {
        void (async () => {
          try {
            const selectedCard = tree[row]?.[col]?.data;
            if (!selectedCard) {
              return;
            }
            const nextHash = serializePathNodes(getSelectedPathNodes(tree));

            logCinenerdleDebug("controller.afterCardSelected.start", {
              row,
              col,
              kind: selectedCard.kind,
              key: selectedCard.key,
              name: selectedCard.name,
              year: selectedCard.kind === "movie" ? selectedCard.year : "",
              treeRowsBefore: tree.length,
              selectedCardSummary:
                selectedCard.kind === "movie"
                  ? summarizeMovieRecord(selectedCard)
                  : selectedCard.kind === "person"
                    ? summarizePersonCard(selectedCard)
                    : {
                        key: selectedCard.key,
                        name: selectedCard.name,
                        connectionCount: selectedCard.connectionCount,
                      },
            });

            const preparedCard =
              selectedCard.kind === "person"
                ? (() => {
                    const personRecord = selectedCard.record;
                    return prepareSelectedPerson(
                      selectedCard.name,
                      personRecord?.id ?? null,
                    ).then((nextRecord) =>
                      nextRecord
                        ? createPersonRootCard(nextRecord, selectedCard.name)
                        : selectedCard,
                    );
                  })()
                : selectedCard.kind === "movie"
                  ? (() => {
                      const movieRecord = selectedCard.record;
                      return prepareSelectedMovie(
                        selectedCard.name,
                        selectedCard.year,
                        movieRecord?.id ?? null,
                      ).then((nextRecord) =>
                        nextRecord
                          ? createMovieRootCard(nextRecord, selectedCard.name)
                          : selectedCard,
                      );
                    })()
                  : Promise.resolve(selectedCard);

            const resolvedSelectedCard = await preparedCard;
            logCinenerdleDebug("controller.afterCardSelected.prepared", {
              kind: resolvedSelectedCard.kind,
              key: resolvedSelectedCard.key,
              name: resolvedSelectedCard.name,
              year:
                resolvedSelectedCard.kind === "movie" ? resolvedSelectedCard.year : "",
              summary:
                resolvedSelectedCard.kind === "movie"
                  ? summarizeMovieRecord(resolvedSelectedCard)
                  : resolvedSelectedCard.kind === "person"
                    ? summarizePersonCard(resolvedSelectedCard)
                    : {
                        key: resolvedSelectedCard.key,
                        name: resolvedSelectedCard.name,
                      },
              nextHash,
            });
            const resolvedTree = tree.map((currentRow, currentRowIndex) =>
              currentRowIndex === row
                ? currentRow.map((node, currentColIndex) =>
                    currentColIndex === col
                      ? {
                          ...node,
                          data: resolvedSelectedCard,
                        }
                      : node,
                  )
                : currentRow,
            );

            const childRow = await buildChildRowForCard(resolvedSelectedCard);
            if (!childRow || childRow.length === 0) {
              logCinenerdleDebug("controller.afterCardSelected.setTreeWithoutChildRow", {
                rows: resolvedTree.length,
                selectedKey: resolvedSelectedCard.key,
                nextHash,
              });
              setTree(resolvedTree);
              writeHash(nextHash);
              return;
            }

            logCinenerdleDebug("controller.afterCardSelected.setTreeWithChildRow", {
              rowsBefore: resolvedTree.length,
              childRowLength: childRow.length,
              rowsAfter: resolvedTree.length + 1,
              selectedKey: resolvedSelectedCard.key,
              nextHash,
            });
            setTree([...resolvedTree, childRow]);
            writeHash(nextHash);
          } catch (error) {
            console.error("cinenerdle2.afterCardSelected", error);
            logCinenerdleDebug("controller.afterCardSelected.error", {
              message: error instanceof Error ? error.message : String(error),
            });
          }
        })();
      },
      renderCard(row, col, tree) {
        return renderCinenerdleCard(row, col, tree, writeHash);
      },
    }),
    [readHash, writeHash],
  );
}

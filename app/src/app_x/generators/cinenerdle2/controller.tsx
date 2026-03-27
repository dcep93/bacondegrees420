import { useMemo } from "react";
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
  createPathNode,
  getNextEntityKind,
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
  prepareSelectedMovie,
  prepareSelectedPerson,
} from "./tmdb";
import { logCinenerdleDebug } from "./debug";
import {
  formatMoviePathLabel,
  getAssociatedPeopleFromMovieCredits,
  getMovieKeyFromCredit,
  getSnapshotPeopleByRole,
  getUniqueSortedTmdbMovieCredits,
  isAllowedBfsTmdbMovieCredit,
  normalizeName,
  normalizeTitle,
  parseMoviePathLabel,
} from "./utils";
import type { CinenerdleCard, CinenerdlePathNode } from "./view_types";

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

function getSelectedPathNodes(tree: GeneratorTree<CinenerdleCard>): CinenerdlePathNode[] {
  return tree
    .map((row) => row.find((node) => node.selected)?.data ?? null)
    .filter((card): card is CinenerdleCard => card !== null)
    .map((card) => {
      if (card.kind === "cinenerdle") {
        return createPathNode("cinenerdle", "cinenerdle");
      }

      if (card.kind === "movie") {
        return createPathNode("movie", card.name, card.year);
      }

      return createPathNode("person", card.name);
    });
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
  const connectionCounts = new Map(
    await Promise.all(
      tmdbCredits.map(async (credit) => {
        const personName = credit.name ?? "";
        const matchingFilms = await getFilmRecordsByPersonConnectionKey(personName);
        return [normalizeName(personName), Math.max(matchingFilms.length, 1)] as const;
      }),
    ),
  );

  const cards = tmdbCredits.map((credit) =>
    createPersonAssociationCard(
      credit,
      connectionCounts.get(normalizeName(credit.name ?? "")) ?? 1,
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

async function createRootTreeFromSegment(
  segment: string,
): Promise<GeneratorTree<CinenerdleCard> | null> {
  if (normalizeTitle(segment) === "cinenerdle") {
    return createRootTreeFromPathNode(createPathNode("cinenerdle", "cinenerdle"));
  }

  const prefersMovie = /\(\d{4}\)$/.test(segment);
  const parsedMovie = parseMoviePathLabel(segment);
  const localMovieRecord = prefersMovie
    ? await getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year)
    : await getFilmRecordByTitleAndYear(segment, "");
  const localPersonRecord = prefersMovie ? null : await getPersonRecordByName(segment);

  const attempts = prefersMovie
    ? [
        () =>
          createRootTreeFromPathNode(
            createPathNode("movie", parsedMovie.name, parsedMovie.year),
          ),
      ]
    : localMovieRecord && !localPersonRecord
      ? [
          () =>
            createRootTreeFromPathNode(
              createPathNode("movie", localMovieRecord.title, localMovieRecord.year),
            ),
        ]
      : localPersonRecord && !localMovieRecord
        ? [() => createRootTreeFromPathNode(createPathNode("person", segment))]
        : [
            () => createRootTreeFromPathNode(createPathNode("movie", parsedMovie.name, parsedMovie.year)),
            () => createRootTreeFromPathNode(createPathNode("person", segment)),
          ];

  for (const attempt of attempts) {
    const tree = await attempt();
    if (tree) {
      return tree;
    }
  }

  return null;
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

function buildContinuationPathNodes(
  rootKind: CinenerdleCard["kind"],
  segments: string[],
): Array<Extract<CinenerdlePathNode, { kind: "movie" | "person" }>> {
  const pathNodes: Array<Extract<CinenerdlePathNode, { kind: "movie" | "person" }>> = [];
  let nextKind = getNextEntityKind(rootKind);

  segments.forEach((segment) => {
    if (!segment) {
      nextKind = getNextEntityKind(nextKind);
      return;
    }

    if (nextKind === "movie") {
      const movie = parseMoviePathLabel(segment);
      pathNodes.push(createPathNode("movie", movie.name, movie.year));
      nextKind = "person";
      return;
    }

    pathNodes.push(createPathNode("person", segment));
    nextKind = "movie";
  });

  return pathNodes;
}

async function buildTreeFromHash(
  hashValue: string,
): Promise<GeneratorTree<CinenerdleCard>> {
  const segments = parseHashSegments(hashValue);

  if (segments.length === 0) {
    return createCinenerdleRootTree();
  }

  const rootTree = await createRootTreeFromSegment(segments[0]);
  if (!rootTree) {
    return createCinenerdleRootTree();
  }

  let tree = rootTree;
  const rootCard = getSelectedCard(tree, 0);
  if (!rootCard) {
    return createCinenerdleRootTree();
  }

  const continuationNodes = buildContinuationPathNodes(rootCard.kind, segments.slice(1));

  for (const pathNode of continuationNodes) {
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

function renderCinenerdleCard(
  row: number,
  col: number,
  tree: GeneratorTree<CinenerdleCard>,
) {
  const card = tree[row][col].data;
  const isSelected = tree[row][col].selected;

  return (
    <article
      className={
        isSelected ? "cinenerdle-card cinenerdle-card-selected" : "cinenerdle-card"
      }
    >
      <div className="cinenerdle-card-image-shell">
        {card.imageUrl ? (
          <img alt="" className="cinenerdle-card-image" src={card.imageUrl} />
        ) : (
          <div className="cinenerdle-card-image cinenerdle-card-image-fallback">
            {card.kind === "movie" ? "FILM" : card.kind.toUpperCase()}
          </div>
        )}
      </div>

      <div className="cinenerdle-card-copy">
        <p className="cinenerdle-card-title">{card.name}</p>
        <p className="cinenerdle-card-subtitle">
          {card.kind === "movie" ? formatMoviePathLabel(card.subtitle, card.year) : card.subtitle}
        </p>
        {card.subtitleDetail ? (
          <p className="cinenerdle-card-detail">{card.subtitleDetail}</p>
        ) : null}
      </div>

      <footer className="cinenerdle-card-footer">
        <div className="cinenerdle-card-meta">
          <span className="cinenerdle-card-count">
            {card.connectionCount ?? 0} links
          </span>
          <span className="cinenerdle-card-popularity">
            popularity {card.popularity.toFixed(1)}
          </span>
        </div>
        <div className="cinenerdle-card-sources">
          {card.sources.map((source) => (
            <span className="cinenerdle-card-source" key={source.label}>
              <img alt="" className="cinenerdle-card-source-icon" src={source.iconUrl} />
              <span>{source.label}</span>
            </span>
          ))}
        </div>
      </footer>
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
          } catch (error) {
            console.error("cinenerdle2.initTree", error);
            logCinenerdleDebug("controller.initTree.error", {
              message: error instanceof Error ? error.message : String(error),
            });
            setTree(await createCinenerdleRootTree());
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
      renderCard: renderCinenerdleCard,
    }),
    [readHash, writeHash],
  );
}

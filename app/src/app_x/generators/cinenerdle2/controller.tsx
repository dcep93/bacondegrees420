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
  ensureMovieCreditsRecord,
  ensureMovieRecordForCard,
  ensurePersonRecordByName,
  fetchCinenerdleDailyStarterMovies,
  resolveMovieRecord,
  resolvePersonRecord,
} from "./tmdb";
import type { CinenerdleCard, CinenerdlePathNode } from "./types";
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

type CinenerdleControllerOptions = {
  readHash: () => string;
  writeHash: (nextHash: string) => void;
};

function createNode(data: CinenerdleCard, selected = false): GeneratorNode<CinenerdleCard> {
  return {
    selected,
    data,
  };
}

function createRow(cards: CinenerdleCard[], selectedKey?: string) {
  return cards.map((card) => createNode(card, selectedKey === card.key));
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

  if (starterFilms.length === 0) {
    return null;
  }

  return createRow(starterFilms.map(createDailyStarterMovieCard));
}

async function buildChildRowForCard(
  card: CinenerdleCard,
): Promise<GeneratorNode<CinenerdleCard>[] | null> {
  if (card.kind === "cinenerdle") {
    return createDailyStarterRow();
  }

  if (card.kind === "person") {
    const personRecord = await ensurePersonRecordByName(card.name);
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

    return createRow(
      movieCredits.map((credit) =>
        createMovieAssociationCard(
          credit,
          (credit.id ? filmRecordsById.get(credit.id) : null) ?? null,
          connectionCounts.get(getMovieKeyFromCredit(credit)) ?? 1,
        ),
      ),
    );
  }

  const movieRecord = await ensureMovieCreditsRecord(await ensureMovieRecordForCard(card));
  if (!movieRecord) {
    return null;
  }

  const tmdbCredits = getAssociatedPeopleFromMovieCredits(movieRecord);
  const cachedPeople = await Promise.all(
    tmdbCredits.map((credit) => getPersonRecordByName(credit.name ?? "")),
  );
  const connectionCounts = new Map(
    await Promise.all(
      tmdbCredits.map(async (credit) => {
        const personName = credit.name ?? "";
        const matchingFilms = await getFilmRecordsByPersonConnectionKey(personName);
        return [normalizeName(personName), Math.max(matchingFilms.length, 1)] as const;
      }),
    ),
  );

  const cards = tmdbCredits.map((credit, index) =>
    createPersonAssociationCard(
      credit,
      cachedPeople[index] ?? null,
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

  return createRow(cards);
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
    const personRecord = await resolvePersonRecord(pathNode.name);
    if (!personRecord) {
      return null;
    }

    const rootCard = createPersonRootCard(personRecord, pathNode.name);
    const tree: GeneratorTree<CinenerdleCard> = [[createNode(rootCard, true)]];
    const childRow = await buildChildRowForCard(rootCard);

    if (childRow && childRow.length > 0) {
      tree.push(childRow);
    }

    return tree;
  }

  const movieRecord = await resolveMovieRecord(pathNode);
  if (!movieRecord) {
    return null;
  }

  const rootCard = createMovieRootCard(movieRecord, pathNode.name);
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
    const personRecord = await resolvePersonRecord(pathNode.name);
    if (!personRecord) {
      return null;
    }

    return createRow(
      [createPersonRootCard(personRecord, pathNode.name)],
      createPersonRootCard(personRecord, pathNode.name).key,
    );
  }

  const movieRecord = await resolveMovieRecord(pathNode);
  if (!movieRecord) {
    return null;
  }

  return createRow(
    [createMovieRootCard(movieRecord, pathNode.name)],
    createMovieRootCard(movieRecord, pathNode.name).key,
  );
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
        <span className="cinenerdle-card-count">
          {card.connectionCount ?? 0} links
        </span>
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
            const nextTree = await buildTreeFromHash(readHash());
            setTree(nextTree);
          } catch (error) {
            console.error("cinenerdle2.initTree", error);
            setTree(await createCinenerdleRootTree());
          }
        })();
      },
      afterCardSelected({ row, col, tree, setTree }) {
        void (async () => {
          try {
            writeHash(serializePathNodes(getSelectedPathNodes(tree)));

            const selectedCard = tree[row]?.[col]?.data;
            if (!selectedCard) {
              return;
            }

            const childRow = await buildChildRowForCard(selectedCard);
            if (!childRow || childRow.length === 0) {
              return;
            }

            setTree([...tree, childRow]);
          } catch (error) {
            console.error("cinenerdle2.afterCardSelected", error);
          }
        })();
      },
      renderCard: renderCinenerdleCard,
    }),
    [readHash, writeHash],
  );
}

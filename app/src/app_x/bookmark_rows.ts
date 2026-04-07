import { ESCAPE_LABEL, TMDB_ICON_URL } from "./generators/cinenerdle2/constants";
import {
  createAssociatedEntityCard,
  type ResolvedAssociatedEntity,
} from "./associated_entity_cards";
import {
  createCinenerdleOnlyPersonCard,
  createCinenerdleRootCard,
  createMovieRootCard,
  createPersonRootCard,
} from "./generators/cinenerdle2/cards";
import {
  getFilmRecordById,
  getFilmRecordByTitleAndYear,
  getPersonRecordByName,
  getPersonRecordById,
} from "./generators/cinenerdle2/indexed_db";
import {
  buildPathNodesFromSegments,
  parseHashSegments,
} from "./generators/cinenerdle2/hash";
import type {
  FilmRecord,
  PersonRecord,
} from "./generators/cinenerdle2/types";
import type { CinenerdleCard, CinenerdlePathNode } from "./generators/cinenerdle2/view_types";
import {
  formatMoviePathLabel,
  getValidTmdbEntityId,
  normalizeName,
  normalizeTitle,
} from "./generators/cinenerdle2/utils";
import {
  createCardViewModel,
  getCardTmdbRowTooltipText,
  getParentMovieRankForPerson,
  getParentPersonRankForMovie,
} from "./generators/cinenerdle2/view_model";
import type { RenderableCinenerdleEntityCard } from "./generators/cinenerdle2";
import { getSelectedPathTooltipEntries } from "./index_helpers";

export type BookmarkRowCard =
  | {
      kind: "break";
      key: string;
      label: string;
    }
  | {
      kind: "card";
      key: string;
      card: RenderableCinenerdleEntityCard;
    };

export type BookmarkRowData = {
  hash: string;
  cards: BookmarkRowCard[];
};

export function formatBookmarkLabel(hashValue: string): string {
  return getSelectedPathTooltipEntries(hashValue).join(" -> ");
}

export function formatBookmarkIndexTooltip(hashValue: string): string {
  return getSelectedPathTooltipEntries(hashValue).join("\n");
}

type BookmarkRenderableEntityCard = Extract<
  CinenerdleCard,
  { kind: "cinenerdle" | "movie" | "person" }
>;

type ResolvedBookmarkEntity = {
  pathNode: Extract<CinenerdlePathNode, { kind: "cinenerdle" | "movie" | "person" }>;
  card: BookmarkRenderableEntityCard;
  movieRecord: FilmRecord | null;
  personRecord: PersonRecord | null;
};

function toResolvedAssociatedEntity(entity: ResolvedBookmarkEntity): ResolvedAssociatedEntity {
  return {
    kind: entity.pathNode.kind,
    name: entity.pathNode.name,
    year: entity.pathNode.year,
    tmdbId: entity.pathNode.kind === "person" ? entity.pathNode.tmdbId : null,
    connectionCount: getBookmarkConnectionCount(entity.card),
    movieRecord: entity.movieRecord,
    personRecord: entity.personRecord,
  };
}

function createUncachedBookmarkMovieCard(
  name: string,
  year: string,
): Extract<CinenerdleCard, { kind: "movie" }> {
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

async function resolveBookmarkPathCard(
  pathNode: Extract<CinenerdlePathNode, { kind: "cinenerdle" | "movie" | "person" }>,
): Promise<ResolvedBookmarkEntity> {
  if (pathNode.kind === "cinenerdle") {
    return {
      pathNode,
      card: createCinenerdleRootCard(null) as BookmarkRenderableEntityCard,
      movieRecord: null,
      personRecord: null,
    };
  }

  if (pathNode.kind === "person") {
    const personRecord = pathNode.tmdbId
      ? await getPersonRecordById(pathNode.tmdbId)
      : await getPersonRecordByName(normalizeName(pathNode.name));

    return {
      pathNode,
      card: (
        personRecord
          ? createPersonRootCard(personRecord, pathNode.name)
          : createCinenerdleOnlyPersonCard(pathNode.name, "database only")
      ) as BookmarkRenderableEntityCard,
      movieRecord: null,
      personRecord,
    };
  }

  const movieRecord = await getFilmRecordByTitleAndYear(pathNode.name, pathNode.year);

  return {
    pathNode,
    card: (
      movieRecord
        ? createMovieRootCard(movieRecord, pathNode.name)
        : createUncachedBookmarkMovieCard(pathNode.name, pathNode.year)
    ) as BookmarkRenderableEntityCard,
    movieRecord,
    personRecord: null,
  };
}

function getBookmarkConnectionCount(card: BookmarkRenderableEntityCard): number {
  return typeof card.connectionCount === "number" ? card.connectionCount : 1;
}

function getBookmarkParentLabel(entity: ResolvedBookmarkEntity): string | null {
  if (entity.card.kind === "movie") {
    return formatMoviePathLabel(entity.card.name, entity.card.year);
  }

  if (entity.card.kind === "person") {
    return entity.card.name;
  }

  return null;
}

async function buildPopularityByMovieKey(
  personRecord: PersonRecord | null,
): Promise<Map<number, number>> {
  if (!personRecord) {
    return new Map();
  }

  const movieKeys = Array.from(
    new Set(
      personRecord.movieConnectionKeys
        .flatMap((movieId) => {
          const validMovieId = getValidTmdbEntityId(movieId);
          return validMovieId === null ? [] : [validMovieId];
        }),
    ),
  );
  const movieRecords = await Promise.all(
    movieKeys.map(async (movieKey) => [movieKey, await getFilmRecordById(movieKey)] as const),
  );

  return new Map(
    movieRecords.map(([movieKey, movieRecord]) => [movieKey, movieRecord?.popularity ?? 0] as const),
  );
}

async function buildPopularityByPersonName(
  movieRecord: FilmRecord | null,
): Promise<Map<number, number>> {
  if (!movieRecord) {
    return new Map();
  }

  const personNames = Array.from(
    new Set(
      movieRecord.personConnectionKeys.flatMap((personId) => {
        const validPersonId = getValidTmdbEntityId(personId);
        return validPersonId === null ? [] : [validPersonId];
      }),
    ),
  );
  const personRecords = await Promise.all(
    personNames.map(async (personName) => [
      personName,
      await getPersonRecordById(personName),
    ] as const),
  );

  return new Map(
    personRecords.map(([personName, personRecord]) => [
      personName,
      personRecord?.rawTmdbPerson?.popularity ?? 0,
    ] as const),
  );
}

async function createAssociatedBookmarkCard(
  previousEntity: ResolvedBookmarkEntity | null,
  entity: ResolvedBookmarkEntity,
): Promise<BookmarkRenderableEntityCard> {
  if (!previousEntity) {
    return entity.card;
  }

  if (previousEntity.card.kind === "person" && entity.card.kind === "movie") {
    const associatedCard = createAssociatedEntityCard(
      toResolvedAssociatedEntity(previousEntity),
      toResolvedAssociatedEntity(entity),
    );
    if (!associatedCard || associatedCard.card.kind !== "movie") {
      return entity.card;
    }

    const popularityByPersonName = await buildPopularityByPersonName(entity.movieRecord);
    return {
      ...associatedCard.card,
      connectionOrder: associatedCard.connectionOrder,
      connectionParentLabel: previousEntity.card.name,
      connectionRank: getParentPersonRankForMovie(
        entity.movieRecord,
        previousEntity.personRecord,
        popularityByPersonName,
      ),
    };
  }

  if (previousEntity.card.kind === "movie" && entity.card.kind === "person") {
    const associatedCard = createAssociatedEntityCard(
      toResolvedAssociatedEntity(previousEntity),
      toResolvedAssociatedEntity(entity),
    );
    if (!associatedCard || associatedCard.card.kind !== "person") {
      return entity.card;
    }

    const popularityByMovieKey = await buildPopularityByMovieKey(entity.personRecord);
    return {
      ...associatedCard.card,
      connectionOrder: associatedCard.connectionOrder,
      connectionParentLabel: getBookmarkParentLabel(previousEntity),
      connectionRank: getParentMovieRankForPerson(
        previousEntity.movieRecord,
        entity.personRecord,
        popularityByMovieKey,
      ),
    };
  }

  return entity.card;
}

function createRenderableBookmarkCard(
  card: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>,
  selectedAncestorCards: CinenerdleCard[],
): RenderableCinenerdleEntityCard {
  const viewModel = createCardViewModel(card, {
    isSelected: false,
  });

  if (viewModel.kind === "break" || viewModel.kind === "dbinfo") {
    throw new Error("Bookmark rows cannot render non-entity cards");
  }

  return {
    ...viewModel,
    onExplicitTmdbRowClick: null,
    onTmdbRowClick: null,
    tmdbTooltipText: card.kind === "movie" || card.kind === "person"
      ? getCardTmdbRowTooltipText(card, selectedAncestorCards)
      : null,
  };
}

export async function buildBookmarkRowData(hashValue: string): Promise<BookmarkRowData> {
  const bookmarkPathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue)).filter(
    (pathNode): pathNode is Extract<
      CinenerdlePathNode,
      { kind: "cinenerdle" | "movie" | "person" | "break" }
    > =>
      pathNode.kind === "cinenerdle" ||
      pathNode.kind === "movie" ||
      pathNode.kind === "person" ||
      pathNode.kind === "break",
  );

  const cards: BookmarkRowCard[] = [];
  let previousEntity: ResolvedBookmarkEntity | null = null;
  let selectedAncestorCards: CinenerdleCard[] = [];

  for (const [index, pathNode] of bookmarkPathNodes.entries()) {
    if (pathNode.kind === "break") {
      cards.push({
        kind: "break",
        key: `${hashValue}:break:${index}`,
        label: ESCAPE_LABEL,
      });
      previousEntity = null;
      selectedAncestorCards = [];
      continue;
    }

    const resolvedEntity = await resolveBookmarkPathCard(pathNode);
    const nextCard = await createAssociatedBookmarkCard(previousEntity, resolvedEntity);
    cards.push({
      kind: "card",
      key: `${hashValue}:${index}:${nextCard.key}`,
      card: createRenderableBookmarkCard(nextCard, selectedAncestorCards),
    });
    selectedAncestorCards = [...selectedAncestorCards, nextCard];
    previousEntity = {
      ...resolvedEntity,
      card: nextCard,
      movieRecord: nextCard.kind === "movie" ? nextCard.record : null,
      personRecord: nextCard.kind === "person" ? nextCard.record : null,
    };
  }

  return {
    hash: hashValue,
    cards,
  };
}

export function createBookmarkRowPlaceholder(hash: string): BookmarkRowData {
  return {
    hash,
    cards: [],
  };
}

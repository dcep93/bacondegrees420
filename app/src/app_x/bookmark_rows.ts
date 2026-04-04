import { ESCAPE_LABEL, TMDB_ICON_URL } from "./generators/cinenerdle2/constants";
import {
  createCinenerdleOnlyPersonCard,
  createCinenerdleRootCard,
  createMovieAssociationCard,
  createMovieRootCard,
  createPersonAssociationCard,
  createPersonRootCard,
} from "./generators/cinenerdle2/cards";
import {
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
  TmdbMovieCredit,
  TmdbPersonCredit,
} from "./generators/cinenerdle2/types";
import type { CinenerdleCard, CinenerdlePathNode } from "./generators/cinenerdle2/view_types";
import {
  formatMoviePathLabel,
  getAssociatedMovieCreditGroupsFromPersonCredits,
  getAssociatedPersonCreditGroupsFromMovieCredits,
  getFilmKey,
  getMovieKeyFromCredit,
  getValidTmdbEntityId,
  normalizeName,
  normalizeTitle,
  parseMoviePathLabel,
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
): Promise<Map<string, number>> {
  if (!personRecord) {
    return new Map();
  }

  const movieKeys = Array.from(
    new Set(
      personRecord.movieConnectionKeys
        .map((movieKey) => {
          const parsedMovie = parseMoviePathLabel(movieKey);
          return getFilmKey(parsedMovie.name, parsedMovie.year);
        })
        .filter(Boolean),
    ),
  );
  const movieRecords = await Promise.all(
    movieKeys.map(async (movieKey) => {
      const parsedMovie = parseMoviePathLabel(movieKey);
      return [
        movieKey,
        await getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year),
      ] as const;
    }),
  );

  return new Map(
    movieRecords.map(([movieKey, movieRecord]) => [movieKey, movieRecord?.popularity ?? 0] as const),
  );
}

async function buildPopularityByPersonName(
  movieRecord: FilmRecord | null,
): Promise<Map<string, number>> {
  if (!movieRecord) {
    return new Map();
  }

  const personNames = Array.from(
    new Set(movieRecord.personConnectionKeys.map(normalizeName).filter(Boolean)),
  );
  const personRecords = await Promise.all(
    personNames.map(async (personName) => [
      personName,
      await getPersonRecordByName(personName),
    ] as const),
  );

  return new Map(
    personRecords.map(([personName, personRecord]) => [
      personName,
      personRecord?.rawTmdbPerson?.popularity ?? 0,
    ] as const),
  );
}

function findMovieCreditGroupForBookmark(
  personRecord: PersonRecord | null,
  entity: ResolvedBookmarkEntity,
): { credits: TmdbMovieCredit[]; connectionOrder: number } | null {
  if (!personRecord || entity.pathNode.kind !== "movie") {
    return null;
  }

  const targetMovieTmdbId = getValidTmdbEntityId(entity.movieRecord?.tmdbId ?? entity.movieRecord?.id);
  const targetMovieKey = getFilmKey(entity.pathNode.name, entity.pathNode.year);
  const creditGroups = getAssociatedMovieCreditGroupsFromPersonCredits(personRecord);
  const connectionIndex = creditGroups.findIndex((creditGroup) => {
    const representativeCredit = creditGroup[0];
    if (!representativeCredit) {
      return false;
    }

    const creditTmdbId = getValidTmdbEntityId(representativeCredit.id);
    if (targetMovieTmdbId !== null && creditTmdbId !== null) {
      return targetMovieTmdbId === creditTmdbId;
    }

    return getMovieKeyFromCredit(representativeCredit) === targetMovieKey;
  });

  return connectionIndex >= 0
    ? {
        credits: creditGroups[connectionIndex] ?? [],
        connectionOrder: connectionIndex + 1,
      }
    : null;
}

function findPersonCreditGroupForBookmark(
  movieRecord: FilmRecord | null,
  entity: ResolvedBookmarkEntity,
): { credits: TmdbPersonCredit[]; connectionOrder: number } | null {
  if (!movieRecord || entity.pathNode.kind !== "person") {
    return null;
  }

  const targetPersonTmdbId = getValidTmdbEntityId(
    entity.personRecord?.tmdbId ?? entity.personRecord?.id ?? entity.pathNode.tmdbId,
  );
  const targetPersonName = normalizeName(entity.pathNode.name);
  const creditGroups = getAssociatedPersonCreditGroupsFromMovieCredits(movieRecord);
  const connectionIndex = creditGroups.findIndex((creditGroup) => {
    const representativeCredit = creditGroup[0];
    if (!representativeCredit) {
      return false;
    }

    const creditTmdbId = getValidTmdbEntityId(representativeCredit.id);
    if (targetPersonTmdbId !== null && creditTmdbId !== null) {
      return targetPersonTmdbId === creditTmdbId;
    }

    return normalizeName(representativeCredit.name ?? "") === targetPersonName;
  });

  return connectionIndex >= 0
    ? {
        credits: creditGroups[connectionIndex] ?? [],
        connectionOrder: connectionIndex + 1,
      }
    : null;
}

async function createAssociatedBookmarkCard(
  previousEntity: ResolvedBookmarkEntity | null,
  entity: ResolvedBookmarkEntity,
): Promise<BookmarkRenderableEntityCard> {
  if (!previousEntity) {
    return entity.card;
  }

  if (previousEntity.card.kind === "person" && entity.card.kind === "movie") {
    const creditGroup = findMovieCreditGroupForBookmark(previousEntity.personRecord, entity);
    if (!creditGroup) {
      return entity.card;
    }

    const popularityByPersonName = await buildPopularityByPersonName(entity.movieRecord);
    return {
      ...(createMovieAssociationCard(
        creditGroup.credits,
        entity.movieRecord,
        entity.movieRecord
          ? Math.max(entity.movieRecord.personConnectionKeys.length, 1)
          : getBookmarkConnectionCount(entity.card),
      ) as Extract<CinenerdleCard, { kind: "movie" }>),
      connectionOrder: creditGroup.connectionOrder,
      connectionParentLabel: previousEntity.card.name,
      connectionRank: getParentPersonRankForMovie(
        entity.movieRecord,
        previousEntity.personRecord,
        popularityByPersonName,
      ),
    };
  }

  if (previousEntity.card.kind === "movie" && entity.card.kind === "person") {
    const creditGroup = findPersonCreditGroupForBookmark(previousEntity.movieRecord, entity);
    if (!creditGroup) {
      return entity.card;
    }

    const popularityByMovieKey = await buildPopularityByMovieKey(entity.personRecord);
    return {
      ...(createPersonAssociationCard(
        creditGroup.credits,
        entity.personRecord
          ? Math.max(entity.personRecord.movieConnectionKeys.length, 1)
          : getBookmarkConnectionCount(entity.card),
        entity.personRecord,
      ) as Extract<CinenerdleCard, { kind: "person" }>),
      connectionOrder: creditGroup.connectionOrder,
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

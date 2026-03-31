import { ESCAPE_LABEL, TMDB_ICON_URL } from "./generators/cinenerdle2/constants";
import {
  createCinenerdleOnlyPersonCard,
  createCinenerdleRootCard,
  createMovieRootCard,
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
import type { CinenerdleCard, CinenerdlePathNode } from "./generators/cinenerdle2/view_types";
import {
  normalizeName,
  normalizeTitle,
} from "./generators/cinenerdle2/utils";
import { createCardViewModel } from "./generators/cinenerdle2/view_model";
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
): Promise<Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>> {
  if (pathNode.kind === "cinenerdle") {
    return createCinenerdleRootCard(null) as Extract<
      CinenerdleCard,
      { kind: "cinenerdle" | "movie" | "person" }
    >;
  }

  if (pathNode.kind === "person") {
    const personRecord = pathNode.tmdbId
      ? await getPersonRecordById(pathNode.tmdbId)
      : await getPersonRecordByName(normalizeName(pathNode.name));

    return (
      personRecord
        ? createPersonRootCard(personRecord, pathNode.name)
        : createCinenerdleOnlyPersonCard(pathNode.name, "database only")
    ) as Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>;
  }

  const movieRecord = await getFilmRecordByTitleAndYear(pathNode.name, pathNode.year);

  return (
    movieRecord
      ? createMovieRootCard(movieRecord, pathNode.name)
      : createUncachedBookmarkMovieCard(pathNode.name, pathNode.year)
  ) as Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>;
}

function createRenderableBookmarkCard(
  card: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>,
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
    tmdbTooltipText: null,
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

  const cards = await Promise.all(
    bookmarkPathNodes.map(async (pathNode, index) => {
      if (pathNode.kind === "break") {
        return {
          kind: "break" as const,
          key: `${hashValue}:break:${index}`,
          label: ESCAPE_LABEL,
        };
      }

      const card = await resolveBookmarkPathCard(pathNode);
      return {
        kind: "card" as const,
        key: `${hashValue}:${index}:${card.key}`,
        card: createRenderableBookmarkCard(card),
      };
    }),
  );

  return {
    hash: hashValue,
    cards: cards.filter((card): card is BookmarkRowCard => Boolean(card)),
  };
}

export function createBookmarkRowPlaceholder(hash: string): BookmarkRowData {
  return {
    hash,
    cards: [],
  };
}

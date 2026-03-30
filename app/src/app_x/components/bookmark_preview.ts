import { ESCAPE_LABEL, TMDB_ICON_URL } from "../generators/cinenerdle2/constants";
import type { CinenerdleCard, CardSource, CardStatus } from "../generators/cinenerdle2/view_types";

type BaseBookmarkPreviewCard = {
  key: string;
  name: string;
  imageUrl: string | null;
  subtitle: string;
  subtitleDetail: string;
  popularity: number;
  popularitySource: string | null;
  connectionCount: number | null;
  sources: CardSource[];
  status: CardStatus | null;
  hasCachedTmdbSource: boolean;
};

export type BookmarkPreviewCard =
  | (BaseBookmarkPreviewCard & {
      kind: "break";
    })
  | (BaseBookmarkPreviewCard & {
      kind: "cinenerdle" | "person";
    })
  | (BaseBookmarkPreviewCard & {
      kind: "movie";
      year: string;
      voteAverage: number | null;
      voteCount: number | null;
    });

function isTmdbSourceLabel(label: string) {
  return label.trim().toLowerCase() === "tmdb";
}

function getRenderableSources(card: Exclude<CinenerdleCard, { kind: "dbinfo" }>) {
  return (card.sources ?? []).filter(
    (source) => source.iconUrl === TMDB_ICON_URL || isTmdbSourceLabel(source.label),
  );
}

function hasCachedTmdbSource(card: Exclude<CinenerdleCard, { kind: "dbinfo" }>) {
  if (card.kind === "break") {
    return false;
  }

  if (card.kind === "movie") {
    return Boolean(
      card.record?.fetchTimestamp ||
      card.record?.rawTmdbMovie ||
      card.record?.rawTmdbMovieSearchResponse ||
      card.record?.rawTmdbMovieCreditsResponse,
    );
  }

  if (card.kind === "person") {
    return Boolean(
      card.record?.fetchTimestamp ||
      card.record?.rawTmdbPerson ||
      card.record?.rawTmdbPersonSearchResponse ||
      card.record?.rawTmdbMovieCreditsResponse,
    );
  }

  return false;
}

export function isBookmarkPreviewCardSelectable(
  card: BookmarkPreviewCard,
): card is Exclude<BookmarkPreviewCard, { kind: "break" }> {
  return card.kind !== "break";
}

export function createBookmarkPreviewCard(
  card: Exclude<CinenerdleCard, { kind: "dbinfo" }>,
): BookmarkPreviewCard {
  if (card.kind === "break") {
    return {
      key: card.key,
      kind: "break",
      name: ESCAPE_LABEL,
      imageUrl: null,
      subtitle: "",
      subtitleDetail: "",
      popularity: 0,
      popularitySource: null,
      connectionCount: null,
      sources: [],
      status: null,
      hasCachedTmdbSource: false,
    };
  }

  const sharedFields = {
    key: card.key,
    name: card.name,
    imageUrl: card.imageUrl,
    subtitle: card.subtitle,
    subtitleDetail: card.subtitleDetail,
    popularity: card.popularity,
    popularitySource: card.popularitySource,
    connectionCount: card.connectionCount,
    sources: getRenderableSources(card),
    status: card.status,
    hasCachedTmdbSource: hasCachedTmdbSource(card),
  } satisfies BaseBookmarkPreviewCard;

  if (card.kind === "movie") {
    return {
      ...sharedFields,
      kind: "movie",
      year: card.year,
      voteAverage: card.voteAverage,
      voteCount: card.voteCount,
    };
  }

  return {
    ...sharedFields,
    kind: card.kind,
  };
}

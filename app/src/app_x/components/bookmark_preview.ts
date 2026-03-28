import { TMDB_ICON_URL } from "../generators/cinenerdle2/constants";
import type { CinenerdleCard, CardSource, CardStatus } from "../generators/cinenerdle2/view_types";

type BaseBookmarkPreviewCard = {
  key: string;
  name: string;
  imageUrl: string | null;
  subtitle: string;
  subtitleDetail: string;
  popularity: number;
  connectionCount: number | null;
  sources: CardSource[];
  status: CardStatus | null;
  hasCachedTmdbSource: boolean;
};

export type BookmarkPreviewCard =
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

export function createBookmarkPreviewCard(
  card: Exclude<CinenerdleCard, { kind: "dbinfo" }>,
): BookmarkPreviewCard {
  const sharedFields = {
    key: card.key,
    name: card.name,
    imageUrl: card.imageUrl,
    subtitle: card.subtitle,
    subtitleDetail: card.subtitleDetail,
    popularity: card.popularity,
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

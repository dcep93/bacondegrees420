import type { CardCreditLine, CardSource, CardStatus } from "../view_types";

type BaseRenderableCinenerdleEntityCard = {
  key: string;
  kind: "cinenerdle" | "person" | "movie";
  name: string;
  imageUrl: string | null;
  subtitle: string;
  subtitleDetail: string;
  creditLines?: CardCreditLine[] | null;
  popularity: number;
  popularitySource: string | null;
  connectionCount: number | null;
  connectionRank: number | null;
  connectionOrder: number | null;
  connectionParentLabel: string | null;
  sources: CardSource[];
  status: CardStatus | null;
  hasCachedTmdbSource: boolean;
  isExcluded: boolean;
  onExplicitTmdbRowClick?: (() => void) | null;
  onTmdbRowClick?: (() => Promise<void> | void) | null;
  tmdbTooltipText?: string | null;
  isSelected: boolean;
  isLocked?: boolean;
  isAncestorSelected?: boolean;
};

type RenderableMovieCard = BaseRenderableCinenerdleEntityCard & {
  kind: "movie";
  voteAverage: number | null;
  voteCount: number | null;
};

type RenderableNonMovieCard = BaseRenderableCinenerdleEntityCard & {
  kind: "cinenerdle" | "person";
};

export type RenderableCinenerdleEntityCard = RenderableMovieCard | RenderableNonMovieCard;

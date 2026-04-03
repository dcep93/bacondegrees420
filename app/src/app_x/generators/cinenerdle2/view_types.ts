import type { GeneratorCardRowOrderMetadata } from "../../types/generator";
import type { FilmRecord, PersonRecord } from "./types";

export type CardSource = {
  iconUrl: string;
  label: string;
};

export type CardStatus = {
  text: string;
  tone: "info" | "success" | "danger";
};

export type CardCreditLine = {
  subtitle: string;
  subtitleDetail: string;
};

export type DbInfoSummaryItem = {
  label: string;
  value: string;
};

export type CinenerdlePathNode =
  | {
      kind: "cinenerdle";
      name: "cinenerdle";
      year: "";
    }
  | {
      kind: "person";
      name: string;
      year: "";
      tmdbId: number | null;
    }
  | {
      kind: "movie";
      name: string;
      year: string;
    }
  | {
      kind: "break";
      name: "";
      year: "";
    };

type BaseCard = {
  key: string;
  name: string;
  popularity: number;
  popularitySource: string | null;
  connectionRank?: number | null;
  connectionOrder?: number | null;
  connectionParentLabel?: string | null;
  imageUrl: string | null;
  subtitle: string;
  subtitleDetail: string;
  creditLines?: CardCreditLine[];
  connectionCount: number | null;
  sources: CardSource[];
  status: CardStatus | null;
};

type EntityCardItemAttrs = {
  itemAttrs?: string[];
  connectedItemAttrs?: string[];
  inheritedItemAttrs?: string[];
  itemAttrCounts?: GeneratorCardRowOrderMetadata;
};

export type DbInfoCard = BaseCard & {
  kind: "dbinfo";
  body: string;
  recordKind: "movie" | "person";
  summaryItems: DbInfoSummaryItem[];
  record: FilmRecord | PersonRecord | null;
};

export type CinenerdleRootCard = BaseCard & {
  kind: "cinenerdle";
  record: null;
};

export type BreakCard = BaseCard & {
  kind: "break";
  record: null;
};

export type PersonCard = BaseCard & EntityCardItemAttrs & {
  kind: "person";
  record: PersonRecord | null;
};

export type MovieCard = BaseCard & EntityCardItemAttrs & {
  kind: "movie";
  year: string;
  voteAverage: number | null;
  voteCount: number | null;
  record: FilmRecord | null;
};

export type CinenerdleCard = CinenerdleRootCard | BreakCard | PersonCard | MovieCard | DbInfoCard;

type BaseCardViewModel = {
  key: string;
  kind: CinenerdleCard["kind"];
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
  isSelected: boolean;
  isLocked: boolean;
  isAncestorSelected: boolean;
  hasCachedTmdbSource: boolean;
  isExcluded: boolean;
};

type EntityCardViewModelAttrs = {
  itemAttrs: string[];
  connectedItemAttrs: string[];
  inheritedItemAttrs: string[];
  itemAttrCounts: GeneratorCardRowOrderMetadata;
};

export type CinenerdleCardViewModel =
  | (BaseCardViewModel & {
      kind: "cinenerdle" | "person";
    } & Partial<EntityCardViewModelAttrs>)
  | (BaseCardViewModel & {
      kind: "movie";
      voteAverage: number | null;
      voteCount: number | null;
    } & EntityCardViewModelAttrs)
  | (BaseCardViewModel & {
      kind: "break";
    })
  | (BaseCardViewModel & {
      kind: "dbinfo";
      body: string;
      recordKind: "movie" | "person";
      summaryItems: DbInfoSummaryItem[];
    });

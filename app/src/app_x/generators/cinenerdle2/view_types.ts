import type { FilmRecord, PersonRecord } from "./types";

export type CardSource = {
  iconUrl: string;
  label: string;
};

export type CardStatus = {
  text: string;
  tone: "info" | "success" | "danger";
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
  imageUrl: string | null;
  subtitle: string;
  subtitleDetail: string;
  connectionCount: number | null;
  sources: CardSource[];
  status: CardStatus | null;
};

export type CinenerdleRootCard = BaseCard & {
  kind: "cinenerdle";
  record: null;
};

export type PersonCard = BaseCard & {
  kind: "person";
  record: PersonRecord | null;
};

export type MovieCard = BaseCard & {
  kind: "movie";
  year: string;
  voteAverage: number | null;
  voteCount: number | null;
  record: FilmRecord | null;
};

export type CinenerdleCard = CinenerdleRootCard | PersonCard | MovieCard;

type BaseCardViewModel = {
  kind: CinenerdleCard["kind"];
  name: string;
  imageUrl: string | null;
  subtitle: string;
  subtitleDetail: string;
  popularity: number;
  connectionCount: number | null;
  sources: CardSource[];
  status: CardStatus | null;
  isSelected: boolean;
  isLocked: boolean;
  isAncestorSelected: boolean;
  hasCachedTmdbSource: boolean;
};

export type CinenerdleCardViewModel =
  | (BaseCardViewModel & {
      kind: "cinenerdle" | "person";
    })
  | (BaseCardViewModel & {
      kind: "movie";
      voteAverage: number | null;
      voteCount: number | null;
    });

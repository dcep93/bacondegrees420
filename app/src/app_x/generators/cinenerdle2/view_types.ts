import type { FilmRecord, PersonRecord } from "./types";

export type CardSource = {
  iconUrl: string;
  label: string;
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
  record: FilmRecord | null;
};

export type CinenerdleCard = CinenerdleRootCard | PersonCard | MovieCard;

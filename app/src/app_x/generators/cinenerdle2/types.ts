export type CardSource = {
  iconUrl: string;
  label: string;
};

export type CinenerdleDailyStarter = {
  id?: string | number | null;
  title?: string | null;
  posterUrl?: string | null;
  genres?: string[] | null;
  cast?: string[] | null;
  directors?: string[] | null;
  writers?: string[] | null;
  composers?: string[] | null;
};

export type TmdbPersonSearchResult = {
  id: number;
  name?: string;
  profile_path?: string | null;
  popularity?: number;
};

export type TmdbMovieSearchResult = {
  id: number;
  title?: string;
  original_title?: string;
  poster_path?: string | null;
  release_date?: string;
  popularity?: number;
};

export type TmdbMovieCredit = {
  id?: number;
  title?: string;
  original_title?: string;
  poster_path?: string | null;
  release_date?: string;
  popularity?: number;
  creditType?: "cast" | "crew";
  character?: string;
  job?: string;
};

export type TmdbPersonCredit = {
  id?: number;
  name?: string;
  profile_path?: string | null;
  popularity?: number;
  known_for_department?: string;
  character?: string;
  job?: string;
};

export type TmdbMovieCreditsResponse = {
  cast?: TmdbPersonCredit[];
  crew?: TmdbPersonCredit[];
};

export type TmdbPersonMovieCreditsResponse = {
  cast?: TmdbMovieCredit[];
  crew?: TmdbMovieCredit[];
};

export type TmdbSearchResponse<T> = {
  page?: number;
  results?: T[];
  total_pages?: number;
  total_results?: number;
};

export type CinenerdlePeopleByRole = {
  cast: string[];
  directors: string[];
  writers: string[];
  composers: string[];
};

export type PersonRecord = {
  id: number;
  tmdbId: number | null;
  cinenerdleId: string;
  name: string;
  nameLower: string;
  movieConnectionKeys: string[];
  rawTmdbPerson?: TmdbPersonSearchResult;
  rawTmdbPersonSearchResponse?: TmdbSearchResponse<TmdbPersonSearchResult>;
  rawTmdbMovieCreditsResponse?: TmdbPersonMovieCreditsResponse;
  savedAt?: string;
};

export type FilmRecord = {
  id: number | string;
  tmdbId: number | null;
  cinenerdleId: string;
  title: string;
  titleLower: string;
  year: string;
  titleYear: string;
  popularity: number;
  personConnectionKeys: string[];
  rawTmdbMovie?: TmdbMovieSearchResult;
  rawTmdbMovieSearchResponse?: TmdbSearchResponse<TmdbMovieSearchResult>;
  rawTmdbMovieCreditsResponse?: TmdbMovieCreditsResponse;
  rawCinenerdleDailyStarter?: CinenerdleDailyStarter;
  cinenerdleSnapshot?: CinenerdlePeopleByRole;
  tmdbSavedAt?: string;
  tmdbCreditsSavedAt?: string;
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

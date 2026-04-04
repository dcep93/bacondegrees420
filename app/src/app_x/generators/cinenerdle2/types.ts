export type CinenerdleDailyStarter = {
  id?: string | number | null;
  tmdbId?: number | null;
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

export type TmdbGenre = {
  id: number;
  name: string;
};

export type TmdbMovieSearchResult = {
  id: number;
  title?: string;
  original_title?: string;
  poster_path?: string | null;
  release_date?: string;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  genres?: TmdbGenre[];
};

export type TmdbMovieCredit = {
  id?: number;
  title?: string;
  original_title?: string;
  poster_path?: string | null;
  release_date?: string;
  popularity?: number;
  genre_ids?: number[];
  order?: number;
  vote_average?: number;
  vote_count?: number;
  fetchTimestamp?: string;
  creditType?: "cast" | "crew";
  character?: string;
  job?: string;
  department?: string;
};

export type TmdbPersonCredit = {
  id?: number;
  name?: string;
  profile_path?: string | null;
  popularity?: number;
  order: number;
  fetchTimestamp?: string;
  known_for_department?: string;
  creditType?: "cast" | "crew";
  character?: string;
  job?: string;
  department?: string;
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

export type PersonRecord = {
  id: number;
  tmdbId: number | null;
  lookupKey: string;
  name: string;
  nameLower: string;
  movieConnectionKeys: string[];
  tmdbSource?: import("./tmdb_provenance").PersonTmdbSource;
  rawTmdbPerson?: TmdbPersonSearchResult;
  rawTmdbPersonSearchResponse?: TmdbSearchResponse<TmdbPersonSearchResult>;
  rawTmdbMovieCreditsResponse?: TmdbPersonMovieCreditsResponse;
  fetchTimestamp?: string;
};

export type FilmRecord = {
  id: number | string;
  tmdbId: number | null;
  lookupKey: string;
  title: string;
  titleLower: string;
  year: string;
  titleYear: string;
  popularity: number;
  genreIds: number[];
  personConnectionKeys: string[];
  tmdbSource?: import("./tmdb_provenance").FilmTmdbSource;
  rawTmdbMovie?: TmdbMovieSearchResult;
  rawTmdbMovieSearchResponse?: TmdbSearchResponse<TmdbMovieSearchResult>;
  rawTmdbMovieCreditsResponse?: TmdbMovieCreditsResponse;
  fetchTimestamp?: string;
};

export type SearchableConnectionEntityRecord = {
  key: string;
  type: "person" | "movie";
  nameLower: string;
  popularity?: number;
};

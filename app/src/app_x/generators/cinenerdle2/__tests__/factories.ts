import type {
  CinenerdleDailyStarter,
  FilmRecord,
  PersonRecord,
  TmdbMovieCredit,
  TmdbMovieSearchResult,
  TmdbPersonCredit,
  TmdbPersonSearchResult,
} from "../types";
import { getCinenerdleMovieId, getCinenerdlePersonId, getFilmKey, normalizeName, normalizeTitle } from "../utils";

function pickOverride<T extends object, K extends keyof T>(
  overrides: Partial<T>,
  key: K,
  fallback: T[K],
): T[K] {
  return Object.prototype.hasOwnProperty.call(overrides, key)
    ? (overrides[key] as T[K])
    : fallback;
}

export function makeStarter(
  overrides: Partial<CinenerdleDailyStarter> = {},
): CinenerdleDailyStarter {
  return {
    id: pickOverride(overrides, "id", "starter-heat"),
    title: pickOverride(overrides, "title", "Heat (1995)"),
    posterUrl: pickOverride(overrides, "posterUrl", "https://img.test/starter-heat.jpg"),
    genres: pickOverride(overrides, "genres", ["Crime", "Drama", "Thriller"]),
    cast: pickOverride(overrides, "cast", ["Al Pacino", "Robert De Niro"]),
    directors: pickOverride(overrides, "directors", ["Michael Mann"]),
    writers: pickOverride(overrides, "writers", ["Michael Mann"]),
    composers: pickOverride(overrides, "composers", ["Elliot Goldenthal"]),
  };
}

export function makeTmdbMovieSearchResult(
  overrides: Partial<TmdbMovieSearchResult> = {},
): TmdbMovieSearchResult {
  return {
    id: pickOverride(overrides, "id", 10),
    title: pickOverride(overrides, "title", "Heat"),
    original_title: pickOverride(
      overrides,
      "original_title",
      pickOverride(overrides, "title", "Heat"),
    ),
    poster_path: pickOverride(overrides, "poster_path", "/heat.jpg"),
    release_date: pickOverride(overrides, "release_date", "1995-12-15"),
    popularity: pickOverride(overrides, "popularity", 88),
    vote_average: pickOverride(overrides, "vote_average", 8.2),
    vote_count: pickOverride(overrides, "vote_count", 9000),
  };
}

export function makeTmdbPersonSearchResult(
  overrides: Partial<TmdbPersonSearchResult> = {},
): TmdbPersonSearchResult {
  return {
    id: pickOverride(overrides, "id", 20),
    name: pickOverride(overrides, "name", "Al Pacino"),
    profile_path: pickOverride(overrides, "profile_path", "/al-pacino.jpg"),
    popularity: pickOverride(overrides, "popularity", 77),
  };
}

export function makeMovieCredit(
  overrides: Partial<TmdbMovieCredit> = {},
): TmdbMovieCredit {
  return {
    id: pickOverride(overrides, "id", 30),
    title: pickOverride(overrides, "title", "Insomnia"),
    original_title: pickOverride(
      overrides,
      "original_title",
      pickOverride(overrides, "title", "Insomnia"),
    ),
    poster_path: pickOverride(overrides, "poster_path", "/insomnia.jpg"),
    release_date: pickOverride(overrides, "release_date", "2002-05-24"),
    popularity: pickOverride(overrides, "popularity", 55),
    vote_average: pickOverride(overrides, "vote_average", 7.1),
    vote_count: pickOverride(overrides, "vote_count", 1200),
    creditType: pickOverride(overrides, "creditType", "cast"),
    character: pickOverride(overrides, "character", "Will Dormer"),
    job: pickOverride(overrides, "job", undefined),
    department: pickOverride(overrides, "department", undefined),
  };
}

export function makePersonCredit(
  overrides: Partial<TmdbPersonCredit> = {},
): TmdbPersonCredit {
  return {
    id: pickOverride(overrides, "id", 40),
    name: pickOverride(overrides, "name", "Hilary Swank"),
    profile_path: pickOverride(overrides, "profile_path", "/hilary-swank.jpg"),
    popularity: pickOverride(overrides, "popularity", 44),
    known_for_department: pickOverride(overrides, "known_for_department", "Acting"),
    creditType: pickOverride(overrides, "creditType", "cast"),
    character: pickOverride(overrides, "character", "Ellie Burr"),
    job: pickOverride(overrides, "job", undefined),
    department: pickOverride(overrides, "department", undefined),
  };
}

export function makeFilmRecord(
  overrides: Partial<FilmRecord> = {},
): FilmRecord {
  const title = pickOverride(overrides, "title", "Heat");
  const year = pickOverride(overrides, "year", "1995");

  return {
    id: pickOverride(overrides, "id", 50),
    tmdbId: pickOverride(overrides, "tmdbId", 50),
    lookupKey: pickOverride(overrides, "lookupKey", getCinenerdleMovieId(title, year)),
    title,
    titleLower: pickOverride(overrides, "titleLower", normalizeTitle(title)),
    year,
    titleYear: pickOverride(overrides, "titleYear", getFilmKey(title, year)),
    popularity: pickOverride(overrides, "popularity", 66),
    personConnectionKeys: pickOverride(overrides, "personConnectionKeys", []),
    rawTmdbMovie: pickOverride(overrides, "rawTmdbMovie", undefined),
    rawTmdbMovieSearchResponse: pickOverride(overrides, "rawTmdbMovieSearchResponse", undefined),
    rawTmdbMovieCreditsResponse: pickOverride(overrides, "rawTmdbMovieCreditsResponse", undefined),
    rawCinenerdleDailyStarter: pickOverride(overrides, "rawCinenerdleDailyStarter", undefined),
    starterPeopleByRole: pickOverride(overrides, "starterPeopleByRole", undefined),
    isCinenerdleDailyStarter: pickOverride(overrides, "isCinenerdleDailyStarter", undefined),
    tmdbSavedAt: pickOverride(overrides, "tmdbSavedAt", undefined),
    tmdbCreditsSavedAt: pickOverride(overrides, "tmdbCreditsSavedAt", undefined),
  };
}

export function makePersonRecord(
  overrides: Partial<PersonRecord> = {},
): PersonRecord {
  const name = pickOverride(overrides, "name", "Al Pacino");

  return {
    id: pickOverride(overrides, "id", 60),
    tmdbId: pickOverride(overrides, "tmdbId", 60),
    lookupKey: pickOverride(overrides, "lookupKey", getCinenerdlePersonId(name)),
    name,
    nameLower: pickOverride(overrides, "nameLower", normalizeName(name)),
    movieConnectionKeys: pickOverride(overrides, "movieConnectionKeys", []),
    rawTmdbPerson: pickOverride(overrides, "rawTmdbPerson", undefined),
    rawTmdbPersonSearchResponse: pickOverride(overrides, "rawTmdbPersonSearchResponse", undefined),
    rawTmdbMovieCreditsResponse: pickOverride(overrides, "rawTmdbMovieCreditsResponse", undefined),
    savedAt: pickOverride(overrides, "savedAt", undefined),
  };
}

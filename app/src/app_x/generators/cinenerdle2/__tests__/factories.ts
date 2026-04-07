import type {
  CinenerdleDailyStarter,
  FilmRecord,
  PersonRecord,
  TmdbGenre,
  TmdbMovieCredit,
  TmdbMovieSearchResult,
  TmdbPersonCredit,
  TmdbPersonSearchResult,
} from "../types";
import { getCinenerdleMovieId, getCinenerdlePersonId, getFilmKey, normalizeName, normalizeTitle } from "../utils";
import { getFilmTmdbSource, getPersonTmdbSource } from "../tmdb_provenance";

type LegacyConnectionKey = string | number;

type FilmRecordOverrides = Omit<Partial<FilmRecord>, "personConnectionKeys"> & {
  personConnectionKeys?: LegacyConnectionKey[];
};

type PersonRecordOverrides = Omit<Partial<PersonRecord>, "movieConnectionKeys"> & {
  movieConnectionKeys?: LegacyConnectionKey[];
};

function pickOverride<T extends object, K extends keyof T>(
  overrides: Partial<T>,
  key: K,
  fallback: T[K],
): T[K] {
  return Object.prototype.hasOwnProperty.call(overrides, key)
    ? (overrides[key] as T[K])
    : fallback;
}

function getStableLegacyConnectionId(
  kind: "movie" | "person",
  value: string,
): number {
  const normalizedValue = kind === "movie" ? normalizeTitle(value) : normalizeName(value);
  let hash = kind === "movie" ? 17 : 31;

  for (const character of normalizedValue) {
    hash = ((hash * 33) + character.charCodeAt(0)) % 2147483647;
  }

  return Math.max(hash, 1);
}

export function getLegacyMovieConnectionId(value: string): number {
  return getStableLegacyConnectionId("movie", value);
}

export function getLegacyPersonConnectionId(value: string): number {
  return getStableLegacyConnectionId("person", value);
}

function normalizeLegacyMovieConnectionKeys(
  connectionKeys: LegacyConnectionKey[],
  rawCredits: FilmRecord["rawTmdbMovieCreditsResponse"],
): number[] {
  const creditIdsByName = new Map(
    (rawCredits?.cast ?? [])
      .concat(rawCredits?.crew ?? [])
      .flatMap((credit) => {
        const validId = typeof credit.id === "number" ? credit.id : null;
        const normalizedName = normalizeName(credit.name ?? "");
        return validId && normalizedName ? [[normalizedName, validId] as const] : [];
      }),
  );

  return Array.from(new Set(connectionKeys.flatMap((connectionKey) => {
    if (typeof connectionKey === "number") {
      return [connectionKey];
    }

    const normalizedName = normalizeName(connectionKey);
    if (!normalizedName) {
      return [];
    }

    return [creditIdsByName.get(normalizedName) ?? getLegacyPersonConnectionId(connectionKey)];
  })));
}

function normalizeLegacyPersonMovieConnectionKeys(
  connectionKeys: LegacyConnectionKey[],
  rawCredits: PersonRecord["rawTmdbMovieCreditsResponse"],
): number[] {
  const creditIdsByMovieKey = new Map(
    (rawCredits?.cast ?? [])
      .concat(rawCredits?.crew ?? [])
      .flatMap((credit) => {
        const validId = typeof credit.id === "number" ? credit.id : null;
        const movieKey = getFilmKey(credit.title ?? credit.original_title ?? "", credit.release_date?.slice(0, 4) ?? "");
        return validId && movieKey ? [[movieKey, validId] as const] : [];
      }),
  );

  return Array.from(new Set(connectionKeys.flatMap((connectionKey) => {
    if (typeof connectionKey === "number") {
      return [connectionKey];
    }

    const movieKey = getFilmKey(
      ...(() => {
        const match = connectionKey.match(/^(.*) \((\d{4})\)$/);
        return match ? [match[1].trim(), match[2]] as const : [connectionKey, ""] as const;
      })(),
    );
    if (!movieKey) {
      return [];
    }

    return [creditIdsByMovieKey.get(movieKey) ?? getLegacyMovieConnectionId(connectionKey)];
  })));
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
    runtime: pickOverride(overrides, "runtime", undefined as number | undefined),
    genres: pickOverride(overrides, "genres", undefined as TmdbGenre[] | undefined),
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
    genre_ids: pickOverride(overrides, "genre_ids", undefined as number[] | undefined),
    order: pickOverride(overrides, "order", 0),
    vote_average: pickOverride(overrides, "vote_average", 7.1),
    vote_count: pickOverride(overrides, "vote_count", 1200),
    fetchTimestamp: pickOverride(overrides, "fetchTimestamp", undefined),
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
    order: pickOverride(overrides, "order", 0),
    fetchTimestamp: pickOverride(overrides, "fetchTimestamp", undefined),
    known_for_department: pickOverride(overrides, "known_for_department", "Acting"),
    creditType: pickOverride(overrides, "creditType", "cast"),
    character: pickOverride(overrides, "character", "Ellie Burr"),
    job: pickOverride(overrides, "job", undefined),
    department: pickOverride(overrides, "department", undefined),
  };
}

export function makeFilmRecord(
  overrides: FilmRecordOverrides = {},
): FilmRecord {
  const title = pickOverride(overrides, "title", "Heat");
  const year = pickOverride(overrides, "year", "1995");
  const rawTmdbMovie =
    overrides.rawTmdbMovie as FilmRecord["rawTmdbMovie"] | undefined;
  const rawTmdbMovieCreditsResponse =
    overrides.rawTmdbMovieCreditsResponse as FilmRecord["rawTmdbMovieCreditsResponse"] | undefined;
  const rawTmdbMovieSearchResponse =
    overrides.rawTmdbMovieSearchResponse as FilmRecord["rawTmdbMovieSearchResponse"] | undefined;
  const fetchTimestamp = overrides.fetchTimestamp as FilmRecord["fetchTimestamp"] | undefined;

  return {
    id: pickOverride(overrides, "id", 50),
    tmdbId: pickOverride(overrides, "tmdbId", 50),
    lookupKey: pickOverride(overrides, "lookupKey", getCinenerdleMovieId(title, year)),
    title,
    titleLower: pickOverride(overrides, "titleLower", normalizeTitle(title)),
    year,
    titleYear: pickOverride(overrides, "titleYear", getFilmKey(title, year)),
    popularity: pickOverride(overrides, "popularity", 66),
    genreIds: pickOverride(
      overrides,
      "genreIds",
      rawTmdbMovie?.genres?.map((genre) => genre.id) ?? [],
    ),
    personConnectionKeys: normalizeLegacyMovieConnectionKeys(
      pickOverride(overrides, "personConnectionKeys", []),
      rawTmdbMovieCreditsResponse,
    ),
    tmdbSource: pickOverride(
      overrides,
      "tmdbSource",
      getFilmTmdbSource({
        rawTmdbMovie,
      } as FilmRecord),
    ),
    rawTmdbMovie,
    rawTmdbMovieSearchResponse,
    rawTmdbMovieCreditsResponse,
    fetchTimestamp,
  };
}

export function makePersonRecord(
  overrides: PersonRecordOverrides = {},
): PersonRecord {
  const name = pickOverride(overrides, "name", "Al Pacino");
  const rawTmdbMovieCreditsResponse =
    overrides.rawTmdbMovieCreditsResponse as PersonRecord["rawTmdbMovieCreditsResponse"] | undefined;
  const rawTmdbPerson = overrides.rawTmdbPerson as PersonRecord["rawTmdbPerson"] | undefined;
  const rawTmdbPersonSearchResponse =
    overrides.rawTmdbPersonSearchResponse as PersonRecord["rawTmdbPersonSearchResponse"] | undefined;
  const fetchTimestamp = overrides.fetchTimestamp as PersonRecord["fetchTimestamp"] | undefined;

  return {
    id: pickOverride(overrides, "id", 60),
    tmdbId: pickOverride(overrides, "tmdbId", 60),
    lookupKey: pickOverride(overrides, "lookupKey", getCinenerdlePersonId(name)),
    name,
    nameLower: pickOverride(overrides, "nameLower", normalizeName(name)),
    movieConnectionKeys: normalizeLegacyPersonMovieConnectionKeys(
      pickOverride(overrides, "movieConnectionKeys", []),
      rawTmdbMovieCreditsResponse,
    ),
    tmdbSource: pickOverride(
      overrides,
      "tmdbSource",
      getPersonTmdbSource({
        rawTmdbPerson,
      } as PersonRecord),
    ),
    rawTmdbPerson,
    rawTmdbPersonSearchResponse,
    rawTmdbMovieCreditsResponse,
    fetchTimestamp,
  };
}

import { CINENERDLE_ICON_URL, TMDB_ICON_URL } from "./constants";
import type {
  CinenerdleDailyStarter,
  FilmRecord,
  PersonRecord,
  TmdbMovieCredit,
  TmdbPersonCredit,
} from "./types";
import type { CinenerdleCard } from "./view_types";
import {
  buildPeopleByRoleFromStarter,
  getCinenerdleMovieId,
  getMovieCardKey,
  getMoviePosterUrl,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getPersonCardKey,
  getPersonProfileImageUrl,
  getPosterUrl,
  normalizeName,
  normalizeTitle,
} from "./utils";

export function createCinenerdleRootCard(connectionCount: number | null): CinenerdleCard {
  return {
    key: "cinenerdle",
    kind: "cinenerdle",
    name: "cinenerdle",
    popularity: 0,
    imageUrl: CINENERDLE_ICON_URL,
    subtitle: "Daily starters",
    subtitleDetail: "Open today’s board",
    connectionCount,
    sources: [{ iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle" }],
    record: null,
  };
}

export function createDailyStarterFilmRecord(
  starter: CinenerdleDailyStarter,
): FilmRecord {
  const titleAndYear = starter.title
    ? (() => {
        const match = starter.title.match(/^(.*) \((\d{4})\)$/);
        if (!match) {
          return {
            title: starter.title ?? "",
            year: "",
          };
        }

        return {
          title: match[1].trim(),
          year: match[2],
        };
      })()
    : { title: "", year: "" };

  const title = titleAndYear.title;
  const year = titleAndYear.year;

  return {
    id: starter.id ?? getCinenerdleMovieId(title, year),
    tmdbId: null,
    lookupKey: String(starter.id ?? getCinenerdleMovieId(title, year)),
    title,
    titleLower: normalizeTitle(title),
    year,
    titleYear: getCinenerdleMovieId(title, year),
    popularity: 0,
    rawCinenerdleDailyStarter: starter,
    starterPeopleByRole: buildPeopleByRoleFromStarter(starter),
    personConnectionKeys: Array.from(
      new Set(
        [
          ...(starter.cast ?? []),
          ...(starter.directors ?? []),
          ...(starter.writers ?? []),
          ...(starter.composers ?? []),
        ]
          .map((name) => normalizeName(name))
          .filter(Boolean),
      ),
    ),
  };
}

export function createDailyStarterMovieCard(filmRecord: FilmRecord): CinenerdleCard {
  const starter = filmRecord.rawCinenerdleDailyStarter;

  return {
    key: getMovieCardKey(filmRecord.title, filmRecord.year, filmRecord.id),
    kind: "movie",
    name: filmRecord.title,
    year: filmRecord.year,
    popularity: filmRecord.popularity,
    imageUrl: getMoviePosterUrl(filmRecord),
    subtitle: filmRecord.year || "Movie",
    subtitleDetail: (starter?.genres ?? []).slice(0, 2).join(" • "),
    connectionCount: Math.max(filmRecord.personConnectionKeys.length, 1),
    sources: [
      {
        iconUrl: CINENERDLE_ICON_URL,
        label: "Cinenerdle daily starter",
      },
    ],
    record: filmRecord,
  };
}

export function createPersonRootCard(
  personRecord: PersonRecord,
  requestedName: string,
): CinenerdleCard {
  const personName = personRecord.name || requestedName;

  return {
    key: getPersonCardKey(personName, personRecord.id),
    kind: "person",
    name: personName,
    popularity: personRecord.rawTmdbPerson?.popularity ?? 0,
    imageUrl: getPersonProfileImageUrl(personRecord),
    subtitle: "Person",
    subtitleDetail: "TMDB profile",
    connectionCount: Math.max(personRecord.movieConnectionKeys.length, 1),
    sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDB" }],
    record: personRecord,
  };
}

export function createMovieRootCard(
  movieRecord: FilmRecord,
  requestedTitle: string,
): CinenerdleCard {
  const title = movieRecord.title || requestedTitle;
  const year = movieRecord.year;

  return {
    key: getMovieCardKey(title, year, movieRecord.id),
    kind: "movie",
    name: title,
    year,
    popularity: movieRecord.popularity,
    imageUrl: getMoviePosterUrl(movieRecord),
    subtitle: "Movie",
    subtitleDetail: "TMDB film",
    connectionCount: Math.max(movieRecord.personConnectionKeys.length, 1),
    sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDB" }],
    record: movieRecord,
  };
}

export function createMovieAssociationCard(
  credit: TmdbMovieCredit,
  filmRecord: FilmRecord | null,
  connectionCount: number,
): CinenerdleCard {
  const title = filmRecord?.title ?? getMovieTitleFromCredit(credit);
  const year = filmRecord?.year ?? getMovieYearFromCredit(credit);
  const resolvedFilmRecord =
    filmRecord ??
    (title
      ? {
          id: credit.id ?? getCinenerdleMovieId(title, year),
          tmdbId: credit.id ?? null,
          lookupKey: getCinenerdleMovieId(title, year),
          title,
          titleLower: normalizeTitle(title),
          year,
          titleYear: getCinenerdleMovieId(title, year),
          popularity: credit.popularity ?? 0,
          personConnectionKeys: [],
          rawTmdbMovie: credit.id
            ? {
                id: credit.id,
                title,
                original_title: credit.original_title,
                poster_path: credit.poster_path,
                release_date: credit.release_date,
                popularity: credit.popularity,
              }
            : undefined,
        }
      : null);
  return {
    key: getMovieCardKey(title, year, resolvedFilmRecord?.id ?? credit.id),
    kind: "movie",
    name: title,
    year,
    popularity:
      credit.popularity ??
      resolvedFilmRecord?.rawTmdbMovie?.popularity ??
      resolvedFilmRecord?.popularity ??
      0,
    imageUrl:
      getPosterUrl(credit.poster_path) ?? getMoviePosterUrl(resolvedFilmRecord),
    subtitle: "Movie",
    subtitleDetail:
      credit.creditType === "cast"
        ? credit.character?.trim() ?? "Cast"
        : credit.job?.trim() ?? "Crew",
    connectionCount,
    sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDB" }],
    record: resolvedFilmRecord,
  };
}

export function createPersonAssociationCard(
  credit: TmdbPersonCredit,
  connectionCount: number,
): CinenerdleCard {
  const personName = credit.name ?? "";

  return {
    key: getPersonCardKey(personName, credit.id),
    kind: "person",
    name: personName,
    popularity: credit.popularity ?? 0,
    imageUrl: getPosterUrl(credit.profile_path, "w300_and_h450_face"),
    subtitle: credit.job?.trim() ?? "Person",
    subtitleDetail: credit.character?.trim() ?? "",
    connectionCount,
    sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDB" }],
    record: null,
  };
}

export function createCinenerdleOnlyPersonCard(
  personName: string,
  role: string,
): CinenerdleCard {
  return {
    key: getPersonCardKey(personName, `starter:${normalizeName(personName)}`),
    kind: "person",
    name: personName,
    popularity: 0,
    imageUrl: null,
    subtitle: "Cinenerdle",
    subtitleDetail: role,
    connectionCount: 1,
    sources: [{ iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle" }],
    record: null,
  };
}

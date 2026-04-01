import { CINENERDLE_ICON_URL, TMDB_ICON_URL } from "./constants";
import type {
  CinenerdleDailyStarter,
  FilmRecord,
  PersonRecord,
  TmdbMovieCredit,
  TmdbPersonCredit,
} from "./types";
import type { CardCreditLine, CinenerdleCard } from "./view_types";
import {
  formatFallbackPersonDisplayName,
  getCinenerdleMovieId,
  getMovieCardKey,
  getMoviePosterUrl,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getPersonCardKey,
  getPersonProfileImageUrl,
  getPosterUrl,
  getValidTmdbEntityId,
  normalizeName,
  normalizeTitle,
} from "./utils";

function getMovieCardIdentityId(
  movieRecord: FilmRecord | null | undefined,
  fallbackTmdbId?: number | string | null,
): number | null {
  return getValidTmdbEntityId(
    movieRecord?.rawTmdbMovie?.id ??
    movieRecord?.tmdbId ??
    fallbackTmdbId,
  );
}

function getMoviePopularitySource(record: FilmRecord | null | undefined): string {
  if (record?.rawTmdbMovie) {
    return "TMDb movie popularity from the cached movie record.";
  }

  if (typeof record?.popularity === "number" && record.popularity > 0) {
    return "Stored movie popularity from the local cache.";
  }

  return "Popularity is unavailable, so this card falls back to 0.";
}

function getDailyStarterMoviePopularitySource(record: FilmRecord | null | undefined): string {
  if (record?.rawTmdbMovie) {
    return "TMDb movie popularity from the cached movie record.";
  }

  if (typeof record?.popularity === "number" && record.popularity > 0) {
    return "Stored movie popularity from the local cache.";
  }

  return "Cinenerdle daily starter fallback. No TMDb movie popularity is cached yet.";
}

function getPersonPopularitySource(record: PersonRecord | null | undefined): string {
  if (record?.rawTmdbPerson) {
    return "TMDb person popularity from the cached person record.";
  }

  if (record) {
    return "Person details are cached, but no TMDb popularity is available yet.";
  }

  return "Popularity is unavailable, so this card falls back to 0.";
}

function getFallbackPersonSubtitle(role: string): string {
  switch (normalizeName(role)) {
    case "cast":
      return "Cast as";
    case "directors":
    case "director":
      return "Director";
    case "writers":
    case "writer":
      return "Writer";
    case "composers":
    case "composer":
      return "Composer";
    default:
      return "Crew";
  }
}

function dedupeCreditLines(lines: CardCreditLine[]): CardCreditLine[] {
  const seen = new Set<string>();

  return lines.filter((line) => {
    const fingerprint = `${line.subtitle}:${line.subtitleDetail}`;
    if (seen.has(fingerprint)) {
      return false;
    }

    seen.add(fingerprint);
    return true;
  });
}

function getMovieAssociationCreditLines(
  credits: TmdbMovieCredit[],
  year: string,
): CardCreditLine[] {
  return dedupeCreditLines(credits.map((credit) => ({
    subtitle:
      credit.creditType === "cast"
        ? `${year || "Movie"} • Cast as`
        : `${year || "Movie"} • ${credit.job?.trim() || credit.department?.trim() || "Crew"}`,
    subtitleDetail: credit.creditType === "cast" ? credit.character?.trim() ?? "" : "",
  })));
}

function getPersonAssociationCreditLines(
  credits: TmdbPersonCredit[],
): CardCreditLine[] {
  return dedupeCreditLines(credits.map((credit) => ({
    subtitle:
      credit.creditType === "cast"
        ? "Cast as"
        : credit.job?.trim() || credit.department?.trim() || "Crew",
    subtitleDetail: credit.creditType === "cast" ? credit.character?.trim() ?? "" : "",
  })));
}

export function createCinenerdleRootCard(connectionCount: number | null): CinenerdleCard {
  return {
    key: "cinenerdle",
    kind: "cinenerdle",
    name: "cinenerdle",
    popularity: 0,
    popularitySource: "Cinenerdle root cards do not have a popularity score.",
    imageUrl: CINENERDLE_ICON_URL,
    subtitle: "Daily starters",
    subtitleDetail: "Open today’s board",
    connectionCount,
    sources: [{ iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle" }],
    status: null,
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
  const tmdbId = getValidTmdbEntityId(starter.tmdbId);
  const fallbackId = starter.id ?? getCinenerdleMovieId(title, year);

  return {
    id: tmdbId ?? fallbackId,
    tmdbId,
    lookupKey: String(tmdbId ?? fallbackId),
    title,
    titleLower: normalizeTitle(title),
    year,
    titleYear: getCinenerdleMovieId(title, year),
    popularity: 0,
    personConnectionKeys: [],
  };
}

export function createDailyStarterFilmRecordFromTitle(starterTitle: string): FilmRecord {
  return createDailyStarterFilmRecord({ title: starterTitle });
}

export function createDailyStarterMovieCard(filmRecord: FilmRecord): CinenerdleCard {
  return {
    key: getMovieCardKey(
      filmRecord.title,
      filmRecord.year,
      getMovieCardIdentityId(filmRecord),
    ),
    kind: "movie",
    name: filmRecord.title,
    year: filmRecord.year,
    popularity: filmRecord.popularity,
    popularitySource: getDailyStarterMoviePopularitySource(filmRecord),
    imageUrl: getMoviePosterUrl(filmRecord),
    subtitle: filmRecord.year || "Movie",
    subtitleDetail: "",
    connectionCount: Math.max(filmRecord.personConnectionKeys.length, 1),
    sources: [
      {
        iconUrl: TMDB_ICON_URL,
        label: "TMDb",
      },
      {
        iconUrl: CINENERDLE_ICON_URL,
        label: "Cinenerdle daily starter",
      },
    ],
    status: null,
    voteAverage: filmRecord.rawTmdbMovie?.vote_average ?? null,
    voteCount: filmRecord.rawTmdbMovie?.vote_count ?? null,
    record: filmRecord,
  };
}

export function createPersonRootCard(
  personRecord: PersonRecord,
  requestedName: string,
): Extract<CinenerdleCard, { kind: "person" }> {
  const personName = personRecord.name || requestedName;

  return {
    key: getPersonCardKey(personName, personRecord.id),
    kind: "person",
    name: personName,
    popularity: personRecord.rawTmdbPerson?.popularity ?? 0,
    popularitySource: getPersonPopularitySource(personRecord),
    imageUrl: getPersonProfileImageUrl(personRecord),
    subtitle: "",
    subtitleDetail: "",
    connectionCount: Math.max(personRecord.movieConnectionKeys.length, 1),
    sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
    status: null,
    record: personRecord,
  };
}

export function createMovieRootCard(
  movieRecord: FilmRecord,
  requestedTitle: string,
): Extract<CinenerdleCard, { kind: "movie" }> {
  const title = movieRecord.title || requestedTitle;
  const year = movieRecord.year;

  return {
    key: getMovieCardKey(title, year, getMovieCardIdentityId(movieRecord)),
    kind: "movie",
    name: title,
    year,
    popularity: movieRecord.popularity,
    popularitySource: getMoviePopularitySource(movieRecord),
    imageUrl: getMoviePosterUrl(movieRecord),
    subtitle: year || "Movie",
    subtitleDetail: "",
    connectionCount: Math.max(movieRecord.personConnectionKeys.length, 1),
    sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
    status: null,
    voteAverage: movieRecord.rawTmdbMovie?.vote_average ?? null,
    voteCount: movieRecord.rawTmdbMovie?.vote_count ?? null,
    record: movieRecord,
  };
}

export function createMovieAssociationCard(
  creditOrCredits: TmdbMovieCredit | TmdbMovieCredit[],
  filmRecord: FilmRecord | null,
  connectionCount: number,
): CinenerdleCard {
  const credits = Array.isArray(creditOrCredits) ? creditOrCredits : [creditOrCredits];
  const credit = credits.find((candidate) => candidate.creditType === "cast") ?? credits[0];
  if (!credit) {
    throw new Error("Movie association cards require at least one credit.");
  }
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
                vote_average: credit.vote_average,
                vote_count: credit.vote_count,
              }
            : undefined,
        }
      : null);

  const creditLines = getMovieAssociationCreditLines(credits, year);
  const primaryCreditLine = creditLines[0] ?? { subtitle: year || "Movie", subtitleDetail: "" };
  const popularitySource =
    credit.popularity !== null && credit.popularity !== undefined
      ? "TMDb movie popularity from this person's movie credit."
      : resolvedFilmRecord?.rawTmdbMovie
        ? "TMDb movie popularity from the cached movie record."
        : resolvedFilmRecord
          ? "Stored movie popularity from the local cache."
          : "Popularity is unavailable, so this card falls back to 0.";

  return {
    key: getMovieCardKey(
      title,
      year,
      getMovieCardIdentityId(resolvedFilmRecord, credit.id ?? null),
    ),
    kind: "movie",
    name: title,
    year,
    popularity:
      credit.popularity ??
      resolvedFilmRecord?.rawTmdbMovie?.popularity ??
      resolvedFilmRecord?.popularity ??
      0,
    popularitySource,
    imageUrl:
      getPosterUrl(credit.poster_path) ?? getMoviePosterUrl(resolvedFilmRecord),
    subtitle: primaryCreditLine.subtitle,
    subtitleDetail: primaryCreditLine.subtitleDetail,
    creditLines: creditLines.length > 1 ? creditLines : undefined,
    connectionCount,
    sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
    status: null,
    voteAverage:
      credit.vote_average ??
      resolvedFilmRecord?.rawTmdbMovie?.vote_average ??
      null,
    voteCount:
      credit.vote_count ??
      resolvedFilmRecord?.rawTmdbMovie?.vote_count ??
      null,
    record: resolvedFilmRecord,
  };
}

export function createPersonAssociationCard(
  creditOrCredits: TmdbPersonCredit | TmdbPersonCredit[],
  connectionCount: number,
  personRecord: PersonRecord | null = null,
): CinenerdleCard {
  const credits = Array.isArray(creditOrCredits) ? creditOrCredits : [creditOrCredits];
  const credit = credits.find((candidate) => candidate.creditType === "cast") ?? credits[0];
  if (!credit) {
    throw new Error("Person association cards require at least one credit.");
  }
  const personName = personRecord?.name ?? credit.name ?? "";
  const creditLines = getPersonAssociationCreditLines(credits);
  const primaryCreditLine = creditLines[0] ?? { subtitle: "", subtitleDetail: "" };
  const popularitySource = personRecord?.rawTmdbPerson
    ? "TMDb person popularity from the cached person record."
    : credit.popularity !== null && credit.popularity !== undefined
      ? "TMDb person popularity from this movie credit."
      : "Popularity is unavailable, so this card falls back to 0.";

  return {
    key: getPersonCardKey(personName, credit.id),
    kind: "person",
    name: personName,
    popularity: personRecord?.rawTmdbPerson?.popularity ?? credit.popularity ?? 0,
    popularitySource,
    imageUrl:
      getPersonProfileImageUrl(personRecord) ??
      getPosterUrl(credit.profile_path, "w300_and_h450_face"),
    subtitle: primaryCreditLine.subtitle,
    subtitleDetail: primaryCreditLine.subtitleDetail,
    creditLines: creditLines.length > 1 ? creditLines : undefined,
    connectionCount,
    sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
    status: null,
    record: personRecord,
  };
}

export function createCinenerdleOnlyPersonCard(
  personName: string,
  role: string,
): CinenerdleCard {
  const displayName = formatFallbackPersonDisplayName(personName);

  return {
    key: getPersonCardKey(displayName, `starter:${normalizeName(personName)}`),
    kind: "person",
    name: displayName,
    popularity: 0,
    popularitySource: "Cinenerdle starter-only fallback. No TMDb person popularity is cached yet.",
    imageUrl: null,
    subtitle: getFallbackPersonSubtitle(role),
    subtitleDetail: "",
    connectionCount: 1,
    sources: [{ iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle" }],
    status: null,
    record: null,
  };
}

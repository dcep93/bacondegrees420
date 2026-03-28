import { CINENERDLE_ICON_URL, TMDB_ICON_URL } from "./constants";
import type {
  CinenerdleDailyStarter,
  FilmRecord,
  PersonRecord,
  TmdbMovieCredit,
  TmdbPersonCredit,
} from "./types";
import type { CinenerdleCard, DbInfoSummaryItem } from "./view_types";
import {
  buildPeopleByRoleFromStarter,
  formatFallbackPersonDisplayName,
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

function buildMovieDbInfoSummary(
  item: {
    name: string;
    year?: string;
  },
  record: FilmRecord | null,
) {
  if (!record) {
    return {
      cached: false,
      kind: "movie",
      title: item.name,
      year: item.year ?? "",
    };
  }

  return {
    cached: true,
    kind: "movie",
    title: record.title || item.name,
    year: record.year || item.year || "",
    id: record.id,
    tmdbId: record.tmdbId,
    popularity: record.popularity,
    voteAverage: record.rawTmdbMovie?.vote_average ?? null,
    voteCount: record.rawTmdbMovie?.vote_count ?? null,
    castCount: record.rawTmdbMovieCreditsResponse?.cast?.length ?? 0,
    crewCount: record.rawTmdbMovieCreditsResponse?.crew?.length ?? 0,
    connectionCount: record.personConnectionKeys.length,
    hasTmdbMovie: Boolean(record.rawTmdbMovie),
    hasTmdbCredits: Boolean(record.rawTmdbMovieCreditsResponse),
    posterPath: record.rawTmdbMovie?.poster_path ?? null,
    tmdbSavedAt: record.tmdbSavedAt ?? null,
    tmdbCreditsSavedAt: record.tmdbCreditsSavedAt ?? null,
    hasCinenerdleStarter: Boolean(record.rawCinenerdleDailyStarter),
  };
}

function buildPersonDbInfoSummary(
  item: {
    name: string;
  },
  record: PersonRecord | null,
) {
  if (!record) {
    return {
      cached: false,
      kind: "person",
      name: item.name,
    };
  }

  return {
    cached: true,
    kind: "person",
    name: record.name || item.name,
    id: record.id,
    tmdbId: record.tmdbId,
    popularity: record.rawTmdbPerson?.popularity ?? null,
    movieConnectionCount: record.movieConnectionKeys.length,
    castCreditCount: record.rawTmdbMovieCreditsResponse?.cast?.length ?? 0,
    crewCreditCount: record.rawTmdbMovieCreditsResponse?.crew?.length ?? 0,
    hasTmdbPerson: Boolean(record.rawTmdbPerson),
    hasTmdbMovieCredits: Boolean(record.rawTmdbMovieCreditsResponse),
    profilePath: record.rawTmdbPerson?.profile_path ?? null,
    savedAt: record.savedAt ?? null,
  };
}

function formatSummaryValue(value: number | string | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  return value;
}

function buildMovieDbInfoItems(
  item: {
    name: string;
    year?: string;
  },
  record: FilmRecord | null,
): DbInfoSummaryItem[] {
  const summary = buildMovieDbInfoSummary(item, record);

  return [
    { label: "Cached", value: formatSummaryValue(summary.cached) },
    { label: "TMDb ID", value: formatSummaryValue(summary.tmdbId) },
    { label: "Year", value: formatSummaryValue(summary.year) },
    { label: "Popularity", value: formatSummaryValue(summary.popularity) },
    { label: "Rating", value: formatSummaryValue(summary.voteAverage) },
    { label: "Votes", value: formatSummaryValue(summary.voteCount) },
    { label: "Cast", value: formatSummaryValue(summary.castCount) },
    { label: "Crew", value: formatSummaryValue(summary.crewCount) },
    { label: "Links", value: formatSummaryValue(summary.connectionCount) },
    { label: "Credits", value: formatSummaryValue(summary.hasTmdbCredits) },
  ];
}

function buildPersonDbInfoItems(
  item: {
    name: string;
  },
  record: PersonRecord | null,
): DbInfoSummaryItem[] {
  const summary = buildPersonDbInfoSummary(item, record);

  return [
    { label: "Cached", value: formatSummaryValue(summary.cached) },
    { label: "TMDb ID", value: formatSummaryValue(summary.tmdbId) },
    { label: "Popularity", value: formatSummaryValue(summary.popularity) },
    { label: "Movies", value: formatSummaryValue(summary.movieConnectionCount) },
    { label: "Cast", value: formatSummaryValue(summary.castCreditCount) },
    { label: "Crew", value: formatSummaryValue(summary.crewCreditCount) },
    { label: "Profile", value: formatSummaryValue(summary.hasTmdbPerson) },
    { label: "Credits", value: formatSummaryValue(summary.hasTmdbMovieCredits) },
  ];
}

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
    isCinenerdleDailyStarter: 1,
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
): CinenerdleCard {
  const personName = personRecord.name || requestedName;

  return {
    key: getPersonCardKey(personName, personRecord.id),
    kind: "person",
    name: personName,
    popularity: personRecord.rawTmdbPerson?.popularity ?? 0,
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

export function createRootDatabaseInfoCard(
  item: {
    kind: "movie" | "person";
    name: string;
    year?: string;
  },
  record: FilmRecord | PersonRecord | null,
): CinenerdleCard {
  const summaryLine =
    item.kind === "movie"
      ? `${item.name}${item.year ? ` (${item.year})` : ""}`
      : item.name;
  const body = JSON.stringify(
    item.kind === "movie"
      ? buildMovieDbInfoSummary(
          {
            name: item.name,
            year: item.year,
          },
          record as FilmRecord | null,
        )
      : buildPersonDbInfoSummary(
          {
            name: item.name,
          },
          record as PersonRecord | null,
        ),
    null,
    2,
  );

  return {
    key: `dbinfo:${item.kind}:${item.name}:${item.kind === "movie" ? item.year ?? "" : ""}`,
    kind: "dbinfo",
    name: "Database Info",
    popularity: 0,
    imageUrl: null,
    subtitle: summaryLine,
    subtitleDetail: record ? "IndexedDB record" : "Not cached yet",
    connectionCount: null,
    sources: [],
    status: null,
    body,
    recordKind: item.kind,
    summaryItems:
      item.kind === "movie"
        ? buildMovieDbInfoItems(
            {
              name: item.name,
              year: item.year,
            },
            record as FilmRecord | null,
          )
        : buildPersonDbInfoItems(
            {
              name: item.name,
            },
            record as PersonRecord | null,
          ),
    record,
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
                vote_average: credit.vote_average,
                vote_count: credit.vote_count,
              }
            : undefined,
        }
      : null);

  const subtitle =
    credit.creditType === "cast"
      ? `${year || "Movie"} • Cast as`
      : `${year || "Movie"} • ${credit.job?.trim() || credit.department?.trim() || "Crew"}`;

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
    subtitle,
    subtitleDetail: credit.creditType === "cast" ? credit.character?.trim() ?? "" : "",
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
  credit: TmdbPersonCredit,
  connectionCount: number,
  personRecord: PersonRecord | null = null,
): CinenerdleCard {
  const personName = personRecord?.name ?? credit.name ?? "";
  const isCastCredit = credit.creditType === "cast";
  const subtitle = isCastCredit
    ? "Cast as"
    : credit.job?.trim() || credit.department?.trim() || "Crew";

  return {
    key: getPersonCardKey(personName, credit.id),
    kind: "person",
    name: personName,
    popularity: personRecord?.rawTmdbPerson?.popularity ?? credit.popularity ?? 0,
    imageUrl:
      getPersonProfileImageUrl(personRecord) ??
      getPosterUrl(credit.profile_path, "w300_and_h450_face"),
    subtitle,
    subtitleDetail: isCastCredit ? credit.character?.trim() ?? "" : "",
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
    imageUrl: null,
    subtitle: getFallbackPersonSubtitle(role),
    subtitleDetail: "",
    connectionCount: 1,
    sources: [{ iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle" }],
    status: null,
    record: null,
  };
}

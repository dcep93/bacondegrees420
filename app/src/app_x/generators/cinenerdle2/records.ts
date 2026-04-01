import type {
  FilmRecord,
  PersonRecord,
  TmdbPersonCredit,
  TmdbMovieSearchResult,
  TmdbPersonSearchResult,
} from "./types";
import { getFilmTmdbSource, getPersonTmdbSource } from "./tmdb_provenance";
import {
  getAssociatedPeopleFromMovieCredits,
  getAllowedConnectedTmdbMovieCredits,
  getCinenerdleMovieId,
  getCinenerdlePersonId,
  getMovieKeyFromCredit,
  getValidTmdbEntityId,
  getFilmKey,
  normalizeName,
  normalizeTitle,
} from "./utils";
import {
  resetCinenerdleValidationAlertState,
  throwCinenerdleValidationError,
} from "./validation";

function assertPersonRecordsAgree(
  existingPersonRecord: PersonRecord | null | undefined,
  nextPersonRecord: PersonRecord,
): void {
  if (!existingPersonRecord) {
    return;
  }

  const existingTmdbId = getValidTmdbEntityId(
    existingPersonRecord.tmdbId ?? existingPersonRecord.id,
  );
  const nextTmdbId = getValidTmdbEntityId(nextPersonRecord.tmdbId ?? nextPersonRecord.id);
  if (existingTmdbId === null || nextTmdbId === null || existingTmdbId !== nextTmdbId) {
    return;
  }

  if (normalizeName(existingPersonRecord.name) === normalizeName(nextPersonRecord.name)) {
    return;
  }

  resetCinenerdleValidationAlertState();
  throwCinenerdleValidationError(
    `Cannot merge person records: conflicting names for TMDb person ${nextTmdbId}.`,
    {
      reason: "conflicting-person-data",
      tmdbId: nextTmdbId,
      existingPersonRecord,
      nextPersonRecord,
    },
  );
}

function assertFilmRecordMatchesTmdbFilm(
  existingFilmRecord: FilmRecord | null,
  tmdbFilm: TmdbMovieSearchResult,
): void {
  if (!existingFilmRecord) {
    return;
  }

  const existingTmdbId = getValidTmdbEntityId(existingFilmRecord.tmdbId ?? existingFilmRecord.id);
  const nextTmdbId = getValidTmdbEntityId(tmdbFilm.id);
  if (existingTmdbId === null || nextTmdbId === null || existingTmdbId !== nextTmdbId) {
    return;
  }

  const nextTitle = tmdbFilm.title ?? tmdbFilm.original_title ?? "";
  const nextYear = tmdbFilm.release_date?.slice(0, 4) ?? "";
  if (
    normalizeTitle(existingFilmRecord.title) === normalizeTitle(nextTitle) &&
    (existingFilmRecord.year ?? "") === nextYear
  ) {
    return;
  }

  resetCinenerdleValidationAlertState();
  throwCinenerdleValidationError(
    `Cannot merge film records: conflicting title/year for TMDb film ${nextTmdbId}.`,
    {
      reason: "conflicting-film-data",
      tmdbId: nextTmdbId,
      existingFilmRecord,
      nextTmdbFilm: tmdbFilm,
    },
  );
}

function normalizeFetchTimestamp(fetchTimestamp: string | null | undefined): string | undefined {
  const normalizedFetchTimestamp = fetchTimestamp?.trim();
  return normalizedFetchTimestamp ? normalizedFetchTimestamp : undefined;
}

function isEmptyFetchedFieldValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function isStrictlyNewerFetchTimestamp(
  existingFetchTimestamp: string | null | undefined,
  nextFetchTimestamp: string | null | undefined,
): boolean {
  const normalizedExistingFetchTimestamp = normalizeFetchTimestamp(existingFetchTimestamp);
  const normalizedNextFetchTimestamp = normalizeFetchTimestamp(nextFetchTimestamp);
  if (!normalizedExistingFetchTimestamp || !normalizedNextFetchTimestamp) {
    return false;
  }

  return normalizedNextFetchTimestamp > normalizedExistingFetchTimestamp;
}

export function chooseNewestFetchTimestamp(
  existingFetchTimestamp: string | null | undefined,
  nextFetchTimestamp: string | null | undefined,
): string | undefined {
  const normalizedExistingFetchTimestamp = normalizeFetchTimestamp(existingFetchTimestamp);
  const normalizedNextFetchTimestamp = normalizeFetchTimestamp(nextFetchTimestamp);
  if (!normalizedExistingFetchTimestamp) {
    return normalizedNextFetchTimestamp;
  }

  if (!normalizedNextFetchTimestamp) {
    return normalizedExistingFetchTimestamp;
  }

  return isStrictlyNewerFetchTimestamp(
    normalizedExistingFetchTimestamp,
    normalizedNextFetchTimestamp,
  )
    ? normalizedNextFetchTimestamp
    : normalizedExistingFetchTimestamp;
}

export function shouldPreferNextFetchedField<T>(
  existingValue: T | null | undefined,
  nextValue: T | null | undefined,
  existingFetchTimestamp?: string | null,
  nextFetchTimestamp?: string | null,
): boolean {
  if (isEmptyFetchedFieldValue(existingValue)) {
    return !isEmptyFetchedFieldValue(nextValue);
  }

  if (isEmptyFetchedFieldValue(nextValue)) {
    return false;
  }

  const normalizedExistingFetchTimestamp = normalizeFetchTimestamp(existingFetchTimestamp);
  const normalizedNextFetchTimestamp = normalizeFetchTimestamp(nextFetchTimestamp);
  if (!normalizedExistingFetchTimestamp && normalizedNextFetchTimestamp) {
    return true;
  }

  if (normalizedExistingFetchTimestamp && !normalizedNextFetchTimestamp) {
    return false;
  }

  return isStrictlyNewerFetchTimestamp(existingFetchTimestamp, nextFetchTimestamp);
}

export function mergeFetchedFieldValue<T>(
  existingValue: T | null | undefined,
  nextValue: T | null | undefined,
  existingFetchTimestamp?: string | null,
  nextFetchTimestamp?: string | null,
): T | null | undefined {
  return shouldPreferNextFetchedField(
    existingValue,
    nextValue,
    existingFetchTimestamp,
    nextFetchTimestamp,
  )
    ? nextValue
    : existingValue;
}

export function mergeFetchedTmdbMovie(
  existingTmdbMovie: TmdbMovieSearchResult | undefined,
  nextTmdbMovie: TmdbMovieSearchResult,
  existingFetchTimestamp?: string | null,
  nextFetchTimestamp?: string | null,
): TmdbMovieSearchResult {
  if (!existingTmdbMovie) {
    return nextTmdbMovie;
  }

  return {
    id: nextTmdbMovie.id,
    title: mergeFetchedFieldValue(
      existingTmdbMovie.title,
      nextTmdbMovie.title,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
    original_title: mergeFetchedFieldValue(
      existingTmdbMovie.original_title,
      nextTmdbMovie.original_title,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
    poster_path: mergeFetchedFieldValue(
      existingTmdbMovie.poster_path,
      nextTmdbMovie.poster_path,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
    release_date: mergeFetchedFieldValue(
      existingTmdbMovie.release_date,
      nextTmdbMovie.release_date,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
    popularity: mergeFetchedFieldValue(
      existingTmdbMovie.popularity,
      nextTmdbMovie.popularity,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
    vote_average: mergeFetchedFieldValue(
      existingTmdbMovie.vote_average,
      nextTmdbMovie.vote_average,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
    vote_count: mergeFetchedFieldValue(
      existingTmdbMovie.vote_count,
      nextTmdbMovie.vote_count,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
  };
}

export function mergeFetchedTmdbPerson(
  existingTmdbPerson: TmdbPersonSearchResult | undefined,
  nextTmdbPerson: TmdbPersonSearchResult,
  existingFetchTimestamp?: string | null,
  nextFetchTimestamp?: string | null,
): TmdbPersonSearchResult {
  if (!existingTmdbPerson) {
    return nextTmdbPerson;
  }

  return {
    id: nextTmdbPerson.id,
    name: mergeFetchedFieldValue(
      existingTmdbPerson.name,
      nextTmdbPerson.name,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
    profile_path: mergeFetchedFieldValue(
      existingTmdbPerson.profile_path,
      nextTmdbPerson.profile_path,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
    popularity: mergeFetchedFieldValue(
      existingTmdbPerson.popularity,
      nextTmdbPerson.popularity,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
  };
}

function getPersonRecordQualityScore(personRecord: PersonRecord | null): number {
  if (!personRecord) {
    return -1;
  }

  let score = 0;

  if (getPersonTmdbSource(personRecord) === "direct-person-fetch") {
    score += 16;
  }

  if (personRecord.rawTmdbPerson?.profile_path) {
    score += 8;
  }

  if (personRecord.rawTmdbPerson) {
    score += 4;
  }

  if (personRecord.rawTmdbMovieCreditsResponse) {
    score += 2;
  }

  if (personRecord.fetchTimestamp) {
    score += 1;
  }

  if (getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id)) {
    score += 1;
  }

  return score;
}

export function getResolvedPersonMovieConnectionKeys(
  personRecord: PersonRecord | null,
): string[] {
  if (!personRecord) {
    return [];
  }

  const tmdbMovieKeys = getAllowedConnectedTmdbMovieCredits(personRecord)
    .map((credit) => getMovieKeyFromCredit(credit))
    .filter(Boolean);

  if (personRecord.rawTmdbMovieCreditsResponse) {
    return Array.from(new Set(tmdbMovieKeys));
  }

  return Array.from(new Set(personRecord.movieConnectionKeys.filter(Boolean)));
}

export function withDerivedPersonFields(personRecord: PersonRecord): PersonRecord {
  return {
    ...personRecord,
    tmdbSource: getPersonTmdbSource(personRecord),
    tmdbId:
      personRecord.rawTmdbPerson?.id ??
      personRecord.tmdbId ??
      getValidTmdbEntityId(personRecord.id),
    lookupKey: getCinenerdlePersonId(personRecord.name),
    nameLower: normalizeName(personRecord.name),
    movieConnectionKeys: getResolvedPersonMovieConnectionKeys(personRecord),
  };
}

export function buildPersonRecordFromFilmCredit(
  filmRecord: Pick<FilmRecord, "title" | "year" | "fetchTimestamp">,
  credit: TmdbPersonCredit,
): PersonRecord | null {
  const tmdbId = getValidTmdbEntityId(credit.id);
  const normalizedName = normalizeName(credit.name ?? "");
  if (!tmdbId || !normalizedName) {
    return null;
  }

  return withDerivedPersonFields({
    id: tmdbId,
    tmdbId,
    lookupKey: getCinenerdlePersonId(credit.name ?? ""),
    name: credit.name ?? "",
    nameLower: normalizedName,
    movieConnectionKeys: [getFilmKey(filmRecord.title, filmRecord.year)],
    tmdbSource: "connection-derived",
    rawTmdbPerson: {
      id: tmdbId,
      name: credit.name ?? "",
      profile_path: credit.profile_path ?? null,
      popularity: credit.popularity ?? 0,
    },
    rawTmdbPersonSearchResponse: undefined,
    rawTmdbMovieCreditsResponse: undefined,
    fetchTimestamp: credit.fetchTimestamp ?? filmRecord.fetchTimestamp,
  });
}

export function withDerivedFilmFields(filmRecord: FilmRecord): FilmRecord {
  const tmdbPeople = getAssociatedPeopleFromMovieCredits(filmRecord)
    .map((credit) => normalizeName(credit.name ?? ""))
    .filter(Boolean);
  const personConnectionKeys = filmRecord.rawTmdbMovieCreditsResponse
    ? tmdbPeople
    : Array.from(
      new Set([
        ...filmRecord.personConnectionKeys,
        ...tmdbPeople,
      ]),
    );

  return {
    ...filmRecord,
    tmdbSource: getFilmTmdbSource(filmRecord),
    tmdbId:
      filmRecord.rawTmdbMovie?.id ??
      filmRecord.tmdbId ??
      getValidTmdbEntityId(filmRecord.id),
    lookupKey: getCinenerdleMovieId(filmRecord.title, filmRecord.year),
    titleLower: normalizeTitle(filmRecord.title),
    titleYear: getFilmKey(filmRecord.title, filmRecord.year),
    personConnectionKeys,
  };
}

export function buildFilmRecord(
  existingFilmRecord: FilmRecord | null,
  tmdbFilm: TmdbMovieSearchResult,
): FilmRecord {
  assertFilmRecordMatchesTmdbFilm(existingFilmRecord, tmdbFilm);

  const nextFetchTimestamp = new Date().toISOString();
  const mergedTmdbMovie = mergeFetchedTmdbMovie(
    existingFilmRecord?.rawTmdbMovie,
    tmdbFilm,
    existingFilmRecord?.fetchTimestamp,
    nextFetchTimestamp,
  );

  const title =
    existingFilmRecord?.title ?? tmdbFilm.title ?? tmdbFilm.original_title ?? "";
  const year =
    existingFilmRecord?.year ?? tmdbFilm.release_date?.slice(0, 4) ?? "";

  return withDerivedFilmFields({
    ...existingFilmRecord,
    id: tmdbFilm.id,
    tmdbId: tmdbFilm.id,
    lookupKey: getCinenerdleMovieId(title, year),
    title,
    titleLower: normalizeTitle(title),
    year,
    titleYear: getFilmKey(title, year),
    popularity:
      mergedTmdbMovie.popularity ??
      mergeFetchedFieldValue(
        existingFilmRecord?.popularity,
        tmdbFilm.popularity,
        existingFilmRecord?.fetchTimestamp,
        nextFetchTimestamp,
      ) ??
      0,
    personConnectionKeys: existingFilmRecord?.personConnectionKeys ?? [],
    tmdbSource: "direct-film-fetch",
    rawTmdbMovie: mergedTmdbMovie,
    fetchTimestamp: nextFetchTimestamp,
    rawTmdbMovieCreditsResponse: existingFilmRecord?.rawTmdbMovieCreditsResponse,
  });
}

export function chooseBestMovieSearchResult(
  results: TmdbMovieSearchResult[] | undefined,
  movieName: string,
  preferredYear = "",
): TmdbMovieSearchResult | null {
  const normalizedMovieName = normalizeTitle(movieName);
  const exactTitleMatches = (results ?? []).filter(
    (result) => normalizeTitle(result.title ?? "") === normalizedMovieName,
  );

  if (preferredYear) {
    const exactYearMatch =
      exactTitleMatches.find(
        (result) => (result.release_date?.slice(0, 4) ?? "") === preferredYear,
      ) ??
      (results ?? []).find(
        (result) =>
          normalizeTitle(result.title ?? "") === normalizedMovieName &&
          (result.release_date?.slice(0, 4) ?? "") === preferredYear,
      );

    if (exactYearMatch) {
      return exactYearMatch;
    }
  }

  return exactTitleMatches[0] ?? results?.[0] ?? null;
}

export function chooseBestFilmRecord(
  records: FilmRecord[],
  title: string,
  year = "",
): FilmRecord | null {
  return (
    records
      .filter(
        (record) =>
          normalizeTitle(record.title) === normalizeTitle(title) &&
          (!year || record.year === year),
      )
      .sort((left, right) => {
        if ((left.tmdbId ?? 0) && !(right.tmdbId ?? 0)) {
          return -1;
        }

        if (!(left.tmdbId ?? 0) && (right.tmdbId ?? 0)) {
          return 1;
        }

        return (right.popularity ?? 0) - (left.popularity ?? 0);
      })[0] ?? null
  );
}

export function pickBestPersonRecord(
  ...records: Array<PersonRecord | null | undefined>
): PersonRecord | null {
  return records
    .filter((record): record is PersonRecord => Boolean(record))
    .sort((left, right) => {
      const qualityDifference =
        getPersonRecordQualityScore(right) - getPersonRecordQualityScore(left);
      if (qualityDifference !== 0) {
        return qualityDifference;
      }

      const popularityDifference =
        (right.rawTmdbPerson?.popularity ?? 0) - (left.rawTmdbPerson?.popularity ?? 0);
      if (popularityDifference !== 0) {
        return popularityDifference;
      }

      return left.name.localeCompare(right.name);
    })[0] ?? null;
}

export function mergePersonRecords(
  existingPersonRecord: PersonRecord | null | undefined,
  nextPersonRecord: PersonRecord,
): PersonRecord {
  assertPersonRecordsAgree(existingPersonRecord, nextPersonRecord);

  const existingFetchTimestamp = existingPersonRecord?.fetchTimestamp;
  const nextFetchTimestamp = nextPersonRecord.fetchTimestamp;
  const mergedTmdbSource =
    getPersonTmdbSource(existingPersonRecord) === "direct-person-fetch" ||
      getPersonTmdbSource(nextPersonRecord) === "direct-person-fetch"
      ? "direct-person-fetch"
      : "connection-derived";

  return withDerivedPersonFields({
    ...existingPersonRecord,
    ...nextPersonRecord,
    id: nextPersonRecord.id,
    tmdbId: nextPersonRecord.tmdbId ?? existingPersonRecord?.tmdbId ?? null,
    lookupKey: existingPersonRecord?.lookupKey ?? nextPersonRecord.lookupKey,
    name:
      mergeFetchedFieldValue(
        existingPersonRecord?.name,
        nextPersonRecord.name,
        existingFetchTimestamp,
        nextFetchTimestamp,
      ) ?? nextPersonRecord.name,
    nameLower:
      mergeFetchedFieldValue(
        existingPersonRecord?.nameLower,
        nextPersonRecord.nameLower,
        existingFetchTimestamp,
        nextFetchTimestamp,
      ) ?? nextPersonRecord.nameLower,
    movieConnectionKeys: Array.from(
      new Set([
        ...(existingPersonRecord?.movieConnectionKeys ?? []),
        ...nextPersonRecord.movieConnectionKeys,
      ]),
    ),
    rawTmdbPerson:
      existingPersonRecord?.rawTmdbPerson && nextPersonRecord.rawTmdbPerson
        ? mergeFetchedTmdbPerson(
            existingPersonRecord.rawTmdbPerson,
            nextPersonRecord.rawTmdbPerson,
            existingFetchTimestamp,
            nextFetchTimestamp,
          )
        : nextPersonRecord.rawTmdbPerson ?? existingPersonRecord?.rawTmdbPerson,
    rawTmdbPersonSearchResponse: mergeFetchedFieldValue(
      existingPersonRecord?.rawTmdbPersonSearchResponse,
      nextPersonRecord.rawTmdbPersonSearchResponse,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
    rawTmdbMovieCreditsResponse: mergeFetchedFieldValue(
      existingPersonRecord?.rawTmdbMovieCreditsResponse,
      nextPersonRecord.rawTmdbMovieCreditsResponse,
      existingFetchTimestamp,
      nextFetchTimestamp,
    ) ?? undefined,
    tmdbSource: mergedTmdbSource,
    fetchTimestamp: chooseNewestFetchTimestamp(
      existingFetchTimestamp,
      nextFetchTimestamp,
    ),
  });
}

export function buildPersonRecord(
  person: TmdbPersonSearchResult,
  movieCreditsResponse: PersonRecord["rawTmdbMovieCreditsResponse"],
  searchResponse?: { results?: TmdbPersonSearchResult[] },
): PersonRecord {
  return withDerivedPersonFields({
    id: person.id,
    tmdbId: person.id,
    lookupKey: getCinenerdlePersonId(person.name ?? ""),
    name: person.name ?? "",
    nameLower: normalizeName(person.name ?? ""),
    movieConnectionKeys: [],
    tmdbSource: "direct-person-fetch",
    rawTmdbPerson: person,
    rawTmdbPersonSearchResponse: searchResponse,
    rawTmdbMovieCreditsResponse: movieCreditsResponse,
    fetchTimestamp: new Date().toISOString(),
  });
}

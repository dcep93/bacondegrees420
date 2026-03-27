import type {
  FilmRecord,
  PersonRecord,
  TmdbMovieSearchResult,
  TmdbPersonSearchResult,
} from "./types";
import {
  getCinenerdleMovieId,
  getCinenerdlePersonId,
  getMovieKeyFromCredit,
  getSnapshotConnectionLabels,
  getTmdbMovieCredits,
  getValidTmdbEntityId,
  getFilmKey,
  normalizeName,
  normalizeTitle,
} from "./utils";

export function withDerivedPersonFields(personRecord: PersonRecord): PersonRecord {
  const tmdbMovieKeys = getTmdbMovieCredits(personRecord).map((credit) =>
    getMovieKeyFromCredit(credit),
  );

  return {
    ...personRecord,
    tmdbId:
      personRecord.rawTmdbPerson?.id ??
      personRecord.tmdbId ??
      getValidTmdbEntityId(personRecord.id),
    cinenerdleId: getCinenerdlePersonId(personRecord.name),
    nameLower: normalizeName(personRecord.name),
    movieConnectionKeys: Array.from(
      new Set([
        ...personRecord.movieConnectionKeys,
        ...tmdbMovieKeys,
      ]),
    ),
  };
}

export function withDerivedFilmFields(filmRecord: FilmRecord): FilmRecord {
  const credits = filmRecord.rawTmdbMovieCreditsResponse ?? {};
  const tmdbPeople = [...(credits.cast ?? []), ...(credits.crew ?? [])]
    .map((credit) => normalizeName(credit.name ?? ""))
    .filter(Boolean);
  const starterPeople = getSnapshotConnectionLabels(filmRecord).map(normalizeName);

  return {
    ...filmRecord,
    tmdbId:
      filmRecord.rawTmdbMovie?.id ??
      filmRecord.tmdbId ??
      getValidTmdbEntityId(filmRecord.id),
    cinenerdleId: getCinenerdleMovieId(filmRecord.title, filmRecord.year),
    titleLower: normalizeTitle(filmRecord.title),
    titleYear: getFilmKey(filmRecord.title, filmRecord.year),
    personConnectionKeys: Array.from(
      new Set([
        ...filmRecord.personConnectionKeys,
        ...tmdbPeople,
        ...starterPeople,
      ]),
    ),
  };
}

export function buildFilmRecord(
  existingFilmRecord: FilmRecord | null,
  tmdbFilm: TmdbMovieSearchResult,
): FilmRecord {
  const title =
    existingFilmRecord?.title ?? tmdbFilm.title ?? tmdbFilm.original_title ?? "";
  const year =
    existingFilmRecord?.year ?? tmdbFilm.release_date?.slice(0, 4) ?? "";

  return withDerivedFilmFields({
    ...existingFilmRecord,
    id: tmdbFilm.id,
    tmdbId: tmdbFilm.id,
    cinenerdleId: getCinenerdleMovieId(title, year),
    title,
    titleLower: normalizeTitle(title),
    year,
    titleYear: getFilmKey(title, year),
    popularity: tmdbFilm.popularity ?? existingFilmRecord?.popularity ?? 0,
    personConnectionKeys: existingFilmRecord?.personConnectionKeys ?? [],
    rawTmdbMovie: tmdbFilm,
    rawCinenerdleDailyStarter: existingFilmRecord?.rawCinenerdleDailyStarter,
    cinenerdleSnapshot: existingFilmRecord?.cinenerdleSnapshot,
    tmdbSavedAt: new Date().toISOString(),
    rawTmdbMovieCreditsResponse: existingFilmRecord?.rawTmdbMovieCreditsResponse,
    tmdbCreditsSavedAt: existingFilmRecord?.tmdbCreditsSavedAt,
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

export function buildPersonRecord(
  person: TmdbPersonSearchResult,
  searchResponse: { results?: TmdbPersonSearchResult[] },
  movieCreditsResponse: PersonRecord["rawTmdbMovieCreditsResponse"],
): PersonRecord {
  return withDerivedPersonFields({
    id: person.id,
    tmdbId: person.id,
    cinenerdleId: getCinenerdlePersonId(person.name ?? ""),
    name: person.name ?? "",
    nameLower: normalizeName(person.name ?? ""),
    movieConnectionKeys: [],
    rawTmdbPerson: person,
    rawTmdbPersonSearchResponse: searchResponse,
    rawTmdbMovieCreditsResponse: movieCreditsResponse,
    savedAt: new Date().toISOString(),
  });
}

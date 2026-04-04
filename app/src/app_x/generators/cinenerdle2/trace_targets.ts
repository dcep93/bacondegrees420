import type {
  FilmRecord,
  PersonRecord,
  SearchableConnectionEntityRecord,
  TmdbMovieCredit,
} from "./types";
import {
  getMovieTitleFromCredit,
  normalizeName,
  normalizeTitle,
} from "./utils";

const TRACED_MOVIE_TITLE = normalizeTitle("Overnight");
const TRACED_PERSON_NAME = normalizeName("Willem Dafoe");

export function isTracedMovieTitle(title: string | null | undefined): boolean {
  const normalizedTitle = normalizeTitle(title ?? "");
  return (
    normalizedTitle === TRACED_MOVIE_TITLE ||
    normalizedTitle.startsWith(`${TRACED_MOVIE_TITLE} (`)
  );
}

export function isTracedMovieCredit(
  credit: Pick<TmdbMovieCredit, "title" | "original_title"> | null | undefined,
): boolean {
  return isTracedMovieTitle(getMovieTitleFromCredit(credit ?? {}));
}

export function isTracedMovieRecord(
  filmRecord: FilmRecord | null | undefined,
): boolean {
  return (
    isTracedMovieTitle(filmRecord?.title) ||
    isTracedMovieTitle(filmRecord?.rawTmdbMovie?.title) ||
    isTracedMovieTitle(filmRecord?.rawTmdbMovie?.original_title)
  );
}

export function isTracedPersonName(name: string | null | undefined): boolean {
  return normalizeName(name ?? "") === TRACED_PERSON_NAME;
}

export function isTracedPersonRecord(
  personRecord: PersonRecord | null | undefined,
): boolean {
  return (
    isTracedPersonName(personRecord?.name) ||
    isTracedPersonName(personRecord?.rawTmdbPerson?.name)
  );
}

export function isTracedSearchableConnectionEntity(
  record: SearchableConnectionEntityRecord | null | undefined,
): boolean {
  if (!record) {
    return false;
  }

  return record.type === "movie"
    ? isTracedMovieTitle(record.nameLower)
    : isTracedPersonName(record.nameLower);
}

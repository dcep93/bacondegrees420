import type { FilmRecord, PersonRecord } from "./types";

const TMDB_DOCUMENTARY_GENRE_ID = 99;

function hasDocumentaryGenreId(
  genreIds: readonly number[] | null | undefined,
): boolean {
  return (genreIds ?? []).some((genreId) => genreId === TMDB_DOCUMENTARY_GENRE_ID);
}

export function isExcludedFilmRecord(
  filmRecord: FilmRecord | null | undefined,
): boolean {
  return hasDocumentaryGenreId(filmRecord?.genreIds);
}

export function isExcludedPersonRecord(
  personRecord: PersonRecord | null | undefined,
): boolean {
  void personRecord;
  return false;
}

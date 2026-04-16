import type { FilmRecord, PersonRecord } from "./types";

const TMDB_DOCUMENTARY_GENRE_ID = 99;
const TMDB_MUSIC_GENRE_ID = 10402;

export function isExcludedMovieGenreIds(
  genreIds: readonly number[] | null | undefined,
): boolean {
  const normalizedGenreIds = genreIds ?? [];

  return normalizedGenreIds.some((genreId) => genreId === TMDB_DOCUMENTARY_GENRE_ID) ||
    (
      normalizedGenreIds.length === 1 &&
      normalizedGenreIds[0] === TMDB_MUSIC_GENRE_ID
    );
}

export function isExcludedFilmRecord(
  filmRecord: FilmRecord | null | undefined,
): boolean {
  return isExcludedMovieGenreIds(filmRecord?.genreIds);
}

export function isExcludedPersonRecord(
  personRecord: PersonRecord | null | undefined,
): boolean {
  void personRecord;
  return false;
}

import type { FilmRecord, PersonRecord, TmdbGenre } from "./types";
import { normalizeName } from "./utils";

const TMDB_DOCUMENTARY_GENRE_ID = 99;
const DOCUMENTARY_GENRE_NAME = "documentary";

function hasDocumentaryGenre(
  genres: TmdbGenre[] | null | undefined,
): boolean {
  return (genres ?? []).some((genre) =>
    genre.id === TMDB_DOCUMENTARY_GENRE_ID ||
    normalizeName(genre.name ?? "") === DOCUMENTARY_GENRE_NAME,
  );
}

export function isExcludedFilmRecord(
  filmRecord: FilmRecord | null | undefined,
): boolean {
  return hasDocumentaryGenre(filmRecord?.rawTmdbMovie?.genres);
}

export function isExcludedPersonRecord(
  personRecord: PersonRecord | null | undefined,
): boolean {
  void personRecord;
  return false;
}

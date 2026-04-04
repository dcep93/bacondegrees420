import type { FilmRecord, PersonRecord } from "./types";
import { addCinenerdleDebugLog } from "./debug_log";
import { getFilmTmdbSource } from "./tmdb_provenance";
import { isTracedMovieRecord } from "./trace_targets";

const TMDB_DOCUMENTARY_GENRE_ID = 99;

function hasDocumentaryGenreId(
  genreIds: readonly number[] | null | undefined,
): boolean {
  return (genreIds ?? []).some((genreId) => genreId === TMDB_DOCUMENTARY_GENRE_ID);
}

export function isExcludedFilmRecord(
  filmRecord: FilmRecord | null | undefined,
): boolean {
  const excluded = hasDocumentaryGenreId(filmRecord?.genreIds);

  if (isTracedMovieRecord(filmRecord)) {
    addCinenerdleDebugLog("trace.overnight.exclusion-check", {
      excluded,
      reasons: excluded ? ["documentary-genre-id"] : [],
      title: filmRecord?.title ?? filmRecord?.rawTmdbMovie?.title ?? "",
      year: filmRecord?.year ?? "",
      tmdbId: filmRecord?.tmdbId ?? filmRecord?.id ?? null,
      genreIds: [...(filmRecord?.genreIds ?? [])],
      genres: (filmRecord?.rawTmdbMovie?.genres ?? []).map((genre) => ({
        id: genre.id,
        name: genre.name,
      })),
      tmdbSource: getFilmTmdbSource(filmRecord),
    });
  }

  return excluded;
}

export function isExcludedPersonRecord(
  personRecord: PersonRecord | null | undefined,
): boolean {
  void personRecord;
  return false;
}

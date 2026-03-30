import type { FilmRecord, PersonRecord } from "./types";

export type PersonTmdbSource = "direct-person-fetch" | "connection-derived";
export type FilmTmdbSource = "direct-film-fetch" | "connection-derived";

export function getPersonTmdbSource(
  personRecord: PersonRecord | null | undefined,
): PersonTmdbSource {
  if (personRecord?.tmdbSource === "direct-person-fetch") {
    return "direct-person-fetch";
  }

  if (personRecord?.tmdbSource === "connection-derived") {
    return "connection-derived";
  }

  return personRecord?.rawTmdbPerson ? "direct-person-fetch" : "connection-derived";
}

export function getFilmTmdbSource(
  filmRecord: FilmRecord | null | undefined,
): FilmTmdbSource {
  if (filmRecord?.tmdbSource === "direct-film-fetch") {
    return "direct-film-fetch";
  }

  if (filmRecord?.tmdbSource === "connection-derived") {
    return "connection-derived";
  }

  return filmRecord?.rawTmdbMovie ? "direct-film-fetch" : "connection-derived";
}

export function hasDirectTmdbPersonSource(
  personRecord: PersonRecord | null | undefined,
): boolean {
  return getPersonTmdbSource(personRecord) === "direct-person-fetch";
}

export function hasDirectTmdbMovieSource(
  filmRecord: FilmRecord | null | undefined,
): boolean {
  return getFilmTmdbSource(filmRecord) === "direct-film-fetch";
}

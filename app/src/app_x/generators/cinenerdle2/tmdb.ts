import {
  CINENERDLE_DAILY_STARTERS_URL,
  TMDB_API_KEY_STORAGE_KEY,
} from "./constants";
import { createDailyStarterFilmRecord } from "./cards";
import {
  getCachedStarterFilms,
  getFilmRecordById,
  getFilmRecordByTitleAndYear,
  getFilmRecordsByIds,
  getPersonRecordById,
  getPersonRecordByName,
  saveFilmRecord,
  saveFilmRecords,
  savePersonRecord,
} from "./indexed_db";
import {
  buildFilmRecord,
  buildPersonRecord,
  chooseBestMovieSearchResult,
  withDerivedFilmFields,
} from "./records";
import type {
  CinenerdleCard,
  CinenerdleDailyStarter,
  CinenerdlePathNode,
  FilmRecord,
  PersonRecord,
  TmdbMovieCreditsResponse,
  TmdbMovieSearchResult,
  TmdbPersonCredit,
  TmdbPersonMovieCreditsResponse,
  TmdbPersonSearchResult,
  TmdbSearchResponse,
} from "./types";
import {
  getAssociatedPeopleFromMovieCredits,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getUniqueSortedTmdbMovieCredits,
  getValidTmdbEntityId,
  isAllowedBfsTmdbMovieCredit,
  normalizeName,
} from "./utils";

let hasPrimedTmdbApiKey = false;

function readEnvTmdbApiKey(): string {
  const envValue = import.meta.env.VITE_TMDB_API_KEY;
  return typeof envValue === "string" ? envValue.trim() : "";
}

export function getTmdbApiKey(): string | null {
  const envApiKey = readEnvTmdbApiKey();
  if (envApiKey) {
    return envApiKey;
  }

  const localStorageKey =
    localStorage.getItem(TMDB_API_KEY_STORAGE_KEY)?.trim() ?? "";
  if (localStorageKey) {
    return localStorageKey;
  }

  const promptedApiKey = window.prompt("Enter your TMDb API key")?.trim() ?? "";
  if (!promptedApiKey) {
    return null;
  }

  localStorage.setItem(TMDB_API_KEY_STORAGE_KEY, promptedApiKey);
  return promptedApiKey;
}

export function primeTmdbApiKeyOnInit(): void {
  if (hasPrimedTmdbApiKey) {
    return;
  }

  hasPrimedTmdbApiKey = true;
  void getTmdbApiKey();
}

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchTmdbSearch<T>(
  pathname: string,
  query: string,
): Promise<TmdbSearchResponse<T>> {
  const apiKey = getTmdbApiKey();
  if (!apiKey) {
    throw new Error("A TMDB API key is required to continue.");
  }

  const url = new URL(`https://api.themoviedb.org/3/${pathname}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", query);
  return fetchJson<TmdbSearchResponse<T>>(url.toString());
}

async function fetchTmdbCredits<T>(pathname: string): Promise<T> {
  const apiKey = getTmdbApiKey();
  if (!apiKey) {
    throw new Error("A TMDB API key is required to continue.");
  }

  const url = new URL(`https://api.themoviedb.org/3/${pathname}`);
  url.searchParams.set("api_key", apiKey);
  return fetchJson<T>(url.toString());
}

export async function fetchCinenerdleDailyStarterMovies(): Promise<FilmRecord[]> {
  try {
    const payload = await fetchJson<{ data?: CinenerdleDailyStarter[] }>(
      CINENERDLE_DAILY_STARTERS_URL,
    );
    const starterRecords = (payload.data ?? []).map(createDailyStarterFilmRecord);
    await saveFilmRecords(starterRecords.map(withDerivedFilmFields));
    return starterRecords;
  } catch (error) {
    console.error("cinenerdle2.fetchCinenerdleDailyStarterMovies", error);
    return getCachedStarterFilms();
  }
}

export async function resolvePersonRecord(
  personName: string,
  { allowApi = true }: { allowApi?: boolean } = {},
): Promise<PersonRecord | null> {
  const localPersonRecord = await getPersonRecordByName(personName);
  if (localPersonRecord) {
    return localPersonRecord;
  }

  if (!allowApi) {
    return null;
  }

  return fetchAndCachePerson(personName);
}

export async function fetchAndCachePerson(
  personName: string,
): Promise<PersonRecord | null> {
  const searchPayload = await fetchTmdbSearch<TmdbPersonSearchResult>(
    "search/person",
    personName,
  );
  const person =
    searchPayload.results?.find(
      (result) => normalizeName(result.name ?? "") === normalizeName(personName),
    ) ?? searchPayload.results?.[0];

  if (!person) {
    return null;
  }

  const creditsPayload = await fetchTmdbCredits<TmdbPersonMovieCreditsResponse>(
    `person/${person.id}/movie_credits`,
  );
  const personRecord = buildPersonRecord(person, searchPayload, creditsPayload);
  await savePersonRecord(personRecord);
  await saveFilmRecordsFromCredits(creditsPayload, person.name ?? "");

  const storedPersonRecord =
    (await getPersonRecordById(person.id)) ?? personRecord;
  void prefetchBestMovieForPersonRecord(storedPersonRecord);
  return storedPersonRecord;
}

export async function saveFilmRecordsFromCredits(
  creditsPayload: TmdbPersonMovieCreditsResponse,
  connectedPersonName = "",
): Promise<void> {
  const movieCredits = [...(creditsPayload.cast ?? []), ...(creditsPayload.crew ?? [])]
    .filter((credit) => credit.id && getMovieTitleFromCredit(credit));

  const existingRecords = await getFilmRecordsByIds(
    movieCredits.map((credit) => credit.id),
  );

  const nextRecords = movieCredits.map((credit) => {
    const existingRecord = (credit.id ? existingRecords.get(credit.id) : null) ?? null;
    const tmdbFilm: TmdbMovieSearchResult = {
      id: credit.id ?? 0,
      title: getMovieTitleFromCredit(credit),
      original_title: credit.original_title,
      poster_path: credit.poster_path,
      release_date: credit.release_date,
      popularity: credit.popularity,
    };
    const filmRecord = buildFilmRecord(existingRecord, tmdbFilm);

    return withDerivedFilmFields({
      ...filmRecord,
      personConnectionKeys: connectedPersonName
        ? [...filmRecord.personConnectionKeys, normalizeName(connectedPersonName)]
        : filmRecord.personConnectionKeys,
    });
  });

  await saveFilmRecords(nextRecords);
}

export async function resolveMovieRecord(
  pathNode: Extract<CinenerdlePathNode, { kind: "movie" }>,
  { allowApi = true }: { allowApi?: boolean } = {},
): Promise<FilmRecord | null> {
  const localMovieRecord = await getFilmRecordByTitleAndYear(
    pathNode.name,
    pathNode.year,
  );
  if (localMovieRecord) {
    return localMovieRecord;
  }

  if (!allowApi) {
    return null;
  }

  return fetchAndCacheMovie(pathNode.name, pathNode.year);
}

export async function fetchAndCacheMovie(
  movieName: string,
  preferredYear = "",
): Promise<FilmRecord | null> {
  const searchPayload = await fetchTmdbSearch<TmdbMovieSearchResult>(
    "search/movie",
    movieName,
  );
  const movie = chooseBestMovieSearchResult(
    searchPayload.results,
    movieName,
    preferredYear,
  );

  if (!movie) {
    return null;
  }

  const existingRecord =
    (await getFilmRecordById(movie.id)) ??
    (await getFilmRecordByTitleAndYear(movieName, preferredYear));
  const filmRecord = buildFilmRecord(existingRecord, movie);
  await saveFilmRecord(filmRecord);
  const storedMovieRecord = (await getFilmRecordById(movie.id)) ?? filmRecord;

  return fetchAndCacheMovieCredits(storedMovieRecord);
}

export async function fetchAndCacheMovieCredits(
  movieRecord: FilmRecord,
): Promise<FilmRecord | null> {
  let resolvedMovieRecord = movieRecord;
  let tmdbId = getValidTmdbEntityId(
    resolvedMovieRecord.tmdbId ?? resolvedMovieRecord.id,
  );

  if (!tmdbId && resolvedMovieRecord.title) {
    const refreshedRecord = await fetchAndCacheMovie(
      resolvedMovieRecord.title,
      resolvedMovieRecord.year,
    );
    resolvedMovieRecord = refreshedRecord ?? resolvedMovieRecord;
    tmdbId = getValidTmdbEntityId(
      resolvedMovieRecord.tmdbId ?? resolvedMovieRecord.id,
    );
  }

  if (!tmdbId) {
    return resolvedMovieRecord;
  }

  const creditsPayload = await fetchTmdbCredits<TmdbMovieCreditsResponse>(
    `movie/${tmdbId}/credits`,
  );
  const updatedRecord = withDerivedFilmFields({
    ...resolvedMovieRecord,
    id: tmdbId,
    tmdbId,
    rawTmdbMovieCreditsResponse: creditsPayload,
    tmdbCreditsSavedAt: new Date().toISOString(),
  });

  await saveFilmRecord(updatedRecord);
  void prefetchBestPersonForMovieRecord(updatedRecord);
  return updatedRecord;
}

export async function ensurePersonRecordByName(
  personName: string,
): Promise<PersonRecord | null> {
  let personRecord = await getPersonRecordByName(personName);

  if (!personRecord || !personRecord.rawTmdbMovieCreditsResponse) {
    personRecord = await fetchAndCachePerson(personName);
  }

  return personRecord;
}

export async function ensureMovieRecordByPathNode(
  pathNode: Extract<CinenerdlePathNode, { kind: "movie" }>,
): Promise<FilmRecord | null> {
  return resolveMovieRecord(pathNode);
}

export async function ensureMovieRecordForCard(
  card: Extract<CinenerdleCard, { kind: "movie" }>,
): Promise<FilmRecord | null> {
  const tmdbId = getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id);

  if (tmdbId) {
    return (await getFilmRecordById(tmdbId)) ?? card.record;
  }

  return ensureMovieRecordByPathNode({
    kind: "movie",
    name: card.name,
    year: card.year,
  });
}

export async function ensureMovieCreditsRecord(
  movieRecord: FilmRecord | null,
): Promise<FilmRecord | null> {
  if (!movieRecord) {
    return null;
  }

  return movieRecord.rawTmdbMovieCreditsResponse
    ? movieRecord
    : fetchAndCacheMovieCredits(movieRecord);
}

async function prefetchBestMovieForPersonRecord(
  personRecord: PersonRecord,
): Promise<void> {
  const candidateCredits = getUniqueSortedTmdbMovieCredits(personRecord).filter(
    isAllowedBfsTmdbMovieCredit,
  );

  for (const credit of candidateCredits) {
    const existingMovieRecord = credit.id
      ? await getFilmRecordById(credit.id)
      : null;

    if (existingMovieRecord?.rawTmdbMovieCreditsResponse) {
      continue;
    }

    await fetchAndCacheMovie(
      getMovieTitleFromCredit(credit),
      getMovieYearFromCredit(credit),
    );
    return;
  }
}

function isAllowedMoviePersonCredit(credit: TmdbPersonCredit): boolean {
  if (credit.character) {
    return !credit.character.toLowerCase().includes("(uncredited)");
  }

  return Boolean(credit.job);
}

async function prefetchBestPersonForMovieRecord(
  movieRecord: FilmRecord,
): Promise<void> {
  const candidateCredits = getAssociatedPeopleFromMovieCredits(movieRecord)
    .filter(isAllowedMoviePersonCredit)
    .sort((left, right) => (right.popularity ?? 0) - (left.popularity ?? 0));

  for (const credit of candidateCredits) {
    const existingPersonRecord =
      (credit.id ? await getPersonRecordById(credit.id) : null) ??
      (credit.name ? await getPersonRecordByName(credit.name) : null);

    if (existingPersonRecord?.rawTmdbMovieCreditsResponse) {
      continue;
    }

    if (credit.name) {
      await fetchAndCachePerson(credit.name);
      return;
    }
  }
}

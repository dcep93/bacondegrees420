import {
  CINENERDLE_DAILY_STARTERS_URL,
  TMDB_API_KEY_STORAGE_KEY,
} from "./constants";
import { createDailyStarterFilmRecord } from "./cards";
import {
  getAllSearchableConnectionEntities,
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
  hydrateConnectionEntityFromSearchRecord,
} from "./connection_graph";
import {
  buildFilmRecord,
  buildPersonRecord,
  chooseBestMovieSearchResult,
  withDerivedFilmFields,
} from "./records";
import type {
  FilmRecord,
  PersonRecord,
  TmdbMovieCreditsResponse,
  TmdbMovieSearchResult,
  TmdbPersonMovieCreditsResponse,
  TmdbPersonSearchResult,
  TmdbSearchResponse,
} from "./types";
import {
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getUniqueSortedTmdbMovieCredits,
  getValidTmdbEntityId,
  isAllowedBfsTmdbMovieCredit,
  normalizeName,
  normalizeWhitespace,
  normalizeTitle,
  parseMoviePathLabel,
  formatMoviePathLabel,
} from "./utils";

export type ConnectionTarget =
  | {
      kind: "person";
      name: string;
      tmdbId: number | null;
    }
  | {
      kind: "movie";
      name: string;
      year: string;
    };

let hasPrimedTmdbApiKey = false;
let dailyStarterMoviesPromise: Promise<FilmRecord[]> | null = null;
const TMDB_API_KEY_PREFIX = "key:";

function mergeStarterDataIntoFilmRecord(
  filmRecord: FilmRecord,
  starterFilm: FilmRecord,
): FilmRecord {
  return withDerivedFilmFields({
    ...filmRecord,
    rawCinenerdleDailyStarter:
      starterFilm.rawCinenerdleDailyStarter ?? filmRecord.rawCinenerdleDailyStarter,
    starterPeopleByRole:
      starterFilm.starterPeopleByRole ?? filmRecord.starterPeopleByRole,
    isCinenerdleDailyStarter: 1,
    personConnectionKeys: [
      ...filmRecord.personConnectionKeys,
      ...starterFilm.personConnectionKeys,
    ],
  });
}

function encodeTmdbApiKey(apiKey: string): string {
  return btoa(`${TMDB_API_KEY_PREFIX}${apiKey}`);
}

function decodeTmdbApiKey(encodedValue: string): string {
  const trimmedValue = encodedValue.trim();
  if (!trimmedValue) {
    return "";
  }

  if (trimmedValue.startsWith(TMDB_API_KEY_PREFIX)) {
    return trimmedValue.slice(TMDB_API_KEY_PREFIX.length).trim();
  }

  try {
    const decodedValue = atob(trimmedValue).trim();
    if (decodedValue.startsWith(TMDB_API_KEY_PREFIX)) {
      return decodedValue.slice(TMDB_API_KEY_PREFIX.length).trim();
    }
  } catch {
    return trimmedValue;
  }

  return trimmedValue;
}

function readEnvTmdbApiKey(): string {
  const envValue =
    import.meta.env.VITE_TMDB_API_KEY_LOCAL ?? import.meta.env.VITE_TMDB_API_KEY;
  return typeof envValue === "string" ? decodeTmdbApiKey(envValue) : "";
}

export function getTmdbApiKey(): string | null {
  const envApiKey = readEnvTmdbApiKey();
  if (envApiKey) {
    return envApiKey;
  }

  const localStorageKey = decodeTmdbApiKey(
    localStorage.getItem(TMDB_API_KEY_STORAGE_KEY) ?? "",
  );
  if (localStorageKey) {
    return localStorageKey;
  }

  const promptedApiKey = decodeTmdbApiKey(
    window.prompt("Enter your TMDb API key") ?? "",
  );
  if (!promptedApiKey) {
    return null;
  }

  localStorage.setItem(TMDB_API_KEY_STORAGE_KEY, encodeTmdbApiKey(promptedApiKey));
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
  if (!dailyStarterMoviesPromise) {
    dailyStarterMoviesPromise = fetchJson<{
      data?: import("./types").CinenerdleDailyStarter[];
    }>(CINENERDLE_DAILY_STARTERS_URL)
      .then((payload) => (payload.data ?? []).map(createDailyStarterFilmRecord))
      .catch((error) => {
        dailyStarterMoviesPromise = null;
        throw error;
      });
  }

  return dailyStarterMoviesPromise;
}

export async function hydrateCinenerdleDailyStarterMovies(
  starterFilms: FilmRecord[],
): Promise<void> {
  await Promise.allSettled(
    starterFilms.map(async (starterFilm) => {
      if (!starterFilm.title) {
        return;
      }

      const localMovieRecord = await getLocalMovieRecordForCard(
        starterFilm.title,
        starterFilm.year,
        starterFilm.id,
      );
      const backfilledLocalMovieRecord = localMovieRecord
        ? mergeStarterDataIntoFilmRecord(localMovieRecord, starterFilm)
        : null;

      if (backfilledLocalMovieRecord) {
        await saveFilmRecord(backfilledLocalMovieRecord);
      }

      if (hasMovieCredits(backfilledLocalMovieRecord)) {
        return;
      }

      if (backfilledLocalMovieRecord) {
        await fetchAndCacheMovieCredits(backfilledLocalMovieRecord, "prefetch");
        return;
      }

      const fetchedStarterMovieRecord = await fetchAndCacheMovie(
        starterFilm.title,
        starterFilm.year,
        "prefetch",
      );
      if (!fetchedStarterMovieRecord) {
        return;
      }

      await saveFilmRecord(
        mergeStarterDataIntoFilmRecord(fetchedStarterMovieRecord, starterFilm),
      );
    }),
  );
}

export async function fetchAndCachePerson(
  personName: string,
  reason: "fetch" | "prefetch" = "fetch",
  preferredPersonId?: number | null,
): Promise<PersonRecord | null> {
  const validPreferredPersonId = getValidTmdbEntityId(preferredPersonId);
  const searchPayload = validPreferredPersonId
    ? { results: undefined }
    : await fetchTmdbSearch<TmdbPersonSearchResult>(
        "search/person",
        personName,
      );
  const person = validPreferredPersonId
    ? await fetchTmdbCredits<TmdbPersonSearchResult>(`person/${validPreferredPersonId}`)
    : (searchPayload.results?.find(
        (result) => normalizeName(result.name ?? "") === normalizeName(personName),
      ) ?? searchPayload.results?.[0]);

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
  if (reason === "fetch") {
    void prefetchBestMovieForPersonRecord(storedPersonRecord);
  }
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
      vote_average: credit.vote_average,
      vote_count: credit.vote_count,
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

export async function fetchAndCacheMovie(
  movieName: string,
  preferredYear = "",
  reason: "fetch" | "prefetch" = "fetch",
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

  return fetchAndCacheMovieCredits(
    storedMovieRecord,
    reason,
  );
}

export async function fetchAndCacheMovieCredits(
  movieRecord: FilmRecord,
  reason: "fetch" | "prefetch" = "fetch",
): Promise<FilmRecord | null> {
  let resolvedMovieRecord = movieRecord;
  let tmdbId = getValidTmdbEntityId(
    resolvedMovieRecord.tmdbId ?? resolvedMovieRecord.id,
  );

  if (!tmdbId && resolvedMovieRecord.title) {
    const refreshedRecord = await fetchAndCacheMovie(
      resolvedMovieRecord.title,
      resolvedMovieRecord.year,
      reason,
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
  if (reason === "fetch") {
    void prefetchBestPersonForMovieRecord(updatedRecord);
  }
  return updatedRecord;
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

    if (
      existingMovieRecord ??
      (getMovieTitleFromCredit(credit)
        ? await getFilmRecordByTitleAndYear(
            getMovieTitleFromCredit(credit),
            getMovieYearFromCredit(credit),
          )
        : null)
    ) {
      continue;
    }

    await fetchAndCacheMovie(
      getMovieTitleFromCredit(credit),
      getMovieYearFromCredit(credit),
      "prefetch",
    );
    return;
  }
}

async function prefetchBestPersonForMovieRecord(
  movieRecord: FilmRecord,
): Promise<void> {
  const credits = movieRecord.rawTmdbMovieCreditsResponse ?? {};
  const candidateCredits = [
    ...(credits.cast ?? []),
    ...(credits.crew ?? []),
  ].sort((left, right) => (right.popularity ?? 0) - (left.popularity ?? 0));

  for (const credit of candidateCredits) {
    const existingPersonRecord =
      (credit.id ? await getPersonRecordById(credit.id) : null) ??
      (credit.name ? await getPersonRecordByName(credit.name) : null);

    if (existingPersonRecord) {
      continue;
    }

    if (credit.name) {
      await fetchAndCachePerson(credit.name, "prefetch");
      return;
    }
  }
}

async function getLocalPersonRecordForCard(
  personName: string,
  personId?: number | null,
): Promise<PersonRecord | null> {
  return (
    (personId ? await getPersonRecordById(personId) : null) ??
    (personName ? await getPersonRecordByName(personName) : null)
  );
}

async function getLocalMovieRecordForCard(
  movieName: string,
  movieYear = "",
  movieId?: number | string | null,
): Promise<FilmRecord | null> {
  return (
    (movieId ? await getFilmRecordById(movieId) : null) ??
    (movieName ? await getFilmRecordByTitleAndYear(movieName, movieYear) : null)
  );
}

function hasMovieCredits(
  movieRecord: FilmRecord | null,
): movieRecord is FilmRecord & {
  rawTmdbMovieCreditsResponse: NonNullable<FilmRecord["rawTmdbMovieCreditsResponse"]>;
} {
  return Boolean(movieRecord?.rawTmdbMovieCreditsResponse);
}

function hasPersonMovieCredits(
  personRecord: PersonRecord | null,
): personRecord is PersonRecord & {
  rawTmdbMovieCreditsResponse: NonNullable<PersonRecord["rawTmdbMovieCreditsResponse"]>;
} {
  return Boolean(personRecord?.rawTmdbMovieCreditsResponse);
}

export async function prepareSelectedPerson(
  personName: string,
  personId?: number | null,
): Promise<PersonRecord | null> {
  const localPersonRecord = await getLocalPersonRecordForCard(personName, personId);
  if (hasPersonMovieCredits(localPersonRecord)) {
    return localPersonRecord;
  }

  const fetchedPersonRecord = await fetchAndCachePerson(
    personName,
    "fetch",
    personId ?? localPersonRecord?.tmdbId ?? localPersonRecord?.id ?? null,
  );
  return fetchedPersonRecord;
}

export async function prepareSelectedMovie(
  movieName: string,
  movieYear = "",
  movieId?: number | string | null,
): Promise<FilmRecord | null> {
  const localMovieRecord = await getLocalMovieRecordForCard(
    movieName,
    movieYear,
    movieId,
  );
  if (hasMovieCredits(localMovieRecord)) {
    return localMovieRecord;
  }

  if (localMovieRecord) {
    return fetchAndCacheMovieCredits(
      localMovieRecord,
      "fetch",
    );
  }

  return fetchAndCacheMovie(movieName, movieYear, "fetch");
}

function getPersonPopularity(record: PersonRecord | null): number {
  return record?.rawTmdbPerson?.popularity ?? 0;
}

function getMovieLabelNameLower(movieName: string, movieYear = ""): string {
  return normalizeTitle(formatMoviePathLabel(movieName, movieYear));
}

function getTitleOnlyMovieLabelNameLower(movieLabel: string): string {
  const match = normalizeTitle(movieLabel).match(/^(.*) \((\d{4})\)$/);
  return match ? match[1] : normalizeTitle(movieLabel);
}

function isExactPersonMatch(record: PersonRecord | null, query: string): boolean {
  return normalizeName(record?.name ?? "") === normalizeName(query);
}

function isExactMovieMatch(
  record: FilmRecord | null,
  movieName: string,
  movieYear = "",
): boolean {
  return (
    normalizeTitle(record?.title ?? "") === normalizeTitle(movieName) &&
    (!movieYear || (record?.year ?? "") === movieYear)
  );
}

function pickBestConnectionTarget(
  query: string,
  movieName: string,
  movieYear: string,
  personRecord: PersonRecord | null,
  filmRecord: FilmRecord | null,
): ConnectionTarget | null {
  const exactPersonMatch = isExactPersonMatch(personRecord, query);
  const exactMovieMatch = isExactMovieMatch(filmRecord, movieName, movieYear);

  if (movieYear && exactMovieMatch && filmRecord) {
    return {
      kind: "movie",
      name: filmRecord.title,
      year: filmRecord.year,
    };
  }

  if (exactPersonMatch && exactMovieMatch && personRecord && filmRecord) {
    return getPersonPopularity(personRecord) > (filmRecord.popularity ?? 0)
      ? {
          kind: "person",
          name: personRecord.name,
          tmdbId: getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id),
        }
      : {
          kind: "movie",
          name: filmRecord.title,
          year: filmRecord.year,
        };
  }

  if (exactMovieMatch && filmRecord) {
    return {
      kind: "movie",
      name: filmRecord.title,
      year: filmRecord.year,
    };
  }

  if (exactPersonMatch && personRecord) {
    return {
      kind: "person",
      name: personRecord.name,
      tmdbId: getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id),
    };
  }

  if (personRecord && filmRecord) {
    return getPersonPopularity(personRecord) > (filmRecord.popularity ?? 0)
      ? {
          kind: "person",
          name: personRecord.name,
          tmdbId: getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id),
        }
      : {
          kind: "movie",
          name: filmRecord.title,
          year: filmRecord.year,
        };
  }

  if (filmRecord) {
    return {
      kind: "movie",
      name: filmRecord.title,
      year: filmRecord.year,
    };
  }

  if (personRecord) {
    return {
      kind: "person",
      name: personRecord.name,
      tmdbId: getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id),
    };
  }

  return null;
}

export async function resolveConnectionQuery(
  query: string,
): Promise<ConnectionTarget | null> {
  const normalizedQuery = normalizeWhitespace(query);
  if (!normalizedQuery) {
    return null;
  }

  const parsedMovie = parseMoviePathLabel(normalizedQuery);
  const searchRecords = await getAllSearchableConnectionEntities();
  const exactPersonRecord = await getPersonRecordByName(normalizedQuery);
  const exactMovieRecord = await getFilmRecordByTitleAndYear(
    parsedMovie.name,
    parsedMovie.year,
  );
  const exactPersonSearchRecord =
    searchRecords.find(
      (record) =>
        record.type === "person" &&
        record.nameLower === normalizeName(normalizedQuery),
    ) ?? null;
  const exactMovieSearchRecord = parsedMovie.year
    ? (searchRecords.find(
        (record) =>
          record.type === "movie" &&
          record.nameLower === getMovieLabelNameLower(parsedMovie.name, parsedMovie.year),
      ) ?? null)
    : null;
  const titleOnlyMovieSearchRecords = parsedMovie.year
    ? []
    : searchRecords.filter(
        (record) =>
          record.type === "movie" &&
          getTitleOnlyMovieLabelNameLower(record.nameLower) === normalizeTitle(parsedMovie.name),
      );

  const resolvedMovieSearchRecord =
    exactMovieSearchRecord ??
    (exactMovieRecord
      ? titleOnlyMovieSearchRecords.find(
          (record) =>
            record.nameLower === getMovieLabelNameLower(exactMovieRecord.title, exactMovieRecord.year),
        ) ?? null
      : titleOnlyMovieSearchRecords[0] ?? null);

  if (exactPersonSearchRecord || resolvedMovieSearchRecord) {
    const [personEntity, movieEntity, resolvedMovieRecord] = await Promise.all([
      exactPersonSearchRecord
        ? hydrateConnectionEntityFromSearchRecord(exactPersonSearchRecord)
        : Promise.resolve(null),
      resolvedMovieSearchRecord
        ? hydrateConnectionEntityFromSearchRecord(resolvedMovieSearchRecord)
        : Promise.resolve(null),
      resolvedMovieSearchRecord
        ? getFilmRecordByTitleAndYear(
            parseMoviePathLabel(resolvedMovieSearchRecord.nameLower).name,
            parseMoviePathLabel(resolvedMovieSearchRecord.nameLower).year,
          )
        : Promise.resolve(null),
    ]);

    const exactTarget = pickBestConnectionTarget(
      normalizedQuery,
      movieEntity?.name ?? parsedMovie.name,
      movieEntity?.year ?? parsedMovie.year,
      exactPersonRecord,
      resolvedMovieRecord,
    );

    if (exactTarget) {
      return exactTarget;
    }

    if (movieEntity) {
      return {
        kind: "movie",
        name: movieEntity.name,
        year: movieEntity.year,
      };
    }

    if (personEntity) {
      return {
        kind: "person",
        name: personEntity.name,
        tmdbId: personEntity.tmdbId,
      };
    }
  }

  const [fetchedPersonRecord, fetchedFilmRecord] = await Promise.all([
    fetchAndCachePerson(normalizedQuery, "fetch"),
    fetchAndCacheMovie(parsedMovie.name, parsedMovie.year, "fetch"),
  ]);

  const fetchedTarget = pickBestConnectionTarget(
    normalizedQuery,
    parsedMovie.name,
    parsedMovie.year,
    fetchedPersonRecord,
    fetchedFilmRecord,
  );

  return fetchedTarget;
}

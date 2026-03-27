import {
  CINENERDLE_DAILY_STARTERS_URL,
  TMDB_API_KEY_STORAGE_KEY,
} from "./constants";
import { createDailyStarterFilmRecord } from "./cards";
import { logCinenerdleDebug } from "./debug";
import {
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
} from "./utils";

export type ConnectionTarget =
  | {
      kind: "person";
      name: string;
    }
  | {
      kind: "movie";
      name: string;
      year: string;
    };

let hasPrimedTmdbApiKey = false;
let dailyStarterMoviesPromise: Promise<FilmRecord[]> | null = null;

function summarizeFilmRecord(record: FilmRecord | null) {
  return {
    id: record?.id ?? null,
    tmdbId: record?.tmdbId ?? null,
    title: record?.title ?? "",
    year: record?.year ?? "",
    popularity: record?.popularity ?? null,
    posterPath: record?.rawTmdbMovie?.poster_path ?? null,
    castCount: record?.rawTmdbMovieCreditsResponse?.cast?.length ?? 0,
    crewCount: record?.rawTmdbMovieCreditsResponse?.crew?.length ?? 0,
    personConnectionKeys: record?.personConnectionKeys.length ?? 0,
  };
}

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
    personConnectionKeys: [
      ...filmRecord.personConnectionKeys,
      ...starterFilm.personConnectionKeys,
    ],
  });
}

function logEntityEvent(
  kind: "person" | "movie",
  label: string,
  action: "database" | "fetch" | "prefetch",
  dump: PersonRecord | FilmRecord | null,
) {
  const normalizedLabel =
    kind === "person" ? normalizeName(label) : normalizeTitle(label);

  if (!normalizedLabel) {
    return;
  }

  console.log([kind, normalizedLabel, action, dump]);
}

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
  logCinenerdleDebug("tmdb.hydrateCinenerdleDailyStarterMovies.start", {
    starterCount: starterFilms.length,
    starters: starterFilms.slice(0, 12).map((film) => ({
      title: film.title,
      year: film.year,
      id: film.id,
      tmdbId: film.tmdbId ?? null,
    })),
  });

  const results = await Promise.allSettled(
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

  logCinenerdleDebug("tmdb.hydrateCinenerdleDailyStarterMovies.complete", {
    starterCount: starterFilms.length,
    fulfilledCount: results.filter((result) => result.status === "fulfilled").length,
    rejectedCount: results.filter((result) => result.status === "rejected").length,
    errors: results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) =>
        result.reason instanceof Error ? result.reason.message : String(result.reason),
      ),
  });
}

export async function fetchAndCachePerson(
  personName: string,
  reason: "fetch" | "prefetch" = "fetch",
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
  logEntityEvent(
    "person",
    storedPersonRecord.name || person.name || personName,
    reason,
    storedPersonRecord,
  );
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

  logCinenerdleDebug("tmdb.saveFilmRecordsFromCredits", {
    connectedPersonName,
    movieCreditsCount: movieCredits.length,
    preview: nextRecords.slice(0, 8).map((record) => summarizeFilmRecord(record)),
  });
  await saveFilmRecords(nextRecords);
}

export async function fetchAndCacheMovie(
  movieName: string,
  preferredYear = "",
  reason: "fetch" | "prefetch" = "fetch",
): Promise<FilmRecord | null> {
  logCinenerdleDebug("tmdb.fetchAndCacheMovie.start", {
    movieName,
    preferredYear,
    reason,
  });
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
    logCinenerdleDebug("tmdb.fetchAndCacheMovie.notFound", {
      movieName,
      preferredYear,
      totalResults: searchPayload.results?.length ?? 0,
    });
    return null;
  }

  const existingRecord =
    (await getFilmRecordById(movie.id)) ??
    (await getFilmRecordByTitleAndYear(movieName, preferredYear));
  logCinenerdleDebug("tmdb.fetchAndCacheMovie.searchChoice", {
    movieName,
    preferredYear,
    reason,
    movie: {
      id: movie.id,
      title: movie.title ?? movie.original_title ?? "",
      releaseDate: movie.release_date ?? null,
      popularity: movie.popularity ?? null,
      posterPath: movie.poster_path ?? null,
    },
    existingRecord: summarizeFilmRecord(existingRecord),
  });
  const filmRecord = buildFilmRecord(existingRecord, movie);
  await saveFilmRecord(filmRecord);
  const storedMovieRecord = (await getFilmRecordById(movie.id)) ?? filmRecord;
  logCinenerdleDebug("tmdb.fetchAndCacheMovie.afterSave", {
    movieId: movie.id,
    reason,
    builtRecord: summarizeFilmRecord(filmRecord),
    storedMovieRecord: summarizeFilmRecord(storedMovieRecord),
  });

  const resolvedMovieRecord = await fetchAndCacheMovieCredits(
    storedMovieRecord,
    reason,
  );
  logCinenerdleDebug("tmdb.fetchAndCacheMovie.complete", {
    movieName,
    preferredYear,
    reason,
    resolvedMovieRecord: summarizeFilmRecord(resolvedMovieRecord),
  });
  logEntityEvent(
    "movie",
    resolvedMovieRecord?.title || movie.title || movieName,
    reason,
    resolvedMovieRecord,
  );
  return resolvedMovieRecord;
}

export async function fetchAndCacheMovieCredits(
  movieRecord: FilmRecord,
  reason: "fetch" | "prefetch" = "fetch",
): Promise<FilmRecord | null> {
  logCinenerdleDebug("tmdb.fetchAndCacheMovieCredits.start", {
    reason,
    movieRecord: summarizeFilmRecord(movieRecord),
  });
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
    logCinenerdleDebug("tmdb.fetchAndCacheMovieCredits.missingTmdbId", {
      reason,
      movieRecord: summarizeFilmRecord(resolvedMovieRecord),
    });
    return resolvedMovieRecord;
  }

  const creditsPayload = await fetchTmdbCredits<TmdbMovieCreditsResponse>(
    `movie/${tmdbId}/credits`,
  );
  logCinenerdleDebug("tmdb.fetchAndCacheMovieCredits.fetchedCredits", {
    tmdbId,
    reason,
    castCount: creditsPayload.cast?.length ?? 0,
    crewCount: creditsPayload.crew?.length ?? 0,
    castPreview: (creditsPayload.cast ?? []).slice(0, 8).map((credit) => ({
      id: credit.id ?? null,
      name: credit.name ?? "",
      popularity: credit.popularity ?? null,
      profilePath: credit.profile_path ?? null,
      character: credit.character ?? "",
    })),
  });
  const updatedRecord = withDerivedFilmFields({
    ...resolvedMovieRecord,
    id: tmdbId,
    tmdbId,
    rawTmdbMovieCreditsResponse: creditsPayload,
    tmdbCreditsSavedAt: new Date().toISOString(),
  });

  await saveFilmRecord(updatedRecord);
  const persistedRecord = (await getFilmRecordById(tmdbId)) ?? updatedRecord;
  logCinenerdleDebug("tmdb.fetchAndCacheMovieCredits.afterSave", {
    tmdbId,
    reason,
    updatedRecord: summarizeFilmRecord(updatedRecord),
    persistedRecord: summarizeFilmRecord(persistedRecord),
  });
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

export async function prepareSelectedPerson(
  personName: string,
  personId?: number | null,
): Promise<PersonRecord | null> {
  const localPersonRecord = await getLocalPersonRecordForCard(personName, personId);
  if (localPersonRecord) {
    logEntityEvent(
      "person",
      localPersonRecord.name || personName,
      "database",
      localPersonRecord,
    );
    return localPersonRecord;
  }

  return fetchAndCachePerson(personName, "fetch");
}

export async function prepareSelectedMovie(
  movieName: string,
  movieYear = "",
  movieId?: number | string | null,
): Promise<FilmRecord | null> {
  logCinenerdleDebug("tmdb.prepareSelectedMovie.start", {
    movieName,
    movieYear,
    movieId: movieId ?? null,
  });
  const localMovieRecord = await getLocalMovieRecordForCard(
    movieName,
    movieYear,
    movieId,
  );
  logCinenerdleDebug("tmdb.prepareSelectedMovie.localRecord", {
    movieName,
    movieYear,
    movieId: movieId ?? null,
    localMovieRecord: summarizeFilmRecord(localMovieRecord),
  });
  if (hasMovieCredits(localMovieRecord)) {
    logEntityEvent(
      "movie",
      localMovieRecord.title || movieName,
      "database",
      localMovieRecord,
    );
    logCinenerdleDebug("tmdb.prepareSelectedMovie.returnLocalWithCredits", {
      movieName,
      movieYear,
      localMovieRecord: summarizeFilmRecord(localMovieRecord),
    });
    return localMovieRecord;
  }

  if (localMovieRecord) {
    const hydratedMovieRecord = await fetchAndCacheMovieCredits(
      localMovieRecord,
      "fetch",
    );
    logCinenerdleDebug("tmdb.prepareSelectedMovie.returnHydratedLocal", {
      movieName,
      movieYear,
      hydratedMovieRecord: summarizeFilmRecord(hydratedMovieRecord),
    });
    logEntityEvent(
      "movie",
      hydratedMovieRecord?.title || localMovieRecord.title || movieName,
      "fetch",
      hydratedMovieRecord,
    );
    return hydratedMovieRecord;
  }

  const fetchedMovieRecord = await fetchAndCacheMovie(movieName, movieYear, "fetch");
  logCinenerdleDebug("tmdb.prepareSelectedMovie.returnFetched", {
    movieName,
    movieYear,
    fetchedMovieRecord: summarizeFilmRecord(fetchedMovieRecord),
  });
  return fetchedMovieRecord;
}

function getPersonPopularity(record: PersonRecord | null): number {
  return record?.rawTmdbPerson?.popularity ?? 0;
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
    };
  }

  if (personRecord && filmRecord) {
    return getPersonPopularity(personRecord) > (filmRecord.popularity ?? 0)
      ? {
          kind: "person",
          name: personRecord.name,
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
  logCinenerdleDebug("tmdb.resolveConnectionQuery.start", {
    query,
    normalizedQuery,
    parsedMovie,
  });

  const [exactPersonRecord, exactFilmRecord] = await Promise.all([
    getPersonRecordByName(normalizedQuery),
    getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year),
  ]);

  const exactTarget = pickBestConnectionTarget(
    normalizedQuery,
    parsedMovie.name,
    parsedMovie.year,
    exactPersonRecord,
    exactFilmRecord,
  );

  logCinenerdleDebug("tmdb.resolveConnectionQuery.exactLookup", {
    query: normalizedQuery,
    exactPersonName: exactPersonRecord?.name ?? null,
    exactMovieTitle: exactFilmRecord?.title ?? null,
    exactMovieYear: exactFilmRecord?.year ?? null,
    exactTarget,
  });

  if (exactTarget) {
    return exactTarget;
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

  logCinenerdleDebug("tmdb.resolveConnectionQuery.fallbackLookup", {
    query: normalizedQuery,
    fetchedPersonName: fetchedPersonRecord?.name ?? null,
    fetchedMovieTitle: fetchedFilmRecord?.title ?? null,
    fetchedMovieYear: fetchedFilmRecord?.year ?? null,
    fetchedTarget,
  });

  return fetchedTarget;
}

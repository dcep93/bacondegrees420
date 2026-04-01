import { measureAsync } from "../../perf";
import { createDailyStarterFilmRecord } from "./cards";
import {
  getMovieConnectionEntityKey,
  getPersonConnectionEntityKey,
  hydrateConnectionEntityFromSearchRecord,
} from "./connection_graph";
import {
  createMovieEntityRefreshRequestFromRecord,
  createPersonEntityRefreshRequestFromRecord,
  dispatchEntityRefreshRequest,
} from "./entity_refresh";
import {
  CINENERDLE_DAILY_STARTERS_URL,
  TMDB_API_KEY_STORAGE_KEY,
} from "./constants";
import { addCinenerdleDebugLog } from "./debug_log";
import {
  getAllFilmRecords,
  getAllPersonRecords,
  batchCinenerdleRecordsUpdatedEvents,
  getAllSearchableConnectionEntities,
  incrementCinenerdleIndexedDbFetchCount,
  getFilmRecordById,
  getFilmRecordByTitleAndYear,
  getFilmRecordsByIds,
  getPersonRecordById,
  getPersonRecordByName,
  getSearchableConnectionEntityPersistenceStatus,
  saveFilmRecord,
  saveFilmRecords,
  savePersonRecord,
} from "./indexed_db";
import {
  buildFilmRecord,
  buildPersonRecord,
  chooseBestMovieSearchResult,
  getResolvedPersonMovieConnectionKeys,
  mergePersonRecords,
  pickBestPersonRecord,
  withDerivedFilmFields,
} from "./records";
import { writeCinenerdleDailyStarterEntries } from "./starter_storage";
import { hasDirectTmdbMovieSource, hasDirectTmdbPersonSource } from "./tmdb_provenance";
import type {
  CinenerdleDailyStarter,
  FilmRecord,
  PersonRecord,
  SearchableConnectionEntityRecord,
  TmdbMovieCredit,
  TmdbMovieCreditsResponse,
  TmdbMovieSearchResult,
  TmdbPersonCredit,
  TmdbPersonMovieCreditsResponse,
  TmdbPersonSearchResult,
  TmdbSearchResponse,
} from "./types";
import {
  formatMoviePathLabel,
  getAllowedConnectedTmdbMovieCredits,
  getAssociatedPeopleFromMovieCredits,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getUniqueSortedTmdbMovieCredits,
  getValidTmdbEntityId,
  isAllowedBfsTmdbMovieCredit,
  normalizeName,
  normalizeTitle,
  normalizeWhitespace,
  parseMoviePathLabel,
} from "./utils";
import type { CinenerdleCard } from "./view_types";

export type ConnectionTarget =
  | {
    kind: "cinenerdle";
    name: "cinenerdle";
    year: "";
  }
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

type PrepareSelectedOptions = {
  forceRefresh?: boolean;
};

type FetchAndCacheOptions = {
  skipFollowOnPrefetch?: boolean;
};

function getPartialFilmCreditRoleLabel(credit: TmdbPersonCredit): string {
  return normalizeWhitespace(
    credit.creditType === "crew"
      ? credit.job ?? credit.department ?? ""
      : credit.character ?? "",
  );
}

function getPartialFilmCreditKey(credit: TmdbPersonCredit): string {
  return [
    getValidTmdbEntityId(credit.id) ?? 0,
    credit.creditType === "crew" ? "crew" : "cast",
    normalizeName(getPartialFilmCreditRoleLabel(credit)),
  ].join(":");
}

function mergePartialFilmCredit(
  existingCreditsResponse: TmdbMovieCreditsResponse | undefined,
  nextCredit: TmdbPersonCredit,
): TmdbMovieCreditsResponse {
  const creditType = nextCredit.creditType === "crew" ? "crew" : "cast";
  const nextCreditKey = getPartialFilmCreditKey(nextCredit);
  const existingCast = existingCreditsResponse?.cast ?? [];
  const existingCrew = existingCreditsResponse?.crew ?? [];

  if (creditType === "cast") {
    return {
      cast: [
        ...existingCast.filter((credit) => getPartialFilmCreditKey(credit) !== nextCreditKey),
        nextCredit,
      ],
      crew: existingCrew,
    };
  }

  return {
    cast: existingCast,
    crew: [
      ...existingCrew.filter((credit) => getPartialFilmCreditKey(credit) !== nextCreditKey),
      nextCredit,
    ],
  };
}

function createPartialFilmCreditFromMovieCredit(
  connectedPerson: PersonRecord,
  movieCredit: TmdbMovieCredit,
): TmdbPersonCredit | null {
  const connectedPersonTmdbId = getValidTmdbEntityId(
    connectedPerson.tmdbId ?? connectedPerson.id,
  );
  const normalizedPersonName = normalizeWhitespace(connectedPerson.name);

  if (!connectedPersonTmdbId || !normalizedPersonName) {
    return null;
  }

  const creditType = movieCredit.creditType === "crew" ? "crew" : "cast";

  return {
    id: connectedPersonTmdbId,
    name: connectedPerson.name,
    profile_path: connectedPerson.rawTmdbPerson?.profile_path ?? null,
    popularity: connectedPerson.rawTmdbPerson?.popularity ?? 0,
    order: typeof movieCredit.order === "number" ? movieCredit.order : 0,
    fetchTimestamp: connectedPerson.fetchTimestamp,
    creditType,
    character: creditType === "cast" ? movieCredit.character : undefined,
    job: creditType === "crew" ? movieCredit.job : undefined,
    department: creditType === "crew" ? movieCredit.department : undefined,
  };
}

function createConnectionDerivedFilmRecord(
  existingFilmRecord: FilmRecord | null,
  movieCredit: TmdbMovieCredit,
  connectedPerson: PersonRecord,
): FilmRecord | null {
  const tmdbId = getValidTmdbEntityId(movieCredit.id);
  const title = getMovieTitleFromCredit(movieCredit);
  const year = getMovieYearFromCredit(movieCredit);
  const partialFilmCredit = createPartialFilmCreditFromMovieCredit(
    connectedPerson,
    movieCredit,
  );
  if (!tmdbId || !title || !partialFilmCredit) {
    return null;
  }

  const existingIsDirect = hasDirectTmdbMovieSource(existingFilmRecord);
  const mergedMovieCreditsResponse = mergePartialFilmCredit(
    existingFilmRecord?.rawTmdbMovieCreditsResponse,
    partialFilmCredit,
  );

  return withDerivedFilmFields({
    ...existingFilmRecord,
    id: tmdbId,
    tmdbId,
    lookupKey: existingFilmRecord?.lookupKey ?? "",
    title: existingFilmRecord?.title ?? title,
    titleLower: existingFilmRecord?.titleLower ?? normalizeTitle(title),
    year: existingFilmRecord?.year ?? year,
    titleYear: existingFilmRecord?.titleYear ?? "",
    popularity: existingFilmRecord?.popularity ?? movieCredit.popularity ?? 0,
    personConnectionKeys: [
      ...(existingFilmRecord?.personConnectionKeys ?? []),
      normalizeName(connectedPerson.name),
    ],
    tmdbSource: existingIsDirect ? "direct-film-fetch" : "connection-derived",
    rawTmdbMovie: existingFilmRecord?.rawTmdbMovie ?? {
      id: tmdbId,
      title,
      original_title: movieCredit.original_title,
      poster_path: movieCredit.poster_path,
      release_date: movieCredit.release_date,
      popularity: movieCredit.popularity,
      vote_average: movieCredit.vote_average,
      vote_count: movieCredit.vote_count,
    },
    fetchTimestamp: existingIsDirect
      ? existingFilmRecord?.fetchTimestamp
      : connectedPerson.fetchTimestamp,
    rawTmdbMovieCreditsResponse: mergedMovieCreditsResponse,
  });
}

type PendingPopularMoviePrefetch = {
  key: string;
  title: string;
  year: string;
  tmdbId: number | null;
  popularity: number;
};

type PendingPopularPersonPrefetch = {
  key: string;
  name: string;
  tmdbId: number | null;
  popularity: number;
};

type FetchLogPosition = {
  index: number;
  total: number;
};

type FetchLogContext = {
  generation?: number;
  position?: FetchLogPosition;
  popularity?: number | null;
};

type SelectedPrefetchCard = Extract<CinenerdleCard, { kind: "movie" | "person" }>;

let hasPrimedTmdbApiKey = false;
let dailyStarterMoviesPromise: Promise<FilmRecord[]> | null = null;
let dailyStarterHydrationPromise: Promise<void> | null = null;
let syncPopularConnectionPrefetchQueuesPromise: Promise<void> | null = null;
let prefetchTopPopularUnhydratedConnectionsPromise: Promise<void> | null = null;
const TMDB_API_KEY_PREFIX = "key:";
const POPULAR_CONNECTION_PREFETCH_COUNT = 1;
let pendingPopularMoviePrefetchQueue: PendingPopularMoviePrefetch[] = [];
let pendingPopularPersonPrefetchQueue: PendingPopularPersonPrefetch[] = [];
let pendingDirectMoviePrefetchQueue: PendingPopularMoviePrefetch[] = [];
let pendingDirectPersonPrefetchQueue: PendingPopularPersonPrefetch[] = [];
const inFlightPopularMoviePrefetchKeys = new Set<string>();
const inFlightPopularPersonPrefetchKeys = new Set<string>();
let currentTmdbLogGeneration = 0;
const inFlightSelectedMoviePreparations = new Map<string, Promise<FilmRecord | null>>();
const inFlightSelectedPersonPreparations = new Map<string, Promise<PersonRecord | null>>();

function getSelectedMoviePreparationKey(
  movieName: string,
  movieYear = "",
  movieId?: number | string | null,
): string {
  const tmdbId = getValidTmdbEntityId(movieId);
  if (tmdbId) {
    return `movie:${tmdbId}`;
  }

  return `movie:${normalizeTitle(movieName)}:${movieYear}`;
}

function getSelectedPersonPreparationKey(
  personName: string,
  personId?: number | null,
): string {
  const tmdbId = getValidTmdbEntityId(personId);
  if (tmdbId) {
    return `person:${tmdbId}`;
  }

  return `person:${normalizeName(personName)}`;
}

function getSearchRecordPersonTmdbId(
  searchRecord: SearchableConnectionEntityRecord,
): number | null {
  if (searchRecord.type !== "person" || !searchRecord.key.startsWith("person:")) {
    return null;
  }

  return getValidTmdbEntityId(searchRecord.key.slice("person:".length));
}

function buildHydratedMoviePrefetchKeySet(filmRecords: FilmRecord[]): Set<string> {
  return new Set(
    filmRecords
      .filter((filmRecord) => hasMovieFullState(filmRecord))
      .map((filmRecord) => getMovieConnectionEntityKey(filmRecord.title, filmRecord.year)),
  );
}

function buildHydratedPersonPrefetchKeySet(personRecords: PersonRecord[]): Set<string> {
  const hydratedKeys = new Set<string>();

  personRecords
    .filter((personRecord) => hasPersonFullState(personRecord))
    .forEach((personRecord) => {
      hydratedKeys.add(
        getPersonConnectionEntityKey(
          personRecord.name,
          personRecord.tmdbId ?? personRecord.id,
        ),
      );
      hydratedKeys.add(getPersonConnectionEntityKey(personRecord.name));
    });

  return hydratedKeys;
}

function buildPendingPopularMoviePrefetchFromSearchRecord(
  searchRecord: SearchableConnectionEntityRecord,
): PendingPopularMoviePrefetch | null {
  if (searchRecord.type !== "movie") {
    return null;
  }

  const parsedMovieLabel = parseMoviePathLabel(searchRecord.nameLower);
  return {
    key: searchRecord.key,
    title: parsedMovieLabel.name,
    year: parsedMovieLabel.year,
    tmdbId: null,
    popularity: searchRecord.popularity ?? 0,
  };
}

function buildPendingPopularPersonPrefetchFromSearchRecord(
  searchRecord: SearchableConnectionEntityRecord,
): PendingPopularPersonPrefetch | null {
  if (searchRecord.type !== "person") {
    return null;
  }

  return {
    key: searchRecord.key,
    name: searchRecord.nameLower,
    tmdbId: getSearchRecordPersonTmdbId(searchRecord),
    popularity: searchRecord.popularity ?? 0,
  };
}

function describeFetchInput(input: string) {
  try {
    const url = new URL(input);
    return {
      origin: url.origin,
      pathname: url.pathname,
    };
  } catch {
    return {
      input,
    };
  }
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

function comparePendingPopularPrefetchCandidates(
  left: { key: string; popularity: number },
  right: { key: string; popularity: number },
): number {
  const popularityDifference = right.popularity - left.popularity;
  if (popularityDifference !== 0) {
    return popularityDifference;
  }

  return left.key.localeCompare(right.key);
}

function getFetchLogGeneration(
  reason: "fetch" | "prefetch",
  context?: FetchLogContext,
): number {
  if (typeof context?.generation === "number") {
    return Math.max(0, context.generation);
  }

  return reason === "prefetch"
    ? currentTmdbLogGeneration + 1
    : currentTmdbLogGeneration;
}

function getFetchLogPosition(context?: FetchLogContext): FetchLogPosition {
  return context?.position ?? {
    index: 1,
    total: 1,
  };
}

function getFetchLogPopularity(
  context?: FetchLogContext,
): number | null {
  return typeof context?.popularity === "number" ? context.popularity : null;
}

function formatFetchLogEvent(
  generation: number,
  kind: "movie" | "person",
  position: FetchLogPosition,
  reason: "fetch" | "prefetch",
  label: string,
  popularity: number | null,
): string {
  const popularityLabel =
    typeof popularity === "number"
      ? ` pop ${Number(popularity.toFixed(2))}`
      : "";

  return `gen ${generation} ${kind} ${position.index} / ${position.total} ${reason} ${label}${popularityLabel}`;
}

export function setTmdbLogGeneration(generation: number): void {
  currentTmdbLogGeneration = Math.max(0, generation);
}

function logRawTmdbMovieResponse(
  reason: "fetch" | "prefetch",
  movieName: string,
  movieYear: string,
  payload: unknown,
  context?: FetchLogContext,
): void {
  const label = formatMoviePathLabel(movieName, movieYear);
  const generation = getFetchLogGeneration(reason, context);
  const position = getFetchLogPosition(context);
  const popularity = getFetchLogPopularity(context);
  const event = formatFetchLogEvent(
    generation,
    "movie",
    position,
    reason,
    label,
    popularity,
  );
  console.log(event, payload);
  addCinenerdleDebugLog(event);
  void incrementCinenerdleIndexedDbFetchCount().catch(() => { });
}

function logRawTmdbPersonResponse(
  reason: "fetch" | "prefetch",
  personName: string,
  payload: unknown,
  context?: FetchLogContext,
): void {
  const generation = getFetchLogGeneration(reason, context);
  const position = getFetchLogPosition(context);
  const popularity = getFetchLogPopularity(context);
  const event = formatFetchLogEvent(
    generation,
    "person",
    position,
    reason,
    personName,
    popularity,
  );
  console.log(event, payload);
  addCinenerdleDebugLog(event);
  void incrementCinenerdleIndexedDbFetchCount().catch(() => { });
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
  return measureAsync(
    "tmdb.fetchJson",
    async () => {
      const response = await fetch(input);
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      return response.json() as Promise<T>;
    },
    {
      always: true,
      details: describeFetchInput(input),
    },
  );
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

async function resolveCinenerdleDailyStarterTmdbId(
  starter: CinenerdleDailyStarter,
): Promise<number | null> {
  const starterRecord = createDailyStarterFilmRecord({
    title: starter.title,
  });
  if (!starterRecord.title) {
    return null;
  }

  try {
    const searchPayload = await fetchTmdbSearch<TmdbMovieSearchResult>(
      "search/movie",
      starterRecord.title,
    );
    const movie = chooseBestMovieSearchResult(
      searchPayload.results,
      starterRecord.title,
      starterRecord.year,
    );
    return getValidTmdbEntityId(movie?.id);
  } catch {
    return null;
  }
}

export async function fetchCinenerdleDailyStarterMovies(): Promise<FilmRecord[]> {
  const hasCachedPromise = dailyStarterMoviesPromise !== null;

  return measureAsync(
    "tmdb.fetchCinenerdleDailyStarterMovies",
    async () => {
      if (!dailyStarterMoviesPromise) {
        dailyStarterMoviesPromise = fetchJson<{
          data?: CinenerdleDailyStarter[];
        }>(CINENERDLE_DAILY_STARTERS_URL)
          .then(async (payload) => {
            const starters = payload.data ?? [];
            const startersWithTmdbIds = await Promise.all(
              starters.map(async (starter) => ({
                ...starter,
                tmdbId: await resolveCinenerdleDailyStarterTmdbId(starter),
              })),
            );
            writeCinenerdleDailyStarterEntries(
              startersWithTmdbIds.flatMap((starter) => {
                const title = starter.title?.trim() ?? "";
                return title
                  ? [{
                      title,
                      tmdbId: starter.tmdbId ?? null,
                    }]
                  : [];
              }),
            );
            return startersWithTmdbIds.map(createDailyStarterFilmRecord);
          })
          .catch((error) => {
            dailyStarterMoviesPromise = null;
            throw error;
          });
      }

      return dailyStarterMoviesPromise;
    },
    {
      always: true,
      details: {
        hasCachedPromise,
      },
      summarizeResult: (starterFilms) => ({
        starterCount: starterFilms.length,
      }),
    },
  );
}

export async function hydrateCinenerdleDailyStarterMovies(
  starterFilms: FilmRecord[],
): Promise<void> {
  if (dailyStarterHydrationPromise) {
    return dailyStarterHydrationPromise;
  }

  dailyStarterHydrationPromise = measureAsync(
    "tmdb.hydrateCinenerdleDailyStarterMovies",
    () =>
      batchCinenerdleRecordsUpdatedEvents(async () => {
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
            if (hasMovieFullState(localMovieRecord)) {
              return;
            }

            if (localMovieRecord) {
              const localMovieTmdbId = getValidTmdbEntityId(
                localMovieRecord.tmdbId ?? localMovieRecord.id,
              );
              if (!hasDirectTmdbMovieSource(localMovieRecord) && localMovieTmdbId) {
                await fetchAndCacheMovie(
                  localMovieRecord.title,
                  localMovieRecord.year,
                  "prefetch",
                  localMovieTmdbId,
                );
                return;
              }

              await fetchAndCacheMovieCredits(localMovieRecord, "prefetch");
              return;
            }

            const starterMovieTmdbId = getValidTmdbEntityId(
              starterFilm.tmdbId ?? starterFilm.id,
            );
            const fetchedStarterMovieRecord = starterMovieTmdbId
              ? await fetchAndCacheMovie(
                  starterFilm.title,
                  starterFilm.year,
                  "prefetch",
                  starterMovieTmdbId,
                )
              : null;
            if (!fetchedStarterMovieRecord) {
              return;
            }
          }),
        );
      }),
    {
      always: true,
      details: {
        starterCount: starterFilms.length,
      },
    },
  ).finally(() => {
    dailyStarterHydrationPromise = null;
  });

  return dailyStarterHydrationPromise;
}

async function syncPopularConnectionPrefetchQueues(): Promise<void> {
  if (syncPopularConnectionPrefetchQueuesPromise) {
    return syncPopularConnectionPrefetchQueuesPromise;
  }

  syncPopularConnectionPrefetchQueuesPromise = measureAsync(
    "tmdb.syncPopularConnectionPrefetchQueues",
    async () => {
      if (getSearchableConnectionEntityPersistenceStatus().isPending) {
        pendingPopularMoviePrefetchQueue = [];
        pendingPopularPersonPrefetchQueue = [];
        return;
      }

      const [searchableConnectionEntities, filmRecords, personRecords] = await Promise.all([
        getAllSearchableConnectionEntities(),
        getAllFilmRecords(),
        getAllPersonRecords(),
      ]);
      const hydratedMovieKeys = buildHydratedMoviePrefetchKeySet(filmRecords);
      const hydratedPersonKeys = buildHydratedPersonPrefetchKeySet(personRecords);
      const pendingMovieCandidates = searchableConnectionEntities
        .filter((searchRecord) =>
          searchRecord.type === "movie" &&
          !hydratedMovieKeys.has(searchRecord.key))
        .map((searchRecord) => buildPendingPopularMoviePrefetchFromSearchRecord(searchRecord));
      const pendingPersonCandidates = searchableConnectionEntities
        .filter((searchRecord) =>
          searchRecord.type === "person" &&
          !hydratedPersonKeys.has(searchRecord.key))
        .map((searchRecord) => buildPendingPopularPersonPrefetchFromSearchRecord(searchRecord));

      pendingPopularMoviePrefetchQueue = pendingMovieCandidates
        .filter((candidate): candidate is PendingPopularMoviePrefetch => candidate !== null)
        .sort(comparePendingPopularPrefetchCandidates);
      pendingPopularPersonPrefetchQueue = pendingPersonCandidates
        .filter((candidate): candidate is PendingPopularPersonPrefetch => candidate !== null)
        .sort(comparePendingPopularPrefetchCandidates);
    },
    {
      always: true,
      summarizeResult: () => ({
        pendingMovieCount: pendingPopularMoviePrefetchQueue.length,
        pendingPersonCount: pendingPopularPersonPrefetchQueue.length,
      }),
    },
  ).finally(() => {
    syncPopularConnectionPrefetchQueuesPromise = null;
  });

  return syncPopularConnectionPrefetchQueuesPromise;
}

async function refreshPopularConnectionPrefetchQueues(): Promise<void> {
  await syncPopularConnectionPrefetchQueues();
}

async function getExistingMovieRecordForPendingCandidate(
  candidate: Pick<PendingPopularMoviePrefetch, "title" | "year" | "tmdbId">,
): Promise<FilmRecord | null> {
  return (
    (candidate.tmdbId ? await getFilmRecordById(candidate.tmdbId) : null) ??
    (await getFilmRecordByTitleAndYear(candidate.title, candidate.year))
  );
}

async function getExistingPersonRecordForPendingCandidate(
  candidate: Pick<PendingPopularPersonPrefetch, "name" | "tmdbId">,
): Promise<PersonRecord | null> {
  return candidate.tmdbId
    ? await getPersonRecordById(candidate.tmdbId)
    : await getPersonRecordByName(candidate.name);
}

async function buildPendingDirectMoviePrefetchQueue(
  personRecord: PersonRecord,
  options: {
    maxCandidateCount?: number;
  } = {},
): Promise<PendingPopularMoviePrefetch[]> {
  const seenKeys = new Set<string>();
  const candidateCredits = getUniqueSortedTmdbMovieCredits(personRecord).filter(
    isAllowedBfsTmdbMovieCredit,
  );
  const existingMovieRecordsById = await getFilmRecordsByIds(
    candidateCredits.map((credit) => getValidTmdbEntityId(credit.id)).filter(Boolean),
  );
  const candidates: PendingPopularMoviePrefetch[] = [];
  const maxCandidateCount = options.maxCandidateCount ?? Number.POSITIVE_INFINITY;

  for (const credit of candidateCredits) {
    const title = normalizeWhitespace(getMovieTitleFromCredit(credit));
    if (!title) {
      continue;
    }

    const year = getMovieYearFromCredit(credit);
    const key = getMovieConnectionEntityKey(title, year);
    if (seenKeys.has(key)) {
      continue;
    }

    const existingMovieRecord = credit.id
      ? existingMovieRecordsById.get(credit.id) ?? null
      : null;
    const fallbackMovieRecord = existingMovieRecord
      ? null
      : await getFilmRecordByTitleAndYear(title, year);
    const resolvedExistingMovieRecord = existingMovieRecord ?? fallbackMovieRecord;
    if (hasMovieFullState(resolvedExistingMovieRecord)) {
      continue;
    }

    seenKeys.add(key);
    candidates.push({
      key,
      title,
      year,
      tmdbId: getValidTmdbEntityId(
        credit.id ?? resolvedExistingMovieRecord?.tmdbId ?? resolvedExistingMovieRecord?.id,
      ),
      popularity: credit.popularity ?? resolvedExistingMovieRecord?.popularity ?? 0,
    });

    if (candidates.length >= maxCandidateCount) {
      break;
    }
  }

  return candidates;
}

async function buildPendingDirectPersonPrefetchQueue(
  movieRecord: FilmRecord,
  options: {
    maxCandidateCount?: number;
  } = {},
): Promise<PendingPopularPersonPrefetch[]> {
  const seenKeys = new Set<string>();
  const credits = movieRecord.rawTmdbMovieCreditsResponse ?? {};
  const candidateCredits = [
    ...(credits.cast ?? []),
    ...(credits.crew ?? []),
  ].sort((left, right) => (right.popularity ?? 0) - (left.popularity ?? 0));
  const candidates: PendingPopularPersonPrefetch[] = [];
  const maxCandidateCount = options.maxCandidateCount ?? Number.POSITIVE_INFINITY;

  for (const credit of candidateCredits) {
    const name = normalizeWhitespace(credit.name ?? "");
    if (!name) {
      continue;
    }

    const tmdbId = getValidTmdbEntityId(credit.id);
    const key = getPersonConnectionEntityKey(name, tmdbId);
    if (seenKeys.has(key)) {
      continue;
    }

    const existingPersonRecord = pickBestPersonRecord(
      tmdbId ? await getPersonRecordById(tmdbId) : null,
      await getPersonRecordByName(name),
    );
    if (hasPersonFullState(existingPersonRecord)) {
      continue;
    }

    seenKeys.add(key);
    candidates.push({
      key,
      name,
      tmdbId,
      popularity: credit.popularity ?? 0,
    });

    if (candidates.length >= maxCandidateCount) {
      break;
    }
  }

  return candidates;
}

async function syncDirectConnectionPrefetchQueues(
  selectedCard: SelectedPrefetchCard | null,
  options: {
    maxCandidateCount?: number;
  } = {},
): Promise<void> {
  pendingDirectMoviePrefetchQueue = [];
  pendingDirectPersonPrefetchQueue = [];

  if (!selectedCard) {
    return;
  }

  if (selectedCard.kind === "movie") {
    const movieRecord =
      selectedCard.record ??
      (await getLocalMovieRecordForCard(
        selectedCard.name,
        selectedCard.year,
      ));
    if (!hasMovieFullState(movieRecord)) {
      return;
    }

    pendingDirectPersonPrefetchQueue = await buildPendingDirectPersonPrefetchQueue(movieRecord, options);
    return;
  }

  const personRecord =
    selectedCard.record ??
    (await getLocalPersonRecordForCard(
      selectedCard.name,
      getSelectedPersonCardTmdbId(selectedCard),
    ));
  if (!hasPersonFullState(personRecord)) {
    return;
  }

  pendingDirectMoviePrefetchQueue = await buildPendingDirectMoviePrefetchQueue(personRecord, options);
}

async function selectEligibleMoviePrefetchCandidate(
  queue: PendingPopularMoviePrefetch[],
): Promise<PendingPopularMoviePrefetch | null> {
  for (const candidate of queue) {
    if (inFlightPopularMoviePrefetchKeys.has(candidate.key)) {
      continue;
    }

    if (hasMovieFullState(await getExistingMovieRecordForPendingCandidate(candidate))) {
      continue;
    }

    return candidate;
  }

  return null;
}

async function selectEligiblePersonPrefetchCandidate(
  queue: PendingPopularPersonPrefetch[],
): Promise<PendingPopularPersonPrefetch | null> {
  for (const candidate of queue) {
    if (inFlightPopularPersonPrefetchKeys.has(candidate.key)) {
      continue;
    }

    if (hasPersonFullState(await getExistingPersonRecordForPendingCandidate(candidate))) {
      continue;
    }

    return candidate;
  }

  return null;
}

async function selectNextMoviePrefetchCandidate(
  options: {
    directOnly?: boolean;
  } = {},
): Promise<PendingPopularMoviePrefetch | null> {
  const directCandidate = await selectEligibleMoviePrefetchCandidate(
    pendingDirectMoviePrefetchQueue,
  );
  if (directCandidate || options.directOnly) {
    return directCandidate;
  }

  return selectEligibleMoviePrefetchCandidate(pendingPopularMoviePrefetchQueue);
}

async function selectNextPersonPrefetchCandidate(
  options: {
    directOnly?: boolean;
  } = {},
): Promise<PendingPopularPersonPrefetch | null> {
  const directCandidate = await selectEligiblePersonPrefetchCandidate(
    pendingDirectPersonPrefetchQueue,
  );
  if (directCandidate || options.directOnly) {
    return directCandidate;
  }

  return selectEligiblePersonPrefetchCandidate(pendingPopularPersonPrefetchQueue);
}

export async function fetchAndCachePerson(
  personName: string,
  reason: "fetch" | "prefetch" = "fetch",
  preferredPersonId?: number | null,
  options: FetchAndCacheOptions & {
    logContext?: FetchLogContext;
  } = {},
): Promise<PersonRecord | null> {
  return measureAsync(
    "tmdb.fetchAndCachePerson",
    async () => {
      const validPreferredPersonId = getValidTmdbEntityId(preferredPersonId);
      if (!validPreferredPersonId) {
        return personName ? await getPersonRecordByName(personName) : null;
      }

      const person = await fetchTmdbCredits<TmdbPersonSearchResult>(
        `person/${validPreferredPersonId}`,
      );
      const creditsPayload = await fetchTmdbCredits<TmdbPersonMovieCreditsResponse>(
        `person/${person.id}/movie_credits`,
      );
      logRawTmdbPersonResponse(
        reason,
        person.name ?? personName,
        {
          person,
          movieCredits: creditsPayload,
        },
        {
          ...options.logContext,
          popularity: person.popularity ?? null,
        },
      );
      const fetchTimestamp = new Date().toISOString();
      const personRecord = {
        ...buildPersonRecord(person, creditsPayload),
        fetchTimestamp,
      };
      const existingPersonRecord = pickBestPersonRecord(
        await getPersonRecordById(person.id),
        await getPersonRecordByName(person.name ?? personName),
      );
      const mergedPersonRecord = mergePersonRecords(
        existingPersonRecord,
        personRecord,
      );

      await savePersonRecord(mergedPersonRecord);
      await saveFilmRecordsFromCredits(mergedPersonRecord);
      await refreshPopularConnectionPrefetchQueues();

      const storedPersonRecord =
        (await getPersonRecordById(person.id)) ?? mergedPersonRecord;
      dispatchEntityRefreshRequest(
        createPersonEntityRefreshRequestFromRecord(storedPersonRecord, reason),
      );
      return storedPersonRecord;
    },
    {
      always: true,
      details: {
        personName,
        preferredPersonId,
        reason,
        skipFollowOnPrefetch: options.skipFollowOnPrefetch ?? false,
      },
      summarizeResult: (personRecord) => ({
        hit: Boolean(personRecord),
      }),
    },
  );
}

export async function saveFilmRecordsFromCredits(
  connectedPerson: PersonRecord,
): Promise<void> {
  const movieCredits = getAllowedConnectedTmdbMovieCredits(connectedPerson)
    .filter((credit) => credit.id && getMovieTitleFromCredit(credit));

  const existingRecords = await getFilmRecordsByIds(
    movieCredits.map((credit) => credit.id),
  );

  const nextRecords = movieCredits.flatMap((credit) => {
    const existingRecord = (credit.id ? existingRecords.get(credit.id) : null) ?? null;
    const filmRecord = createConnectionDerivedFilmRecord(
      existingRecord,
      credit,
      connectedPerson,
    );

    return filmRecord ? [filmRecord] : [];
  });
  await saveFilmRecords(nextRecords);
}

export async function fetchAndCacheMovie(
  movieName: string,
  preferredYear = "",
  reason: "fetch" | "prefetch" = "fetch",
  preferredMovieId?: number | string | null,
  options: FetchAndCacheOptions & {
    logContext?: FetchLogContext;
  } = {},
): Promise<FilmRecord | null> {
  const validPreferredMovieId = getValidTmdbEntityId(preferredMovieId);
  if (!validPreferredMovieId) {
    return movieName ? await getFilmRecordByTitleAndYear(movieName, preferredYear) : null;
  }

  return fetchAndCacheMovieById(validPreferredMovieId, {
    movieName,
    movieYear: preferredYear,
    reason,
    skipFollowOnPrefetch: options.skipFollowOnPrefetch,
    logContext: options.logContext,
  });
}

async function fetchAndCacheMovieById(
  tmdbId: number,
  options: {
    movieName?: string;
    movieYear?: string;
    reason?: "fetch" | "prefetch";
    skipFollowOnPrefetch?: boolean;
    logContext?: FetchLogContext;
  } = {},
): Promise<FilmRecord | null> {
  const {
    movieName = "",
    movieYear = "",
    reason = "fetch",
  } = options;

  return measureAsync(
    "tmdb.fetchAndCacheMovieById",
    async () => {
      const exactMovie = await fetchTmdbCredits<TmdbMovieSearchResult>(`movie/${tmdbId}`);
      const existingRecord =
        (await getFilmRecordById(tmdbId)) ??
        (movieName ? await getFilmRecordByTitleAndYear(movieName, movieYear) : null);
      const filmRecord = buildFilmRecord(existingRecord, exactMovie);

      await saveFilmRecord(filmRecord);
      const storedMovieRecord = (await getFilmRecordById(tmdbId)) ?? filmRecord;
      const hydratedMovieRecord = await fetchAndCacheMovieCredits(
        storedMovieRecord,
        reason,
        {
          skipFollowOnPrefetch: options.skipFollowOnPrefetch,
          logContext: options.logContext,
          suppressLog: true,
        },
      );
      logRawTmdbMovieResponse(
        reason,
        filmRecord.title || movieName,
        filmRecord.year || movieYear,
        {
          movie: exactMovie,
          credits: hydratedMovieRecord?.rawTmdbMovieCreditsResponse ?? null,
        },
        {
          ...options.logContext,
          popularity: exactMovie.popularity ?? filmRecord.popularity ?? null,
        },
      );
      return hydratedMovieRecord;
    },
    {
      always: true,
      details: {
        movieName,
        movieYear,
        reason,
        skipFollowOnPrefetch: options.skipFollowOnPrefetch ?? false,
        tmdbId,
      },
      summarizeResult: (filmRecord) => ({
        hit: Boolean(filmRecord),
      }),
    },
  );
}

export async function fetchAndCacheMovieCredits(
  movieRecord: FilmRecord,
  reason: "fetch" | "prefetch" = "fetch",
  options: FetchAndCacheOptions & {
    logContext?: FetchLogContext;
    suppressLog?: boolean;
  } = {},
): Promise<FilmRecord | null> {
  return measureAsync(
    "tmdb.fetchAndCacheMovieCredits",
    async () => {
      const resolvedMovieRecord = movieRecord;
      const tmdbId = getValidTmdbEntityId(
        resolvedMovieRecord.tmdbId ?? resolvedMovieRecord.id,
      );

      if (!tmdbId) {
        return resolvedMovieRecord;
      }

      const creditsPayload = await fetchTmdbCredits<TmdbMovieCreditsResponse>(
        `movie/${tmdbId}/credits`,
      );
      const fetchTimestamp = new Date().toISOString();
      const updatedRecord = withDerivedFilmFields({
        ...resolvedMovieRecord,
        id: tmdbId,
        tmdbId,
        rawTmdbMovieCreditsResponse: {
          cast: creditsPayload.cast?.map((credit) => ({ ...credit, fetchTimestamp })) ?? [],
          crew: creditsPayload.crew?.map((credit) => ({ ...credit, fetchTimestamp })) ?? [],
        },
        fetchTimestamp,
      });

      await saveFilmRecord(updatedRecord);
      if (!options.suppressLog) {
        logRawTmdbMovieResponse(
          reason,
          resolvedMovieRecord.title,
          resolvedMovieRecord.year,
          {
            movie: resolvedMovieRecord.rawTmdbMovie ?? null,
            credits: creditsPayload,
          },
          {
            ...options.logContext,
            popularity: resolvedMovieRecord.popularity ?? null,
          },
        );
      }
      await refreshPopularConnectionPrefetchQueues();
      dispatchEntityRefreshRequest(
        createMovieEntityRefreshRequestFromRecord(updatedRecord, reason),
      );
      return updatedRecord;
    },
    {
      always: true,
      details: {
        movieId: movieRecord.tmdbId ?? movieRecord.id ?? null,
        movieTitle: movieRecord.title,
        reason,
        skipFollowOnPrefetch: options.skipFollowOnPrefetch ?? false,
      },
      summarizeResult: (filmRecord) => ({
        hit: Boolean(filmRecord),
      }),
    },
  );
}

async function getLocalPersonRecordForCard(
  personName: string,
  personId?: number | null,
): Promise<PersonRecord | null> {
  return pickBestPersonRecord(
    personId ? await getPersonRecordById(personId) : null,
    personName ? await getPersonRecordByName(personName) : null,
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

function getSelectedPersonCardTmdbId(
  card: Extract<CinenerdleCard, { kind: "person" }>,
): number | null {
  const recordTmdbId = getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id);
  if (recordTmdbId) {
    return recordTmdbId;
  }

  const keyMatch = card.key.match(/^person:(\d+)$/);
  return keyMatch ? getValidTmdbEntityId(keyMatch[1]) : null;
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

export function hasHydratedMovieRecord(
  movieRecord: FilmRecord | null | undefined,
): movieRecord is FilmRecord & {
  rawTmdbMovie: NonNullable<FilmRecord["rawTmdbMovie"]>;
} {
  return hasDirectTmdbMovieSource(movieRecord);
}

export function hasHydratedPersonRecord(
  personRecord: PersonRecord | null | undefined,
): personRecord is PersonRecord & {
  rawTmdbPerson: NonNullable<PersonRecord["rawTmdbPerson"]>;
} {
  return hasDirectTmdbPersonSource(personRecord);
}

export function hasMovieFullState(
  movieRecord: FilmRecord | null | undefined,
): movieRecord is FilmRecord & {
  rawTmdbMovie: NonNullable<FilmRecord["rawTmdbMovie"]>;
  rawTmdbMovieCreditsResponse: NonNullable<FilmRecord["rawTmdbMovieCreditsResponse"]>;
} {
  if (!hasHydratedMovieRecord(movieRecord) || !hasMovieCredits(movieRecord ?? null)) {
    return false;
  }

  const resolvedMovieRecord = movieRecord!;
  return (
    (resolvedMovieRecord.personConnectionKeys?.length ?? 0) === 0 ||
    getAssociatedPeopleFromMovieCredits(resolvedMovieRecord).length > 0
  );
}

export function hasPersonFullState(
  personRecord: PersonRecord | null | undefined,
): personRecord is PersonRecord & {
  rawTmdbPerson: NonNullable<PersonRecord["rawTmdbPerson"]>;
  rawTmdbMovieCreditsResponse: NonNullable<PersonRecord["rawTmdbMovieCreditsResponse"]>;
} {
  if (!hasHydratedPersonRecord(personRecord) || !hasPersonMovieCredits(personRecord ?? null)) {
    return false;
  }

  const resolvedPersonRecord = personRecord!;
  return (
    getResolvedPersonMovieConnectionKeys(resolvedPersonRecord).length === 0 ||
    getAllowedConnectedTmdbMovieCredits(resolvedPersonRecord).length > 0
  );
}

export async function prefetchBestConnectionForYoungestSelectedCard(
  selectedCard: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null,
): Promise<void> {
  await measureAsync(
    "tmdb.prefetchBestConnectionForYoungestSelectedCard",
    async () => {
      if (!selectedCard || selectedCard.kind === "cinenerdle") {
        await syncDirectConnectionPrefetchQueues(null);
        return;
      }

      await syncDirectConnectionPrefetchQueues(selectedCard, {
        maxCandidateCount: 8,
      });

      if (selectedCard.kind === "movie") {
        const personCandidate = await selectNextPersonPrefetchCandidate({
          directOnly: true,
        });
        if (!personCandidate) {
          return;
        }

        await prefetchPopularPersonCandidate(personCandidate, {
          index: 1,
          total: 1,
        });
        return;
      }

      const movieCandidate = await selectNextMoviePrefetchCandidate({
        directOnly: true,
      });
      if (!movieCandidate) {
        return;
      }

      await prefetchPopularMovieCandidate(movieCandidate, {
        index: 1,
        total: 1,
      });
    },
    {
      always: true,
      details: {
        selectedCardKey: selectedCard?.key ?? "",
        selectedCardKind: selectedCard?.kind ?? "none",
      },
    },
  );
}

async function prefetchPopularMovieCandidate(
  candidate: PendingPopularMoviePrefetch,
  position: FetchLogPosition,
): Promise<void> {
  if (inFlightPopularMoviePrefetchKeys.has(candidate.key)) {
    return;
  }

  inFlightPopularMoviePrefetchKeys.add(candidate.key);

  try {
    const existingMovieRecord = await getExistingMovieRecordForPendingCandidate(candidate);
    if (hasMovieFullState(existingMovieRecord)) {
      return;
    }

    const resolvedMovieTmdbId = getValidTmdbEntityId(
      candidate.tmdbId ?? existingMovieRecord?.tmdbId ?? existingMovieRecord?.id,
    );
    if (existingMovieRecord) {
      if (!hasDirectTmdbMovieSource(existingMovieRecord) && resolvedMovieTmdbId) {
        await fetchAndCacheMovie(
          candidate.title,
          candidate.year,
          "prefetch",
          resolvedMovieTmdbId,
          {
            skipFollowOnPrefetch: true,
            logContext: {
              position,
              popularity: candidate.popularity,
            },
          },
        );
        return;
      }

      await fetchAndCacheMovieCredits(existingMovieRecord, "prefetch", {
        skipFollowOnPrefetch: true,
        logContext: {
          position,
          popularity: candidate.popularity,
        },
      });
      return;
    }

    if (resolvedMovieTmdbId) {
      await fetchAndCacheMovie(candidate.title, candidate.year, "prefetch", resolvedMovieTmdbId, {
        skipFollowOnPrefetch: true,
        logContext: {
          position,
          popularity: candidate.popularity,
        },
      });
      return;
    }
  } finally {
    inFlightPopularMoviePrefetchKeys.delete(candidate.key);
    await refreshPopularConnectionPrefetchQueues();
  }
}

async function prefetchPopularPersonCandidate(
  candidate: PendingPopularPersonPrefetch,
  position: FetchLogPosition,
): Promise<void> {
  if (inFlightPopularPersonPrefetchKeys.has(candidate.key)) {
    return;
  }

  inFlightPopularPersonPrefetchKeys.add(candidate.key);

  try {
    const existingPersonRecord = await getExistingPersonRecordForPendingCandidate(candidate);
    if (hasPersonFullState(existingPersonRecord)) {
      return;
    }

    if (candidate.tmdbId) {
      await fetchAndCachePerson(candidate.name, "prefetch", candidate.tmdbId, {
        skipFollowOnPrefetch: true,
        logContext: {
          position,
          popularity: candidate.popularity,
        },
      });
    }
  } finally {
    inFlightPopularPersonPrefetchKeys.delete(candidate.key);
    await refreshPopularConnectionPrefetchQueues();
  }
}

export async function prefetchTopPopularUnhydratedConnections(
  selectedCard: SelectedPrefetchCard | null = null,
): Promise<void> {
  if (prefetchTopPopularUnhydratedConnectionsPromise) {
    return prefetchTopPopularUnhydratedConnectionsPromise;
  }

  prefetchTopPopularUnhydratedConnectionsPromise = measureAsync(
    "tmdb.prefetchTopPopularUnhydratedConnections",
    async () => {
      await Promise.all([
        syncPopularConnectionPrefetchQueues(),
        syncDirectConnectionPrefetchQueues(selectedCard),
      ]);

      let moviesToPrefetch = (
        await Promise.all(
          Array.from({ length: POPULAR_CONNECTION_PREFETCH_COUNT }, () =>
            selectNextMoviePrefetchCandidate(),
          ),
        )
      ).filter((candidate): candidate is PendingPopularMoviePrefetch => candidate !== null);
      let peopleToPrefetch = (
        await Promise.all(
          Array.from({ length: POPULAR_CONNECTION_PREFETCH_COUNT }, () =>
            selectNextPersonPrefetchCandidate(),
          ),
        )
      ).filter((candidate): candidate is PendingPopularPersonPrefetch => candidate !== null);

      await Promise.allSettled([
        ...moviesToPrefetch.map((candidate, index) => prefetchPopularMovieCandidate(candidate, {
          index: index + 1,
          total: moviesToPrefetch.length,
        })),
        ...peopleToPrefetch.map((candidate, index) => prefetchPopularPersonCandidate(candidate, {
          index: index + 1,
          total: peopleToPrefetch.length,
        })),
      ]);

      if (moviesToPrefetch.length > 0 && peopleToPrefetch.length > 0) {
        return;
      }

      await Promise.all([
        syncPopularConnectionPrefetchQueues(),
        syncDirectConnectionPrefetchQueues(selectedCard),
      ]);
      moviesToPrefetch = moviesToPrefetch.length > 0
        ? []
        : (
          await Promise.all(
            Array.from({ length: POPULAR_CONNECTION_PREFETCH_COUNT }, () =>
              selectNextMoviePrefetchCandidate(),
            ),
          )
        ).filter((candidate): candidate is PendingPopularMoviePrefetch => candidate !== null);
      peopleToPrefetch = peopleToPrefetch.length > 0
        ? []
        : (
          await Promise.all(
            Array.from({ length: POPULAR_CONNECTION_PREFETCH_COUNT }, () =>
              selectNextPersonPrefetchCandidate(),
            ),
          )
        ).filter((candidate): candidate is PendingPopularPersonPrefetch => candidate !== null);

      await Promise.allSettled([
        ...moviesToPrefetch.map((candidate, index) => prefetchPopularMovieCandidate(candidate, {
          index: index + 1,
          total: moviesToPrefetch.length,
        })),
        ...peopleToPrefetch.map((candidate, index) => prefetchPopularPersonCandidate(candidate, {
          index: index + 1,
          total: peopleToPrefetch.length,
        })),
      ]);
    },
    {
      always: true,
      summarizeResult: () => ({
        pendingDirectMovieCount: pendingDirectMoviePrefetchQueue.length,
        pendingDirectPersonCount: pendingDirectPersonPrefetchQueue.length,
        pendingMovieCount: pendingPopularMoviePrefetchQueue.length,
        pendingPersonCount: pendingPopularPersonPrefetchQueue.length,
      }),
    },
  ).finally(() => {
    prefetchTopPopularUnhydratedConnectionsPromise = null;
  });

  return prefetchTopPopularUnhydratedConnectionsPromise;
}

export async function prepareSelectedPerson(
  personName: string,
  personId?: number | null,
  options: PrepareSelectedOptions = {},
): Promise<PersonRecord | null> {
  const preparationKey = getSelectedPersonPreparationKey(personName, personId);
  const existingPreparation = inFlightSelectedPersonPreparations.get(preparationKey);
  if (existingPreparation) {
    return existingPreparation;
  }

  const preparationPromise = measureAsync(
    "tmdb.prepareSelectedPerson",
    async () => {
      const localPersonRecord = await getLocalPersonRecordForCard(personName, personId);
      if (hasPersonFullState(localPersonRecord) && !options.forceRefresh) {
        return localPersonRecord;
      }

      if (options.forceRefresh) {
        const refreshedPersonRecord = await batchCinenerdleRecordsUpdatedEvents(() =>
          fetchAndCachePerson(
            personName,
            "fetch",
            personId ?? localPersonRecord?.tmdbId ?? localPersonRecord?.id ?? null,
            {
              skipFollowOnPrefetch: true,
            },
          ),
        );
        return refreshedPersonRecord ?? localPersonRecord;
      }

      const fetchedPersonRecord = await fetchAndCachePerson(
        personName,
        "fetch",
        personId ?? localPersonRecord?.tmdbId ?? localPersonRecord?.id ?? null,
      );
      return fetchedPersonRecord ?? localPersonRecord;
    },
    {
      always: true,
      details: {
        forceRefresh: options.forceRefresh ?? false,
        personId,
        personName,
      },
      summarizeResult: (personRecord) => ({
        hit: Boolean(personRecord),
      }),
    },
  ).finally(() => {
    if (inFlightSelectedPersonPreparations.get(preparationKey) === preparationPromise) {
      inFlightSelectedPersonPreparations.delete(preparationKey);
    }
  });

  inFlightSelectedPersonPreparations.set(preparationKey, preparationPromise);
  return preparationPromise;
}

export async function prepareSelectedMovie(
  movieName: string,
  movieYear = "",
  movieId?: number | string | null,
  options: PrepareSelectedOptions = {},
): Promise<FilmRecord | null> {
  const preparationKey = getSelectedMoviePreparationKey(movieName, movieYear, movieId);
  const existingPreparation = inFlightSelectedMoviePreparations.get(preparationKey);
  if (existingPreparation) {
    return existingPreparation;
  }

  const preparationPromise = measureAsync(
    "tmdb.prepareSelectedMovie",
    async () => {
      const localMovieRecord = await getLocalMovieRecordForCard(
        movieName,
        movieYear,
        movieId,
      );
      if (hasMovieFullState(localMovieRecord) && !options.forceRefresh) {
        return localMovieRecord;
      }

      if (options.forceRefresh) {
        const refreshedMovieRecord = await batchCinenerdleRecordsUpdatedEvents(() => {
          const resolvedMovieTmdbId = getValidTmdbEntityId(
            movieId ?? localMovieRecord?.tmdbId ?? localMovieRecord?.id,
          );
          if (resolvedMovieTmdbId) {
            return fetchAndCacheMovieById(resolvedMovieTmdbId, {
              movieName,
              movieYear,
              reason: "fetch",
              skipFollowOnPrefetch: true,
            });
          }

          if (localMovieRecord) {
            return fetchAndCacheMovieCredits(
              localMovieRecord,
              "fetch",
              {
                skipFollowOnPrefetch: true,
              },
            );
          }

          return Promise.resolve(null);
        });
        return refreshedMovieRecord ?? localMovieRecord;
      }

      if (localMovieRecord) {
        const localMovieTmdbId = getValidTmdbEntityId(
          localMovieRecord.tmdbId ?? localMovieRecord.id,
        );
        if (!hasDirectTmdbMovieSource(localMovieRecord) && localMovieTmdbId) {
          const fetchedMovieRecord = await fetchAndCacheMovie(
            localMovieRecord.title,
            localMovieRecord.year,
            "fetch",
            localMovieTmdbId,
          );
          return fetchedMovieRecord;
        }

        const hydratedMovieRecord = await fetchAndCacheMovieCredits(
          localMovieRecord,
          "fetch",
        );
        return hydratedMovieRecord;
      }

      return null;
    },
    {
      always: true,
      details: {
        forceRefresh: options.forceRefresh ?? false,
        movieId,
        movieName,
        movieYear,
      },
      summarizeResult: (filmRecord) => ({
        hit: Boolean(filmRecord),
      }),
    },
  ).finally(() => {
    if (inFlightSelectedMoviePreparations.get(preparationKey) === preparationPromise) {
      inFlightSelectedMoviePreparations.delete(preparationKey);
    }
  });

  inFlightSelectedMoviePreparations.set(preparationKey, preparationPromise);
  return preparationPromise;
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

function getValidConnectionPersonRecord(personRecord: PersonRecord | null): PersonRecord | null {
  if (!personRecord) {
    return null;
  }

  return getResolvedPersonMovieConnectionKeys(personRecord).length > 0
    ? personRecord
    : null;
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
  return measureAsync(
    "tmdb.resolveConnectionQuery",
    async () => {
      const normalizedQuery = normalizeWhitespace(query);
      if (!normalizedQuery) {
        return null;
      }

      if (normalizeTitle(normalizedQuery) === "cinenerdle") {
        return {
          kind: "cinenerdle",
          name: "cinenerdle",
          year: "",
        };
      }

      const parsedMovie = parseMoviePathLabel(normalizedQuery);
      const searchRecords = await getAllSearchableConnectionEntities();
      const exactPersonRecord = getValidConnectionPersonRecord(
        await getPersonRecordByName(normalizedQuery),
      );
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
      const localTarget = pickBestConnectionTarget(
        normalizedQuery,
        exactMovieRecord?.title ?? parsedMovie.name,
        exactMovieRecord?.year ?? parsedMovie.year,
        exactPersonRecord,
        exactMovieRecord,
      );

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

        if (personEntity && personEntity.connectionCount > 0) {
          return {
            kind: "person",
            name: personEntity.name,
            tmdbId: personEntity.tmdbId,
          };
        }
      }

      return localTarget;
    },
    {
      always: true,
      details: {
        query,
      },
      summarizeResult: (target) => ({
        resolvedKind: target?.kind ?? "none",
      }),
    },
  );
}

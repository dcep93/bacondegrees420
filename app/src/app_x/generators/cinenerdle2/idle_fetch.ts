import {
  getMovieConnectionEntityKey,
  getPersonConnectionEntityKey,
  hydrateConnectionEntityFromSearchRecord,
} from "./connection_graph";
import {
  getAllSearchableConnectionEntities,
  getFilmRecordById,
  getFilmRecordByTitleAndYear,
  getIndexedDbSnapshot,
  getPersonRecordById,
  getPersonRecordByName,
  inflateIndexedDbSnapshot,
} from "./indexed_db";
import {
  fetchAndCacheMovie,
  fetchAndCacheMovieCredits,
  fetchAndCachePerson,
} from "./tmdb";
import type {
  FilmRecord,
  PersonRecord,
  SearchableConnectionEntityRecord,
} from "./types";
import { hasDirectTmdbMovieSource, hasDirectTmdbPersonSource } from "./tmdb_provenance";
import { getValidTmdbEntityId } from "./utils";

const IDLE_FETCH_INTERVAL_MS = 1000;
const IDLE_FETCH_TYPES = ["person", "movie"] as const;

type IdleFetchEntityType = (typeof IDLE_FETCH_TYPES)[number];

type IdleFetchState = "starting" | "running" | "completed" | "stopped";

type IdleFetchRun = {
  activeKeys: Record<IdleFetchEntityType, string | null>;
  failedKeys: Set<string>;
  lastError: string | null;
  lastFetchedKeys: Record<IdleFetchEntityType, string | null>;
  pendingByType: Record<IdleFetchEntityType, Map<string, SearchableConnectionEntityRecord>>;
  pendingKeysByType: Record<IdleFetchEntityType, string[]>;
  processedKeys: Set<string>;
  processing: boolean;
  searchRecordKeys: Set<string>;
  state: IdleFetchState;
  stopped: boolean;
  timerId: number | null;
};

export type IdleFetchStatus = {
  activeKeys: string[];
  failedCount: number;
  lastError: string | null;
  lastFetchedKeys: string[];
  pendingCount: number;
  pendingMovieCount: number;
  pendingPersonCount: number;
  processedCount: number;
  state: IdleFetchState;
};

export type IdleFetchHandle = {
  getStatus: () => IdleFetchStatus;
  stop: () => IdleFetchStatus;
};

let activeIdleFetchRun: IdleFetchRun | null = null;

function compareIdleFetchRecords(
  left: SearchableConnectionEntityRecord,
  right: SearchableConnectionEntityRecord,
): number {
  const popularityDifference = (right.popularity ?? 0) - (left.popularity ?? 0);
  if (popularityDifference !== 0) {
    return popularityDifference;
  }

  if (left.type !== right.type) {
    return left.type === "person" ? -1 : 1;
  }

  return left.nameLower.localeCompare(right.nameLower);
}

function createIdleFetchRecordBuckets<T>(factory: () => T): Record<IdleFetchEntityType, T> {
  return {
    movie: factory(),
    person: factory(),
  };
}

function getIdleFetchPendingCount(run: IdleFetchRun): number {
  return run.pendingKeysByType.person.length + run.pendingKeysByType.movie.length;
}

function getIdleFetchStatus(run: IdleFetchRun): IdleFetchStatus {
  return {
    activeKeys: IDLE_FETCH_TYPES
      .map((type) => run.activeKeys[type])
      .filter((key): key is string => Boolean(key)),
    failedCount: run.failedKeys.size,
    lastError: run.lastError,
    lastFetchedKeys: IDLE_FETCH_TYPES
      .map((type) => run.lastFetchedKeys[type])
      .filter((key): key is string => Boolean(key)),
    pendingCount: getIdleFetchPendingCount(run),
    pendingMovieCount: run.pendingKeysByType.movie.length,
    pendingPersonCount: run.pendingKeysByType.person.length,
    processedCount: run.processedKeys.size,
    state: run.state,
  };
}

function createIdleFetchHandle(run: IdleFetchRun): IdleFetchHandle {
  return {
    getStatus: () => getIdleFetchStatus(run),
    stop: () => {
      stopIdleFetchRun(run, "stopped");
      return getIdleFetchStatus(run);
    },
  };
}

function rebuildIdleFetchPendingKeys(
  run: IdleFetchRun,
  type: IdleFetchEntityType,
): void {
  run.pendingKeysByType[type] = Array.from(run.pendingByType[type].values())
    .sort(compareIdleFetchRecords)
    .map((record) => record.key);
}

function stopIdleFetchRun(run: IdleFetchRun, state: Extract<IdleFetchState, "completed" | "stopped">): void {
  if (run.timerId !== null) {
    window.clearInterval(run.timerId);
    run.timerId = null;
  }

  run.stopped = true;
  run.state = state;

  if (activeIdleFetchRun === run) {
    activeIdleFetchRun = null;
  }
}

function isCompleteMovieRecord(filmRecord: FilmRecord | null | undefined): boolean {
  return Boolean(hasDirectTmdbMovieSource(filmRecord) && filmRecord?.rawTmdbMovieCreditsResponse);
}

function isCompletePersonRecord(personRecord: PersonRecord | null | undefined): boolean {
  return Boolean(hasDirectTmdbPersonSource(personRecord) && personRecord?.rawTmdbMovieCreditsResponse);
}

function getInitialFullyCachedKeys(snapshot: ReturnType<typeof inflateIndexedDbSnapshot>): Set<string> {
  const fullyCachedKeys = new Set<string>();

  snapshot.people.forEach((personRecord) => {
    if (!isCompletePersonRecord(personRecord)) {
      return;
    }

    fullyCachedKeys.add(
      getPersonConnectionEntityKey(
        personRecord.name,
        personRecord.tmdbId ?? personRecord.id,
      ),
    );
  });

  snapshot.films.forEach((filmRecord) => {
    if (!isCompleteMovieRecord(filmRecord)) {
      return;
    }

    fullyCachedKeys.add(getMovieConnectionEntityKey(filmRecord.title, filmRecord.year));
  });

  return fullyCachedKeys;
}

function parseIdleFetchPersonKey(key: string): { tmdbId: number | null } {
  const rawValue = key.startsWith("person:") ? key.slice("person:".length) : key;

  return {
    tmdbId: getValidTmdbEntityId(rawValue),
  };
}

function parseIdleFetchMovieKey(key: string): { title: string; year: string } {
  const rawValue = key.startsWith("movie:") ? key.slice("movie:".length) : key;
  const lastColonIndex = rawValue.lastIndexOf(":");

  if (lastColonIndex < 0) {
    return {
      title: rawValue,
      year: "",
    };
  }

  return {
    title: rawValue.slice(0, lastColonIndex),
    year: rawValue.slice(lastColonIndex + 1),
  };
}

async function isSearchRecordFullyCached(
  searchRecord: SearchableConnectionEntityRecord,
): Promise<boolean> {
  if (searchRecord.type === "person") {
    const parsedPerson = parseIdleFetchPersonKey(searchRecord.key);
    const personRecord = parsedPerson.tmdbId
      ? await getPersonRecordById(parsedPerson.tmdbId)
      : await getPersonRecordByName(searchRecord.nameLower);

    return isCompletePersonRecord(personRecord);
  }

  const parsedMovie = parseIdleFetchMovieKey(searchRecord.key);
  const filmRecord =
    (await getFilmRecordByTitleAndYear(parsedMovie.title, parsedMovie.year)) ??
    null;

  return isCompleteMovieRecord(filmRecord);
}

async function mergeIdleFetchSearchRecords(
  run: IdleFetchRun,
  searchRecords: SearchableConnectionEntityRecord[],
): Promise<void> {
  const changedTypes = new Set<IdleFetchEntityType>();

  for (const searchRecord of searchRecords) {
    if (!searchRecord.key) {
      continue;
    }

    const queueType = searchRecord.type;
    const hasSeenRecord = run.searchRecordKeys.has(searchRecord.key);
    run.searchRecordKeys.add(searchRecord.key);

    if (run.processedKeys.has(searchRecord.key) || run.failedKeys.has(searchRecord.key)) {
      continue;
    }

    if (run.pendingByType[queueType].has(searchRecord.key)) {
      run.pendingByType[queueType].set(searchRecord.key, searchRecord);
      changedTypes.add(queueType);
      continue;
    }

    if (hasSeenRecord) {
      continue;
    }

    if (await isSearchRecordFullyCached(searchRecord)) {
      continue;
    }

    run.pendingByType[queueType].set(searchRecord.key, searchRecord);
    changedTypes.add(queueType);
  }

  changedTypes.forEach((type) => {
    rebuildIdleFetchPendingKeys(run, type);
  });
}

async function fetchIdleFetchSearchRecord(
  searchRecord: SearchableConnectionEntityRecord,
): Promise<boolean> {
  const entity = await hydrateConnectionEntityFromSearchRecord(searchRecord);

  if (entity.kind === "person") {
    const existingPersonRecord = entity.tmdbId
      ? await getPersonRecordById(entity.tmdbId)
      : await getPersonRecordByName(searchRecord.nameLower);

    if (isCompletePersonRecord(existingPersonRecord)) {
      return false;
    }

    const fetchedPersonRecord = await fetchAndCachePerson(
      entity.name,
      "prefetch",
      entity.tmdbId,
    );

    return Boolean(fetchedPersonRecord);
  }

  if (entity.kind !== "movie") {
    return false;
  }

  const existingMovieRecord =
    (entity.tmdbId ? await getFilmRecordById(entity.tmdbId) : null) ??
    (await getFilmRecordByTitleAndYear(entity.name, entity.year));

  if (isCompleteMovieRecord(existingMovieRecord)) {
    return false;
  }

  if (existingMovieRecord) {
    const fetchedMovieRecord = await fetchAndCacheMovieCredits(
      existingMovieRecord,
      "prefetch",
    );
    return Boolean(fetchedMovieRecord);
  }

  const fetchedMovieRecord = await fetchAndCacheMovie(
    entity.name,
    entity.year,
    "prefetch",
    entity.tmdbId,
  );

  return Boolean(fetchedMovieRecord);
}

async function dequeueNextPendingRecord(
  run: IdleFetchRun,
  type: IdleFetchEntityType,
): Promise<SearchableConnectionEntityRecord | null> {
  while (!run.stopped) {
    const nextKey = run.pendingKeysByType[type].shift() ?? null;
    if (!nextKey) {
      return null;
    }

    const nextRecord = run.pendingByType[type].get(nextKey) ?? null;
    if (!nextRecord) {
      continue;
    }

    run.pendingByType[type].delete(nextKey);

    if (await isSearchRecordFullyCached(nextRecord)) {
      run.processedKeys.add(nextKey);
      continue;
    }

    return nextRecord;
  }

  return null;
}

async function processIdleFetchRecord(
  run: IdleFetchRun,
  searchRecord: SearchableConnectionEntityRecord,
): Promise<void> {
  run.activeKeys[searchRecord.type] = searchRecord.key;
  const didFetch = await fetchIdleFetchSearchRecord(searchRecord);
  run.activeKeys[searchRecord.type] = null;
  run.lastFetchedKeys[searchRecord.type] = searchRecord.key;

  if (didFetch) {
    run.processedKeys.add(searchRecord.key);
    return;
  }

  run.failedKeys.add(searchRecord.key);
}

async function processNextIdleFetchTick(run: IdleFetchRun): Promise<void> {
  if (run.processing || run.stopped || run.state !== "running") {
    return;
  }

  run.processing = true;

  try {
    const [nextPersonRecord, nextMovieRecord] = await Promise.all([
      dequeueNextPendingRecord(run, "person"),
      dequeueNextPendingRecord(run, "movie"),
    ]);

    if (!nextPersonRecord && !nextMovieRecord) {
      stopIdleFetchRun(run, "completed");
      return;
    }

    await Promise.all([
      nextPersonRecord ? processIdleFetchRecord(run, nextPersonRecord) : Promise.resolve(),
      nextMovieRecord ? processIdleFetchRecord(run, nextMovieRecord) : Promise.resolve(),
    ]);

    await mergeIdleFetchSearchRecords(
      run,
      await getAllSearchableConnectionEntities(),
    );
  } catch (error) {
    run.activeKeys.person = null;
    run.activeKeys.movie = null;
    run.lastError = error instanceof Error ? error.message : "Idle fetch failed";
    stopIdleFetchRun(run, "stopped");
  } finally {
    run.processing = false;
  }
}

async function initializeIdleFetchRun(run: IdleFetchRun): Promise<void> {
  try {
    const snapshot = inflateIndexedDbSnapshot(await getIndexedDbSnapshot());
    if (run.stopped) {
      return;
    }

    const fullyCachedKeys = getInitialFullyCachedKeys(snapshot);
    snapshot.searchableConnectionEntities.forEach((searchRecord) => {
      run.searchRecordKeys.add(searchRecord.key);
      if (fullyCachedKeys.has(searchRecord.key)) {
        return;
      }

      run.pendingByType[searchRecord.type].set(searchRecord.key, searchRecord);
    });
    rebuildIdleFetchPendingKeys(run, "person");
    rebuildIdleFetchPendingKeys(run, "movie");

    if (getIdleFetchPendingCount(run) === 0) {
      stopIdleFetchRun(run, "completed");
      return;
    }

    run.state = "running";
    run.timerId = window.setInterval(() => {
      void processNextIdleFetchTick(run);
    }, IDLE_FETCH_INTERVAL_MS);
  } catch (error) {
    run.lastError = error instanceof Error ? error.message : "Idle fetch failed";
    stopIdleFetchRun(run, "stopped");
  }
}

export function startIdleFetch(): IdleFetchHandle {
  if (activeIdleFetchRun) {
    return createIdleFetchHandle(activeIdleFetchRun);
  }

  const run: IdleFetchRun = {
    activeKeys: createIdleFetchRecordBuckets(() => null),
    failedKeys: new Set(),
    lastError: null,
    lastFetchedKeys: createIdleFetchRecordBuckets(() => null),
    pendingByType: createIdleFetchRecordBuckets(() => new Map()),
    pendingKeysByType: createIdleFetchRecordBuckets(() => []),
    processedKeys: new Set(),
    processing: false,
    searchRecordKeys: new Set(),
    state: "starting",
    stopped: false,
    timerId: null,
  };

  activeIdleFetchRun = run;
  void initializeIdleFetchRun(run);
  return createIdleFetchHandle(run);
}

import {
  FILMS_STORE_NAME,
  INDEXED_DB_NAME,
  INDEXED_DB_METADATA_STORE_NAME,
  INDEXED_DB_VERSION,
  PEOPLE_STORE_NAME,
  SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
} from "./constants";
import { createDailyStarterFilmRecordFromTitle } from "./cards";
import {
  buildPersonRecordFromFilmCredit,
  chooseNewestFetchTimestamp,
  chooseBestFilmRecord,
  mergeFetchedFieldValue,
  mergePersonRecords,
  pickBestPersonRecord,
  getResolvedPersonMovieConnectionKeys,
  shouldPreferNextFetchedField,
} from "./records";
import {
  hasDirectTmdbMovieSource,
  hasDirectTmdbPersonSource,
} from "./tmdb_provenance";
import { readCinenerdleDailyStarterTitles } from "./starter_storage";
import type {
  FilmRecord,
  PersonRecord,
  SearchableConnectionEntityRecord,
  TmdbMovieCredit,
  TmdbMovieCreditsResponse,
  TmdbMovieSearchResult,
  TmdbPersonCredit,
  TmdbPersonMovieCreditsResponse,
  TmdbPersonSearchResult,
} from "./types";
import {
  getCinenerdleMovieId,
  getCinenerdlePersonId,
  formatMoviePathLabel,
  getValidTmdbEntityId,
  getAssociatedPeopleFromMovieCredits,
  getAssociatedPeopleFromMovieCreditsForSnapshot,
  getAllowedConnectedTmdbMovieCredits,
  getFilmKey,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  normalizeName,
  parseMoviePathLabel,
  normalizeTitle,
  normalizeWhitespace,
} from "./utils";
import { measureAsync } from "../../perf";
import {
  resetCinenerdleValidationAlertState,
  throwCinenerdleValidationError,
} from "./validation";

const REQUIRED_OBJECT_STORE_NAMES = [
  PEOPLE_STORE_NAME,
  FILMS_STORE_NAME,
  SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
  INDEXED_DB_METADATA_STORE_NAME,
] as const;

export const CINENERDLE_RECORDS_UPDATED_EVENT = "cinenerdle:records-updated";
export const CINENERDLE_INDEXED_DB_FETCH_COUNT_UPDATED_EVENT =
  "cinenerdle:indexed-db-fetch-count-updated";
const INDEXED_DB_SNAPSHOT_VERSION = 9 as const;
const INDEXED_DB_FETCH_COUNT_KEY = "tmdbFetchCount";

type StoredPersonRecord = IndexedDbSnapshotPerson;
type StoredFilmRecord = IndexedDbSnapshotFilm;
type IndexedDbMetadataRecord = {
  key: string;
  value: number;
};

const personRecordByIdCache = new Map<number, PersonRecord>();
const personRecordByNameCache = new Map<string, PersonRecord>();
const missingPersonRecordIdsCache = new Set<number>();
const missingPersonRecordNamesCache = new Set<string>();
const filmRecordByIdCache = new Map<string, FilmRecord>();
const filmRecordQueryCache = new Map<string, FilmRecord | null>();
let allPersonRecordsCache: PersonRecord[] | null = null;
let allFilmRecordsCache: FilmRecord[] | null = null;
const personCountByMovieKeyCache = new Map<string, number>();
const filmCountByPersonNameCache = new Map<string, number>();
const personPopularityByNameCache = new Map<string, number>();
const moviePopularityByLabelCache = new Map<string, number>();
const searchableConnectionEntityByKeyCache = new Map<string, SearchableConnectionEntityRecord>();
let allSearchableConnectionEntitiesCache: SearchableConnectionEntityRecord[] | null = null;
let coreRecordCachesReadyPromise: Promise<void> | null = null;
let indexedDbPromise: Promise<IDBDatabase> | null = null;
let indexedDbConnection: IDBDatabase | null = null;
let indexedDbFetchCountCache: number | null = null;
let cinenerdleRecordsUpdatedDispatchSuspensionCount = 0;
let hasPendingCinenerdleRecordsUpdatedDispatch = false;
let searchableConnectionEntityPersistencePromise: Promise<SearchableConnectionEntityRecord[]> | null =
  null;

type SearchableConnectionEntityPersistencePhase =
  | "idle"
  | "persisting-base"
  | "flushing-deferred";

export type SearchableConnectionEntityPersistenceStatus = {
  isPending: boolean;
  phase: SearchableConnectionEntityPersistencePhase;
};

type SearchableConnectionEntityPersistenceEvent = {
  event: string;
  details?: Record<string, unknown>;
};

const SEARCHABLE_CONNECTION_ENTITY_PERSISTENCE_READY_STORAGE_KEY =
  "cinenerdle:searchable-connection-entities-ready";
let searchableConnectionEntityPersistenceStatus: SearchableConnectionEntityPersistenceStatus = {
  isPending: false,
  phase: "idle",
};
const searchableConnectionEntityPersistenceListeners =
  new Set<(status: SearchableConnectionEntityPersistenceStatus) => void>();
const searchableConnectionEntityPersistenceEventListeners =
  new Set<(event: SearchableConnectionEntityPersistenceEvent) => void>();
const SEARCHABLE_CONNECTION_ENTITY_PERSISTENCE_BATCH_SIZE = 250;

function getIndexedDbPerfNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function roundIndexedDbElapsedMs(value: number): number {
  return Number(value.toFixed(2));
}

function queueIndexedDbStoreWrites<RecordType>(
  store: IDBObjectStore,
  records: RecordType[],
): void {
  for (const record of records) {
    store.put(record);
  }
}

function setSearchableConnectionEntityPersistenceStatus(
  nextStatus: SearchableConnectionEntityPersistenceStatus,
): void {
  if (
    searchableConnectionEntityPersistenceStatus.isPending === nextStatus.isPending &&
    searchableConnectionEntityPersistenceStatus.phase === nextStatus.phase
  ) {
    return;
  }

  searchableConnectionEntityPersistenceStatus = nextStatus;
  searchableConnectionEntityPersistenceListeners.forEach((listener) => {
    listener(nextStatus);
  });
}

export function subscribeSearchableConnectionEntityPersistenceStatus(
  listener: (status: SearchableConnectionEntityPersistenceStatus) => void,
): () => void {
  searchableConnectionEntityPersistenceListeners.add(listener);
  listener(searchableConnectionEntityPersistenceStatus);

  return () => {
    searchableConnectionEntityPersistenceListeners.delete(listener);
  };
}

export function subscribeSearchableConnectionEntityPersistenceEvents(
  listener: (event: SearchableConnectionEntityPersistenceEvent) => void,
): () => void {
  searchableConnectionEntityPersistenceEventListeners.add(listener);

  return () => {
    searchableConnectionEntityPersistenceEventListeners.delete(listener);
  };
}

export function getSearchableConnectionEntityPersistenceStatus(): SearchableConnectionEntityPersistenceStatus {
  return searchableConnectionEntityPersistenceStatus;
}

function emitSearchableConnectionEntityPersistenceEvent(
  event: string,
  details?: Record<string, unknown>,
): void {
  const nextEvent = {
    event,
    details,
  };

  searchableConnectionEntityPersistenceEventListeners.forEach((listener) => {
    listener(nextEvent);
  });
}

function canUseSearchableConnectionEntityPersistenceStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function writeSearchableConnectionEntityPersistenceReadyMarker(isReady: boolean): void {
  if (!canUseSearchableConnectionEntityPersistenceStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      SEARCHABLE_CONNECTION_ENTITY_PERSISTENCE_READY_STORAGE_KEY,
      isReady ? "1" : "0",
    );
  } catch {
    // Best-effort only.
  }
}

function clearSearchableConnectionEntityPersistenceReadyMarker(): void {
  if (!canUseSearchableConnectionEntityPersistenceStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(SEARCHABLE_CONNECTION_ENTITY_PERSISTENCE_READY_STORAGE_KEY);
  } catch {
    // Best-effort only.
  }
}

export function getSearchableConnectionEntityPersistenceReadyMarkerValue(): string | null {
  if (!canUseSearchableConnectionEntityPersistenceStorage()) {
    return null;
  }

  try {
    return window.localStorage.getItem(SEARCHABLE_CONNECTION_ENTITY_PERSISTENCE_READY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getFilmCacheIdKey(id: number | string): string {
  return String(id);
}

function getFilmQueryCacheKey(title: string, year = ""): string {
  const normalizedTitle = normalizeTitle(title);
  return year
    ? `title-year:${normalizedTitle}:${year.trim()}`
    : `title:${normalizedTitle}`;
}

function createStoredPersonRecord(
  personRecord: PersonRecord,
): StoredPersonRecord {
  return createPersonSnapshotFromPersonRecord(personRecord);
}

function createStoredFilmRecord(
  filmRecord: FilmRecord,
): StoredFilmRecord {
  return createSnapshotFilmRecord(
    filmRecord,
    getAssociatedPeopleFromMovieCredits(filmRecord),
    new Map<number, IndexedDbSnapshotPerson>(),
  );
}

function clearInMemoryIndexedDbCaches(): void {
  personRecordByIdCache.clear();
  personRecordByNameCache.clear();
  missingPersonRecordIdsCache.clear();
  missingPersonRecordNamesCache.clear();
  filmRecordByIdCache.clear();
  filmRecordQueryCache.clear();
  allPersonRecordsCache = null;
  allFilmRecordsCache = null;
  personCountByMovieKeyCache.clear();
  filmCountByPersonNameCache.clear();
  personPopularityByNameCache.clear();
  moviePopularityByLabelCache.clear();
  searchableConnectionEntityByKeyCache.clear();
  allSearchableConnectionEntitiesCache = null;
  coreRecordCachesReadyPromise = null;
  indexedDbFetchCountCache = null;
}

function normalizeIndexedDbFetchCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function dispatchIndexedDbFetchCountUpdated(): void {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function"
  ) {
    return;
  }

  window.dispatchEvent(new Event(CINENERDLE_INDEXED_DB_FETCH_COUNT_UPDATED_EVENT));
}

function setIndexedDbFetchCountCache(nextCount: number | null): void {
  const normalizedNextCount =
    nextCount === null ? null : normalizeIndexedDbFetchCount(nextCount);

  if (indexedDbFetchCountCache === normalizedNextCount) {
    return;
  }

  indexedDbFetchCountCache = normalizedNextCount;
  if (normalizedNextCount !== null) {
    dispatchIndexedDbFetchCountUpdated();
  }
}

function resetSearchableConnectionEntityPersistenceState(): void {
  searchableConnectionEntityPersistencePromise = null;
  setSearchableConnectionEntityPersistenceStatus({
    isPending: false,
    phase: "idle",
  });
  clearSearchableConnectionEntityPersistenceReadyMarker();
}

function cachePersonRecord(personRecord: PersonRecord | null | undefined): void {
  if (!personRecord) {
    return;
  }

  const recordId = getValidTmdbEntityId(personRecord.id);
  const recordTmdbId = getValidTmdbEntityId(personRecord.tmdbId);
  const normalizedName = normalizeName(personRecord.name);

  if (recordId) {
    personRecordByIdCache.set(recordId, personRecord);
    missingPersonRecordIdsCache.delete(recordId);
  }

  if (recordTmdbId) {
    personRecordByIdCache.set(recordTmdbId, personRecord);
    missingPersonRecordIdsCache.delete(recordTmdbId);
  }

  if (normalizedName) {
    personRecordByNameCache.set(normalizedName, personRecord);
    missingPersonRecordNamesCache.delete(normalizedName);
  }
}

function cacheFilmRecord(filmRecord: FilmRecord | null | undefined): void {
  if (!filmRecord) {
    return;
  }

  if (filmRecord.id !== null && filmRecord.id !== undefined && filmRecord.id !== "") {
    filmRecordByIdCache.set(getFilmCacheIdKey(filmRecord.id), filmRecord);
  }

  if (
    filmRecord.tmdbId !== null &&
    filmRecord.tmdbId !== undefined
  ) {
    filmRecordByIdCache.set(getFilmCacheIdKey(filmRecord.tmdbId), filmRecord);
  }

  const normalizedTitle = normalizeTitle(filmRecord.title);
  if (!normalizedTitle) {
    return;
  }

  filmRecordQueryCache.set(
    getFilmQueryCacheKey(normalizedTitle, filmRecord.year),
    filmRecord,
  );
}

function rebuildConnectionCountCaches(
  people: PersonRecord[],
  films: FilmRecord[],
): void {
  personCountByMovieKeyCache.clear();
  filmCountByPersonNameCache.clear();

  people.forEach((personRecord) => {
    personRecord.movieConnectionKeys.forEach((movieKey) => {
      if (!movieKey) {
        return;
      }
      personCountByMovieKeyCache.set(
        movieKey,
        (personCountByMovieKeyCache.get(movieKey) ?? 0) + 1,
      );
    });
  });

  films.forEach((filmRecord) => {
    filmRecord.personConnectionKeys.forEach((personName) => {
      if (!personName) {
        return;
      }
      filmCountByPersonNameCache.set(
        personName,
        (filmCountByPersonNameCache.get(personName) ?? 0) + 1,
      );
    });
  });
}

function replaceCachedCoreRecords(snapshot: LiveIndexedDbCoreSnapshot): void {
  clearInMemoryIndexedDbCaches();
  allPersonRecordsCache = snapshot.people;
  allFilmRecordsCache = snapshot.films;
  snapshot.people.forEach((personRecord) => {
    cachePersonRecord(personRecord);
  });
  snapshot.films.forEach((filmRecord) => {
    cacheFilmRecord(filmRecord);
  });
  rebuildConnectionCountCaches(snapshot.people, snapshot.films);
}

function cacheSearchableConnectionEntities(
  records: SearchableConnectionEntityRecord[],
): void {
  if (records.length === 0) {
    return;
  }

  const cachedRecordsByKey = new Map<string, SearchableConnectionEntityRecord>();
  if (allSearchableConnectionEntitiesCache) {
    allSearchableConnectionEntitiesCache.forEach((record) => {
      cachedRecordsByKey.set(record.key, record);
    });
  }

  records.forEach((record) => {
    const existingRecord =
      cachedRecordsByKey.get(record.key) ??
      searchableConnectionEntityByKeyCache.get(record.key);
    const nextRecord = existingRecord
      ? {
        ...existingRecord,
        ...record,
        popularity: Math.max(existingRecord.popularity ?? 0, record.popularity ?? 0),
      }
      : record;

    searchableConnectionEntityByKeyCache.set(nextRecord.key, nextRecord);
    cachedRecordsByKey.set(nextRecord.key, nextRecord);
  });

  if (allSearchableConnectionEntitiesCache) {
    allSearchableConnectionEntitiesCache = Array.from(cachedRecordsByKey.values());
  }
}

function replaceCachedSearchableConnectionEntities(
  records: SearchableConnectionEntityRecord[],
): SearchableConnectionEntityRecord[] {
  const mergedRecords = mergeSearchableConnectionEntityRecords(records);
  searchableConnectionEntityByKeyCache.clear();
  mergedRecords.forEach((record) => {
    searchableConnectionEntityByKeyCache.set(record.key, record);
  });
  allSearchableConnectionEntitiesCache = mergedRecords;
  clearSearchableConnectionPopularityCaches();
  return mergedRecords;
}

function removeCachedSearchableConnectionEntity(key: string): void {
  if (!key) {
    return;
  }

  searchableConnectionEntityByKeyCache.delete(key);
  if (!allSearchableConnectionEntitiesCache) {
    return;
  }

  allSearchableConnectionEntitiesCache = allSearchableConnectionEntitiesCache.filter(
    (record) => record.key !== key,
  );
}

function clearSearchableConnectionPopularityCaches(): void {
  personPopularityByNameCache.clear();
  moviePopularityByLabelCache.clear();
}

function invalidateSearchableConnectionPopularityCachesForRecords(
  records: SearchableConnectionEntityRecord[],
): void {
  records.forEach((record) => {
    if (record.type === "person") {
      personPopularityByNameCache.delete(record.nameLower);
      return;
    }

    moviePopularityByLabelCache.delete(record.nameLower);
  });
}

function setConnectionCountCacheValue(
  cache: Map<string, number>,
  key: string,
  nextCount: number,
): void {
  if (!key) {
    return;
  }

  if (nextCount > 0) {
    cache.set(key, nextCount);
    return;
  }

  cache.delete(key);
}

function updatePersonCountCacheForMovieKeys(movieKeys: Iterable<string>): void {
  if (!allPersonRecordsCache) {
    return;
  }

  Array.from(new Set(Array.from(movieKeys).map((movieKey) => normalizeTitle(movieKey)).filter(Boolean)))
    .forEach((movieKey) => {
      const nextCount = allPersonRecordsCache?.reduce((count, personRecord) =>
        count + Number(personRecord.movieConnectionKeys.includes(movieKey)), 0) ?? 0;
      setConnectionCountCacheValue(personCountByMovieKeyCache, movieKey, nextCount);
    });
}

function updateFilmCountCacheForPersonNames(personNames: Iterable<string>): void {
  if (!allFilmRecordsCache) {
    return;
  }

  Array.from(new Set(Array.from(personNames).map((personName) => normalizeName(personName)).filter(Boolean)))
    .forEach((personName) => {
      const nextCount = allFilmRecordsCache?.reduce((count, filmRecord) =>
        count + Number(filmRecord.personConnectionKeys.includes(personName)), 0) ?? 0;
      setConnectionCountCacheValue(filmCountByPersonNameCache, personName, nextCount);
    });
}

function resolveSearchableConnectionEntityRecordByKey(
  key: string,
): SearchableConnectionEntityRecord | null {
  if (!key) {
    return null;
  }

  let resolvedRecord: SearchableConnectionEntityRecord | null = null;
  const mergeCandidateRecord = (candidateRecord: SearchableConnectionEntityRecord | null): void => {
    if (!candidateRecord || candidateRecord.key !== key) {
      return;
    }

    resolvedRecord = resolvedRecord
      ? {
          ...resolvedRecord,
          ...candidateRecord,
          popularity: Math.max(
            resolvedRecord.popularity ?? 0,
            candidateRecord.popularity ?? 0,
          ),
        }
      : candidateRecord;
  };

  (allPersonRecordsCache ?? []).forEach((personRecord) => {
    collectSearchableConnectionEntitiesFromPersonRecord(personRecord).forEach((candidateRecord) => {
      mergeCandidateRecord(candidateRecord);
    });
  });
  (allFilmRecordsCache ?? []).forEach((filmRecord) => {
    collectSearchableConnectionEntitiesFromFilmRecord(filmRecord).forEach((candidateRecord) => {
      mergeCandidateRecord(candidateRecord);
    });
  });

  return resolvedRecord;
}

async function synchronizePersistedSearchableConnectionEntityKeys(
  keys: Iterable<string>,
): Promise<void> {
  const uniqueKeys = Array.from(new Set(Array.from(keys).filter(Boolean)));
  if (uniqueKeys.length === 0) {
    return;
  }

  await ensureCoreRecordCachesReady();

  const resolvedRecords = uniqueKeys
    .map((key) => resolveSearchableConnectionEntityRecordByKey(key))
    .filter((record): record is SearchableConnectionEntityRecord => record !== null);
  const resolvedRecordsByKey = new Map(
    resolvedRecords.map((record) => [record.key, record] as const),
  );

  await withStore(
    SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
    "readwrite",
    async (store) => {
      await Promise.all(
        uniqueKeys.map(async (key) => {
          const resolvedRecord = resolvedRecordsByKey.get(key);
          if (resolvedRecord) {
            await indexedDbRequestToPromise(store.put(resolvedRecord));
            return;
          }

          await indexedDbRequestToPromise(store.delete(key));
        }),
      );
    },
  );

  cacheSearchableConnectionEntities(resolvedRecords);
  uniqueKeys.forEach((key) => {
    if (!resolvedRecordsByKey.has(key)) {
      removeCachedSearchableConnectionEntity(key);
    }
  });
  writeSearchableConnectionEntityPersistenceReadyMarker(true);
}

function dispatchCinenerdleRecordsUpdated(): void {
  if (typeof window === "undefined") {
    return;
  }

  if (cinenerdleRecordsUpdatedDispatchSuspensionCount > 0) {
    hasPendingCinenerdleRecordsUpdatedDispatch = true;
    return;
  }

  window.dispatchEvent(new Event(CINENERDLE_RECORDS_UPDATED_EVENT));
}

function resetIndexedDbConnection(): void {
  indexedDbConnection?.close();
  indexedDbConnection = null;
  indexedDbPromise = null;
}

export async function deleteCinenerdleIndexedDbDatabase(): Promise<void> {
  resetSearchableConnectionEntityPersistenceState();
  clearInMemoryIndexedDbCaches();
  resetIndexedDbConnection();

  if (typeof indexedDB === "undefined") {
    setIndexedDbFetchCountCache(0);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(INDEXED_DB_NAME);

    deleteRequest.onsuccess = () => {
      resolve();
    };
    deleteRequest.onerror = () => {
      const error = deleteRequest.error ?? new Error("Unable to delete IndexedDB");
      reject(error);
    };
    deleteRequest.onblocked = () => {
      const error = new Error("IndexedDB deletion blocked. Close other tabs and try again.");
      reject(error);
    };
  });

  setIndexedDbFetchCountCache(0);
}

function flushPendingCinenerdleRecordsUpdated(): void {
  if (!hasPendingCinenerdleRecordsUpdatedDispatch) {
    return;
  }

  hasPendingCinenerdleRecordsUpdatedDispatch = false;
  dispatchCinenerdleRecordsUpdated();
}

export async function batchCinenerdleRecordsUpdatedEvents<T>(
  callback: () => Promise<T>,
): Promise<T> {
  cinenerdleRecordsUpdatedDispatchSuspensionCount += 1;

  try {
    return await callback();
  } finally {
    cinenerdleRecordsUpdatedDispatchSuspensionCount = Math.max(
      0,
      cinenerdleRecordsUpdatedDispatchSuspensionCount - 1,
    );

    if (cinenerdleRecordsUpdatedDispatchSuspensionCount === 0) {
      flushPendingCinenerdleRecordsUpdated();
    }
  }
}

function indexedDbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed"));
    };
  });
}

function transactionDonePromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    };
  });
}

function getConnectionMovieEntityKey(title: string, year = ""): string {
  return `movie:${normalizeTitle(title)}:${year.trim()}`;
}

function getConnectionPersonEntityKey(
  name: string,
  tmdbId?: number | string | null,
): string {
  const validTmdbId = getValidTmdbEntityId(tmdbId);
  return `person:${validTmdbId ?? normalizeName(name)}`;
}

function createSearchableConnectionEntityRecord(
  type: SearchableConnectionEntityRecord["type"],
  key: string,
  nameLower: string,
  popularity = 0,
): SearchableConnectionEntityRecord | null {
  const normalizedNameLower =
    type === "person" ? normalizeName(nameLower) : normalizeTitle(nameLower);

  if (!key || !normalizedNameLower) {
    return null;
  }

  return {
    key,
    type,
    nameLower: normalizedNameLower,
    popularity: Math.max(0, popularity),
  };
}

function getMovieSearchableNameLower(title: string, year = ""): string {
  return normalizeTitle(formatMoviePathLabel(title, year));
}

function createPersonSearchRecord(
  personName: string,
  personTmdbId?: number | string | null,
  popularity = 0,
): SearchableConnectionEntityRecord | null {
  const normalizedName = normalizeName(personName);
  return createSearchableConnectionEntityRecord(
    "person",
    getConnectionPersonEntityKey(normalizedName, personTmdbId),
    normalizedName,
    popularity,
  );
}

function createMovieSearchRecord(
  title: string,
  year = "",
  popularity = 0,
): SearchableConnectionEntityRecord | null {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) {
    return null;
  }

  return createSearchableConnectionEntityRecord(
    "movie",
    getConnectionMovieEntityKey(normalizedTitle, year),
    getMovieSearchableNameLower(normalizedTitle, year),
    popularity,
  );
}

function collectSearchableConnectionEntitiesFromPersonRecord(
  personRecord: PersonRecord,
): SearchableConnectionEntityRecord[] {
  const recordsByKey = new Map<string, SearchableConnectionEntityRecord>();
  const movieConnectionKeys = getResolvedPersonMovieConnectionKeys(personRecord);

  if (movieConnectionKeys.length > 0) {
    const personRecordEntry = createPersonSearchRecord(
      personRecord.name,
      personRecord.tmdbId ?? personRecord.id,
      personRecord.rawTmdbPerson?.popularity ?? 0,
    );
    if (personRecordEntry) {
      recordsByKey.set(personRecordEntry.key, personRecordEntry);
    }
  }

  getAllowedConnectedTmdbMovieCredits(personRecord).forEach((credit) => {
    const title = getMovieTitleFromCredit(credit);
    if (!title) {
      return;
    }

    const movieRecord = createMovieSearchRecord(
      title,
      getMovieYearFromCredit(credit),
      credit.popularity ?? 0,
    );
    if (movieRecord) {
      recordsByKey.set(movieRecord.key, movieRecord);
    }
  });

  return Array.from(recordsByKey.values());
}

function collectSearchableConnectionEntitiesFromFilmRecord(
  filmRecord: FilmRecord,
): SearchableConnectionEntityRecord[] {
  const recordsByKey = new Map<string, SearchableConnectionEntityRecord>();

  const movieRecord = createMovieSearchRecord(
    filmRecord.title,
    filmRecord.year,
    filmRecord.popularity ?? 0,
  );
  if (movieRecord) {
    recordsByKey.set(movieRecord.key, movieRecord);
  }

  const upsertPersonName = (
    personName: string,
    personTmdbId?: number | string | null,
    popularity = 0,
  ) => {
    const personRecord = createPersonSearchRecord(personName, personTmdbId, popularity);
    if (personRecord) {
      recordsByKey.set(personRecord.key, personRecord);
    }
  };

  getAssociatedPeopleFromMovieCredits(filmRecord).forEach((credit) => {
    upsertPersonName(credit.name ?? "", credit.id, credit.popularity ?? 0);
  });

  return Array.from(recordsByKey.values());
}

async function openIndexedDb(): Promise<IDBDatabase> {
  if (indexedDbConnection) {
    return indexedDbConnection;
  }

  if (indexedDbPromise) {
    return indexedDbPromise;
  }

  indexedDbPromise = measureAsync(
    "idb.openIndexedDb",
    async () => {
      function hasRequiredObjectStores(database: IDBDatabase): boolean {
        return REQUIRED_OBJECT_STORE_NAMES.every((storeName) =>
          database.objectStoreNames.contains(storeName),
        );
      }

      function deleteIndexedDb(): Promise<void> {
        return new Promise((resolve, reject) => {
          resetIndexedDbConnection();
          const deleteRequest = indexedDB.deleteDatabase(INDEXED_DB_NAME);

          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => {
            reject(deleteRequest.error ?? new Error("Unable to delete IndexedDB"));
          };
          deleteRequest.onblocked = () => {
            reject(new Error("IndexedDB deletion blocked"));
          };
        });
      }

      async function openIndexedDbOnce(allowDeleteAndRetry: boolean): Promise<IDBDatabase> {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);

          request.onupgradeneeded = (event) => {
            const database = request.result;
            const oldVersion = event.oldVersion ?? 0;

            if (oldVersion > 0 && oldVersion < INDEXED_DB_VERSION) {
              Array.from(database.objectStoreNames).forEach((storeName) => {
                database.deleteObjectStore(storeName);
              });
            }

            if (!database.objectStoreNames.contains(PEOPLE_STORE_NAME)) {
              database.createObjectStore(PEOPLE_STORE_NAME, {
                keyPath: "tmdbId",
              });
            }

            if (!database.objectStoreNames.contains(FILMS_STORE_NAME)) {
              database.createObjectStore(FILMS_STORE_NAME, {
                keyPath: "tmdbId",
              });
            }

            if (!database.objectStoreNames.contains(SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME)) {
              const searchableStore = database.createObjectStore(
                SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
                {
                  keyPath: "key",
                },
              );
              searchableStore.createIndex("nameLower", "nameLower", { unique: false });
            }

            if (!database.objectStoreNames.contains(INDEXED_DB_METADATA_STORE_NAME)) {
              database.createObjectStore(INDEXED_DB_METADATA_STORE_NAME, {
                keyPath: "key",
              });
            }
          };

          request.onsuccess = () => resolve(request.result);
          request.onerror = () => {
            reject(request.error ?? new Error("Unable to open IndexedDB"));
          };
        });

        database.onversionchange = () => {
          database.close();
          if (indexedDbConnection === database) {
            indexedDbConnection = null;
            indexedDbPromise = null;
          }
        };

        if (hasRequiredObjectStores(database)) {
          return database;
        }

        database.close();

        if (!allowDeleteAndRetry) {
          throw new Error("IndexedDB schema is missing required object stores");
        }

        await deleteIndexedDb();
        return openIndexedDbOnce(false);
      }

      return openIndexedDbOnce(true);
    },
    {
      details: {
        databaseName: INDEXED_DB_NAME,
        version: INDEXED_DB_VERSION,
      },
      slowThresholdMs: 10,
    },
  );

  try {
    indexedDbConnection = await indexedDbPromise;
    return indexedDbConnection;
  } catch (error) {
    resetIndexedDbConnection();
    throw error;
  }
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore, transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const database = await openIndexedDb();

  const transaction = database.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  const result = await callback(store, transaction);
  await transactionDonePromise(transaction);
  return result;
}

async function withStores<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  callback: (
    stores: Map<string, IDBObjectStore>,
    transaction: IDBTransaction,
  ) => Promise<T>,
): Promise<T> {
  const database = await openIndexedDb();

  const transaction = database.transaction(storeNames, mode);
  const stores = new Map(
    storeNames.map((storeName) => [storeName, transaction.objectStore(storeName)]),
  );
  const result = await callback(stores, transaction);
  await transactionDonePromise(transaction);
  return result;
}

async function loadPersistedSearchableConnectionEntities(): Promise<
  SearchableConnectionEntityRecord[]
> {
  return withStore(
    SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
    "readonly",
    async (store) => {
      const records = await indexedDbRequestToPromise<SearchableConnectionEntityRecord[]>(
        store.getAll(),
      );
      return mergeSearchableConnectionEntityRecords(records ?? []);
    },
  );
}

async function countPersistedSearchableConnectionEntities(): Promise<number> {
  return withStore(
    SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
    "readonly",
    async (store) => indexedDbRequestToPromise<number>(store.count()),
  );
}

async function waitForNextSearchableConnectionEntityPersistenceTurn(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      window.setTimeout(resolve, 0);
      return;
    }

    setTimeout(resolve, 0);
  });
}

export async function getCinenerdleIndexedDbFetchCount(): Promise<number> {
  if (indexedDbFetchCountCache !== null) {
    return indexedDbFetchCountCache;
  }

  const count = await withStore(
    INDEXED_DB_METADATA_STORE_NAME,
    "readonly",
    async (store) => {
      const record = await indexedDbRequestToPromise<IndexedDbMetadataRecord | undefined>(
        store.get(INDEXED_DB_FETCH_COUNT_KEY),
      );
      return normalizeIndexedDbFetchCount(record?.value);
    },
  );

  indexedDbFetchCountCache = count;
  return count;
}

export async function incrementCinenerdleIndexedDbFetchCount(): Promise<number> {
  const nextCount = await withStore(
    INDEXED_DB_METADATA_STORE_NAME,
    "readwrite",
    async (store) => {
      const record = await indexedDbRequestToPromise<IndexedDbMetadataRecord | undefined>(
        store.get(INDEXED_DB_FETCH_COUNT_KEY),
      );
      const updatedCount = normalizeIndexedDbFetchCount(record?.value) + 1;
      await indexedDbRequestToPromise(store.put({
        key: INDEXED_DB_FETCH_COUNT_KEY,
        value: updatedCount,
      }));
      return updatedCount;
    },
  );

  setIndexedDbFetchCountCache(nextCount);
  return nextCount;
}

async function loadPersistedCoreSnapshot(): Promise<IndexedDbSnapshot> {
  return withStores(
    [PEOPLE_STORE_NAME, FILMS_STORE_NAME],
    "readonly",
    async (stores) => {
        const [storedPeople, storedFilms] = await Promise.all([
        indexedDbRequestToPromise<StoredPersonRecord[]>(
          stores.get(PEOPLE_STORE_NAME)!.getAll(),
        ),
        indexedDbRequestToPromise<StoredFilmRecord[]>(
          stores.get(FILMS_STORE_NAME)!.getAll(),
        ),
      ]);

      return {
        format: "cinenerdle-indexed-db-snapshot",
        version: INDEXED_DB_SNAPSHOT_VERSION,
        people: storedPeople ?? [],
        films: storedFilms ?? [],
      };
    },
  );
}

async function ensureCoreRecordCachesReady(): Promise<void> {
  if (allPersonRecordsCache && allFilmRecordsCache) {
    return;
  }

  if (!coreRecordCachesReadyPromise) {
    coreRecordCachesReadyPromise = (async () => {
      const snapshot = await loadPersistedCoreSnapshot();
      replaceCachedCoreRecords(inflateIndexedDbSnapshotCore(snapshot));
    })().catch((error) => {
      coreRecordCachesReadyPromise = null;
      throw error;
    });
  }

  await coreRecordCachesReadyPromise;
}

export async function getPersonRecordByName(
  personName: string,
): Promise<PersonRecord | null> {
  return measureAsync(
    "idb.getPersonRecordByName",
    async () => {
      const normalizedPersonName = normalizeName(personName);
      if (!normalizedPersonName) {
        return null;
      }

      if (missingPersonRecordNamesCache.has(normalizedPersonName)) {
        return null;
      }

      await ensureCoreRecordCachesReady();
      const cachedRecord = personRecordByNameCache.get(normalizedPersonName);
      if (cachedRecord) {
        return cachedRecord;
      }

      missingPersonRecordNamesCache.add(normalizedPersonName);
      return null;
    },
    {
      details: {
        personName,
      },
      slowThresholdMs: 5,
      summarizeResult: (personRecord) => ({
        hit: Boolean(personRecord),
      }),
    },
  );
}

export async function getPersonRecordById(
  id: number | null | undefined,
): Promise<PersonRecord | null> {
  return measureAsync(
    "idb.getPersonRecordById",
    async () => {
      if (!id) {
        return null;
      }

      if (missingPersonRecordIdsCache.has(id)) {
        return null;
      }

      await ensureCoreRecordCachesReady();
      const cachedRecord = personRecordByIdCache.get(id);
      if (cachedRecord) {
        return cachedRecord;
      }

      missingPersonRecordIdsCache.add(id);
      return null;
    },
    {
      details: {
        id,
      },
      slowThresholdMs: 5,
      summarizeResult: (personRecord) => ({
        hit: Boolean(personRecord),
      }),
    },
  );
}

export async function getPersonRecordsByMovieKey(
  movieKey: string,
): Promise<PersonRecord[]> {
  if (!movieKey) {
    return [];
  }

  await ensureCoreRecordCachesReady();
  return (allPersonRecordsCache ?? []).filter((personRecord) =>
    personRecord.movieConnectionKeys.includes(movieKey));
}

export async function getPersonMovieConnectionKeys(
  personName: string,
  personTmdbId?: number | null,
): Promise<string[]> {
  const normalizedPersonName = normalizeName(personName);
  const validPersonTmdbId = getValidTmdbEntityId(personTmdbId);

  if (!normalizedPersonName && !validPersonTmdbId) {
    return [];
  }

  await ensureCoreRecordCachesReady();
  const personRecord = pickBestPersonRecord(
    validPersonTmdbId ? personRecordByIdCache.get(validPersonTmdbId) ?? null : null,
    normalizedPersonName ? personRecordByNameCache.get(normalizedPersonName) ?? null : null,
  );

  return Array.from(
    new Set(
      getResolvedPersonMovieConnectionKeys(personRecord)
        .map((movieKey) => normalizeTitle(movieKey))
        .filter(Boolean),
    ),
  );
}

export async function getPersonRecordCountsByMovieKeys(
  movieKeys: string[],
): Promise<Map<string, number>> {
  return measureAsync(
    "idb.getPersonRecordCountsByMovieKeys",
    async () => {
      const uniqueMovieKeys = Array.from(new Set(movieKeys.filter(Boolean)));

      if (uniqueMovieKeys.length === 0) {
        return new Map();
      }

      const resolvedCounts = new Map<string, number>();
      const missingMovieKeys = uniqueMovieKeys.filter((movieKey) => {
        if (!personCountByMovieKeyCache.has(movieKey)) {
          return true;
        }

        resolvedCounts.set(movieKey, personCountByMovieKeyCache.get(movieKey) ?? 0);
        return false;
      });

      if (missingMovieKeys.length === 0) {
        return resolvedCounts;
      }

      await ensureCoreRecordCachesReady();
      missingMovieKeys.forEach((movieKey) => {
        const count = personCountByMovieKeyCache.get(movieKey) ?? 0;
        personCountByMovieKeyCache.set(movieKey, count);
        resolvedCounts.set(movieKey, count);
      });
      return resolvedCounts;
    },
    {
      details: {
        movieKeyCount: movieKeys.length,
      },
      slowThresholdMs: 10,
      summarizeResult: (counts) => ({
        resolvedCount: counts.size,
      }),
    },
  );
}

export async function getAllPersonRecords(): Promise<PersonRecord[]> {
  await ensureCoreRecordCachesReady();
  return allPersonRecordsCache ?? [];
}

export async function savePersonRecord(personRecord: PersonRecord): Promise<void> {
  await measureAsync(
    "idb.savePersonRecord",
    async () => {
      await ensureCoreRecordCachesReady();

      const existingPersonRecord = pickBestPersonRecord(
        personRecordByIdCache.get(personRecord.tmdbId ?? personRecord.id) ?? null,
        personRecordByNameCache.get(normalizeName(personRecord.name)) ?? null,
      );
      const storedPersonRecord = createStoredPersonRecord(personRecord);
      const searchRecords = collectSearchableConnectionEntitiesFromPersonRecord(personRecord);
      const existingSearchRecords = existingPersonRecord
        ? collectSearchableConnectionEntitiesFromPersonRecord(existingPersonRecord)
        : [];
      const canonicalSearchRecord = createPersonSearchRecord(
        personRecord.name,
        personRecord.tmdbId ?? personRecord.id,
      );
      const legacySearchRecord = createPersonSearchRecord(personRecord.name);
      const searchRecordKeys = new Set(searchRecords.map((record) => record.key));
      const searchableKeysToDelete = [
        canonicalSearchRecord && !searchRecordKeys.has(canonicalSearchRecord.key)
          ? canonicalSearchRecord.key
          : "",
        legacySearchRecord && !searchRecordKeys.has(legacySearchRecord.key)
          ? legacySearchRecord.key
          : "",
      ].filter(Boolean);

      await withStores(
        [PEOPLE_STORE_NAME, SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME],
        "readwrite",
        async (stores) => {
          await indexedDbRequestToPromise(stores.get(PEOPLE_STORE_NAME)!.put(storedPersonRecord));
        },
      );

      cachePersonRecord(personRecord);
      if (allPersonRecordsCache) {
        const nextPeopleById = new Map(allPersonRecordsCache.map((record) => [record.id, record] as const));
        nextPeopleById.set(personRecord.id, personRecord);
        allPersonRecordsCache = Array.from(nextPeopleById.values());
      }

      updatePersonCountCacheForMovieKeys([
        ...getResolvedPersonMovieConnectionKeys(existingPersonRecord),
        ...getResolvedPersonMovieConnectionKeys(personRecord),
      ]);
      invalidateSearchableConnectionPopularityCachesForRecords([
        ...existingSearchRecords,
        ...searchRecords,
      ]);

      await synchronizePersistedSearchableConnectionEntityKeys([
        ...existingSearchRecords.map((record) => record.key),
        ...searchRecords.map((record) => record.key),
        ...searchableKeysToDelete,
      ]);

      dispatchCinenerdleRecordsUpdated();

      return searchRecords.length;
    },
    {
      always: true,
      details: {
        movieConnectionCount: personRecord.movieConnectionKeys.length,
        personName: personRecord.name,
      },
      summarizeResult: (searchRecordCount) => ({
        searchRecordCount,
      }),
    },
  );
}

export async function getFilmRecordById(
  id: number | string | null | undefined,
): Promise<FilmRecord | null> {
  if (id === null || id === undefined || id === "") {
    return null;
  }

  const cacheKey = getFilmCacheIdKey(id);
  const cachedRecord = filmRecordByIdCache.get(cacheKey);
  if (cachedRecord) {
    return cachedRecord;
  }

  await ensureCoreRecordCachesReady();
  return filmRecordByIdCache.get(cacheKey) ?? null;
}

export async function getFilmRecordsByTitle(title: string): Promise<FilmRecord[]> {
  await ensureCoreRecordCachesReady();
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) {
    return [];
  }

  return (allFilmRecordsCache ?? []).filter((filmRecord) =>
    normalizeTitle(filmRecord.title) === normalizedTitle);
}

export async function getFilmRecordByTitleAndYear(
  title: string,
  year = "",
): Promise<FilmRecord | null> {
  return measureAsync(
    "idb.getFilmRecordByTitleAndYear",
    async () => {
      const normalizedTitle = normalizeTitle(title);
      if (!normalizedTitle) {
        return null;
      }

      const queryCacheKey = getFilmQueryCacheKey(normalizedTitle, year);
      if (filmRecordQueryCache.has(queryCacheKey)) {
        return filmRecordQueryCache.get(queryCacheKey) ?? null;
      }

      await ensureCoreRecordCachesReady();
      const records = (allFilmRecordsCache ?? []).filter((filmRecord) =>
        normalizeTitle(filmRecord.title) === normalizedTitle);
      const resolvedRecord = chooseBestFilmRecord(records, normalizedTitle, year);
      filmRecordQueryCache.set(queryCacheKey, resolvedRecord);
      cacheFilmRecord(resolvedRecord);
      return resolvedRecord;
    },
    {
      details: {
        title,
        year,
      },
      slowThresholdMs: 5,
      summarizeResult: (filmRecord) => ({
        hit: Boolean(filmRecord),
      }),
    },
  );
}

export async function getFilmRecordsByIds(
  ids: Array<number | string | null | undefined>,
): Promise<Map<number | string, FilmRecord>> {
  const uniqueIds = Array.from(
    new Set(ids.filter((id): id is number | string => Boolean(id))),
  );

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const resolvedRecords = new Map<number | string, FilmRecord>();
  const missingIds = uniqueIds.filter((id) => {
    const cachedRecord = filmRecordByIdCache.get(getFilmCacheIdKey(id));
    if (!cachedRecord) {
      return true;
    }

    resolvedRecords.set(id, cachedRecord);
    return false;
  });

  if (missingIds.length === 0) {
    return resolvedRecords;
  }

  await ensureCoreRecordCachesReady();
  missingIds.forEach((id) => {
    const record = filmRecordByIdCache.get(getFilmCacheIdKey(id));
    if (!record) {
      return;
    }
    resolvedRecords.set(id, record);
  });
  return resolvedRecords;
}

export async function getAllFilmRecords(): Promise<FilmRecord[]> {
  await ensureCoreRecordCachesReady();
  return allFilmRecordsCache ?? [];
}

function getFallbackSearchableEntityPopularityByNameLower(
  nameLower: string,
  type: SearchableConnectionEntityRecord["type"],
): number {
  if (type === "person") {
    const normalizedPersonName = normalizeName(nameLower);
    let popularity =
      personRecordByNameCache.get(normalizedPersonName)?.rawTmdbPerson?.popularity ?? 0;

    (allFilmRecordsCache ?? []).forEach((filmRecord) => {
      getAssociatedPeopleFromMovieCredits(filmRecord).forEach((credit) => {
        if (normalizeName(credit.name ?? "") !== normalizedPersonName) {
          return;
        }

        popularity = Math.max(popularity, credit.popularity ?? 0);
      });
    });

    return popularity;
  }

  let popularity = 0;
  (allFilmRecordsCache ?? []).forEach((filmRecord) => {
    if (getMovieSearchableNameLower(filmRecord.title, filmRecord.year) !== nameLower) {
      return;
    }

    popularity = Math.max(popularity, filmRecord.popularity ?? 0);
  });
  (allPersonRecordsCache ?? []).forEach((personRecord) => {
    getAllowedConnectedTmdbMovieCredits(personRecord).forEach((credit) => {
      const title = getMovieTitleFromCredit(credit);
      if (!title) {
        return;
      }

      if (getMovieSearchableNameLower(title, getMovieYearFromCredit(credit)) !== nameLower) {
        return;
      }

      popularity = Math.max(popularity, credit.popularity ?? 0);
    });
  });

  return popularity;
}

async function getSearchableEntityPopularityByNameLower(
  nameLowerValues: string[],
  type: SearchableConnectionEntityRecord["type"],
  cache: Map<string, number>,
): Promise<Map<string, number>> {
  const normalizedValues = Array.from(new Set(nameLowerValues.filter(Boolean)));
  const resolvedPopularity = new Map<string, number>();
  const missingValues = normalizedValues.filter((nameLower) => {
    if (!cache.has(nameLower)) {
      return true;
    }

    resolvedPopularity.set(nameLower, cache.get(nameLower) ?? 0);
    return false;
  });

  if (missingValues.length === 0) {
    return resolvedPopularity;
  }

  if (allSearchableConnectionEntitiesCache) {
    missingValues.forEach((nameLower) => {
      const popularity = allSearchableConnectionEntitiesCache?.reduce((maxPopularity, record) => {
        if (record.type !== type || record.nameLower !== nameLower) {
          return maxPopularity;
        }

        return Math.max(maxPopularity, record.popularity ?? 0);
      }, 0) ?? 0;
      cache.set(nameLower, popularity);
      resolvedPopularity.set(nameLower, popularity);
    });

    return resolvedPopularity;
  }

  if (searchableConnectionEntityPersistenceStatus.isPending) {
    await ensureCoreRecordCachesReady();
    missingValues.forEach((nameLower) => {
      const popularity = getFallbackSearchableEntityPopularityByNameLower(nameLower, type);
      cache.set(nameLower, popularity);
      resolvedPopularity.set(nameLower, popularity);
    });

    return resolvedPopularity;
  }

  return withStore(
    SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
    "readonly",
    async (store) => {
      const nameLowerIndex = store.index("nameLower");
      const entries = await Promise.all(
        missingValues.map(async (nameLower) => {
          const records = await indexedDbRequestToPromise<SearchableConnectionEntityRecord[]>(
            nameLowerIndex.getAll(nameLower),
          );
          const popularity = (records ?? []).reduce((maxPopularity, record) => {
            if (record.type !== type) {
              return maxPopularity;
            }

            return Math.max(maxPopularity, record.popularity ?? 0);
          }, 0);

          return [nameLower, popularity] as const;
        }),
      );

      entries.forEach(([nameLower, popularity]) => {
        cache.set(nameLower, popularity);
        resolvedPopularity.set(nameLower, popularity);
      });

      return resolvedPopularity;
    },
  );
}

export async function getPersonPopularityByNames(
  names: string[],
): Promise<Map<string, number>> {
  return getSearchableEntityPopularityByNameLower(
    names.map((name) => normalizeName(name)),
    "person",
    personPopularityByNameCache,
  );
}

export async function getMoviePopularityByLabels(
  labels: string[],
): Promise<Map<string, number>> {
  return getSearchableEntityPopularityByNameLower(
    labels.map((label) => normalizeTitle(label)),
    "movie",
    moviePopularityByLabelCache,
  );
}

export async function getFilmRecordsByPersonConnectionKey(
  personName: string,
): Promise<FilmRecord[]> {
  if (!personName) {
    return [];
  }

  const normalizedPersonName = normalizeName(personName);
  const movieConnectionKeys = await getPersonMovieConnectionKeys(normalizedPersonName);
  if (movieConnectionKeys.length > 0) {
    const filmRecords = await Promise.all(
      movieConnectionKeys.map(async (movieConnectionKey) => {
        const parsedMovie = parseMoviePathLabel(movieConnectionKey);
        return getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year);
      }),
    );

    return filmRecords.filter((filmRecord): filmRecord is FilmRecord => filmRecord !== null);
  }

  await ensureCoreRecordCachesReady();
  return (allFilmRecordsCache ?? []).filter((filmRecord) =>
    filmRecord.personConnectionKeys.includes(normalizedPersonName));
}

export async function getFilmRecordCountsByPersonConnectionKeys(
  personNames: string[],
): Promise<Map<string, number>> {
  return measureAsync(
    "idb.getFilmRecordCountsByPersonConnectionKeys",
    async () => {
      const normalizedNames = Array.from(
        new Set(
          personNames
            .map((personName) => normalizeName(personName))
            .filter(Boolean),
        ),
      );

      if (normalizedNames.length === 0) {
        return new Map();
      }

      const resolvedCounts = new Map<string, number>();
      const missingNames = normalizedNames.filter((personName) => {
        if (!filmCountByPersonNameCache.has(personName)) {
          return true;
        }

        resolvedCounts.set(personName, filmCountByPersonNameCache.get(personName) ?? 0);
        return false;
      });

      if (missingNames.length === 0) {
        return resolvedCounts;
      }

      await ensureCoreRecordCachesReady();
      missingNames.forEach((personName) => {
        const count = filmCountByPersonNameCache.get(personName) ?? 0;
        filmCountByPersonNameCache.set(personName, count);
        resolvedCounts.set(personName, count);
      });
      return resolvedCounts;
    },
    {
      details: {
        personNameCount: personNames.length,
      },
      slowThresholdMs: 10,
      summarizeResult: (counts) => ({
        resolvedCount: counts.size,
      }),
    },
  );
}

export async function getCinenerdleStarterFilmRecords(): Promise<FilmRecord[]> {
  return measureAsync(
    "idb.getCinenerdleStarterFilmRecords",
    async () => {
      const starterTitles = readCinenerdleDailyStarterTitles();
      const starterRecords = await Promise.all(
        starterTitles.map(async (starterTitle) => {
          const starterRecord = createDailyStarterFilmRecordFromTitle(starterTitle);
          const cachedFilmRecord = await getFilmRecordByTitleAndYear(
            starterRecord.title,
            starterRecord.year,
          );

          if (!cachedFilmRecord) {
            return starterRecord;
          }

          return {
            ...starterRecord,
            id: cachedFilmRecord.id,
            tmdbId: cachedFilmRecord.tmdbId,
            popularity: cachedFilmRecord.popularity,
            personConnectionKeys: cachedFilmRecord.personConnectionKeys,
            rawTmdbMovie: cachedFilmRecord.rawTmdbMovie,
            rawTmdbMovieSearchResponse: cachedFilmRecord.rawTmdbMovieSearchResponse,
            rawTmdbMovieCreditsResponse: cachedFilmRecord.rawTmdbMovieCreditsResponse,
            fetchTimestamp: cachedFilmRecord.fetchTimestamp,
          };
        }),
      );

      return starterRecords.sort((left, right) => (right.popularity ?? 0) - (left.popularity ?? 0));
    },
    {
      always: true,
      summarizeResult: (records) => ({
        recordCount: records.length,
      }),
    },
  );
}

export async function getAllSearchableConnectionEntities(): Promise<
  SearchableConnectionEntityRecord[]
> {
  return measureAsync(
    "idb.getAllSearchableConnectionEntities",
    async () => {
      if (allSearchableConnectionEntitiesCache) {
        return allSearchableConnectionEntitiesCache;
      }

      return replaceCachedSearchableConnectionEntities(
        await loadPersistedSearchableConnectionEntities(),
      );
    },
    {
      always: true,
      summarizeResult: (records) => ({
        recordCount: records.length,
      }),
    },
  );
}

export type IndexedDbSnapshotConnection = {
  fetchTimestamp: string;
  personTmdbId: number;
  profilePath: string | null;
  roleType: "cast" | "crew";
  role: string;
  order: number;
};

export type IndexedDbSnapshotPerson = {
  tmdbId: number;
  name: string;
  movieConnectionKeys: string[];
  popularity: number;
  fromTmdb: {
    fetchTimestamp: string;
    profilePath: string | null;
  } | null;
};

export type IndexedDbSnapshotFilm = {
  tmdbId: number;
  title: string;
  year: string;
  posterPath: string | null;
  popularity: number;
  voteAverage: number | null;
  voteCount: number | null;
  releaseDate: string;
  fromTmdb: {
    fetchTimestamp: string;
  } | null;
  personConnectionKeys: string[];
  people: IndexedDbSnapshotConnection[];
};

export type IndexedDbSnapshot = {
  format: "cinenerdle-indexed-db-snapshot";
  version: typeof INDEXED_DB_SNAPSHOT_VERSION;
  people: IndexedDbSnapshotPerson[];
  films: IndexedDbSnapshotFilm[];
};

type LiveIndexedDbCoreSnapshot = {
  people: PersonRecord[];
  films: FilmRecord[];
};

type LiveIndexedDbSnapshot = LiveIndexedDbCoreSnapshot & {
  searchableConnectionEntities: SearchableConnectionEntityRecord[];
};

function getEscapedUnicodeCodePoint(character: string): string {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) {
    return character;
  }

  if (codePoint <= 0xffff) {
    return `\\u${codePoint.toString(16).padStart(4, "0")}`;
  }

  const normalizedCodePoint = codePoint - 0x10000;
  const highSurrogate = 0xd800 + (normalizedCodePoint >> 10);
  const lowSurrogate = 0xdc00 + (normalizedCodePoint & 0x3ff);
  return `\\u${highSurrogate.toString(16).padStart(4, "0")}\\u${lowSurrogate
    .toString(16)
    .padStart(4, "0")}`;
}

function isAmbiguousUnicodeCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0000 && codePoint <= 0x001f) ||
    (codePoint >= 0x007f && codePoint <= 0x009f) ||
    codePoint === 0x00a0 ||
    codePoint === 0x00ad ||
    codePoint === 0x034f ||
    codePoint === 0x061c ||
    codePoint === 0x1680 ||
    codePoint === 0x180e ||
    (codePoint >= 0x2000 && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202f) ||
    codePoint === 0x205f ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0x3000 ||
    codePoint === 0xfeff
  );
}

function escapeAmbiguousUnicodeCharacters(text: string): string {
  let escapedText = "";
  let isInsideJsonString = false;
  let isEscapingNextCharacter = false;

  for (const character of text) {
    if (!isInsideJsonString) {
      escapedText += character;
      if (character === "\"") {
        isInsideJsonString = true;
      }
      continue;
    }

    if (isEscapingNextCharacter) {
      escapedText += character;
      isEscapingNextCharacter = false;
      continue;
    }

    if (character === "\\") {
      escapedText += character;
      isEscapingNextCharacter = true;
      continue;
    }

    if (character === "\"") {
      escapedText += character;
      isInsideJsonString = false;
      continue;
    }

    const codePoint = character.codePointAt(0);
    escapedText += codePoint !== undefined && isAmbiguousUnicodeCodePoint(codePoint)
      ? getEscapedUnicodeCodePoint(character)
      : character;
  }

  return escapedText;
}

function mergeSearchableConnectionEntityRecords(
  records: SearchableConnectionEntityRecord[],
): SearchableConnectionEntityRecord[] {
  const mergedRecordsByKey = records.reduce((recordsByKey, record) => {
    const existingRecord = recordsByKey.get(record.key);

    if (!existingRecord) {
      recordsByKey.set(record.key, record);
      return recordsByKey;
    }

    recordsByKey.set(record.key, {
      ...existingRecord,
      ...record,
      popularity: Math.max(existingRecord.popularity ?? 0, record.popularity ?? 0),
    });
    return recordsByKey;
  }, new Map<string, SearchableConnectionEntityRecord>());

  return Array.from(mergedRecordsByKey.values())
    .sort((left, right) => left.key.localeCompare(right.key));
}

function buildSnapshotSearchableConnectionEntities(
  people: PersonRecord[],
  films: FilmRecord[],
): SearchableConnectionEntityRecord[] {
  return mergeSearchableConnectionEntityRecords([
    ...people.flatMap((personRecord) => collectSearchableConnectionEntitiesFromPersonRecord(personRecord)),
    ...films.flatMap((filmRecord) => collectSearchableConnectionEntitiesFromFilmRecord(filmRecord)),
  ]);
}

async function persistSearchableConnectionEntitiesInBackground(
  searchableConnectionEntities: SearchableConnectionEntityRecord[],
): Promise<SearchableConnectionEntityRecord[]> {
  const mergedSearchableConnectionEntities =
    mergeSearchableConnectionEntityRecords(searchableConnectionEntities);

  if (searchableConnectionEntityPersistencePromise) {
    return searchableConnectionEntityPersistencePromise;
  }

  clearSearchableConnectionEntityPersistenceReadyMarker();
  setSearchableConnectionEntityPersistenceStatus({
    isPending: true,
    phase: "persisting-base",
  });
  replaceCachedSearchableConnectionEntities(mergedSearchableConnectionEntities);
  emitSearchableConnectionEntityPersistenceEvent("searchable-persist:start", {
    searchableConnectionEntityCount: mergedSearchableConnectionEntities.length,
  });

  searchableConnectionEntityPersistencePromise = (async () => {
    await withStore(
      SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
      "readwrite",
      async (store) => {
        await indexedDbRequestToPromise(store.clear());
      },
    );

    for (
      let startIndex = 0;
      startIndex < mergedSearchableConnectionEntities.length;
      startIndex += SEARCHABLE_CONNECTION_ENTITY_PERSISTENCE_BATCH_SIZE
    ) {
      const records = mergedSearchableConnectionEntities.slice(
        startIndex,
        startIndex + SEARCHABLE_CONNECTION_ENTITY_PERSISTENCE_BATCH_SIZE,
      );

      await withStore(
        SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
        "readwrite",
        async (store) => {
          queueIndexedDbStoreWrites(store, records);
        },
      );
      emitSearchableConnectionEntityPersistenceEvent("searchable-persist:chunk", {
        persistedCount: Math.min(
          mergedSearchableConnectionEntities.length,
          startIndex + records.length,
        ),
        searchableConnectionEntityCount: mergedSearchableConnectionEntities.length,
      });

      if (startIndex + records.length < mergedSearchableConnectionEntities.length) {
        await waitForNextSearchableConnectionEntityPersistenceTurn();
      }
    }

    setSearchableConnectionEntityPersistenceStatus({
      isPending: true,
      phase: "flushing-deferred",
    });
    writeSearchableConnectionEntityPersistenceReadyMarker(true);
    setSearchableConnectionEntityPersistenceStatus({
      isPending: false,
      phase: "idle",
    });
    emitSearchableConnectionEntityPersistenceEvent("searchable-persist:complete", {
      searchableConnectionEntityCount: mergedSearchableConnectionEntities.length,
    });

    return mergedSearchableConnectionEntities;
  })().catch((error) => {
    clearSearchableConnectionEntityPersistenceReadyMarker();
    setSearchableConnectionEntityPersistenceStatus({
      isPending: false,
      phase: "idle",
    });
    emitSearchableConnectionEntityPersistenceEvent("searchable-persist:error", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }).finally(() => {
    searchableConnectionEntityPersistencePromise = null;
  });

  return searchableConnectionEntityPersistencePromise;
}

export async function prepareSearchableConnectionEntitiesForStartup(): Promise<{
  isSearchablePersistencePending: boolean;
  searchableConnectionEntityCount: number;
}> {
  await ensureCoreRecordCachesReady();

  if (allSearchableConnectionEntitiesCache) {
    writeSearchableConnectionEntityPersistenceReadyMarker(true);
    return {
      isSearchablePersistencePending: false,
      searchableConnectionEntityCount: allSearchableConnectionEntitiesCache.length,
    };
  }

  const persistedSearchableConnectionEntityCount = await countPersistedSearchableConnectionEntities();
  if (
    getSearchableConnectionEntityPersistenceReadyMarkerValue() === "1" &&
    persistedSearchableConnectionEntityCount > 0
  ) {
    return {
      isSearchablePersistencePending: false,
      searchableConnectionEntityCount: persistedSearchableConnectionEntityCount,
    };
  }

  const searchableConnectionEntities = buildSnapshotSearchableConnectionEntities(
    allPersonRecordsCache ?? [],
    allFilmRecordsCache ?? [],
  );
  void persistSearchableConnectionEntitiesInBackground(searchableConnectionEntities).catch(() => { });

  return {
    isSearchablePersistencePending: true,
    searchableConnectionEntityCount: searchableConnectionEntities.length,
  };
}

function resetIndexedDbSnapshotValidationState(): void {
  resetCinenerdleValidationAlertState();
}

function normalizeSnapshotPersonName(name: string): string {
  return normalizeWhitespace(name);
}

function getRequiredSnapshotTmdbId(
  tmdbId: number | string | null | undefined,
  label: string,
): number {
  const validTmdbId = getValidTmdbEntityId(tmdbId);
  if (validTmdbId === null) {
    throwCinenerdleValidationError(
      `Cannot export snapshot: ${label} is missing a numeric TMDb id.`,
    );
  }

  return validTmdbId;
}

function getRequiredSnapshotFetchTimestamp(
  fetchTimestamp: string | undefined,
  label: string,
): string {
  const normalizedFetchTimestamp = fetchTimestamp?.trim();
  if (!normalizedFetchTimestamp) {
    throwCinenerdleValidationError(
      `Cannot export snapshot: ${label} is missing a fetch timestamp.`,
    );
  }

  return normalizedFetchTimestamp;
}

function createPersonSnapshotFromPersonRecord(
  personRecord: PersonRecord,
): IndexedDbSnapshotPerson {
  const tmdbId = getRequiredSnapshotTmdbId(
    personRecord.tmdbId ?? personRecord.id,
    `person "${personRecord.name}"`,
  );

  return {
    tmdbId,
    name: personRecord.name,
    movieConnectionKeys: Array.from(
      new Set(
        getResolvedPersonMovieConnectionKeys(personRecord)
          .map((movieKey) => normalizeTitle(movieKey))
          .filter(Boolean),
      ),
    ),
    popularity: personRecord.rawTmdbPerson?.popularity ?? 0,
    fromTmdb: hasDirectTmdbPersonSource(personRecord) && personRecord.rawTmdbPerson
      ? {
          fetchTimestamp: getRequiredSnapshotFetchTimestamp(
            personRecord.fetchTimestamp,
            `person "${personRecord.name}"`,
          ),
          profilePath: personRecord.rawTmdbPerson.profile_path ?? null,
        }
      : null,
  };
}

function createPersonSnapshotFromFilmCredit(
  credit: TmdbPersonCredit,
): IndexedDbSnapshotPerson {
  const personTmdbId = getValidTmdbEntityId(credit.id);
  if (personTmdbId === null) {
    throwCinenerdleValidationError(
      `Cannot export snapshot: film credit person "${credit.name ?? ""}" is missing a numeric TMDb id.`,
    );
  }

  return {
    tmdbId: personTmdbId,
    name: credit.name ?? "",
    movieConnectionKeys: [],
    popularity: credit.popularity ?? 0,
    fromTmdb: null,
  };
}

function assertPersonSnapshotsAgree(
  standalonePerson: IndexedDbSnapshotPerson,
  derivedPerson: IndexedDbSnapshotPerson,
): void {
  if (
    normalizeSnapshotPersonName(standalonePerson.name) !==
      normalizeSnapshotPersonName(derivedPerson.name)
  ) {
    throwCinenerdleValidationError(
      `Cannot export snapshot: conflicting person data for TMDb person ${derivedPerson.tmdbId}.`,
      {
        reason: "conflicting-person-data",
        tmdbId: derivedPerson.tmdbId,
        standalonePerson,
        derivedPerson,
      },
    );
  }
}

function mergeSnapshotPersonPopularity(
  existingPersonSnapshot: IndexedDbSnapshotPerson,
  nextPopularity: number,
  existingPopularityFetchTimestamp: string | undefined,
  nextPopularityFetchTimestamp: string | undefined,
): {
  personSnapshot: IndexedDbSnapshotPerson;
  popularityFetchTimestamp: string | undefined;
} {
  const mergedPopularity =
    mergeFetchedFieldValue(
      existingPersonSnapshot.popularity,
      nextPopularity,
      existingPopularityFetchTimestamp,
      nextPopularityFetchTimestamp,
    ) ?? 0;

  return {
    personSnapshot: {
      ...existingPersonSnapshot,
      popularity: mergedPopularity,
    },
    popularityFetchTimestamp: shouldPreferNextFetchedField(
      existingPersonSnapshot.popularity,
      nextPopularity,
      existingPopularityFetchTimestamp,
      nextPopularityFetchTimestamp,
    )
      ? nextPopularityFetchTimestamp
      : existingPopularityFetchTimestamp,
  };
}

function createSnapshotConnectionFromFilmCredit(
  credit: TmdbPersonCredit,
  filmFetchTimestamp: string | undefined,
  canonicalPersonSnapshot?: IndexedDbSnapshotPerson,
): IndexedDbSnapshotConnection {
  const personTmdbId = getValidTmdbEntityId(credit.id);
  if (personTmdbId === null) {
    throwCinenerdleValidationError(
      `Cannot export snapshot: film credit person "${credit.name ?? ""}" is missing a numeric TMDb id.`,
    );
  }

  const roleType = credit.creditType === "crew" ? "crew" : "cast";
  const resolvedFetchTimestamp = getRequiredSnapshotFetchTimestamp(
    credit.fetchTimestamp ?? filmFetchTimestamp ?? canonicalPersonSnapshot?.fromTmdb?.fetchTimestamp,
    `film credit person "${credit.name ?? personTmdbId}"`,
  );

  return {
    fetchTimestamp: resolvedFetchTimestamp,
    personTmdbId,
    profilePath:
      typeof credit.profile_path === "string"
        ? credit.profile_path
        : canonicalPersonSnapshot?.fromTmdb?.profilePath ?? null,
    roleType,
    role:
      roleType === "cast"
        ? credit.character?.trim() ?? ""
        : credit.job?.trim() ?? credit.department?.trim() ?? "",
    order: typeof credit.order === "number" ? credit.order : 0,
  };
}

function createSnapshotFilmRecord(
  filmRecord: FilmRecord,
  filmCredits: TmdbPersonCredit[],
  peopleByTmdbId: ReadonlyMap<number, IndexedDbSnapshotPerson>,
): IndexedDbSnapshotFilm {
  const tmdbId = getRequiredSnapshotTmdbId(
    filmRecord.tmdbId ?? filmRecord.id,
    `film "${filmRecord.title}"`,
  );

  return {
    tmdbId,
    title: filmRecord.title,
    year: filmRecord.year,
    posterPath: filmRecord.rawTmdbMovie?.poster_path ?? null,
    popularity: filmRecord.popularity ?? 0,
    voteAverage: filmRecord.rawTmdbMovie?.vote_average ?? null,
    voteCount: filmRecord.rawTmdbMovie?.vote_count ?? null,
    releaseDate: filmRecord.rawTmdbMovie?.release_date ?? "",
    fromTmdb: hasDirectTmdbMovieSource(filmRecord) && filmRecord.rawTmdbMovie
      ? {
          fetchTimestamp: getRequiredSnapshotFetchTimestamp(
            filmRecord.fetchTimestamp,
            `film "${filmRecord.title}"`,
          ),
        }
      : null,
    personConnectionKeys: Array.from(
      new Set(
        filmRecord.personConnectionKeys
          .map((personName) => normalizeName(personName))
          .filter(Boolean),
      ),
    ),
    people: filmCredits.map((credit) => {
      const personTmdbId = getValidTmdbEntityId(credit.id);
      return createSnapshotConnectionFromFilmCredit(
        credit,
        filmRecord.fetchTimestamp,
        personTmdbId === null ? undefined : peopleByTmdbId.get(personTmdbId),
      );
    }),
  };
}

export function buildIndexedDbSnapshot(
  snapshot: LiveIndexedDbSnapshot,
): IndexedDbSnapshot {
  resetIndexedDbSnapshotValidationState();

  const peopleByTmdbId = new Map<number, IndexedDbSnapshotPerson>();
  const personPopularityFetchTimestampByTmdbId = new Map<number, string | undefined>();
  [...(snapshot.people ?? [])]
    .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id)
    .forEach((personRecord) => {
      const personSnapshot = createPersonSnapshotFromPersonRecord(personRecord);
      const existingSnapshot = peopleByTmdbId.get(personSnapshot.tmdbId);
      const popularityFetchTimestamp = personRecord.fetchTimestamp;

      if (existingSnapshot) {
        assertPersonSnapshotsAgree(existingSnapshot, personSnapshot);
        const mergedPerson = mergeSnapshotPersonPopularity(
          existingSnapshot,
          personSnapshot.popularity,
          personPopularityFetchTimestampByTmdbId.get(personSnapshot.tmdbId),
          popularityFetchTimestamp,
        );
        peopleByTmdbId.set(personSnapshot.tmdbId, {
          ...mergedPerson.personSnapshot,
          movieConnectionKeys: Array.from(
            new Set([
              ...existingSnapshot.movieConnectionKeys,
              ...personSnapshot.movieConnectionKeys,
            ]),
          ),
          fromTmdb: personSnapshot.fromTmdb ?? existingSnapshot.fromTmdb,
        });
        personPopularityFetchTimestampByTmdbId.set(
          personSnapshot.tmdbId,
          mergedPerson.popularityFetchTimestamp,
        );
        return;
      }

      peopleByTmdbId.set(personSnapshot.tmdbId, personSnapshot);
      personPopularityFetchTimestampByTmdbId.set(
        personSnapshot.tmdbId,
        popularityFetchTimestamp,
      );
    });

  const films = [...(snapshot.films ?? [])]
    .sort((left, right) =>
      left.title.localeCompare(right.title) ||
      left.year.localeCompare(right.year) ||
      String(left.id).localeCompare(String(right.id)))
    .map((filmRecord) => {
      const filmCredits = getAssociatedPeopleFromMovieCreditsForSnapshot(filmRecord);

      filmCredits.forEach((credit) => {
        const derivedPerson = createPersonSnapshotFromFilmCredit(credit);
        const existingSnapshot = peopleByTmdbId.get(derivedPerson.tmdbId);
        const derivedPopularityFetchTimestamp =
          credit.fetchTimestamp ?? filmRecord.fetchTimestamp;

        if (existingSnapshot) {
          assertPersonSnapshotsAgree(existingSnapshot, derivedPerson);
          const mergedPerson = mergeSnapshotPersonPopularity(
            existingSnapshot,
            derivedPerson.popularity,
            personPopularityFetchTimestampByTmdbId.get(derivedPerson.tmdbId),
            derivedPopularityFetchTimestamp,
          );
          peopleByTmdbId.set(derivedPerson.tmdbId, {
            ...mergedPerson.personSnapshot,
            movieConnectionKeys: Array.from(
              new Set([
                ...existingSnapshot.movieConnectionKeys,
                ...derivedPerson.movieConnectionKeys,
              ]),
            ),
          });
          personPopularityFetchTimestampByTmdbId.set(
            derivedPerson.tmdbId,
            mergedPerson.popularityFetchTimestamp,
          );
          return;
        }

        peopleByTmdbId.set(derivedPerson.tmdbId, derivedPerson);
        personPopularityFetchTimestampByTmdbId.set(
          derivedPerson.tmdbId,
          derivedPopularityFetchTimestamp,
        );
      });

      return createSnapshotFilmRecord(filmRecord, filmCredits, peopleByTmdbId);
    });

  const people = Array.from(peopleByTmdbId.values()).sort(
    (left, right) => left.name.localeCompare(right.name) || left.tmdbId - right.tmdbId,
  );

  return {
    format: "cinenerdle-indexed-db-snapshot",
    version: INDEXED_DB_SNAPSHOT_VERSION,
    people,
    films,
  };
}

function createTmdbPersonFromSnapshot(
  personSnapshot: IndexedDbSnapshotPerson,
  connectionSummary?: {
    fetchTimestamp: string;
    profilePath: string | null;
  },
): TmdbPersonSearchResult | undefined {
  const summary = personSnapshot.fromTmdb ?? connectionSummary;
  if (!summary) {
    return undefined;
  }

  return {
    id: personSnapshot.tmdbId,
    name: personSnapshot.name,
    profile_path: summary.profilePath,
    popularity: personSnapshot.popularity,
  };
}

function createTmdbMovieFromSnapshot(
  filmSnapshot: IndexedDbSnapshotFilm,
): TmdbMovieSearchResult | undefined {
  return {
    id: filmSnapshot.tmdbId,
    title: filmSnapshot.title,
    original_title: filmSnapshot.title,
    poster_path: filmSnapshot.posterPath,
    release_date: filmSnapshot.releaseDate,
    popularity: filmSnapshot.popularity,
    vote_average: filmSnapshot.voteAverage ?? undefined,
    vote_count: filmSnapshot.voteCount ?? undefined,
  };
}

function createTmdbPersonCreditFromSnapshotConnection(
  connection: IndexedDbSnapshotConnection,
  personSnapshot: IndexedDbSnapshotPerson,
): TmdbPersonCredit {
  return {
    id: connection.personTmdbId,
    name: personSnapshot.name,
    profile_path: connection.profilePath ?? personSnapshot.fromTmdb?.profilePath ?? null,
    popularity: personSnapshot.popularity,
    order: connection.order,
    fetchTimestamp: connection.fetchTimestamp,
    creditType: connection.roleType,
    character: connection.roleType === "cast" ? connection.role : undefined,
    job: connection.roleType === "crew" ? connection.role : undefined,
  };
}

function createTmdbMovieCreditFromSnapshotFilm(
  filmSnapshot: IndexedDbSnapshotFilm,
  connection: IndexedDbSnapshotConnection,
): TmdbMovieCredit {
  return {
    id: filmSnapshot.tmdbId,
    title: filmSnapshot.title,
    original_title: filmSnapshot.title,
    poster_path: filmSnapshot.posterPath,
    release_date: filmSnapshot.releaseDate,
    popularity: filmSnapshot.popularity,
    order: connection.order,
    fetchTimestamp: connection.fetchTimestamp,
    vote_average: filmSnapshot.voteAverage ?? undefined,
    vote_count: filmSnapshot.voteCount ?? undefined,
    creditType: connection.roleType,
    character: connection.roleType === "cast" ? connection.role : undefined,
    job: connection.roleType === "crew" ? connection.role : undefined,
  };
}

function buildPersonMovieCreditsByTmdbId(
  snapshot: IndexedDbSnapshot,
): Map<number, TmdbPersonMovieCreditsResponse> {
  const personMovieCreditsByTmdbId = new Map<number, TmdbPersonMovieCreditsResponse>();

  snapshot.films.forEach((filmSnapshot) => {
    filmSnapshot.people.forEach((connection) => {
      const creditsResponse =
        personMovieCreditsByTmdbId.get(connection.personTmdbId) ??
        { cast: [], crew: [] };
      const nextCredit = createTmdbMovieCreditFromSnapshotFilm(filmSnapshot, connection);

      if (connection.roleType === "cast") {
        creditsResponse.cast = [...(creditsResponse.cast ?? []), nextCredit];
      } else {
        creditsResponse.crew = [...(creditsResponse.crew ?? []), nextCredit];
      }

      personMovieCreditsByTmdbId.set(connection.personTmdbId, creditsResponse);
    });
  });

  return personMovieCreditsByTmdbId;
}

function inflateFilmCreditsResponse(
  filmSnapshot: IndexedDbSnapshotFilm,
  personSnapshotsByTmdbId: Map<number, IndexedDbSnapshotPerson>,
): TmdbMovieCreditsResponse | undefined {
  if (filmSnapshot.people.length === 0) {
    return undefined;
  }

  const cast: TmdbPersonCredit[] = [];
  const crew: TmdbPersonCredit[] = [];

  filmSnapshot.people.forEach((connection) => {
    const personSnapshot = personSnapshotsByTmdbId.get(connection.personTmdbId);
    if (!personSnapshot) {
      throw new Error(
        `IndexedDB snapshot is missing person ${connection.personTmdbId} referenced by film ${filmSnapshot.title}.`,
      );
    }

    const nextCredit = createTmdbPersonCreditFromSnapshotConnection(connection, personSnapshot);
    if (connection.roleType === "cast") {
      cast.push(nextCredit);
    } else {
      crew.push(nextCredit);
    }
  });

  return { cast, crew };
}

function deriveFilmPersonConnectionKeys(
  creditsResponse: TmdbMovieCreditsResponse | undefined,
): string[] {
  if (!creditsResponse) {
    return [];
  }

  return Array.from(
    new Set(
      getAssociatedPeopleFromMovieCredits({
        rawTmdbMovieCreditsResponse: creditsResponse,
      } as FilmRecord)
        .map((credit) => normalizeName(credit.name ?? ""))
        .filter(Boolean),
    ),
  );
}

function buildConnectionDerivedPersonSummaryByTmdbId(
  snapshot: IndexedDbSnapshot,
): Map<number, { fetchTimestamp: string; profilePath: string | null }> {
  const summaryByTmdbId = new Map<number, { fetchTimestamp: string; profilePath: string | null }>();

  snapshot.films.forEach((filmSnapshot) => {
    filmSnapshot.people.forEach((connection) => {
      const existingSummary = summaryByTmdbId.get(connection.personTmdbId);
      if (!existingSummary) {
        summaryByTmdbId.set(connection.personTmdbId, {
          fetchTimestamp: connection.fetchTimestamp,
          profilePath: connection.profilePath,
        });
        return;
      }

      summaryByTmdbId.set(connection.personTmdbId, {
        fetchTimestamp:
          chooseNewestFetchTimestamp(existingSummary.fetchTimestamp, connection.fetchTimestamp) ??
          existingSummary.fetchTimestamp,
        profilePath:
          mergeFetchedFieldValue(
            existingSummary.profilePath,
            connection.profilePath,
            existingSummary.fetchTimestamp,
            connection.fetchTimestamp,
          ) ?? null,
      });
    });
  });

  return summaryByTmdbId;
}

function getSnapshotFilmFetchTimestamp(
  filmSnapshot: IndexedDbSnapshotFilm,
): string | undefined {
  return filmSnapshot.people.reduce<string | undefined>(
    (latestFetchTimestamp, connection) =>
      chooseNewestFetchTimestamp(latestFetchTimestamp, connection.fetchTimestamp) ??
      latestFetchTimestamp ??
      connection.fetchTimestamp,
    filmSnapshot.fromTmdb?.fetchTimestamp,
  );
}

function inflateIndexedDbSnapshotCore(
  snapshot: IndexedDbSnapshot,
): LiveIndexedDbCoreSnapshot {
  if (
    snapshot.format !== "cinenerdle-indexed-db-snapshot" ||
    snapshot.version !== INDEXED_DB_SNAPSHOT_VERSION
  ) {
    throw new Error(`Unsupported IndexedDB snapshot version: ${String(snapshot.version)}`);
  }

  const personSnapshotsByTmdbId = new Map(
    snapshot.people
      .filter((personSnapshot) => getValidTmdbEntityId(personSnapshot.tmdbId) !== null)
      .map((personSnapshot) => [personSnapshot.tmdbId as number, personSnapshot] as const),
  );
  const personMovieCreditsByTmdbId = buildPersonMovieCreditsByTmdbId(snapshot);
  const connectionDerivedPersonSummaryByTmdbId =
    buildConnectionDerivedPersonSummaryByTmdbId(snapshot);
  const people = snapshot.people.map((personSnapshot) => {
    const movieCreditsResponse = personMovieCreditsByTmdbId.get(personSnapshot.tmdbId);
    const connectionSummary = connectionDerivedPersonSummaryByTmdbId.get(personSnapshot.tmdbId);
    const personRecord: PersonRecord = {
      id: personSnapshot.tmdbId,
      tmdbId: personSnapshot.tmdbId,
      lookupKey: getCinenerdlePersonId(personSnapshot.name),
      name: personSnapshot.name,
      nameLower: normalizeName(personSnapshot.name),
      movieConnectionKeys: Array.from(
        new Set(
          (personSnapshot.movieConnectionKeys ?? [])
            .map((movieKey) => normalizeTitle(movieKey))
            .filter(Boolean),
        ),
      ),
      tmdbSource: personSnapshot.fromTmdb ? "direct-person-fetch" : "connection-derived",
      rawTmdbPerson: createTmdbPersonFromSnapshot(personSnapshot, connectionSummary),
      rawTmdbPersonSearchResponse: undefined,
      rawTmdbMovieCreditsResponse: movieCreditsResponse,
      fetchTimestamp: personSnapshot.fromTmdb?.fetchTimestamp ?? connectionSummary?.fetchTimestamp,
    };

    personRecord.movieConnectionKeys = Array.from(
      new Set([
        ...personRecord.movieConnectionKeys,
        ...getResolvedPersonMovieConnectionKeys(personRecord),
      ]),
    );
    return personRecord;
  });
  const films = snapshot.films.map((filmSnapshot) => {
    const filmCreditsResponse = inflateFilmCreditsResponse(filmSnapshot, personSnapshotsByTmdbId);
    const filmRecord: FilmRecord = {
      id: filmSnapshot.tmdbId,
      tmdbId: filmSnapshot.tmdbId,
      lookupKey: getCinenerdleMovieId(filmSnapshot.title, filmSnapshot.year),
      title: filmSnapshot.title,
      titleLower: normalizeTitle(filmSnapshot.title),
      year: filmSnapshot.year,
      titleYear: getFilmKey(filmSnapshot.title, filmSnapshot.year),
      popularity: filmSnapshot.popularity,
      personConnectionKeys: Array.from(
        new Set([
          ...filmSnapshot.personConnectionKeys.map((personName) => normalizeName(personName)),
          ...deriveFilmPersonConnectionKeys(filmCreditsResponse),
        ].filter(Boolean)),
      ),
      tmdbSource: filmSnapshot.fromTmdb ? "direct-film-fetch" : "connection-derived",
      rawTmdbMovie: createTmdbMovieFromSnapshot(filmSnapshot),
      rawTmdbMovieSearchResponse: undefined,
      rawTmdbMovieCreditsResponse: filmCreditsResponse,
      fetchTimestamp: getSnapshotFilmFetchTimestamp(filmSnapshot),
    };

    return filmRecord;
  });

  return {
    people,
    films,
  };
}

export function inflateIndexedDbSnapshot(
  snapshot: IndexedDbSnapshot,
): LiveIndexedDbSnapshot {
  const inflatedCoreSnapshot = inflateIndexedDbSnapshotCore(snapshot);

  return {
    ...inflatedCoreSnapshot,
    searchableConnectionEntities: buildSnapshotSearchableConnectionEntities(
      inflatedCoreSnapshot.people,
      inflatedCoreSnapshot.films,
    ),
  };
}

export function stringifyIndexedDbSnapshot(
  snapshot: IndexedDbSnapshot,
): string {
  return escapeAmbiguousUnicodeCharacters(JSON.stringify(snapshot, null, 2));
}

export async function getIndexedDbSnapshot(): Promise<IndexedDbSnapshot> {
  return withStores(
    [
      PEOPLE_STORE_NAME,
      FILMS_STORE_NAME,
    ],
    "readonly",
    async (stores) => {
      const [storedPeople, storedFilms] = await Promise.all([
        indexedDbRequestToPromise<StoredPersonRecord[]>(
          stores.get(PEOPLE_STORE_NAME)!.getAll(),
        ),
        indexedDbRequestToPromise<StoredFilmRecord[]>(
          stores.get(FILMS_STORE_NAME)!.getAll(),
        ),
      ]);

      return {
        format: "cinenerdle-indexed-db-snapshot",
        version: INDEXED_DB_SNAPSHOT_VERSION,
        people: storedPeople ?? [],
        films: storedFilms ?? [],
      };
    },
  );
}

export async function hasCinenerdleIndexedDbRecords(): Promise<boolean> {
  return measureAsync(
    "idb.hasCinenerdleIndexedDbRecords",
    async () =>
      withStores(
        [
          PEOPLE_STORE_NAME,
          FILMS_STORE_NAME,
        ],
        "readonly",
        async (stores) => {
          const [peopleCount, filmCount] = await Promise.all([
            indexedDbRequestToPromise<number>(
              stores.get(PEOPLE_STORE_NAME)!.count(),
            ),
            indexedDbRequestToPromise<number>(
              stores.get(FILMS_STORE_NAME)!.count(),
            ),
          ]);

          return peopleCount > 0 || filmCount > 0;
        },
      ),
    {
      always: true,
    },
  );
}

export async function importIndexedDbSnapshot(
  snapshot: IndexedDbSnapshot,
  options?: {
    deferSearchablePersistence?: boolean;
    onProgress?: (event: string, details?: Record<string, unknown>) => void;
  },
): Promise<{
  isSearchablePersistencePending: boolean;
  searchableConnectionEntityCount: number;
}> {
  return measureAsync(
    "idb.importIndexedDbSnapshot",
    async () => {
      const importStartedAt = getIndexedDbPerfNow();
      options?.onProgress?.("start", {
        deferSearchablePersistence: options?.deferSearchablePersistence === true,
        filmCount: snapshot.films.length,
        peopleCount: snapshot.people.length,
        snapshotVersion: snapshot.version,
      });

      const normalizeStartedAt = getIndexedDbPerfNow();
      const inflatedCoreSnapshot = inflateIndexedDbSnapshotCore(snapshot);
      const storedPeople = snapshot.people;
      const storedFilms = snapshot.films;
      options?.onProgress?.("normalize-records", {
        elapsedMs: roundIndexedDbElapsedMs(getIndexedDbPerfNow() - normalizeStartedAt),
        filmCount: storedFilms.length,
        peopleCount: storedPeople.length,
        peopleWithTmdbIdCount: snapshot.people.filter((personSnapshot) =>
          getValidTmdbEntityId(personSnapshot.tmdbId) !== null).length,
      });

      const backfillStartedAt = getIndexedDbPerfNow();
      options?.onProgress?.("backfill-person-connections", {
        elapsedMs: roundIndexedDbElapsedMs(getIndexedDbPerfNow() - backfillStartedAt),
        filmCount: storedFilms.length,
      });

      resetSearchableConnectionEntityPersistenceState();
      let clearStoresElapsedMs = 0;
      let queuePeopleElapsedMs = 0;
      let queueFilmsElapsedMs = 0;
      const coreWriteTransactionStartedAt = getIndexedDbPerfNow();

      await withStores(
        [
          PEOPLE_STORE_NAME,
          FILMS_STORE_NAME,
          SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
          INDEXED_DB_METADATA_STORE_NAME,
        ],
        "readwrite",
        async (stores) => {
          const peopleStore = stores.get(PEOPLE_STORE_NAME)!;
          const filmsStore = stores.get(FILMS_STORE_NAME)!;

          const clearStartedAt = getIndexedDbPerfNow();
          await Promise.all([
            indexedDbRequestToPromise(peopleStore.clear()),
            indexedDbRequestToPromise(filmsStore.clear()),
            indexedDbRequestToPromise(
              stores.get(SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME)!.clear(),
            ),
            indexedDbRequestToPromise(
              stores.get(INDEXED_DB_METADATA_STORE_NAME)!.clear(),
            ),
          ]);
          clearStoresElapsedMs = roundIndexedDbElapsedMs(getIndexedDbPerfNow() - clearStartedAt);
          options?.onProgress?.("clear-stores", {
            elapsedMs: clearStoresElapsedMs,
            searchableStoreCleared: true,
          });

          const writePeopleStartedAt = getIndexedDbPerfNow();
          queueIndexedDbStoreWrites(peopleStore, storedPeople);
          queuePeopleElapsedMs = roundIndexedDbElapsedMs(getIndexedDbPerfNow() - writePeopleStartedAt);
          options?.onProgress?.("write-people", {
            elapsedMs: queuePeopleElapsedMs,
            mode: "queued-batch",
            peopleCount: storedPeople.length,
          });

          const writeFilmsStartedAt = getIndexedDbPerfNow();
          queueIndexedDbStoreWrites(filmsStore, storedFilms);
          queueFilmsElapsedMs = roundIndexedDbElapsedMs(getIndexedDbPerfNow() - writeFilmsStartedAt);
          options?.onProgress?.("write-films", {
            elapsedMs: queueFilmsElapsedMs,
            filmCount: storedFilms.length,
            mode: "queued-batch",
          });
        },
      );
      const coreWriteTransactionElapsedMs =
        roundIndexedDbElapsedMs(getIndexedDbPerfNow() - coreWriteTransactionStartedAt);
      options?.onProgress?.("commit-core-transaction", {
        elapsedMs: Math.max(
          0,
          roundIndexedDbElapsedMs(
            coreWriteTransactionElapsedMs -
            clearStoresElapsedMs -
            queuePeopleElapsedMs -
            queueFilmsElapsedMs,
          ),
        ),
        transactionElapsedMs: coreWriteTransactionElapsedMs,
      });

      const cacheRefreshStartedAt = getIndexedDbPerfNow();
      replaceCachedCoreRecords(inflatedCoreSnapshot);
      setIndexedDbFetchCountCache(0);
      dispatchCinenerdleRecordsUpdated();
      options?.onProgress?.("refresh-caches", {
        elapsedMs: roundIndexedDbElapsedMs(getIndexedDbPerfNow() - cacheRefreshStartedAt),
      });

      const searchableStartedAt = getIndexedDbPerfNow();
      const searchableConnectionEntities = buildSnapshotSearchableConnectionEntities(
        inflatedCoreSnapshot.people,
        inflatedCoreSnapshot.films,
      );
      options?.onProgress?.("build-searchable-entities", {
        elapsedMs: roundIndexedDbElapsedMs(getIndexedDbPerfNow() - searchableStartedAt),
        searchableConnectionEntityCount: searchableConnectionEntities.length,
      });

      const shouldDeferSearchablePersistence = options?.deferSearchablePersistence === true;
      if (shouldDeferSearchablePersistence) {
        void persistSearchableConnectionEntitiesInBackground(searchableConnectionEntities).catch(() => { });
      } else {
        await persistSearchableConnectionEntitiesInBackground(searchableConnectionEntities);
      }

      options?.onProgress?.("complete", {
        elapsedMs: roundIndexedDbElapsedMs(getIndexedDbPerfNow() - importStartedAt),
        filmCount: storedFilms.length,
        peopleCount: storedPeople.length,
        searchableConnectionEntityCount: searchableConnectionEntities.length,
      });
      return {
        isSearchablePersistencePending: shouldDeferSearchablePersistence,
        searchableConnectionEntityCount: searchableConnectionEntities.length,
      };
    },
    {
      always: true,
      summarizeResult: (result) => ({
        imported: true,
        isSearchablePersistencePending: result.isSearchablePersistencePending,
        searchableConnectionEntityCount: result.searchableConnectionEntityCount,
      }),
    },
  );
}

export async function getSearchableConnectionEntityByKey(
  key: string,
): Promise<SearchableConnectionEntityRecord | null> {
  if (!key) {
    return null;
  }

  const cachedRecord = searchableConnectionEntityByKeyCache.get(key);
  if (cachedRecord) {
    return cachedRecord;
  }

  await getAllSearchableConnectionEntities();
  return searchableConnectionEntityByKeyCache.get(key) ?? null;
}

export async function estimateIndexedDbUsageBytes(): Promise<number> {
  return measureAsync(
    "idb.estimateIndexedDbUsageBytes",
    async () => {
      const estimate = (await navigator.storage?.estimate?.()) as
        | (StorageEstimate & {
            usageDetails?: {
              indexedDB?: number;
            };
          })
        | undefined;
      return estimate?.usageDetails?.indexedDB ?? estimate?.usage ?? 0;
    },
    {
      always: true,
      summarizeResult: (bytes) => ({
        bytes,
      }),
    },
  );
}

export async function clearIndexedDb(): Promise<void> {
  await measureAsync(
    "idb.clearIndexedDb",
    async () => {
      await deleteCinenerdleIndexedDbDatabase();
    },
    {
      always: true,
    },
  );
}

export async function saveFilmRecord(filmRecord: FilmRecord): Promise<void> {
  await saveFilmRecords([filmRecord]);
}

export async function saveFilmRecords(filmRecords: FilmRecord[]): Promise<void> {
  await measureAsync(
    "idb.saveFilmRecords",
    async () => {
      if (filmRecords.length === 0) {
        return 0;
      }

      await ensureCoreRecordCachesReady();

      const existingFilmRecords = filmRecords.map((filmRecord) =>
        filmRecordByIdCache.get(getFilmCacheIdKey(filmRecord.id)) ??
        (filmRecord.tmdbId ? filmRecordByIdCache.get(getFilmCacheIdKey(filmRecord.tmdbId)) : null) ??
        null,
      );
      const storedFilmRecords = filmRecords.map((filmRecord) => createStoredFilmRecord(filmRecord));
      const derivedPeopleByTmdbId = new Map<number, PersonRecord>();
      filmRecords.forEach((filmRecord) => {
        getAssociatedPeopleFromMovieCredits(filmRecord).forEach((credit) => {
          const derivedPersonRecord = buildPersonRecordFromFilmCredit(filmRecord, credit);
          const derivedPersonTmdbId = getValidTmdbEntityId(derivedPersonRecord?.tmdbId);
          if (!derivedPersonRecord || !derivedPersonTmdbId) {
            return;
          }

          derivedPeopleByTmdbId.set(
            derivedPersonTmdbId,
            mergePersonRecords(
              derivedPeopleByTmdbId.get(derivedPersonTmdbId) ?? null,
              derivedPersonRecord,
            ),
          );
        });
      });
      const derivedPersonRecords = Array.from(derivedPeopleByTmdbId.values());
      const existingDerivedPersonRecords = derivedPersonRecords.map((personRecord) =>
        pickBestPersonRecord(
          personRecordByIdCache.get(personRecord.tmdbId ?? personRecord.id) ?? null,
          personRecordByNameCache.get(normalizeName(personRecord.name)) ?? null,
        ),
      );

      let mergedPersonRecords = derivedPersonRecords;
      await withStores(
        [PEOPLE_STORE_NAME, FILMS_STORE_NAME, SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME],
        "readwrite",
        async (stores) => {
          const peopleStore = stores.get(PEOPLE_STORE_NAME)!;
          const filmsStore = stores.get(FILMS_STORE_NAME)!;

          if (derivedPersonRecords.length > 0) {
            const existingStoredPeople = await Promise.all(
              derivedPersonRecords.map((personRecord) =>
                indexedDbRequestToPromise<StoredPersonRecord | undefined>(
                  peopleStore.get(personRecord.tmdbId ?? personRecord.id),
                )),
            );

            mergedPersonRecords = derivedPersonRecords.map((personRecord, index) => {
              const cachedExistingPersonRecord =
                personRecordByIdCache.get(personRecord.tmdbId ?? personRecord.id) ??
                personRecordByNameCache.get(normalizeName(personRecord.name));
              const storedPersonRecord = existingStoredPeople[index];
              const persistedExistingPersonRecord = storedPersonRecord
                ? inflateIndexedDbSnapshot({
                    format: "cinenerdle-indexed-db-snapshot",
                    version: INDEXED_DB_SNAPSHOT_VERSION,
                    people: [storedPersonRecord],
                    films: [],
                  }).people[0] ?? null
                : null;
              return mergePersonRecords(
                pickBestPersonRecord(cachedExistingPersonRecord, persistedExistingPersonRecord),
                personRecord,
              );
            });

            queueIndexedDbStoreWrites(
              peopleStore,
              mergedPersonRecords.map((personRecord) => createStoredPersonRecord(personRecord)),
            );
          }

          queueIndexedDbStoreWrites(filmsStore, storedFilmRecords);
        },
      );

      filmRecordQueryCache.clear();
      if (allPersonRecordsCache) {
        const nextPeopleById = new Map(allPersonRecordsCache.map((record) => [record.id, record] as const));
        mergedPersonRecords.forEach((personRecord) => {
          nextPeopleById.set(personRecord.id, personRecord);
        });
        allPersonRecordsCache = Array.from(nextPeopleById.values());
      }
      mergedPersonRecords.forEach((personRecord) => {
        cachePersonRecord(personRecord);
      });
      if (allFilmRecordsCache) {
        const nextFilmsById = new Map(
          allFilmRecordsCache.map((record) => [getFilmCacheIdKey(record.id), record] as const),
        );
        filmRecords.forEach((filmRecord) => {
          nextFilmsById.set(getFilmCacheIdKey(filmRecord.id), filmRecord);
          const filmTmdbId = filmRecord.tmdbId;
          if (filmTmdbId !== null && filmTmdbId !== undefined) {
            nextFilmsById.set(getFilmCacheIdKey(filmTmdbId), filmRecord);
          }
        });
        allFilmRecordsCache = Array.from(new Map(
          Array.from(nextFilmsById.values()).map((record) => [getFilmCacheIdKey(record.id), record] as const),
        ).values());
      }
      filmRecords.forEach((filmRecord) => {
        cacheFilmRecord(filmRecord);
      });

      updateFilmCountCacheForPersonNames([
        ...existingFilmRecords.flatMap((filmRecord) => filmRecord?.personConnectionKeys ?? []),
        ...filmRecords.flatMap((filmRecord) => filmRecord.personConnectionKeys),
      ]);
      updatePersonCountCacheForMovieKeys([
        ...existingDerivedPersonRecords.flatMap((personRecord) =>
          personRecord ? getResolvedPersonMovieConnectionKeys(personRecord) : []),
        ...mergedPersonRecords.flatMap((personRecord) => getResolvedPersonMovieConnectionKeys(personRecord)),
      ]);

      const existingSearchRecords = [
        ...existingFilmRecords.flatMap((filmRecord) =>
          filmRecord ? collectSearchableConnectionEntitiesFromFilmRecord(filmRecord) : []),
        ...existingDerivedPersonRecords.flatMap((personRecord) =>
          personRecord ? collectSearchableConnectionEntitiesFromPersonRecord(personRecord) : []),
      ];
      const nextSearchRecords = [
        ...filmRecords.flatMap((filmRecord) => collectSearchableConnectionEntitiesFromFilmRecord(filmRecord)),
        ...mergedPersonRecords.flatMap((personRecord) =>
          collectSearchableConnectionEntitiesFromPersonRecord(personRecord)),
      ];
      invalidateSearchableConnectionPopularityCachesForRecords([
        ...existingSearchRecords,
        ...nextSearchRecords,
      ]);
      await synchronizePersistedSearchableConnectionEntityKeys([
        ...existingSearchRecords.map((record) => record.key),
        ...nextSearchRecords.map((record) => record.key),
      ]);

      dispatchCinenerdleRecordsUpdated();
      return nextSearchRecords.length;
    },
    {
      always: true,
      details: {
        filmRecordCount: filmRecords.length,
      },
      summarizeResult: (searchRecordCount) => ({
        searchRecordCount,
      }),
    },
  );
}

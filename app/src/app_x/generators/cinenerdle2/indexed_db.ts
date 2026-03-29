import {
  FILMS_STORE_NAME,
  INDEXED_DB_NAME,
  INDEXED_DB_VERSION,
  PEOPLE_STORE_NAME,
  SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
} from "./constants";
import { chooseBestFilmRecord, withDerivedFilmFields } from "./records";
import type {
  FilmRecord,
  PersonRecord,
  SearchableConnectionEntityRecord,
} from "./types";
import {
  formatMoviePathLabel,
  getValidTmdbEntityId,
  getAssociatedPeopleFromMovieCredits,
  getAllowedConnectedTmdbMovieCredits,
  getMovieCreditPersonPopularityLookup,
  getFilmKey,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getSnapshotConnectionLabels,
  normalizeName,
  normalizeTitle,
} from "./utils";

const REQUIRED_OBJECT_STORE_NAMES = [
  PEOPLE_STORE_NAME,
  FILMS_STORE_NAME,
  SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
] as const;

export const CINENERDLE_RECORDS_UPDATED_EVENT = "cinenerdle:records-updated";

const personRecordByIdCache = new Map<number, PersonRecord>();
const personRecordByNameCache = new Map<string, PersonRecord>();
const filmRecordByIdCache = new Map<string, FilmRecord>();
const filmRecordQueryCache = new Map<string, FilmRecord | null>();
const personCountByMovieKeyCache = new Map<string, number>();
const filmCountByPersonNameCache = new Map<string, number>();
const searchableConnectionEntityByKeyCache = new Map<string, SearchableConnectionEntityRecord>();
let allSearchableConnectionEntitiesCache: SearchableConnectionEntityRecord[] | null = null;

function getFilmCacheIdKey(id: number | string): string {
  return String(id);
}

function getFilmQueryCacheKey(title: string, year = ""): string {
  const normalizedTitle = normalizeTitle(title);
  return year
    ? `title-year:${normalizedTitle}:${year.trim()}`
    : `title:${normalizedTitle}`;
}

function clearInMemoryIndexedDbCaches(): void {
  personRecordByIdCache.clear();
  personRecordByNameCache.clear();
  filmRecordByIdCache.clear();
  filmRecordQueryCache.clear();
  personCountByMovieKeyCache.clear();
  filmCountByPersonNameCache.clear();
  searchableConnectionEntityByKeyCache.clear();
  allSearchableConnectionEntitiesCache = null;
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
  }

  if (recordTmdbId) {
    personRecordByIdCache.set(recordTmdbId, personRecord);
  }

  if (normalizedName) {
    personRecordByNameCache.set(normalizedName, personRecord);
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

function dispatchCinenerdleRecordsUpdated(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(CINENERDLE_RECORDS_UPDATED_EVENT));
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

  const personRecordEntry = createPersonSearchRecord(
    personRecord.name,
    personRecord.tmdbId ?? personRecord.id,
    personRecord.rawTmdbPerson?.popularity ?? 0,
  );
  if (personRecordEntry) {
    recordsByKey.set(personRecordEntry.key, personRecordEntry);
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
  const coveredFallbackPersonNames = new Set<string>();
  const movieCreditPopularityByName = getMovieCreditPersonPopularityLookup(filmRecord);

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
      if (getValidTmdbEntityId(personTmdbId)) {
        coveredFallbackPersonNames.add(normalizeName(personName));
      }
    }
  };

  getAssociatedPeopleFromMovieCredits(filmRecord).forEach((credit) => {
    upsertPersonName(credit.name ?? "", credit.id, credit.popularity ?? 0);
  });
  getSnapshotConnectionLabels(filmRecord).forEach((personName) => {
    const normalizedPersonName = normalizeName(personName);
    if (coveredFallbackPersonNames.has(normalizedPersonName)) {
      return;
    }

    upsertPersonName(personName, null, movieCreditPopularityByName.get(normalizedPersonName) ?? 0);
  });
  filmRecord.personConnectionKeys.forEach((personName) => {
    const normalizedPersonName = normalizeName(personName);
    if (coveredFallbackPersonNames.has(normalizedPersonName)) {
      return;
    }

    upsertPersonName(personName, null, movieCreditPopularityByName.get(normalizedPersonName) ?? 0);
  });

  return Array.from(recordsByKey.values());
}

async function openIndexedDb(): Promise<IDBDatabase> {
  function hasRequiredObjectStores(database: IDBDatabase): boolean {
    return REQUIRED_OBJECT_STORE_NAMES.every((storeName) =>
      database.objectStoreNames.contains(storeName),
    );
  }

  function deleteIndexedDb(): Promise<void> {
    return new Promise((resolve, reject) => {
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
          const peopleStore = database.createObjectStore(PEOPLE_STORE_NAME, {
            keyPath: "id",
          });
          peopleStore.createIndex("nameLower", "nameLower", { unique: false });
          peopleStore.createIndex("movieConnectionKeys", "movieConnectionKeys", {
            unique: false,
            multiEntry: true,
          });
        }

        if (!database.objectStoreNames.contains(FILMS_STORE_NAME)) {
          const filmsStore = database.createObjectStore(FILMS_STORE_NAME, {
            keyPath: "id",
          });
          filmsStore.createIndex("titleYear", "titleYear", { unique: false });
          filmsStore.createIndex("titleLower", "titleLower", { unique: false });
          filmsStore.createIndex("personConnectionKeys", "personConnectionKeys", {
            unique: false,
            multiEntry: true,
          });
          filmsStore.createIndex("isCinenerdleDailyStarter", "isCinenerdleDailyStarter", {
            unique: false,
          });
        }

        if (!database.objectStoreNames.contains(SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME)) {
          const searchableStore = database.createObjectStore(
            SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
            {
              keyPath: "key",
            },
          );
          searchableStore.createIndex("type", "type", { unique: false });
          searchableStore.createIndex("nameLower", "nameLower", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        reject(request.error ?? new Error("Unable to open IndexedDB"));
      };
    });

    database.onversionchange = () => {
      database.close();
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
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore, transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const database = await openIndexedDb();

  try {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = await callback(store, transaction);
    await transactionDonePromise(transaction);
    return result;
  } finally {
    database.close();
  }
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

  try {
    const transaction = database.transaction(storeNames, mode);
    const stores = new Map(
      storeNames.map((storeName) => [storeName, transaction.objectStore(storeName)]),
    );
    const result = await callback(stores, transaction);
    await transactionDonePromise(transaction);
    return result;
  } finally {
    database.close();
  }
}

async function upsertSearchableConnectionEntities(
  store: IDBObjectStore,
  records: SearchableConnectionEntityRecord[],
): Promise<void> {
  const uniqueRecords = Array.from(records.reduce((recordsByKey, record) => {
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
  }, new Map<string, SearchableConnectionEntityRecord>()).values());

  for (const record of uniqueRecords) {
    await indexedDbRequestToPromise(store.put(record));
  }
}

function buildSearchableConnectionPopularityLookup(
  personRecords: PersonRecord[],
  filmRecords: FilmRecord[],
): Map<string, number> {
  const popularityByKey = new Map<string, number>();

  personRecords.forEach((personRecord) => {
    const popularity = personRecord.rawTmdbPerson?.popularity ?? 0;
    const canonicalKey = getConnectionPersonEntityKey(personRecord.name, personRecord.tmdbId ?? personRecord.id);
    const legacyKey = getConnectionPersonEntityKey(personRecord.name);
    popularityByKey.set(canonicalKey, Math.max(popularityByKey.get(canonicalKey) ?? 0, popularity));
    popularityByKey.set(legacyKey, Math.max(popularityByKey.get(legacyKey) ?? 0, popularity));
  });

  filmRecords.forEach((filmRecord) => {
    const key = getConnectionMovieEntityKey(filmRecord.title, filmRecord.year);
    const popularity = filmRecord.popularity ?? 0;
    popularityByKey.set(key, Math.max(popularityByKey.get(key) ?? 0, popularity));
  });

  return popularityByKey;
}

export async function getPersonRecordByName(
  personName: string,
): Promise<PersonRecord | null> {
  const normalizedPersonName = normalizeName(personName);
  if (!normalizedPersonName) {
    return null;
  }

  const cachedRecord = personRecordByNameCache.get(normalizedPersonName);
  if (cachedRecord) {
    return cachedRecord;
  }

  return withStore(PEOPLE_STORE_NAME, "readonly", async (store) => {
    const personRecord = await indexedDbRequestToPromise<PersonRecord | undefined>(
      store.index("nameLower").get(normalizedPersonName),
    );

    const resolvedRecord = personRecord ?? null;
    cachePersonRecord(resolvedRecord);
    return resolvedRecord;
  });
}

export async function getPersonRecordById(
  id: number | null | undefined,
): Promise<PersonRecord | null> {
  if (!id) {
    return null;
  }

  const cachedRecord = personRecordByIdCache.get(id);
  if (cachedRecord) {
    return cachedRecord;
  }

  return withStore(PEOPLE_STORE_NAME, "readonly", async (store) => {
    const record = await indexedDbRequestToPromise<PersonRecord | undefined>(
      store.get(id),
    );

    const resolvedRecord = record ?? null;
    cachePersonRecord(resolvedRecord);
    return resolvedRecord;
  });
}

export async function getPersonRecordsByMovieKey(
  movieKey: string,
): Promise<PersonRecord[]> {
  if (!movieKey) {
    return [];
  }

  return withStore(PEOPLE_STORE_NAME, "readonly", async (store) => {
    const records = await indexedDbRequestToPromise<PersonRecord[]>(
      store.index("movieConnectionKeys").getAll(movieKey),
    );

    return records ?? [];
  });
}

export async function getPersonRecordCountsByMovieKeys(
  movieKeys: string[],
): Promise<Map<string, number>> {
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

  return withStore(PEOPLE_STORE_NAME, "readonly", async (store) => {
    const movieConnectionIndex = store.index("movieConnectionKeys");
    const entries = await Promise.all(
      missingMovieKeys.map(async (movieKey) => [
        movieKey,
        await indexedDbRequestToPromise<number>(movieConnectionIndex.count(movieKey)),
      ] as const),
    );

    entries.forEach(([movieKey, count]) => {
      personCountByMovieKeyCache.set(movieKey, count);
      resolvedCounts.set(movieKey, count);
    });

    return resolvedCounts;
  });
}

export async function getAllPersonRecords(): Promise<PersonRecord[]> {
  return withStore(PEOPLE_STORE_NAME, "readonly", async (store) => {
    const records = await indexedDbRequestToPromise<PersonRecord[]>(store.getAll());
    return records ?? [];
  });
}

export async function savePersonRecord(personRecord: PersonRecord): Promise<void> {
  const searchRecords = collectSearchableConnectionEntitiesFromPersonRecord(personRecord);
  const canonicalSearchRecord = createPersonSearchRecord(
    personRecord.name,
    personRecord.tmdbId ?? personRecord.id,
  );
  const legacySearchRecord = createPersonSearchRecord(personRecord.name);

  await withStores(
    [PEOPLE_STORE_NAME, SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME],
    "readwrite",
    async (stores) => {
      await indexedDbRequestToPromise(
        stores.get(PEOPLE_STORE_NAME)!.put(personRecord),
      );
      await upsertSearchableConnectionEntities(
        stores.get(SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME)!,
        searchRecords,
      );

      if (
        canonicalSearchRecord &&
        legacySearchRecord &&
        canonicalSearchRecord.key !== legacySearchRecord.key
      ) {
        await indexedDbRequestToPromise(
          stores.get(SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME)!.delete(legacySearchRecord.key),
        );
      }
    },
  );

  cachePersonRecord(personRecord);
  personCountByMovieKeyCache.clear();
  cacheSearchableConnectionEntities(searchRecords);
  if (
    canonicalSearchRecord &&
    legacySearchRecord &&
    canonicalSearchRecord.key !== legacySearchRecord.key
  ) {
    removeCachedSearchableConnectionEntity(legacySearchRecord.key);
  }

  dispatchCinenerdleRecordsUpdated();
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

  return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
    const record = await indexedDbRequestToPromise<FilmRecord | undefined>(
      store.get(id),
    );

    const resolvedRecord = record ?? null;
    cacheFilmRecord(resolvedRecord);
    return resolvedRecord;
  });
}

export async function getFilmRecordsByTitle(title: string): Promise<FilmRecord[]> {
  return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
    const records = await indexedDbRequestToPromise<FilmRecord[]>(
      store.index("titleLower").getAll(normalizeTitle(title)),
    );

    return records ?? [];
  });
}

export async function getFilmRecordByTitleAndYear(
  title: string,
  year = "",
): Promise<FilmRecord | null> {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) {
    return null;
  }

  const queryCacheKey = getFilmQueryCacheKey(normalizedTitle, year);
  if (filmRecordQueryCache.has(queryCacheKey)) {
    return filmRecordQueryCache.get(queryCacheKey) ?? null;
  }

  if (year) {
    return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
      const exactRecords = await indexedDbRequestToPromise<FilmRecord[]>(
        store.index("titleYear").getAll(getFilmKey(normalizedTitle, year)),
      );

      const resolvedRecord = chooseBestFilmRecord(exactRecords ?? [], normalizedTitle, year);
      cacheFilmRecord(resolvedRecord);
      filmRecordQueryCache.set(queryCacheKey, resolvedRecord);
      return resolvedRecord;
    });
  }

  const records = await getFilmRecordsByTitle(normalizedTitle);
  const resolvedRecord = chooseBestFilmRecord(records, normalizedTitle, year);
  filmRecordQueryCache.set(queryCacheKey, resolvedRecord);
  cacheFilmRecord(resolvedRecord);
  return resolvedRecord;
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

  return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
    const entries = await Promise.all(
      missingIds.map(async (id) => {
        const record = await indexedDbRequestToPromise<FilmRecord | undefined>(
          store.get(id),
        );
        return record ? [id, record] : null;
      }),
    );

    entries
      .filter(
        (entry): entry is [number | string, FilmRecord] => entry !== null,
      )
      .forEach(([id, record]) => {
        cacheFilmRecord(record);
        resolvedRecords.set(id, record);
      });

    return resolvedRecords;
  });
}

export async function getAllFilmRecords(): Promise<FilmRecord[]> {
  return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
    const records = await indexedDbRequestToPromise<FilmRecord[]>(store.getAll());
    return records ?? [];
  });
}

export async function getFilmRecordsByPersonConnectionKey(
  personName: string,
): Promise<FilmRecord[]> {
  if (!personName) {
    return [];
  }

  return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
    const records = await indexedDbRequestToPromise<FilmRecord[]>(
      store.index("personConnectionKeys").getAll(normalizeName(personName)),
    );

    return records ?? [];
  });
}

export async function getFilmRecordCountsByPersonConnectionKeys(
  personNames: string[],
): Promise<Map<string, number>> {
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

  return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
    const personConnectionIndex = store.index("personConnectionKeys");
    const entries = await Promise.all(
      missingNames.map(async (personName) => [
        personName,
        await indexedDbRequestToPromise<number>(personConnectionIndex.count(personName)),
      ] as const),
    );

    entries.forEach(([personName, count]) => {
      filmCountByPersonNameCache.set(personName, count);
      resolvedCounts.set(personName, count);
    });

    return resolvedCounts;
  });
}

export async function getCinenerdleStarterFilmRecords(): Promise<FilmRecord[]> {
  return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
    const indexedRecords = await indexedDbRequestToPromise<FilmRecord[]>(
      store.index("isCinenerdleDailyStarter").getAll(1),
    );

    if ((indexedRecords ?? []).length > 0) {
      return (indexedRecords ?? []).sort(
        (left, right) => (right.popularity ?? 0) - (left.popularity ?? 0),
      );
    }

    const allRecords = await indexedDbRequestToPromise<FilmRecord[]>(store.getAll());
    const starterRecords = (allRecords ?? []).filter(
      (record) => record.isCinenerdleDailyStarter === 1 || record.rawCinenerdleDailyStarter,
    );
    const fallbackRecords = starterRecords
      .map((record) => withDerivedFilmFields(record))
      .sort((left, right) => (right.popularity ?? 0) - (left.popularity ?? 0));

    if (fallbackRecords.length > 0) {
      void saveFilmRecords(
        starterRecords
          .filter((record) => record.isCinenerdleDailyStarter !== 1)
          .map((record) => withDerivedFilmFields(record)),
      );
    }

    return fallbackRecords;
  });
}

export async function getAllSearchableConnectionEntities(): Promise<
  SearchableConnectionEntityRecord[]
> {
  if (allSearchableConnectionEntitiesCache) {
    return allSearchableConnectionEntitiesCache;
  }

  return withStores(
    [
      SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
      PEOPLE_STORE_NAME,
      FILMS_STORE_NAME,
    ],
    "readonly",
    async (stores) => {
      const searchStore = stores.get(SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME)!;
      const records = await indexedDbRequestToPromise<SearchableConnectionEntityRecord[]>(
        searchStore.getAll(),
      );

      const nextRecords = records ?? [];
      if (nextRecords.every((record) => typeof record.popularity === "number")) {
        allSearchableConnectionEntitiesCache = nextRecords;
        nextRecords.forEach((record) => {
          searchableConnectionEntityByKeyCache.set(record.key, record);
        });
        return nextRecords;
      }

      const [personRecords, filmRecords] = await Promise.all([
        indexedDbRequestToPromise<PersonRecord[]>(stores.get(PEOPLE_STORE_NAME)!.getAll()),
        indexedDbRequestToPromise<FilmRecord[]>(stores.get(FILMS_STORE_NAME)!.getAll()),
      ]);
      const popularityByKey = buildSearchableConnectionPopularityLookup(
        personRecords ?? [],
        filmRecords ?? [],
      );

      const resolvedRecords = nextRecords.map((record) => ({
        ...record,
        popularity: record.popularity ?? popularityByKey.get(record.key) ?? 0,
      }));
      allSearchableConnectionEntitiesCache = resolvedRecords;
      resolvedRecords.forEach((record) => {
        searchableConnectionEntityByKeyCache.set(record.key, record);
      });
      return resolvedRecords;
    },
  );
}

export async function getIndexedDbSnapshot(): Promise<{
  people: PersonRecord[];
  films: FilmRecord[];
  searchableConnectionEntities: SearchableConnectionEntityRecord[];
}> {
  return withStores(
    [
      PEOPLE_STORE_NAME,
      FILMS_STORE_NAME,
      SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
    ],
    "readonly",
    async (stores) => {
      const [people, films, searchableConnectionEntities] = await Promise.all([
        indexedDbRequestToPromise<PersonRecord[]>(
          stores.get(PEOPLE_STORE_NAME)!.getAll(),
        ),
        indexedDbRequestToPromise<FilmRecord[]>(
          stores.get(FILMS_STORE_NAME)!.getAll(),
        ),
        indexedDbRequestToPromise<SearchableConnectionEntityRecord[]>(
          stores.get(SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME)!.getAll(),
        ),
      ]);

      return {
        people: people ?? [],
        films: films ?? [],
        searchableConnectionEntities: searchableConnectionEntities ?? [],
      };
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

  return withStore(
    SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
    "readonly",
    async (store) => {
      const record = await indexedDbRequestToPromise<
        SearchableConnectionEntityRecord | undefined
      >(store.get(key));
      const resolvedRecord = record ?? null;
      if (resolvedRecord) {
        searchableConnectionEntityByKeyCache.set(resolvedRecord.key, resolvedRecord);
      }
      return resolvedRecord;
    },
  );
}

export async function estimateIndexedDbUsageBytes(): Promise<number> {
  const estimate = (await navigator.storage?.estimate?.()) as
    | (StorageEstimate & {
        usageDetails?: {
          indexedDB?: number;
        };
      })
    | undefined;
  return estimate?.usageDetails?.indexedDB ?? estimate?.usage ?? 0;
}

export async function clearIndexedDb(): Promise<void> {
  const database = await openIndexedDb();

  try {
    const transaction = database.transaction(
      [
        PEOPLE_STORE_NAME,
        FILMS_STORE_NAME,
        SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
      ],
      "readwrite",
    );

    await Promise.all([
      indexedDbRequestToPromise(
        transaction.objectStore(PEOPLE_STORE_NAME).clear(),
      ),
      indexedDbRequestToPromise(
        transaction.objectStore(FILMS_STORE_NAME).clear(),
      ),
      indexedDbRequestToPromise(
        transaction.objectStore(SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME).clear(),
      ),
    ]);

    await transactionDonePromise(transaction);
  } finally {
    database.close();
  }

  clearInMemoryIndexedDbCaches();
}

export async function saveFilmRecord(filmRecord: FilmRecord): Promise<void> {
  await saveFilmRecords([filmRecord]);
}

export async function saveFilmRecords(filmRecords: FilmRecord[]): Promise<void> {
  if (filmRecords.length === 0) {
    return;
  }

  const searchRecords = filmRecords.flatMap(collectSearchableConnectionEntitiesFromFilmRecord);

  await withStores(
    [FILMS_STORE_NAME, SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME],
    "readwrite",
    async (stores) => {
      const filmsStore = stores.get(FILMS_STORE_NAME)!;

      for (const filmRecord of filmRecords) {
        await indexedDbRequestToPromise(filmsStore.put(filmRecord));
      }

      await upsertSearchableConnectionEntities(
        stores.get(SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME)!,
        searchRecords,
      );
    },
  );

  filmRecordQueryCache.clear();
  filmCountByPersonNameCache.clear();
  filmRecords.forEach((filmRecord) => {
    cacheFilmRecord(filmRecord);
  });
  cacheSearchableConnectionEntities(searchRecords);

  dispatchCinenerdleRecordsUpdated();
}

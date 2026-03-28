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
  getFilmKey,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getSnapshotConnectionLabels,
  getTmdbMovieCredits,
  normalizeName,
  normalizeTitle,
} from "./utils";

const REQUIRED_OBJECT_STORE_NAMES = [
  PEOPLE_STORE_NAME,
  FILMS_STORE_NAME,
  SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
] as const;

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

  getTmdbMovieCredits(personRecord).forEach((credit) => {
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
    if (coveredFallbackPersonNames.has(normalizeName(personName))) {
      return;
    }

    upsertPersonName(personName);
  });
  filmRecord.personConnectionKeys.forEach((personName) => {
    if (coveredFallbackPersonNames.has(normalizeName(personName))) {
      return;
    }

    upsertPersonName(personName);
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
  return withStore(PEOPLE_STORE_NAME, "readonly", async (store) => {
    const personRecord = await indexedDbRequestToPromise<PersonRecord | undefined>(
      store.index("nameLower").get(normalizeName(personName)),
    );

    return personRecord ?? null;
  });
}

export async function getPersonRecordById(
  id: number | null | undefined,
): Promise<PersonRecord | null> {
  if (!id) {
    return null;
  }

  return withStore(PEOPLE_STORE_NAME, "readonly", async (store) => {
    const record = await indexedDbRequestToPromise<PersonRecord | undefined>(
      store.get(id),
    );

    return record ?? null;
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
}

export async function getFilmRecordById(
  id: number | string | null | undefined,
): Promise<FilmRecord | null> {
  if (id === null || id === undefined || id === "") {
    return null;
  }

  return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
    const record = await indexedDbRequestToPromise<FilmRecord | undefined>(
      store.get(id),
    );

    return record ?? null;
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

  if (year) {
    return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
      const exactRecords = await indexedDbRequestToPromise<FilmRecord[]>(
        store.index("titleYear").getAll(getFilmKey(normalizedTitle, year)),
      );

      return chooseBestFilmRecord(exactRecords ?? [], normalizedTitle, year);
    });
  }

  const records = await getFilmRecordsByTitle(normalizedTitle);
  return chooseBestFilmRecord(records, normalizedTitle, year);
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

  return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
    const entries = await Promise.all(
      uniqueIds.map(async (id) => {
        const record = await indexedDbRequestToPromise<FilmRecord | undefined>(
          store.get(id),
        );
        return record ? [id, record] : null;
      }),
    );

    return new Map(
      entries.filter(
        (entry): entry is [number | string, FilmRecord] => entry !== null,
      ),
    );
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

      return nextRecords.map((record) => ({
        ...record,
        popularity: record.popularity ?? popularityByKey.get(record.key) ?? 0,
      }));
    },
  );
}

export async function getSearchableConnectionEntityByKey(
  key: string,
): Promise<SearchableConnectionEntityRecord | null> {
  if (!key) {
    return null;
  }

  return withStore(
    SEARCHABLE_CONNECTION_ENTITIES_STORE_NAME,
    "readonly",
    async (store) => {
      const record = await indexedDbRequestToPromise<
        SearchableConnectionEntityRecord | undefined
      >(store.get(key));
      return record ?? null;
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
}

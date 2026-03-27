import {
  FILMS_STORE_NAME,
  INDEXED_DB_NAME,
  INDEXED_DB_VERSION,
  PEOPLE_STORE_NAME,
} from "./constants";
import { chooseBestFilmRecord } from "./records";
import type { FilmRecord, PersonRecord } from "./types";
import { normalizeName, normalizeTitle } from "./utils";

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

async function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(request.error ?? new Error("Unable to open IndexedDB"));
    };
  });
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
  await withStore(PEOPLE_STORE_NAME, "readwrite", async (store) => {
    await indexedDbRequestToPromise(store.put(personRecord));
  });
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
  const records = await getFilmRecordsByTitle(title);
  return chooseBestFilmRecord(records, title, year);
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

    return new Map(entries.filter((entry): entry is [number | string, FilmRecord] => entry !== null));
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

export async function getAllFilmRecords(): Promise<FilmRecord[]> {
  return withStore(FILMS_STORE_NAME, "readonly", async (store) => {
    const records = await indexedDbRequestToPromise<FilmRecord[]>(store.getAll());
    return records ?? [];
  });
}

export async function estimateIndexedDbUsageBytes(): Promise<number> {
  const [peopleRecords, filmRecords] = await Promise.all([
    getAllPersonRecords(),
    getAllFilmRecords(),
  ]);

  return new Blob([JSON.stringify({ peopleRecords, filmRecords })]).size;
}

function stripCinenerdleFilmData(filmRecord: FilmRecord): FilmRecord {
  const { rawCinenerdleDailyStarter, cinenerdleSnapshot, ...persistedFilmRecord } =
    filmRecord;
  void rawCinenerdleDailyStarter;
  void cinenerdleSnapshot;
  return persistedFilmRecord;
}

export async function clearIndexedDb(): Promise<void> {
  const database = await openIndexedDb();

  try {
    const transaction = database.transaction(
      [PEOPLE_STORE_NAME, FILMS_STORE_NAME],
      "readwrite",
    );

    await Promise.all([
      indexedDbRequestToPromise(
        transaction.objectStore(PEOPLE_STORE_NAME).clear(),
      ),
      indexedDbRequestToPromise(
        transaction.objectStore(FILMS_STORE_NAME).clear(),
      ),
    ]);

    await transactionDonePromise(transaction);
  } finally {
    database.close();
  }
}

export async function getCachedStarterFilms(): Promise<FilmRecord[]> {
  const records = await getAllFilmRecords();

  return records
    .filter((record) => record.rawCinenerdleDailyStarter)
    .sort((left, right) => (right.popularity ?? 0) - (left.popularity ?? 0));
}

export async function saveFilmRecord(filmRecord: FilmRecord): Promise<void> {
  await withStore(FILMS_STORE_NAME, "readwrite", async (store) => {
    await indexedDbRequestToPromise(store.put(stripCinenerdleFilmData(filmRecord)));
  });
}

export async function saveFilmRecords(filmRecords: FilmRecord[]): Promise<void> {
  if (filmRecords.length === 0) {
    return;
  }

  await withStore(FILMS_STORE_NAME, "readwrite", async (store) => {
    for (const filmRecord of filmRecords) {
      await indexedDbRequestToPromise(
        store.put(stripCinenerdleFilmData(filmRecord)),
      );
    }
  });
}

import {
  getCinenerdleStarterFilmRecords,
  getFilmRecordByTitleAndYear,
  getFilmRecordsByPersonConnectionKey,
  getPersonRecordByName,
  getPersonRecordsByMovieKey,
} from "./indexed_db";
import type {
  FilmRecord,
  PersonRecord,
  SearchableConnectionEntityRecord,
} from "./types";
import {
  formatMoviePathLabel,
  getAssociatedPeopleFromMovieCredits,
  getFilmKey,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getSnapshotConnectionLabels,
  getTmdbMovieCredits,
  normalizeName,
  normalizeTitle,
} from "./utils";

export type ConnectionEntity = {
  key: string;
  kind: "cinenerdle" | "movie" | "person";
  name: string;
  year: string;
  label: string;
  connectionCount: number;
  hasCachedTmdbSource: boolean;
};

export type ConnectionSearchResult = {
  status: "found" | "not_found" | "timeout";
  path: ConnectionEntity[];
  elapsedMs: number;
};

export function getMovieConnectionEntityKey(title: string, year = ""): string {
  return `movie:${normalizeTitle(title)}:${year.trim()}`;
}

export function getPersonConnectionEntityKey(name: string): string {
  return `person:${normalizeName(name)}`;
}

export function getCinenerdleConnectionEntityKey(): string {
  return "cinenerdle";
}

export function getConnectionEdgeKey(leftKey: string, rightKey: string): string {
  return [leftKey, rightKey].sort().join("|");
}

export function hasCachedTmdbSourceForMovieRecord(movieRecord: FilmRecord | null): boolean {
  return Boolean(
    movieRecord?.tmdbCreditsSavedAt ||
      movieRecord?.rawTmdbMovieCreditsResponse,
  );
}

export function hasCachedTmdbSourceForPersonRecord(personRecord: PersonRecord | null): boolean {
  return Boolean(
    personRecord?.savedAt ||
      personRecord?.rawTmdbPerson ||
      personRecord?.rawTmdbPersonSearchResponse ||
      personRecord?.rawTmdbMovieCreditsResponse,
  );
}

export function createConnectionEntityFromMovieRecord(movieRecord: FilmRecord): ConnectionEntity {
  return {
    key: getMovieConnectionEntityKey(movieRecord.title, movieRecord.year),
    kind: "movie",
    name: movieRecord.title,
    year: movieRecord.year,
    label: formatMoviePathLabel(movieRecord.title, movieRecord.year),
    connectionCount: Math.max(movieRecord.personConnectionKeys.length, 1),
    hasCachedTmdbSource: hasCachedTmdbSourceForMovieRecord(movieRecord),
  };
}

export function createConnectionEntityFromPersonRecord(personRecord: PersonRecord): ConnectionEntity {
  return {
    key: getPersonConnectionEntityKey(personRecord.name),
    kind: "person",
    name: personRecord.name,
    year: "",
    label: personRecord.name,
    connectionCount: Math.max(personRecord.movieConnectionKeys.length, 1),
    hasCachedTmdbSource: hasCachedTmdbSourceForPersonRecord(personRecord),
  };
}

export function createCinenerdleConnectionEntity(starterCount: number): ConnectionEntity {
  return {
    key: getCinenerdleConnectionEntityKey(),
    kind: "cinenerdle",
    name: "cinenerdle",
    year: "",
    label: "cinenerdle",
    connectionCount: Math.max(starterCount, 1),
    hasCachedTmdbSource: true,
  };
}

export function createFallbackConnectionEntity(
  item: {
    kind: "cinenerdle" | "movie" | "person";
    name: string;
    year?: string;
  },
): ConnectionEntity {
  if (item.kind === "cinenerdle") {
    return createCinenerdleConnectionEntity(1);
  }

  if (item.kind === "movie") {
    return {
      key: getMovieConnectionEntityKey(item.name, item.year ?? ""),
      kind: "movie",
      name: item.name,
      year: item.year ?? "",
      label: formatMoviePathLabel(item.name, item.year ?? ""),
      connectionCount: 0,
      hasCachedTmdbSource: false,
    };
  }

  return {
    key: getPersonConnectionEntityKey(item.name),
    kind: "person",
    name: item.name,
    year: "",
    label: item.name,
    connectionCount: 0,
    hasCachedTmdbSource: false,
  };
}

function parseMovieConnectionEntityKey(key: string): { name: string; year: string } {
  const rawValue = key.startsWith("movie:") ? key.slice("movie:".length) : key;
  const lastColonIndex = rawValue.lastIndexOf(":");

  if (lastColonIndex < 0) {
    return {
      name: rawValue,
      year: "",
    };
  }

  return {
    name: rawValue.slice(0, lastColonIndex),
    year: rawValue.slice(lastColonIndex + 1),
  };
}

function parsePersonConnectionEntityKey(key: string): string {
  return key.startsWith("person:") ? key.slice("person:".length) : key;
}

function getMovieLookupKeyFromConnectionEntityKey(key: string): string {
  const parsedMovie = parseMovieConnectionEntityKey(key);
  return getFilmKey(parsedMovie.name, parsedMovie.year);
}

function getMovieConnectionEntityKeyFromLookupKey(movieKey: string): string {
  const normalizedMovie = normalizeTitle(movieKey);
  const match = normalizedMovie.match(/^(.*) \((\d{4})\)$/);

  if (!match) {
    return getMovieConnectionEntityKey(normalizedMovie, "");
  }

  return getMovieConnectionEntityKey(match[1], match[2]);
}

function createReadableFallbackLabel(normalizedLabel: string): string {
  return normalizedLabel.replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

function findOriginalPersonNameInFilms(
  filmRecords: FilmRecord[],
  personNameLower: string,
): string | null {
  for (const filmRecord of filmRecords) {
    const creditMatch = getAssociatedPeopleFromMovieCredits(filmRecord).find(
      (credit) => normalizeName(credit.name ?? "") === personNameLower,
    );

    if (creditMatch?.name?.trim()) {
      return creditMatch.name.trim();
    }

    const starterMatch = getSnapshotConnectionLabels(filmRecord).find(
      (personName) => normalizeName(personName) === personNameLower,
    );

    if (starterMatch?.trim()) {
      return starterMatch.trim();
    }
  }

  return null;
}

function findOriginalMovieInPeople(
  personRecords: PersonRecord[],
  movieLookupKey: string,
): { title: string; year: string } | null {
  for (const personRecord of personRecords) {
    const creditMatch = getTmdbMovieCredits(personRecord).find((credit) => {
      const title = getMovieTitleFromCredit(credit);
      if (!title) {
        return false;
      }

      return getFilmKey(title, getMovieYearFromCredit(credit)) === movieLookupKey;
    });

    if (!creditMatch) {
      continue;
    }

    const title = getMovieTitleFromCredit(creditMatch).trim();
    if (!title) {
      continue;
    }

    return {
      title,
      year: getMovieYearFromCredit(creditMatch),
    };
  }

  return null;
}

export async function hydrateConnectionEntityFromSearchRecord(
  searchRecord: SearchableConnectionEntityRecord,
): Promise<ConnectionEntity> {
  if (searchRecord.type === "person") {
    const personRecord = await getPersonRecordByName(searchRecord.nameLower);
    if (personRecord) {
      return createConnectionEntityFromPersonRecord(personRecord);
    }

    const matchingFilms = await getFilmRecordsByPersonConnectionKey(searchRecord.nameLower);
    const personName =
      findOriginalPersonNameInFilms(matchingFilms, searchRecord.nameLower) ??
      createReadableFallbackLabel(searchRecord.nameLower);

    return {
      key: searchRecord.key,
      kind: "person",
      name: personName,
      year: "",
      label: personName,
      connectionCount: Math.max(matchingFilms.length, 1),
      hasCachedTmdbSource: false,
    };
  }

  const parsedMovie = parseMovieConnectionEntityKey(searchRecord.key);
  const filmRecord = await getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year);
  if (filmRecord) {
    return createConnectionEntityFromMovieRecord(filmRecord);
  }

  const movieLookupKey = getMovieLookupKeyFromConnectionEntityKey(searchRecord.key);
  const matchingPeople = await getPersonRecordsByMovieKey(movieLookupKey);
  const originalMovie =
    findOriginalMovieInPeople(matchingPeople, movieLookupKey) ?? {
      title: createReadableFallbackLabel(parsedMovie.name),
      year: parsedMovie.year,
    };

  return {
    key: searchRecord.key,
    kind: "movie",
    name: originalMovie.title,
    year: originalMovie.year,
    label: formatMoviePathLabel(originalMovie.title, originalMovie.year),
    connectionCount: Math.max(matchingPeople.length, 1),
    hasCachedTmdbSource: false,
  };
}

export async function hydrateConnectionEntityFromKey(key: string): Promise<ConnectionEntity> {
  if (key === getCinenerdleConnectionEntityKey()) {
    const starterFilms = await getCinenerdleStarterFilmRecords();
    return createCinenerdleConnectionEntity(starterFilms.length);
  }

  if (key.startsWith("person:")) {
    return hydrateConnectionEntityFromSearchRecord({
      key,
      type: "person",
      nameLower: parsePersonConnectionEntityKey(key),
    });
  }

  return hydrateConnectionEntityFromSearchRecord({
    key,
    type: "movie",
    nameLower: formatMoviePathLabel(
      parseMovieConnectionEntityKey(key).name,
      parseMovieConnectionEntityKey(key).year,
    ),
  });
}

function reconstructPath(
  startKey: string,
  endKey: string,
  meetingKey: string,
  parentFromStart: Map<string, string | null>,
  parentFromEnd: Map<string, string | null>,
): string[] {
  const startHalf: string[] = [];
  let currentKey: string | null = meetingKey;

  while (currentKey) {
    startHalf.push(currentKey);
    currentKey = parentFromStart.get(currentKey) ?? null;
  }

  const endHalf: string[] = [];
  currentKey = parentFromEnd.get(meetingKey) ?? null;

  while (currentKey) {
    endHalf.push(currentKey);
    currentKey = parentFromEnd.get(currentKey) ?? null;
  }

  const path = [...startHalf.reverse(), ...endHalf];
  if (path[0] !== startKey || path[path.length - 1] !== endKey) {
    return [];
  }

  return path;
}

async function getNeighborKeysForEntityKey(entityKey: string): Promise<string[]> {
  if (entityKey === getCinenerdleConnectionEntityKey()) {
    const starterFilms = await getCinenerdleStarterFilmRecords();
    return starterFilms.map((filmRecord) =>
      getMovieConnectionEntityKey(filmRecord.title, filmRecord.year),
    );
  }

  if (entityKey.startsWith("person:")) {
    const personNameLower = parsePersonConnectionEntityKey(entityKey);
    const [personRecord, filmRecords] = await Promise.all([
      getPersonRecordByName(personNameLower),
      getFilmRecordsByPersonConnectionKey(personNameLower),
    ]);
    const movieKeys = new Set<string>();

    personRecord?.movieConnectionKeys.forEach((movieKey) => {
      movieKeys.add(getMovieConnectionEntityKeyFromLookupKey(movieKey));
    });

    filmRecords.forEach((filmRecord) => {
      movieKeys.add(getMovieConnectionEntityKey(filmRecord.title, filmRecord.year));
    });

    return Array.from(movieKeys);
  }

  const parsedMovie = parseMovieConnectionEntityKey(entityKey);
  const movieLookupKey = getMovieLookupKeyFromConnectionEntityKey(entityKey);
  const [filmRecord, personRecords] = await Promise.all([
    getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year),
    getPersonRecordsByMovieKey(movieLookupKey),
  ]);
  const personKeys = new Set<string>();

  filmRecord?.personConnectionKeys.forEach((personName) => {
    personKeys.add(getPersonConnectionEntityKey(personName));
  });
  personRecords.forEach((personRecord) => {
    personKeys.add(getPersonConnectionEntityKey(personRecord.name));
  });

  const nextKeys = Array.from(personKeys);
  if (filmRecord?.rawCinenerdleDailyStarter) {
    nextKeys.push(getCinenerdleConnectionEntityKey());
  }

  return nextKeys;
}

export async function findConnectionPathBidirectional(
  startEntity: ConnectionEntity,
  endEntity: ConnectionEntity,
  options?: {
    excludedNodeKeys?: Set<string>;
    excludedEdgeKeys?: Set<string>;
    timeoutMs?: number;
  },
): Promise<ConnectionSearchResult> {
  const startTime = performance.now();
  const timeoutMs = options?.timeoutMs ?? 5000;
  const deadline = startTime + timeoutMs;
  const excludedNodeKeys = options?.excludedNodeKeys ?? new Set<string>();
  const excludedEdgeKeys = options?.excludedEdgeKeys ?? new Set<string>();
  const startKey = startEntity.key;
  const endKey = endEntity.key;
  const neighborCache = new Map<string, Promise<string[]>>();
  const entityCache = new Map<string, Promise<ConnectionEntity>>();

  if (excludedNodeKeys.has(startKey) || excludedNodeKeys.has(endKey)) {
    return {
      status: "not_found",
      path: [],
      elapsedMs: performance.now() - startTime,
    };
  }

  if (startKey === endKey) {
    return {
      status: "found",
      path: [startEntity],
      elapsedMs: performance.now() - startTime,
    };
  }

  entityCache.set(startKey, Promise.resolve(startEntity));
  entityCache.set(endKey, Promise.resolve(endEntity));

  async function getNeighborKeys(entityKey: string): Promise<string[]> {
    const cachedNeighbors = neighborCache.get(entityKey);
    if (cachedNeighbors) {
      return cachedNeighbors;
    }

    const nextNeighborsPromise = getNeighborKeysForEntityKey(entityKey);
    neighborCache.set(entityKey, nextNeighborsPromise);
    return nextNeighborsPromise;
  }

  async function getEntity(entityKey: string): Promise<ConnectionEntity> {
    const cachedEntity = entityCache.get(entityKey);
    if (cachedEntity) {
      return cachedEntity;
    }

    const nextEntityPromise = hydrateConnectionEntityFromKey(entityKey);
    entityCache.set(entityKey, nextEntityPromise);
    return nextEntityPromise;
  }

  const visitedFromStart = new Set<string>([startKey]);
  const visitedFromEnd = new Set<string>([endKey]);
  const parentFromStart = new Map<string, string | null>([[startKey, null]]);
  const parentFromEnd = new Map<string, string | null>([[endKey, null]]);
  let frontierFromStart = [startKey];
  let frontierFromEnd = [endKey];

  async function expandFrontier(
    frontier: string[],
    visitedHere: Set<string>,
    visitedOther: Set<string>,
    parentHere: Map<string, string | null>,
  ): Promise<{ meetingKey: string | null; nextFrontier: string[]; timedOut: boolean }> {
    const nextFrontier: string[] = [];

    for (const currentKey of frontier) {
      if (performance.now() >= deadline) {
        return {
          meetingKey: null,
          nextFrontier,
          timedOut: true,
        };
      }

      const neighborKeys = await getNeighborKeys(currentKey);

      for (const neighborKey of neighborKeys) {
        if (excludedNodeKeys.has(neighborKey)) {
          continue;
        }

        if (excludedEdgeKeys.has(getConnectionEdgeKey(currentKey, neighborKey))) {
          continue;
        }

        if (visitedHere.has(neighborKey)) {
          continue;
        }

        visitedHere.add(neighborKey);
        parentHere.set(neighborKey, currentKey);

        if (visitedOther.has(neighborKey)) {
          return {
            meetingKey: neighborKey,
            nextFrontier,
            timedOut: false,
          };
        }

        nextFrontier.push(neighborKey);
      }
    }

    return {
      meetingKey: null,
      nextFrontier,
      timedOut: false,
    };
  }

  while (frontierFromStart.length > 0 && frontierFromEnd.length > 0) {
    const expandFromStart = frontierFromStart.length <= frontierFromEnd.length;
    const expansion = expandFromStart
      ? await expandFrontier(
          frontierFromStart,
          visitedFromStart,
          visitedFromEnd,
          parentFromStart,
        )
      : await expandFrontier(
          frontierFromEnd,
          visitedFromEnd,
          visitedFromStart,
          parentFromEnd,
        );

    if (expansion.timedOut) {
      return {
        status: "timeout",
        path: [],
        elapsedMs: performance.now() - startTime,
      };
    }

    if (expansion.meetingKey) {
      const pathKeys = reconstructPath(
        startKey,
        endKey,
        expansion.meetingKey,
        parentFromStart,
        parentFromEnd,
      );
      const path = await Promise.all(pathKeys.map((pathKey) => getEntity(pathKey)));

      return {
        status: path.length > 0 ? "found" : "not_found",
        path,
        elapsedMs: performance.now() - startTime,
      };
    }

    if (expandFromStart) {
      frontierFromStart = expansion.nextFrontier;
    } else {
      frontierFromEnd = expansion.nextFrontier;
    }
  }

  return {
    status: "not_found",
    path: [],
    elapsedMs: performance.now() - startTime,
  };
}

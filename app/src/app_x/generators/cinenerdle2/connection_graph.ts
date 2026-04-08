import {
  getCinenerdleStarterFilmRecords,
  getFilmRecordByTitleAndYear,
  getFilmRecordsByIds,
  getFilmRecordsByPersonConnectionKey,
  getPersonRecordById,
  getPersonRecordByName,
  getPersonRecordsByMovieKey,
  getSearchableConnectionEntityByKey,
} from "./indexed_db";
import { isExcludedFilmRecord } from "./exclusion";
import { isCinenerdleDailyStarterFilm } from "./starter_storage";
import type {
  FilmRecord,
  PersonRecord,
  SearchableConnectionEntityRecord,
} from "./types";
import { getResolvedPersonMovieConnectionKeys } from "./records";
import { hasDirectTmdbMovieSource, hasDirectTmdbPersonSource } from "./tmdb_provenance";
import {
  getAllowedConnectedTmdbMovieCredits,
  formatMoviePathLabel,
  getAssociatedPeopleFromMovieCredits,
  getFilmKey,
  getMoviePosterUrl,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getPersonProfileImageUrl,
  getValidTmdbEntityId,
  isZeroVoteFilmRecord,
  normalizeName,
  normalizeTitle,
} from "./utils";
import type { CardCreditLine } from "./view_types";

export type ConnectionEntity = {
  key: string;
  kind: "cinenerdle" | "movie" | "person";
  name: string;
  year: string;
  tmdbId: number | null;
  label: string;
  connectionCount: number;
  hasCachedTmdbSource: boolean;
  imageUrl?: string | null;
  connectionParentLabel?: string | null;
  popularity?: number | null;
  connectionRank?: number | null;
  associationSubtitle?: string;
  associationSubtitleDetail?: string;
  associationCreditLines?: CardCreditLine[] | null;
};

export type ConnectionSearchResult = {
  status: "found" | "not_found" | "timeout";
  path: ConnectionEntity[];
  elapsedMs: number;
};

export function isFilmRecordAllowedInConnectionGraph(
  filmRecord: FilmRecord | null | undefined,
): boolean {
  return !isExcludedFilmRecord(filmRecord);
}

export function getMovieConnectionEntityKey(title: string, year = ""): string {
  return `movie:${normalizeTitle(title)}:${year.trim()}`;
}

export function getPersonConnectionEntityKey(
  name: string,
  tmdbId?: number | string | null,
): string {
  const validTmdbId = getValidTmdbEntityId(tmdbId);
  return `person:${validTmdbId ?? normalizeName(name)}`;
}

export function getCinenerdleConnectionEntityKey(): string {
  return "cinenerdle";
}

export function getConnectionEdgeKey(leftKey: string, rightKey: string): string {
  return [leftKey, rightKey].sort().join("|");
}

export function hasCachedTmdbSourceForMovieRecord(movieRecord: FilmRecord | null): boolean {
  return hasDirectTmdbMovieSource(movieRecord);
}

export function hasCachedTmdbSourceForPersonRecord(personRecord: PersonRecord | null): boolean {
  return hasDirectTmdbPersonSource(personRecord);
}

export function createConnectionEntityFromMovieRecord(movieRecord: FilmRecord): ConnectionEntity {
  return {
    key: getMovieConnectionEntityKey(movieRecord.title, movieRecord.year),
    kind: "movie",
    name: movieRecord.title,
    year: movieRecord.year,
    tmdbId: getValidTmdbEntityId(movieRecord.tmdbId ?? movieRecord.id),
    label: formatMoviePathLabel(movieRecord.title, movieRecord.year),
    connectionCount: Math.max(movieRecord.personConnectionKeys.length, 1),
    hasCachedTmdbSource: hasCachedTmdbSourceForMovieRecord(movieRecord),
    imageUrl: getMoviePosterUrl(movieRecord),
    connectionParentLabel: null,
    popularity: movieRecord.popularity ?? null,
    connectionRank: null,
  };
}

export function createConnectionEntityFromPersonRecord(personRecord: PersonRecord): ConnectionEntity {
  const movieConnectionKeys = getResolvedPersonMovieConnectionKeys(personRecord);

  return {
    key: getPersonConnectionEntityKey(personRecord.name, personRecord.tmdbId ?? personRecord.id),
    kind: "person",
    name: personRecord.name,
    year: "",
    tmdbId: getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id),
    label: personRecord.name,
    connectionCount: movieConnectionKeys.length,
    hasCachedTmdbSource: hasCachedTmdbSourceForPersonRecord(personRecord),
    imageUrl: getPersonProfileImageUrl(personRecord),
    connectionParentLabel: null,
    popularity: personRecord.rawTmdbPerson?.popularity ?? null,
    connectionRank: null,
  };
}

export function createCinenerdleConnectionEntity(starterCount: number): ConnectionEntity {
  return {
    key: getCinenerdleConnectionEntityKey(),
    kind: "cinenerdle",
    name: "cinenerdle",
    year: "",
    tmdbId: null,
    label: "cinenerdle",
    connectionCount: Math.max(starterCount, 1),
    hasCachedTmdbSource: true,
    imageUrl: null,
    connectionParentLabel: null,
    popularity: null,
    connectionRank: null,
  };
}

export function createFallbackConnectionEntity(
  item: {
    kind: "cinenerdle" | "movie" | "person";
    name: string;
    year?: string;
    tmdbId?: number | null;
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
      tmdbId: getValidTmdbEntityId(item.tmdbId),
      label: formatMoviePathLabel(item.name, item.year ?? ""),
      connectionCount: 0,
      hasCachedTmdbSource: false,
      imageUrl: null,
      connectionParentLabel: null,
      popularity: null,
      connectionRank: null,
    };
  }

  return {
    key: getPersonConnectionEntityKey(item.name, item.tmdbId),
    kind: "person",
    name: item.name,
    year: "",
    tmdbId: getValidTmdbEntityId(item.tmdbId),
    label: item.name,
    connectionCount: 0,
    hasCachedTmdbSource: false,
    imageUrl: null,
    connectionParentLabel: null,
    popularity: null,
    connectionRank: null,
  };
}

export async function isConnectionEntityKeyAllowedInGraph(entityKey: string): Promise<boolean> {
  if (
    entityKey === getCinenerdleConnectionEntityKey() ||
    entityKey.startsWith("person:")
  ) {
    return true;
  }

  const parsedMovie = parseMovieConnectionEntityKey(entityKey);
  const filmRecord = await getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year);
  return isFilmRecordAllowedInConnectionGraph(filmRecord);
}

export async function isConnectionEntityAllowedInGraph(
  entity: Pick<ConnectionEntity, "key" | "kind" | "name" | "year">,
): Promise<boolean> {
  if (entity.kind !== "movie") {
    return true;
  }

  return isConnectionEntityKeyAllowedInGraph(
    entity.key || getMovieConnectionEntityKey(entity.name, entity.year),
  );
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

function parsePersonConnectionEntityKey(key: string): {
  tmdbId: number | null;
  nameLower: string;
} {
  const rawValue = key.startsWith("person:") ? key.slice("person:".length) : key;
  const tmdbId = getValidTmdbEntityId(rawValue);

  return {
    tmdbId,
    nameLower: tmdbId ? "" : normalizeName(rawValue),
  };
}

function getMovieLookupKeyFromConnectionEntityKey(key: string): string {
  const parsedMovie = parseMovieConnectionEntityKey(key);
  return getFilmKey(parsedMovie.name, parsedMovie.year);
}

function createReadableFallbackLabel(normalizedLabel: string): string {
  return normalizedLabel.replace(
    /(^|[^\p{L}\p{N}]+)(\p{L})/gu,
    (_match, prefix: string, character: string) => `${prefix}${character.toLocaleUpperCase()}`,
  );
}

async function getPersonRecordForConnectionEntityKey(entityKey: string): Promise<PersonRecord | null> {
  const parsedPerson = parsePersonConnectionEntityKey(entityKey);

  return parsedPerson.tmdbId
    ? getPersonRecordById(parsedPerson.tmdbId)
    : getPersonRecordByName(parsedPerson.nameLower);
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
  }

  return null;
}

function findOriginalMovieInPeople(
  personRecords: PersonRecord[],
  movieLookupKey: string,
): { title: string; year: string } | null {
  for (const personRecord of personRecords) {
    const creditMatch = getAllowedConnectedTmdbMovieCredits(personRecord).find((credit) => {
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
    const parsedPerson = parsePersonConnectionEntityKey(searchRecord.key);
    const personRecord = parsedPerson.tmdbId
      ? await getPersonRecordById(parsedPerson.tmdbId)
      : await getPersonRecordByName(searchRecord.nameLower);
    if (personRecord) {
      return createConnectionEntityFromPersonRecord(personRecord);
    }

    const matchingFilms = await getFilmRecordsByPersonConnectionKey(searchRecord.nameLower);
    const personName =
      findOriginalPersonNameInFilms(matchingFilms, searchRecord.nameLower) ??
      createReadableFallbackLabel(searchRecord.nameLower);

    const entity: ConnectionEntity = {
      key: searchRecord.key,
      kind: "person",
      name: personName,
      year: "",
      tmdbId: parsedPerson.tmdbId,
      label: personName,
      connectionCount: Math.max(matchingFilms.length, 1),
      hasCachedTmdbSource: false,
      imageUrl: null,
      connectionRank: null,
    };

    return entity;
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

  const entity: ConnectionEntity = {
    key: searchRecord.key,
    kind: "movie",
    name: originalMovie.title,
    year: originalMovie.year,
    tmdbId: null,
    label: formatMoviePathLabel(originalMovie.title, originalMovie.year),
    connectionCount: Math.max(matchingPeople.length, 1),
    hasCachedTmdbSource: false,
    imageUrl: null,
    connectionRank: null,
  };

  return entity;
}

export async function hydrateConnectionEntityFromKey(key: string): Promise<ConnectionEntity> {
  if (key === getCinenerdleConnectionEntityKey()) {
    const starterFilms = await getCinenerdleStarterFilmRecords();
    return createCinenerdleConnectionEntity(starterFilms.length);
  }

  if (key.startsWith("person:")) {
    const parsedPerson = parsePersonConnectionEntityKey(key);
    const searchRecord = await getSearchableConnectionEntityByKey(key);
    return hydrateConnectionEntityFromSearchRecord({
      key,
      type: "person",
      nameLower: searchRecord?.nameLower ?? parsedPerson.nameLower,
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

function setPopularityScore(
  popularityByKey: Map<string, number>,
  entityKey: string,
  popularity: number | null | undefined,
) {
  const nextPopularity = popularity ?? 0;
  const currentPopularity = popularityByKey.get(entityKey) ?? 0;
  popularityByKey.set(entityKey, Math.max(currentPopularity, nextPopularity));
}

function sortEntityKeysByPopularity(
  entityKeys: Iterable<string>,
  popularityByKey: Map<string, number>,
): string[] {
  return Array.from(entityKeys).sort((leftKey, rightKey) => {
    const popularityDifference =
      (popularityByKey.get(rightKey) ?? 0) - (popularityByKey.get(leftKey) ?? 0);

    if (popularityDifference !== 0) {
      return popularityDifference;
    }

    return leftKey.localeCompare(rightKey);
  });
}

export async function getConnectionNeighborKeysForEntityKey(entityKey: string): Promise<string[]> {
  if (entityKey === getCinenerdleConnectionEntityKey()) {
    const starterFilms = (await getCinenerdleStarterFilmRecords())
      .filter(isFilmRecordAllowedInConnectionGraph);
    const popularityByKey = new Map<string, number>();
    const starterKeys = starterFilms.map((filmRecord) => {
      const movieKey = getMovieConnectionEntityKey(filmRecord.title, filmRecord.year);
      setPopularityScore(popularityByKey, movieKey, filmRecord.popularity);
      return movieKey;
    });

    return sortEntityKeysByPopularity(starterKeys, popularityByKey);
  }

  if (entityKey.startsWith("person:")) {
    const parsedPerson = parsePersonConnectionEntityKey(entityKey);
    const [personRecord, searchablePersonRecord] = await Promise.all([
      getPersonRecordForConnectionEntityKey(entityKey),
      getSearchableConnectionEntityByKey(entityKey),
    ]);
    const personNameLower =
      searchablePersonRecord?.type === "person" && searchablePersonRecord.nameLower
        ? searchablePersonRecord.nameLower
        : normalizeName(personRecord?.name ?? parsedPerson.nameLower);
    const filmRecords = personNameLower
      ? await getFilmRecordsByPersonConnectionKey(personNameLower)
      : [];
    const visibleFilmRecords = filmRecords.filter(isFilmRecordAllowedInConnectionGraph);
    const movieKeys = new Set<string>();
    const popularityByKey = new Map<string, number>();
    const moviePopularityById = new Map<number, number>();
    const resolvedMovieIds = getResolvedPersonMovieConnectionKeys(personRecord);
    const filmRecordsById = await getFilmRecordsByIds(resolvedMovieIds);

    getAllowedConnectedTmdbMovieCredits(personRecord).forEach((credit) => {
      const movieTmdbId = getValidTmdbEntityId(credit.id);
      if (movieTmdbId === null) {
        return;
      }

      moviePopularityById.set(
        movieTmdbId,
        Math.max(moviePopularityById.get(movieTmdbId) ?? 0, credit.popularity ?? 0),
      );
    });

    for (const movieId of resolvedMovieIds) {
      const matchingFilmRecord = filmRecordsById.get(movieId) ?? null;
      if (!matchingFilmRecord || !isFilmRecordAllowedInConnectionGraph(matchingFilmRecord)) {
        continue;
      }

      const connectionMovieKey = getMovieConnectionEntityKey(
        matchingFilmRecord.title,
        matchingFilmRecord.year,
      );
      movieKeys.add(connectionMovieKey);
      setPopularityScore(
        popularityByKey,
        connectionMovieKey,
        moviePopularityById.get(movieId) ?? matchingFilmRecord.popularity ?? 0,
      );
    }

    visibleFilmRecords.forEach((filmRecord) => {
      const connectionMovieKey = getMovieConnectionEntityKey(filmRecord.title, filmRecord.year);
      movieKeys.add(connectionMovieKey);
      setPopularityScore(popularityByKey, connectionMovieKey, filmRecord.popularity);
    });

    return sortEntityKeysByPopularity(movieKeys, popularityByKey);
  }

  const parsedMovie = parseMovieConnectionEntityKey(entityKey);
  const movieLookupKey = getMovieLookupKeyFromConnectionEntityKey(entityKey);
  const [filmRecord, personRecords] = await Promise.all([
    getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year),
    getPersonRecordsByMovieKey(movieLookupKey),
  ]);
  if (!isFilmRecordAllowedInConnectionGraph(filmRecord)) {
    return [];
  }
  const personKeys = new Set<string>();
  const popularityByKey = new Map<string, number>();
  const personPopularityByKey = new Map<number, number>();
  const resolvedPersonIds = new Set<number>();
  const personRecordsById = new Map(
    personRecords.flatMap((personRecord) => {
      const personTmdbId = getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id);
      return personTmdbId === null ? [] : [[personTmdbId, personRecord] as const];
    }),
  );

  getAssociatedPeopleFromMovieCredits(filmRecord).forEach((credit) => {
    const personTmdbId = getValidTmdbEntityId(credit.id);
    if (personTmdbId === null) {
      return;
    }

    const connectionPersonKey = getPersonConnectionEntityKey(credit.name ?? "", credit.id);
    personKeys.add(connectionPersonKey);
    resolvedPersonIds.add(personTmdbId);
    setPopularityScore(popularityByKey, connectionPersonKey, credit.popularity ?? 0);

    personPopularityByKey.set(
      personTmdbId,
      Math.max(personPopularityByKey.get(personTmdbId) ?? 0, credit.popularity ?? 0),
    );
  });

  filmRecord?.personConnectionKeys.forEach((personId) => {
    const validPersonId = getValidTmdbEntityId(personId);
    if (validPersonId === null || resolvedPersonIds.has(validPersonId)) {
      return;
    }

    const personRecord = personRecordsById.get(validPersonId);
    if (!personRecord) {
      return;
    }

    const connectionPersonKey = getPersonConnectionEntityKey(
      personRecord.name,
      validPersonId,
    );
    personKeys.add(connectionPersonKey);
    setPopularityScore(
      popularityByKey,
      connectionPersonKey,
      personPopularityByKey.get(validPersonId) ??
        personRecord.rawTmdbPerson?.popularity ??
        0,
    );
  });
  personRecords.forEach((personRecord) => {
    const personTmdbId = getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id);
    if (personTmdbId === null) {
      return;
    }

    const connectionPersonKey = getPersonConnectionEntityKey(
      personRecord.name,
      personTmdbId,
    );
    personKeys.add(connectionPersonKey);
    resolvedPersonIds.add(personTmdbId);
    setPopularityScore(
      popularityByKey,
      connectionPersonKey,
      personRecord.rawTmdbPerson?.popularity ??
        personPopularityByKey.get(personTmdbId) ??
        0,
    );
  });

  const nextKeys = sortEntityKeysByPopularity(personKeys, popularityByKey);
  if (filmRecord && isCinenerdleDailyStarterFilm(filmRecord.title, filmRecord.year)) {
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
  const cinenerdleKey = getCinenerdleConnectionEntityKey();
  const cinenerdleAllowedAsEndpoint = startKey === cinenerdleKey || endKey === cinenerdleKey;
  const neighborCache = new Map<string, Promise<string[]>>();
  const entityCache = new Map<string, Promise<ConnectionEntity>>();
  const popularityCache = new Map<string, Promise<number>>();
  const zeroVoteMovieCache = new Map<string, Promise<boolean>>();

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

    const nextNeighborsPromise = getConnectionNeighborKeysForEntityKey(entityKey);
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

  async function getPopularity(entityKey: string): Promise<number> {
    const cachedPopularity = popularityCache.get(entityKey);
    if (cachedPopularity) {
      return cachedPopularity;
    }

    const nextPopularityPromise = (async () => {
      if (entityKey === getCinenerdleConnectionEntityKey()) {
        return 0;
      }

      if (entityKey.startsWith("person:")) {
        const personRecord = await getPersonRecordForConnectionEntityKey(entityKey);
        return personRecord?.rawTmdbPerson?.popularity ?? 0;
      }

      const parsedMovie = parseMovieConnectionEntityKey(entityKey);
      const filmRecord = await getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year);
      return filmRecord?.popularity ?? 0;
    })();

    popularityCache.set(entityKey, nextPopularityPromise);
    return nextPopularityPromise;
  }

  async function isZeroVoteMovie(entityKey: string): Promise<boolean> {
    if (!entityKey.startsWith("movie:")) {
      return false;
    }

    const cachedZeroVote = zeroVoteMovieCache.get(entityKey);
    if (cachedZeroVote) {
      return cachedZeroVote;
    }

    const nextZeroVotePromise = (async () => {
      const parsedMovie = parseMovieConnectionEntityKey(entityKey);
      const filmRecord = await getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year);
      return isZeroVoteFilmRecord(filmRecord);
    })();

    zeroVoteMovieCache.set(entityKey, nextZeroVotePromise);
    return nextZeroVotePromise;
  }

  async function sortFrontierByPopularity(frontier: string[]): Promise<string[]> {
    const popularityByKey = new Map<string, number>(
      await Promise.all(
        frontier.map(async (entityKey) => [entityKey, await getPopularity(entityKey)] as const),
      ),
    );

    return sortEntityKeysByPopularity(frontier, popularityByKey);
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
    const orderedFrontier = await sortFrontierByPopularity(frontier);

    for (const currentKey of orderedFrontier) {
      if (performance.now() >= deadline) {
        return {
          meetingKey: null,
          nextFrontier,
          timedOut: true,
        };
      }

      const neighborKeys = await getNeighborKeys(currentKey);

      for (const neighborKey of neighborKeys) {
        if (neighborKey === cinenerdleKey && !cinenerdleAllowedAsEndpoint) {
          continue;
        }

        if (excludedNodeKeys.has(neighborKey)) {
          continue;
        }

        if (
          neighborKey !== startKey &&
          neighborKey !== endKey &&
          await isZeroVoteMovie(neighborKey)
        ) {
          continue;
        }

        if (!(await isConnectionEntityKeyAllowedInGraph(neighborKey))) {
          continue;
        }

        const edgeKey = getConnectionEdgeKey(currentKey, neighborKey);
        if (excludedEdgeKeys.has(edgeKey)) {
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

    const orderedNextFrontier = await sortFrontierByPopularity(nextFrontier);

    return {
      meetingKey: null,
      nextFrontier: orderedNextFrontier,
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

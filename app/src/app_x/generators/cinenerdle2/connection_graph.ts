import type { FilmRecord, PersonRecord } from "./types";
import {
  formatMoviePathLabel,
  getAssociatedPeopleFromMovieCredits,
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

type ConnectionGraph = {
  entitiesByKey: Map<string, ConnectionEntity>;
  adjacencyByKey: Map<string, string[]>;
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

function addAdjacency(adjacencyByKey: Map<string, Set<string>>, fromKey: string, toKey: string) {
  const nextValues = adjacencyByKey.get(fromKey) ?? new Set<string>();
  nextValues.add(toKey);
  adjacencyByKey.set(fromKey, nextValues);
}

function ensureEntity(
  entitiesByKey: Map<string, ConnectionEntity>,
  entity: ConnectionEntity,
): ConnectionEntity {
  const existingEntity = entitiesByKey.get(entity.key);
  if (!existingEntity) {
    entitiesByKey.set(entity.key, entity);
    return entity;
  }

  const mergedEntity: ConnectionEntity = {
    ...existingEntity,
    ...entity,
    label:
      entity.label.length >= existingEntity.label.length
        ? entity.label
        : existingEntity.label,
    connectionCount: Math.max(existingEntity.connectionCount, entity.connectionCount),
    hasCachedTmdbSource:
      existingEntity.hasCachedTmdbSource || entity.hasCachedTmdbSource,
  };
  entitiesByKey.set(entity.key, mergedEntity);
  return mergedEntity;
}

export function buildConnectionGraph(
  personRecords: PersonRecord[],
  filmRecords: FilmRecord[],
): ConnectionGraph {
  const entitiesByKey = new Map<string, ConnectionEntity>();
  const adjacencyByKey = new Map<string, Set<string>>();
  const personNameByKey = new Map<string, string>();

  personRecords.forEach((personRecord) => {
    personNameByKey.set(normalizeName(personRecord.name), personRecord.name);
    ensureEntity(entitiesByKey, createConnectionEntityFromPersonRecord(personRecord));
  });

  filmRecords.forEach((filmRecord) => {
    getAssociatedPeopleFromMovieCredits(filmRecord).forEach((credit) => {
      const personName = credit.name?.trim();
      if (!personName) {
        return;
      }

      personNameByKey.set(normalizeName(personName), personName);
    });
  });

  filmRecords.forEach((filmRecord) => {
    const movieEntity = ensureEntity(
      entitiesByKey,
      createConnectionEntityFromMovieRecord(filmRecord),
    );
    const seenPersonKeys = new Set<string>();

    filmRecord.personConnectionKeys.forEach((personConnectionKey) => {
      const normalizedPersonKey = normalizeName(personConnectionKey);
      const personKey = getPersonConnectionEntityKey(normalizedPersonKey);
      if (!normalizedPersonKey || seenPersonKeys.has(personKey)) {
        return;
      }

      seenPersonKeys.add(personKey);
      const personName = personNameByKey.get(normalizedPersonKey) ?? normalizedPersonKey;
      const personEntity = ensureEntity(entitiesByKey, {
        key: personKey,
        kind: "person",
        name: personName,
        year: "",
        label: personName,
        connectionCount: 0,
        hasCachedTmdbSource: false,
      });

      addAdjacency(adjacencyByKey, movieEntity.key, personEntity.key);
      addAdjacency(adjacencyByKey, personEntity.key, movieEntity.key);
    });
  });

  const starterMovieRecords = filmRecords.filter((filmRecord) =>
    Boolean(filmRecord.rawCinenerdleDailyStarter),
  );
  if (starterMovieRecords.length > 0) {
    const cinenerdleEntity = ensureEntity(
      entitiesByKey,
      createCinenerdleConnectionEntity(starterMovieRecords.length),
    );

    starterMovieRecords.forEach((filmRecord) => {
      const movieEntity = ensureEntity(
        entitiesByKey,
        createConnectionEntityFromMovieRecord(filmRecord),
      );
      addAdjacency(adjacencyByKey, cinenerdleEntity.key, movieEntity.key);
      addAdjacency(adjacencyByKey, movieEntity.key, cinenerdleEntity.key);
    });
  }

  const normalizedAdjacency = new Map<string, string[]>();
  adjacencyByKey.forEach((neighborKeys, key) => {
    normalizedAdjacency.set(key, Array.from(neighborKeys));

    const entity = entitiesByKey.get(key);
    if (!entity) {
      return;
    }

    entitiesByKey.set(key, {
      ...entity,
      connectionCount: Math.max(entity.connectionCount, neighborKeys.size, 1),
    });
  });

  return {
    entitiesByKey,
    adjacencyByKey: normalizedAdjacency,
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

export function findConnectionPathBidirectional(
  graph: ConnectionGraph,
  startKey: string,
  endKey: string,
  options?: {
    excludedNodeKeys?: Set<string>;
    excludedEdgeKeys?: Set<string>;
    timeoutMs?: number;
  },
): ConnectionSearchResult {
  const startTime = performance.now();
  const timeoutMs = options?.timeoutMs ?? 5000;
  const deadline = startTime + timeoutMs;
  const excludedNodeKeys = options?.excludedNodeKeys ?? new Set<string>();
  const excludedEdgeKeys = options?.excludedEdgeKeys ?? new Set<string>();

  if (!graph.entitiesByKey.has(startKey) || !graph.entitiesByKey.has(endKey)) {
    return {
      status: "not_found",
      path: [],
      elapsedMs: performance.now() - startTime,
    };
  }

  if (startKey === endKey) {
    return {
      status: "found",
      path: [graph.entitiesByKey.get(startKey)!],
      elapsedMs: performance.now() - startTime,
    };
  }

  const visitedFromStart = new Set<string>([startKey]);
  const visitedFromEnd = new Set<string>([endKey]);
  const parentFromStart = new Map<string, string | null>([[startKey, null]]);
  const parentFromEnd = new Map<string, string | null>([[endKey, null]]);
  let frontierFromStart = [startKey];
  let frontierFromEnd = [endKey];

  function expandFrontier(
    frontier: string[],
    visitedHere: Set<string>,
    visitedOther: Set<string>,
    parentHere: Map<string, string | null>,
  ): { meetingKey: string | null; nextFrontier: string[]; timedOut: boolean } {
    const nextFrontier: string[] = [];

    for (const currentKey of frontier) {
      if (performance.now() >= deadline) {
        return {
          meetingKey: null,
          nextFrontier,
          timedOut: true,
        };
      }

      for (const neighborKey of graph.adjacencyByKey.get(currentKey) ?? []) {
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
      ? expandFrontier(
          frontierFromStart,
          visitedFromStart,
          visitedFromEnd,
          parentFromStart,
        )
      : expandFrontier(
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

      return {
        status: pathKeys.length > 0 ? "found" : "not_found",
        path: pathKeys
          .map((pathKey) => graph.entitiesByKey.get(pathKey) ?? null)
          .filter((entity): entity is ConnectionEntity => entity !== null),
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

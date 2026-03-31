import type { FilmRecord, PersonRecord } from "./types";
import {
  getValidTmdbEntityId,
  normalizeName,
  normalizeTitle,
} from "./utils";

export const CINENERDLE_ENTITY_REFRESH_REQUESTED_EVENT =
  "cinenerdle:entity-refresh-requested";

export type EntityRefreshReason = "fetch" | "prefetch";

type BaseEntityRefreshRequest = {
  reason: EntityRefreshReason;
  requestKey: string;
};

export type MovieEntityRefreshRequest = BaseEntityRefreshRequest & {
  kind: "movie";
  name: string;
  tmdbId: number | null;
  year: string;
};

export type PersonEntityRefreshRequest = BaseEntityRefreshRequest & {
  kind: "person";
  name: string;
  tmdbId: number | null;
};

export type EntityRefreshRequest =
  | MovieEntityRefreshRequest
  | PersonEntityRefreshRequest;

type EntityRefreshIdentity =
  | Pick<MovieEntityRefreshRequest, "kind" | "name" | "tmdbId" | "year">
  | Pick<PersonEntityRefreshRequest, "kind" | "name" | "tmdbId">;

let entityRefreshRequestSequence = 0;

export function getEntityRefreshIdentityKey(
  request: EntityRefreshIdentity,
): string {
  if (request.kind === "movie") {
    const tmdbId = getValidTmdbEntityId(request.tmdbId);
    if (tmdbId !== null) {
      return `movie:tmdb:${tmdbId}`;
    }

    return `movie:title:${normalizeTitle(request.name)}:${request.year.trim()}`;
  }

  const tmdbId = getValidTmdbEntityId(request.tmdbId);
  if (tmdbId !== null) {
    return `person:tmdb:${tmdbId}`;
  }

  return `person:name:${normalizeName(request.name)}`;
}

export function createEntityRefreshRequest(
  request: Omit<MovieEntityRefreshRequest, "requestKey">
    | Omit<PersonEntityRefreshRequest, "requestKey">,
): EntityRefreshRequest {
  entityRefreshRequestSequence += 1;

  const requestKey =
    `${getEntityRefreshIdentityKey(request)}:${request.reason}:${entityRefreshRequestSequence}`;

  if (request.kind === "movie") {
    return {
      ...request,
      requestKey,
    };
  }

  return {
    ...request,
    requestKey,
  };
}

export function dispatchEntityRefreshRequest(
  request: Omit<MovieEntityRefreshRequest, "requestKey">
    | Omit<PersonEntityRefreshRequest, "requestKey">,
): EntityRefreshRequest {
  const nextRequest = createEntityRefreshRequest(request);

  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function" ||
    typeof CustomEvent !== "function"
  ) {
    return nextRequest;
  }

  window.dispatchEvent(
    new CustomEvent<EntityRefreshRequest>(
      CINENERDLE_ENTITY_REFRESH_REQUESTED_EVENT,
      {
        detail: nextRequest,
      },
    ),
  );

  return nextRequest;
}

export function createMovieEntityRefreshRequestFromRecord(
  movieRecord: FilmRecord,
  reason: EntityRefreshReason,
): Omit<MovieEntityRefreshRequest, "requestKey"> {
  return {
    kind: "movie",
    name: movieRecord.title,
    reason,
    tmdbId: getValidTmdbEntityId(movieRecord.tmdbId ?? movieRecord.id),
    year: movieRecord.year,
  };
}

export function createPersonEntityRefreshRequestFromRecord(
  personRecord: PersonRecord,
  reason: EntityRefreshReason,
): Omit<PersonEntityRefreshRequest, "requestKey"> {
  return {
    kind: "person",
    name: personRecord.name,
    reason,
    tmdbId: getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id),
  };
}

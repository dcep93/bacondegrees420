import {
  createMovieAssociationCard,
  createPersonAssociationCard,
} from "./generators/cinenerdle2/cards";
import type {
  FilmRecord,
  PersonRecord,
  TmdbMovieCredit,
  TmdbPersonCredit,
} from "./generators/cinenerdle2/types";
import type { CinenerdleCard } from "./generators/cinenerdle2/view_types";
import {
  getAssociatedMovieCreditGroupsFromPersonCredits,
  getAssociatedPersonCreditGroupsFromMovieCredits,
  getFilmKey,
  getMovieKeyFromCredit,
  getValidTmdbEntityId,
  normalizeName,
} from "./generators/cinenerdle2/utils";

export type ResolvedAssociatedEntity = {
  kind: "cinenerdle" | "movie" | "person";
  name: string;
  year: string;
  tmdbId: number | null;
  connectionCount: number;
  movieRecord: FilmRecord | null;
  personRecord: PersonRecord | null;
};

type AssociatedMovieCreditGroup = {
  credits: TmdbMovieCredit[];
  connectionOrder: number;
};

type AssociatedPersonCreditGroup = {
  credits: TmdbPersonCredit[];
  connectionOrder: number;
};

export type AssociatedEntityCardResult =
  | {
      card: Extract<CinenerdleCard, { kind: "movie" }>;
      connectionOrder: number;
    }
  | {
      card: Extract<CinenerdleCard, { kind: "person" }>;
      connectionOrder: number;
    };

function findAssociatedMovieCreditGroup(
  personRecord: PersonRecord | null,
  entity: ResolvedAssociatedEntity,
): AssociatedMovieCreditGroup | null {
  if (!personRecord || entity.kind !== "movie") {
    return null;
  }

  const targetMovieTmdbId = getValidTmdbEntityId(entity.movieRecord?.tmdbId ?? entity.movieRecord?.id);
  const targetMovieKey = getFilmKey(entity.name, entity.year);
  const creditGroups = getAssociatedMovieCreditGroupsFromPersonCredits(personRecord);
  const connectionIndex = creditGroups.findIndex((creditGroup) => {
    const representativeCredit = creditGroup[0];
    if (!representativeCredit) {
      return false;
    }

    const creditTmdbId = getValidTmdbEntityId(representativeCredit.id);
    if (targetMovieTmdbId !== null && creditTmdbId !== null) {
      return targetMovieTmdbId === creditTmdbId;
    }

    return getMovieKeyFromCredit(representativeCredit) === targetMovieKey;
  });

  return connectionIndex >= 0
    ? {
        credits: creditGroups[connectionIndex] ?? [],
        connectionOrder: connectionIndex + 1,
      }
    : null;
}

function findAssociatedPersonCreditGroup(
  movieRecord: FilmRecord | null,
  entity: ResolvedAssociatedEntity,
): AssociatedPersonCreditGroup | null {
  if (!movieRecord || entity.kind !== "person") {
    return null;
  }

  const targetPersonTmdbId = getValidTmdbEntityId(
    entity.personRecord?.tmdbId ?? entity.personRecord?.id ?? entity.tmdbId,
  );
  const targetPersonName = normalizeName(entity.name);
  const creditGroups = getAssociatedPersonCreditGroupsFromMovieCredits(movieRecord);
  const connectionIndex = creditGroups.findIndex((creditGroup) => {
    const representativeCredit = creditGroup[0];
    if (!representativeCredit) {
      return false;
    }

    const creditTmdbId = getValidTmdbEntityId(representativeCredit.id);
    if (targetPersonTmdbId !== null && creditTmdbId !== null) {
      return targetPersonTmdbId === creditTmdbId;
    }

    return normalizeName(representativeCredit.name ?? "") === targetPersonName;
  });

  return connectionIndex >= 0
    ? {
        credits: creditGroups[connectionIndex] ?? [],
        connectionOrder: connectionIndex + 1,
      }
    : null;
}

export function createAssociatedEntityCard(
  previousEntity: ResolvedAssociatedEntity | null,
  entity: ResolvedAssociatedEntity,
): AssociatedEntityCardResult | null {
  if (!previousEntity) {
    return null;
  }

  if (previousEntity.kind === "person" && entity.kind === "movie") {
    const creditGroup = findAssociatedMovieCreditGroup(previousEntity.personRecord, entity);
    if (!creditGroup) {
      return null;
    }

    return {
      card: createMovieAssociationCard(
        creditGroup.credits,
        entity.movieRecord,
        Math.max(entity.connectionCount, 1),
      ) as Extract<CinenerdleCard, { kind: "movie" }>,
      connectionOrder: creditGroup.connectionOrder,
    };
  }

  if (previousEntity.kind === "movie" && entity.kind === "person") {
    const creditGroup = findAssociatedPersonCreditGroup(previousEntity.movieRecord, entity);
    if (!creditGroup) {
      return null;
    }

    return {
      card: createPersonAssociationCard(
        creditGroup.credits,
        Math.max(entity.connectionCount, 1),
        entity.personRecord,
      ) as Extract<CinenerdleCard, { kind: "person" }>,
      connectionOrder: creditGroup.connectionOrder,
    };
  }

  return null;
}

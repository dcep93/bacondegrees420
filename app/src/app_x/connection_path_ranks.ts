import type { ConnectionEntity } from "./generators/cinenerdle2/connection_graph";
import type {
  FilmRecord,
  PersonRecord,
} from "./generators/cinenerdle2/types";
import { getFilmKey, normalizeName } from "./generators/cinenerdle2/utils";
import {
  getParentMovieRankForPerson,
  getParentPersonRankForMovie,
} from "./generators/cinenerdle2/view_model";

export async function annotateDirectionalConnectionPathRanks(
  path: ConnectionEntity[],
  options: {
    getMovieRecord: (entity: ConnectionEntity) => Promise<FilmRecord | null>;
    getPersonRecord: (entity: ConnectionEntity) => Promise<PersonRecord | null>;
    getConnectedMovieRecordsForPerson?: (
      entity: ConnectionEntity,
      personRecord: PersonRecord | null,
    ) => Promise<FilmRecord[]>;
    getConnectedPersonRecordsForMovie?: (
      entity: ConnectionEntity,
      movieRecord: FilmRecord | null,
    ) => Promise<PersonRecord[]>;
  },
): Promise<ConnectionEntity[]> {
  const popularityByMovieKey = new Map<string, number>();
  const popularityByPersonName = new Map<string, number>();
  const movieRecordCache = new Map<string, Promise<FilmRecord | null>>();
  const personRecordCache = new Map<string, Promise<PersonRecord | null>>();
  const populatedMovieConnectionKeys = new Set<string>();
  const populatedPersonConnectionKeys = new Set<string>();

  const getMovieRecord = (entity: ConnectionEntity) => {
    const cachedRecord = movieRecordCache.get(entity.key);
    if (cachedRecord) {
      return cachedRecord;
    }

    const nextRecord = options.getMovieRecord(entity);
    movieRecordCache.set(entity.key, nextRecord);
    return nextRecord;
  };

  const getPersonRecord = (entity: ConnectionEntity) => {
    const cachedRecord = personRecordCache.get(entity.key);
    if (cachedRecord) {
      return cachedRecord;
    }

    const nextRecord = options.getPersonRecord(entity);
    personRecordCache.set(entity.key, nextRecord);
    return nextRecord;
  };

  const populateMoviePopularityForPerson = async (
    entity: ConnectionEntity,
    personRecord: PersonRecord | null,
  ) => {
    if (!options.getConnectedMovieRecordsForPerson || populatedMovieConnectionKeys.has(entity.key)) {
      return;
    }

    populatedMovieConnectionKeys.add(entity.key);
    const movieRecords = await options.getConnectedMovieRecordsForPerson(entity, personRecord);
    movieRecords.forEach((movieRecord) => {
      const movieKey = movieRecord.titleYear ?? getFilmKey(movieRecord.title, movieRecord.year);
      popularityByMovieKey.set(
        movieKey,
        Math.max(popularityByMovieKey.get(movieKey) ?? 0, movieRecord.popularity ?? 0),
      );
    });
  };

  const populatePersonPopularityForMovie = async (
    entity: ConnectionEntity,
    movieRecord: FilmRecord | null,
  ) => {
    if (!options.getConnectedPersonRecordsForMovie || populatedPersonConnectionKeys.has(entity.key)) {
      return;
    }

    populatedPersonConnectionKeys.add(entity.key);
    const personRecords = await options.getConnectedPersonRecordsForMovie(entity, movieRecord);
    personRecords.forEach((personRecord) => {
      const personName = normalizeName(personRecord.name);
      if (!personName) {
        return;
      }

      popularityByPersonName.set(
        personName,
        Math.max(popularityByPersonName.get(personName) ?? 0, personRecord.rawTmdbPerson?.popularity ?? 0),
      );
    });
  };

  const populatedPath = await Promise.all(
    path.map(async (entity, index) => {
      const nextEntity = path[index + 1] ?? null;
      const popularity =
        typeof entity.popularity === "number"
          ? entity.popularity
          : entity.kind === "movie"
            ? (await getMovieRecord(entity))?.popularity ?? null
            : entity.kind === "person"
              ? (await getPersonRecord(entity))?.rawTmdbPerson?.popularity ?? null
              : null;

      return {
        ...entity,
        connectionParentLabel: nextEntity?.label ?? null,
        popularity,
      };
    }),
  );

  await Promise.all(
    populatedPath.map(async (entity) => {
      if (typeof entity.popularity !== "number") {
        return;
      }

      if (entity.kind === "movie") {
        const movieRecord = await getMovieRecord(entity);
        const movieKey = movieRecord?.titleYear ?? getFilmKey(entity.name, entity.year);
        popularityByMovieKey.set(
          movieKey,
          Math.max(popularityByMovieKey.get(movieKey) ?? 0, entity.popularity),
        );
        return;
      }

      if (entity.kind === "person") {
        const personName = normalizeName(entity.name);
        if (!personName) {
          return;
        }

        popularityByPersonName.set(
          personName,
          Math.max(popularityByPersonName.get(personName) ?? 0, entity.popularity),
        );
      }
    }),
  );

  return Promise.all(
    populatedPath.map(async (entity, index) => {
      const nextEntity = populatedPath[index + 1] ?? null;
      const connectionParentLabel = nextEntity?.label ?? null;

      if (entity.kind === "movie" && nextEntity?.kind === "person") {
        const movieRecord = await getMovieRecord(entity);
        const nextPersonRecord = await getPersonRecord(nextEntity);
        await populatePersonPopularityForMovie(entity, movieRecord);

        return {
          ...entity,
          connectionParentLabel,
          popularity: entity.popularity,
          connectionRank: getParentPersonRankForMovie(
            movieRecord,
            nextPersonRecord,
            popularityByPersonName,
          ),
        };
      }

      if (entity.kind === "person" && nextEntity?.kind === "movie") {
        const nextMovieRecord = await getMovieRecord(nextEntity);
        const personRecord = await getPersonRecord(entity);
        await populateMoviePopularityForPerson(entity, personRecord);

        return {
          ...entity,
          connectionParentLabel,
          popularity: entity.popularity,
          connectionRank: getParentMovieRankForPerson(
            nextMovieRecord,
            personRecord,
            popularityByMovieKey,
          ),
        };
      }

      return {
        ...entity,
        connectionParentLabel,
        popularity: entity.popularity,
        connectionRank: null,
      };
    }),
  );
}

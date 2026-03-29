import {
  getMovieConnectionEntityKey,
  getPersonConnectionEntityKey,
} from "./generators/cinenerdle2/connection_graph";
import {
  getAllFilmRecords,
  getAllPersonRecords,
  getFilmRecordByTitleAndYear,
  getFilmRecordsByPersonConnectionKey,
  getPersonRecordById,
  getPersonRecordByName,
  getPersonRecordsByMovieKey,
} from "./generators/cinenerdle2/indexed_db";
import type { FilmRecord, PersonRecord } from "./generators/cinenerdle2/types";
import {
  formatMoviePathLabel,
  getAssociatedPeopleFromMovieCredits,
  getFilmKey,
  getMovieKeyFromCredit,
  getMoviePosterUrl,
  getPersonProfileImageUrl,
  getSnapshotConnectionLabels,
  getTmdbMovieCredits,
  getValidTmdbEntityId,
  normalizeName,
  normalizeWhitespace,
} from "./generators/cinenerdle2/utils";
import type { CinenerdleCard } from "./generators/cinenerdle2/view_types";

export type YoungestSelectedCard = Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>;

export type ConnectionMatchupPreviewEntity = {
  key: string;
  kind: "movie" | "person";
  name: string;
  imageUrl: string | null;
  popularity: number;
  tooltipText: string;
};

export type ConnectionMatchupPreview = {
  counterpart: ConnectionMatchupPreviewEntity;
  spoiler: ConnectionMatchupPreviewEntity;
};

function getCardPersonTmdbId(
  card: Extract<YoungestSelectedCard, { kind: "person" }>,
): number | null {
  const recordTmdbId = getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id);
  if (recordTmdbId) {
    return recordTmdbId;
  }

  const keyMatch = card.key.match(/^person:(\d+)$/);
  return keyMatch ? getValidTmdbEntityId(keyMatch[1]) : null;
}

async function resolveSelectedMovieRecord(
  card: Extract<YoungestSelectedCard, { kind: "movie" }>,
): Promise<FilmRecord | null> {
  return getFilmRecordByTitleAndYear(card.name, card.year);
}

async function resolveSelectedPersonRecord(
  card: Extract<YoungestSelectedCard, { kind: "person" }>,
): Promise<PersonRecord | null> {
  const tmdbId = getCardPersonTmdbId(card);
  if (tmdbId) {
    const personRecord = await getPersonRecordById(tmdbId);
    if (personRecord) {
      return personRecord;
    }
  }

  return getPersonRecordByName(card.name);
}

function getMovieRecordKey(movieRecord: FilmRecord): string {
  return getMovieConnectionEntityKey(movieRecord.title, movieRecord.year);
}

function getPersonRecordKey(personRecord: PersonRecord): string {
  return getPersonConnectionEntityKey(personRecord.name, personRecord.tmdbId ?? personRecord.id);
}

function getMoviePopularity(movieRecord: FilmRecord): number {
  return movieRecord.popularity ?? 0;
}

function getPersonPopularity(personRecord: PersonRecord): number {
  return personRecord.rawTmdbPerson?.popularity ?? 0;
}

function getMovieConnectedPersonLabels(movieRecord: FilmRecord): Map<string, string> {
  const labelsByName = new Map<string, string>();

  movieRecord.personConnectionKeys.forEach((personName) => {
    const normalizedPersonName = normalizeName(personName);
    const trimmedPersonName = normalizeWhitespace(personName);
    if (normalizedPersonName && trimmedPersonName && !labelsByName.has(normalizedPersonName)) {
      labelsByName.set(normalizedPersonName, trimmedPersonName);
    }
  });

  getSnapshotConnectionLabels(movieRecord).forEach((personName) => {
    const normalizedPersonName = normalizeName(personName);
    const trimmedPersonName = normalizeWhitespace(personName);
    if (normalizedPersonName && trimmedPersonName) {
      labelsByName.set(normalizedPersonName, trimmedPersonName);
    }
  });

  getAssociatedPeopleFromMovieCredits(movieRecord).forEach((credit) => {
    const normalizedPersonName = normalizeName(credit.name ?? "");
    const trimmedPersonName = normalizeWhitespace(credit.name ?? "");
    if (normalizedPersonName && trimmedPersonName) {
      labelsByName.set(normalizedPersonName, trimmedPersonName);
    }
  });

  return labelsByName;
}

function getPersonConnectedMovieLabels(personRecord: PersonRecord): Map<string, string> {
  const labelsByMovieKey = new Map<string, string>();

  personRecord.movieConnectionKeys.forEach((movieKey) => {
    const normalizedMovieKey = normalizeWhitespace(movieKey).toLowerCase();
    const trimmedMovieKey = normalizeWhitespace(movieKey);
    if (normalizedMovieKey && trimmedMovieKey && !labelsByMovieKey.has(normalizedMovieKey)) {
      labelsByMovieKey.set(normalizedMovieKey, trimmedMovieKey);
    }
  });

  getTmdbMovieCredits(personRecord).forEach((credit) => {
    const movieKey = getMovieKeyFromCredit(credit);
    const movieTitle = normalizeWhitespace(formatMoviePathLabel(
      credit.title ?? credit.original_title ?? "",
      credit.release_date?.slice(0, 4) ?? "",
    ));

    if (movieKey && movieTitle) {
      labelsByMovieKey.set(movieKey, movieTitle);
    }
  });

  return labelsByMovieKey;
}

function isMovieConnectedToPerson(movieRecord: FilmRecord, personRecord: PersonRecord): boolean {
  const personTmdbId = getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id);
  const normalizedPersonName = normalizeName(personRecord.name);

  if (
    normalizedPersonName &&
    movieRecord.personConnectionKeys.some((personName) => normalizeName(personName) === normalizedPersonName)
  ) {
    return true;
  }

  return getAssociatedPeopleFromMovieCredits(movieRecord).some((credit) => {
    const creditTmdbId = getValidTmdbEntityId(credit.id);
    if (personTmdbId && creditTmdbId) {
      return personTmdbId === creditTmdbId;
    }

    return normalizeName(credit.name ?? "") === normalizedPersonName;
  });
}

function isPersonConnectedToMovie(personRecord: PersonRecord, movieRecord: FilmRecord): boolean {
  const targetMovieKey = getFilmKey(movieRecord.title, movieRecord.year);

  if (personRecord.movieConnectionKeys.some((movieKey) => normalizeWhitespace(movieKey).toLowerCase() === targetMovieKey)) {
    return true;
  }

  return getTmdbMovieCredits(personRecord).some((credit) => getMovieKeyFromCredit(credit) === targetMovieKey);
}

function compareMovieCandidates(
  left: { count: number; movieRecord: FilmRecord },
  right: { count: number; movieRecord: FilmRecord },
): number {
  if (right.count !== left.count) {
    return right.count - left.count;
  }

  const popularityDifference = getMoviePopularity(right.movieRecord) - getMoviePopularity(left.movieRecord);
  if (popularityDifference !== 0) {
    return popularityDifference;
  }

  return getMovieRecordKey(left.movieRecord).localeCompare(getMovieRecordKey(right.movieRecord));
}

function comparePersonCandidates(
  left: { count: number; personRecord: PersonRecord },
  right: { count: number; personRecord: PersonRecord },
): number {
  if (right.count !== left.count) {
    return right.count - left.count;
  }

  const popularityDifference = getPersonPopularity(right.personRecord) - getPersonPopularity(left.personRecord);
  if (popularityDifference !== 0) {
    return popularityDifference;
  }

  return getPersonRecordKey(left.personRecord).localeCompare(getPersonRecordKey(right.personRecord));
}

function comparePreviewEntities(
  left: ConnectionMatchupPreviewEntity,
  right: ConnectionMatchupPreviewEntity,
): number {
  if (right.popularity !== left.popularity) {
    return right.popularity - left.popularity;
  }

  return left.key.localeCompare(right.key);
}

function formatPreviewPopularity(popularity: number): string {
  return Number(popularity.toFixed(2)).toString();
}

function buildCounterpartTooltipText(
  entityName: string,
  popularity: number,
  sharedConnectionLabels: string[],
): string {
  return [
    entityName,
    `Popularity: ${formatPreviewPopularity(popularity)}`,
    ...sharedConnectionLabels,
  ].join("\n");
}

function createPreviewEntityFromMovieRecord(
  movieRecord: FilmRecord,
  sharedConnectionLabels: string[] = [],
): ConnectionMatchupPreviewEntity {
  const movieName = formatMoviePathLabel(movieRecord.title, movieRecord.year);

  return {
    key: getMovieRecordKey(movieRecord),
    kind: "movie",
    name: movieName,
    imageUrl: getMoviePosterUrl(movieRecord),
    popularity: getMoviePopularity(movieRecord),
    tooltipText: sharedConnectionLabels.length > 0
      ? buildCounterpartTooltipText(
        movieName,
        getMoviePopularity(movieRecord),
        sharedConnectionLabels,
      )
      : movieName,
  };
}

function createPreviewEntityFromPersonRecord(
  personRecord: PersonRecord,
  sharedConnectionLabels: string[] = [],
): ConnectionMatchupPreviewEntity {
  return {
    key: getPersonRecordKey(personRecord),
    kind: "person",
    name: personRecord.name,
    imageUrl: getPersonProfileImageUrl(personRecord),
    popularity: getPersonPopularity(personRecord),
    tooltipText: sharedConnectionLabels.length > 0
      ? buildCounterpartTooltipText(
        personRecord.name,
        getPersonPopularity(personRecord),
        sharedConnectionLabels,
      )
      : personRecord.name,
  };
}

async function findMovieCounterpart(
  movieRecord: FilmRecord,
): Promise<{ movieRecord: FilmRecord; sharedConnectionLabels: string[] } | null> {
  const movieKey = getMovieRecordKey(movieRecord);
  const candidates = new Map<
    string,
    { count: number; movieRecord: FilmRecord; sharedConnectionLabels: Set<string> }
  >();
  const connectedPeople = Array.from(getMovieConnectedPersonLabels(movieRecord).entries());

  await Promise.all(
    connectedPeople.map(async ([personName, personLabel]) => {
      const matchingMovies = await getFilmRecordsByPersonConnectionKey(personName);
      const countedMovieKeys = new Set<string>();

      matchingMovies.forEach((candidateMovie) => {
        const candidateMovieKey = getMovieRecordKey(candidateMovie);
        if (candidateMovieKey === movieKey || countedMovieKeys.has(candidateMovieKey)) {
          return;
        }

        countedMovieKeys.add(candidateMovieKey);
        const currentCandidate = candidates.get(candidateMovieKey);
        if (currentCandidate) {
          currentCandidate.count += 1;
          currentCandidate.sharedConnectionLabels.add(personLabel);
          if (getMoviePopularity(candidateMovie) > getMoviePopularity(currentCandidate.movieRecord)) {
            currentCandidate.movieRecord = candidateMovie;
          }
          return;
        }

        candidates.set(candidateMovieKey, {
          count: 1,
          movieRecord: candidateMovie,
          sharedConnectionLabels: new Set([personLabel]),
        });
      });
    }),
  );

  const bestCandidate = [...candidates.values()]
    .sort((left, right) =>
      compareMovieCandidates(
        {
          count: left.count,
          movieRecord: left.movieRecord,
        },
        {
          count: right.count,
          movieRecord: right.movieRecord,
        },
      ),
    )[0];

  if (!bestCandidate) {
    return null;
  }

  return {
    movieRecord: bestCandidate.movieRecord,
    sharedConnectionLabels: [...bestCandidate.sharedConnectionLabels].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

async function findPersonCounterpart(
  personRecord: PersonRecord,
): Promise<{ personRecord: PersonRecord; sharedConnectionLabels: string[] } | null> {
  const personKey = getPersonRecordKey(personRecord);
  const candidates = new Map<
    string,
    { count: number; personRecord: PersonRecord; sharedConnectionLabels: Set<string> }
  >();
  const connectedMovieKeys = Array.from(getPersonConnectedMovieLabels(personRecord).entries());

  await Promise.all(
    connectedMovieKeys.map(async ([movieKey, movieLabel]) => {
      const matchingPeople = await getPersonRecordsByMovieKey(movieKey);
      const countedPersonKeys = new Set<string>();

      matchingPeople.forEach((candidatePerson) => {
        const candidatePersonKey = getPersonRecordKey(candidatePerson);
        if (candidatePersonKey === personKey || countedPersonKeys.has(candidatePersonKey)) {
          return;
        }

        countedPersonKeys.add(candidatePersonKey);
        const currentCandidate = candidates.get(candidatePersonKey);
        if (currentCandidate) {
          currentCandidate.count += 1;
          currentCandidate.sharedConnectionLabels.add(movieLabel);
          if (getPersonPopularity(candidatePerson) > getPersonPopularity(currentCandidate.personRecord)) {
            currentCandidate.personRecord = candidatePerson;
          }
          return;
        }

        candidates.set(candidatePersonKey, {
          count: 1,
          personRecord: candidatePerson,
          sharedConnectionLabels: new Set([movieLabel]),
        });
      });
    }),
  );

  const bestCandidate = [...candidates.values()]
    .sort((left, right) =>
      comparePersonCandidates(
        {
          count: left.count,
          personRecord: left.personRecord,
        },
        {
          count: right.count,
          personRecord: right.personRecord,
        },
      ),
    )[0];

  if (!bestCandidate) {
    return null;
  }

  return {
    personRecord: bestCandidate.personRecord,
    sharedConnectionLabels: [...bestCandidate.sharedConnectionLabels].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

async function findMostPopularSelectedMovieSpoiler(
  selectedMovieRecord: FilmRecord,
  counterpartMovieRecord: FilmRecord,
): Promise<PersonRecord | null> {
  const allPeople = await getAllPersonRecords();
  const sortedPeople = [...allPeople].sort((left, right) =>
    comparePreviewEntities(
      createPreviewEntityFromPersonRecord(left),
      createPreviewEntityFromPersonRecord(right),
    ));

  return (
    sortedPeople.find(
      (personRecord) =>
        isMovieConnectedToPerson(selectedMovieRecord, personRecord) &&
        !isMovieConnectedToPerson(counterpartMovieRecord, personRecord),
    ) ?? null
  );
}

async function findMostPopularSelectedPersonSpoiler(
  selectedPersonRecord: PersonRecord,
  counterpartPersonRecord: PersonRecord,
): Promise<FilmRecord | null> {
  const allFilms = await getAllFilmRecords();
  const sortedFilms = [...allFilms].sort((left, right) =>
    comparePreviewEntities(
      createPreviewEntityFromMovieRecord(left),
      createPreviewEntityFromMovieRecord(right),
    ));

  return (
    sortedFilms.find(
      (movieRecord) =>
        isPersonConnectedToMovie(selectedPersonRecord, movieRecord) &&
        !isPersonConnectedToMovie(counterpartPersonRecord, movieRecord),
    ) ?? null
  );
}

export async function resolveConnectionMatchupPreview(
  youngestSelectedCard: YoungestSelectedCard | null,
): Promise<ConnectionMatchupPreview | null> {
  if (!youngestSelectedCard || youngestSelectedCard.kind === "cinenerdle") {
    return null;
  }

  if (youngestSelectedCard.kind === "movie") {
    const selectedMovieRecord = await resolveSelectedMovieRecord(youngestSelectedCard);
    if (!selectedMovieRecord) {
      return null;
    }

    const counterpartMovie = await findMovieCounterpart(selectedMovieRecord);
    if (!counterpartMovie) {
      return null;
    }

    const spoilerPerson = await findMostPopularSelectedMovieSpoiler(
      selectedMovieRecord,
      counterpartMovie.movieRecord,
    );
    if (!spoilerPerson) {
      return null;
    }

    return {
      counterpart: createPreviewEntityFromMovieRecord(
        counterpartMovie.movieRecord,
        counterpartMovie.sharedConnectionLabels,
      ),
      spoiler: createPreviewEntityFromPersonRecord(spoilerPerson),
    };
  }

  const selectedPersonRecord = await resolveSelectedPersonRecord(youngestSelectedCard);
  if (!selectedPersonRecord) {
    return null;
  }

  const counterpartPerson = await findPersonCounterpart(selectedPersonRecord);
  if (!counterpartPerson) {
    return null;
  }

  const spoilerMovie = await findMostPopularSelectedPersonSpoiler(
    selectedPersonRecord,
    counterpartPerson.personRecord,
  );
  if (!spoilerMovie) {
    return null;
  }

  return {
    counterpart: createPreviewEntityFromPersonRecord(
      counterpartPerson.personRecord,
      counterpartPerson.sharedConnectionLabels,
    ),
    spoiler: createPreviewEntityFromMovieRecord(spoilerMovie),
  };
}

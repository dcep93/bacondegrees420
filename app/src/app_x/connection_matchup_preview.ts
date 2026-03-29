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
  getAssociatedMoviesFromPersonCredits,
  getAssociatedPeopleFromMovieCredits,
  getFilmKey,
  getMovieKeyFromCredit,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getMoviePosterUrl,
  parseMoviePathLabel,
  getPersonProfileImageUrl,
  getTmdbMovieCredits,
  getValidTmdbEntityId,
  normalizeName,
  normalizeWhitespace,
} from "./generators/cinenerdle2/utils";
import type { CinenerdleCard } from "./generators/cinenerdle2/view_types";
import { addCinenerdleDebugLog } from "./generators/cinenerdle2/debug";

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

function summarizeYoungestSelectedCard(
  card: YoungestSelectedCard | null,
) {
  if (!card) {
    return {
      kind: "none",
      key: "",
      label: "",
      year: "",
    };
  }

  return {
    kind: card.kind,
    key: card.key,
    label: card.name,
    year: card.kind === "movie" ? card.year : "",
  };
}

function summarizePreviewEntity(
  entity: ConnectionMatchupPreviewEntity | null,
) {
  if (!entity) {
    return null;
  }

  return {
    key: entity.key,
    kind: entity.kind,
    name: entity.name,
    popularity: entity.popularity,
  };
}

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

  const credits = getAssociatedPeopleFromMovieCredits(movieRecord);

  if (credits.length === 0) {
    movieRecord.personConnectionKeys.forEach((personName) => {
      const normalizedPersonName = normalizeName(personName);
      const trimmedPersonName = normalizeWhitespace(personName);
      if (normalizedPersonName && trimmedPersonName && !labelsByName.has(normalizedPersonName)) {
        labelsByName.set(normalizedPersonName, trimmedPersonName);
      }
    });

    return labelsByName;
  }

  credits.forEach((credit) => {
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
  const credits = getAssociatedPeopleFromMovieCredits(movieRecord);

  if (credits.length === 0) {
    return Boolean(
      normalizedPersonName &&
      movieRecord.personConnectionKeys.some((personName) => normalizeName(personName) === normalizedPersonName),
    );
  }

  return credits.some((credit) => {
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

function compareSharedConnectionLabelsByPopularity(
  left: { label: string; popularity: number },
  right: { label: string; popularity: number },
): number {
  if (right.popularity !== left.popularity) {
    return right.popularity - left.popularity;
  }

  return left.label.localeCompare(right.label);
}

async function sortSharedPersonLabelsByPopularity(
  labels: Iterable<string>,
): Promise<string[]> {
  const allPeople = await getAllPersonRecords();
  const popularityByPersonName = new Map<string, number>();

  allPeople.forEach((personRecord) => {
    const normalizedPersonName = normalizeName(personRecord.name);
    if (!normalizedPersonName) {
      return;
    }

    popularityByPersonName.set(
      normalizedPersonName,
      Math.max(
        popularityByPersonName.get(normalizedPersonName) ?? 0,
        getPersonPopularity(personRecord),
      ),
    );
  });

  const labelsWithPopularity = [...new Set(labels)].map((label) => ({
    label,
    popularity: popularityByPersonName.get(normalizeName(label)) ?? 0,
  }));

  return labelsWithPopularity
    .sort(compareSharedConnectionLabelsByPopularity)
    .map(({ label }) => label);
}

async function sortSharedMovieLabelsByPopularity(
  labels: Iterable<string>,
): Promise<string[]> {
  const allFilms = await getAllFilmRecords();
  const popularityByMovieKey = new Map<string, number>();

  allFilms.forEach((filmRecord) => {
    const movieKey = getFilmKey(filmRecord.title, filmRecord.year);
    popularityByMovieKey.set(
      movieKey,
      Math.max(popularityByMovieKey.get(movieKey) ?? 0, getMoviePopularity(filmRecord)),
    );
  });

  const labelsWithPopularity = [...new Set(labels)].map((label) => {
    const movie = parseMoviePathLabel(label);
    return {
      label,
      popularity: popularityByMovieKey.get(getFilmKey(movie.name, movie.year)) ?? 0,
    };
  });

  return labelsWithPopularity
    .sort(compareSharedConnectionLabelsByPopularity)
    .map(({ label }) => label);
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
    sharedConnectionLabels: await sortSharedPersonLabelsByPopularity(
      bestCandidate.sharedConnectionLabels,
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
    sharedConnectionLabels: await sortSharedMovieLabelsByPopularity(
      bestCandidate.sharedConnectionLabels,
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

async function findDualMergeOrderedSelectedMovieSpoiler(
  selectedMovieRecord: FilmRecord,
  counterpartMovieRecord: FilmRecord,
): Promise<PersonRecord | null> {
  const orderedCredits = getAssociatedPeopleFromMovieCredits(selectedMovieRecord);

  for (const credit of orderedCredits) {
    const personName = normalizeWhitespace(credit.name ?? "");
    if (!personName) {
      continue;
    }

    const personRecord =
      (credit.id ? await getPersonRecordById(credit.id) : null) ??
      (await getPersonRecordByName(personName));
    if (!personRecord) {
      continue;
    }

    if (
      isMovieConnectedToPerson(selectedMovieRecord, personRecord) &&
      !isMovieConnectedToPerson(counterpartMovieRecord, personRecord)
    ) {
      return personRecord;
    }
  }

  return null;
}

async function findBestSelectedMovieSpoiler(
  selectedMovieRecord: FilmRecord,
  counterpartMovieRecord: FilmRecord,
): Promise<PersonRecord | null> {
  return (
    await findDualMergeOrderedSelectedMovieSpoiler(
      selectedMovieRecord,
      counterpartMovieRecord,
    )
  ) ?? findMostPopularSelectedMovieSpoiler(selectedMovieRecord, counterpartMovieRecord);
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

async function findDualMergeOrderedSelectedPersonSpoiler(
  selectedPersonRecord: PersonRecord,
  counterpartPersonRecord: PersonRecord,
): Promise<FilmRecord | null> {
  const orderedCredits = getAssociatedMoviesFromPersonCredits(selectedPersonRecord);

  for (const credit of orderedCredits) {
    const movieTitle = getMovieTitleFromCredit(credit);
    if (!movieTitle) {
      continue;
    }

    const movieRecord = await getFilmRecordByTitleAndYear(
      movieTitle,
      getMovieYearFromCredit(credit),
    );
    if (!movieRecord) {
      continue;
    }

    if (
      isPersonConnectedToMovie(selectedPersonRecord, movieRecord) &&
      !isPersonConnectedToMovie(counterpartPersonRecord, movieRecord)
    ) {
      return movieRecord;
    }
  }

  return null;
}

async function findBestSelectedPersonSpoiler(
  selectedPersonRecord: PersonRecord,
  counterpartPersonRecord: PersonRecord,
): Promise<FilmRecord | null> {
  return (
    await findDualMergeOrderedSelectedPersonSpoiler(
      selectedPersonRecord,
      counterpartPersonRecord,
    )
  ) ?? findMostPopularSelectedPersonSpoiler(selectedPersonRecord, counterpartPersonRecord);
}

export async function resolveConnectionMatchupPreview(
  youngestSelectedCard: YoungestSelectedCard | null,
): Promise<ConnectionMatchupPreview | null> {
  const selectedCardSummary = summarizeYoungestSelectedCard(youngestSelectedCard);

  try {
    if (!youngestSelectedCard || youngestSelectedCard.kind === "cinenerdle") {
      addCinenerdleDebugLog("connectionMatchupPreview.resolve.skipped", {
        reason: !youngestSelectedCard ? "noSelectedCard" : "cinenerdleSelected",
        selectedCard: selectedCardSummary,
      });
      return null;
    }

    if (youngestSelectedCard.kind === "movie") {
      const selectedMovieRecord = await resolveSelectedMovieRecord(youngestSelectedCard);
      if (!selectedMovieRecord) {
        addCinenerdleDebugLog("connectionMatchupPreview.resolve.movie.missingSelectedRecord", {
          selectedCard: selectedCardSummary,
        });
        return null;
      }

      const counterpartMovie = await findMovieCounterpart(selectedMovieRecord);
      if (!counterpartMovie) {
        addCinenerdleDebugLog("connectionMatchupPreview.resolve.movie.noCounterpart", {
          selectedCard: selectedCardSummary,
          selectedMovieKey: getMovieRecordKey(selectedMovieRecord),
        });
        return null;
      }

      const spoilerPerson = await findBestSelectedMovieSpoiler(
        selectedMovieRecord,
        counterpartMovie.movieRecord,
      );
      if (!spoilerPerson) {
        addCinenerdleDebugLog("connectionMatchupPreview.resolve.movie.noSpoiler", {
          selectedCard: selectedCardSummary,
          counterpartMovieKey: getMovieRecordKey(counterpartMovie.movieRecord),
        });
        return null;
      }

      const preview = {
        counterpart: createPreviewEntityFromMovieRecord(
          counterpartMovie.movieRecord,
          counterpartMovie.sharedConnectionLabels,
        ),
        spoiler: createPreviewEntityFromPersonRecord(spoilerPerson),
      };
      addCinenerdleDebugLog("connectionMatchupPreview.resolve.movie.resolved", {
        selectedCard: selectedCardSummary,
        counterpart: summarizePreviewEntity(preview.counterpart),
        spoiler: summarizePreviewEntity(preview.spoiler),
      });
      return preview;
    }

    const selectedPersonRecord = await resolveSelectedPersonRecord(youngestSelectedCard);
    if (!selectedPersonRecord) {
      addCinenerdleDebugLog("connectionMatchupPreview.resolve.person.missingSelectedRecord", {
        selectedCard: selectedCardSummary,
      });
      return null;
    }

    const counterpartPerson = await findPersonCounterpart(selectedPersonRecord);
    if (!counterpartPerson) {
      addCinenerdleDebugLog("connectionMatchupPreview.resolve.person.noCounterpart", {
        selectedCard: selectedCardSummary,
        selectedPersonKey: getPersonRecordKey(selectedPersonRecord),
      });
      return null;
    }

    const spoilerMovie = await findBestSelectedPersonSpoiler(
      selectedPersonRecord,
      counterpartPerson.personRecord,
    );
    if (!spoilerMovie) {
      addCinenerdleDebugLog("connectionMatchupPreview.resolve.person.noSpoiler", {
        selectedCard: selectedCardSummary,
        counterpartPersonKey: getPersonRecordKey(counterpartPerson.personRecord),
      });
      return null;
    }

    const preview = {
      counterpart: createPreviewEntityFromPersonRecord(
        counterpartPerson.personRecord,
        counterpartPerson.sharedConnectionLabels,
      ),
      spoiler: createPreviewEntityFromMovieRecord(spoilerMovie),
    };
    addCinenerdleDebugLog("connectionMatchupPreview.resolve.person.resolved", {
      selectedCard: selectedCardSummary,
      counterpart: summarizePreviewEntity(preview.counterpart),
      spoiler: summarizePreviewEntity(preview.spoiler),
    });
    return preview;
  } catch (error) {
    addCinenerdleDebugLog("connectionMatchupPreview.resolve.failed", {
      selectedCard: selectedCardSummary,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

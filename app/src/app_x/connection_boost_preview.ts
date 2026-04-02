import {
  getFilmRecordByTitleAndYear,
  getFilmRecordsByPersonConnectionKey,
  getPersonRecordById,
  getPersonRecordByName,
  getPersonRecordsByMovieKey,
} from "./generators/cinenerdle2/indexed_db";
import {
  getMovieConnectionEntityKey,
  getPersonConnectionEntityKey,
} from "./generators/cinenerdle2/connection_graph";
import type { FilmRecord, PersonRecord } from "./generators/cinenerdle2/types";
import {
  formatFallbackPersonDisplayName,
  formatMoviePathLabel,
  getAssociatedMoviesFromPersonCredits,
  getAssociatedPeopleFromMovieCredits,
  getFilmKey,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getMoviePosterUrl,
  getPosterUrl,
  getPersonProfileImageUrl,
  getValidTmdbEntityId,
  normalizeName,
  normalizeWhitespace,
  parseMoviePathLabel,
} from "./generators/cinenerdle2/utils";
import type { YoungestSelectedCard } from "./connection_matchup_preview";

export type ConnectionBoostPreviewEntity = {
  key: string;
  kind: "movie" | "person";
  name: string;
  imageUrl: string | null;
  popularity: number;
  tooltipText: string;
};

export type ConnectionBoostPreview = {
  distanceTwo: ConnectionBoostPreviewEntity;
  sharedConnection: ConnectionBoostPreviewEntity;
};

type PersonChildCandidate = {
  key: string;
  lookupKey: string;
  label: string;
  imageUrl: string | null;
  popularity: number;
  tmdbId: number | null;
  personRecord: PersonRecord | null;
};

type MovieChildCandidate = {
  key: string;
  lookupKey: string;
  label: string;
  imageUrl: string | null;
  popularity: number;
  tmdbId: number | null;
  movieRecord: FilmRecord | null;
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
  const personByName = await getPersonRecordByName(card.name);
  if (personByName) {
    return personByName;
  }

  if (tmdbId) {
    return getPersonRecordById(tmdbId);
  }

  return null;
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

function buildEntityTooltipText(name: string, popularity: number): string {
  return [
    name,
    `Popularity: ${Number(popularity.toFixed(2)).toString()}`,
  ].join("\n");
}

async function createPersonChildCandidateFromName(
  personName: string,
  popularity: number | null = null,
  tmdbId: number | null = null,
): Promise<PersonChildCandidate | null> {
  const normalizedPersonName = normalizeName(personName);
  if (!normalizedPersonName) {
    return null;
  }

  const personRecord =
    (await getPersonRecordByName(personName)) ??
    (tmdbId !== null ? await getPersonRecordById(tmdbId) : null);
  const resolvedTmdbId = getValidTmdbEntityId(
    personRecord?.tmdbId ?? personRecord?.id ?? tmdbId,
  );
  const label = personRecord?.name ?? formatFallbackPersonDisplayName(personName);

  return {
    key: getPersonConnectionEntityKey(label, resolvedTmdbId),
    lookupKey: normalizedPersonName,
    label,
    imageUrl:
      getPersonProfileImageUrl(personRecord) ??
      getPosterUrl(personRecord?.rawTmdbPersonSearchResponse?.results?.[0]?.profile_path, "w300_and_h450_face") ??
      null,
    popularity: popularity ?? (personRecord ? getPersonPopularity(personRecord) : 0),
    tmdbId: resolvedTmdbId,
    personRecord,
  };
}

async function createMovieChildCandidateFromParts(
  movieTitle: string,
  movieYear: string,
  popularity: number | null = null,
): Promise<MovieChildCandidate | null> {
  const normalizedTitle = normalizeWhitespace(movieTitle);
  if (!normalizedTitle) {
    return null;
  }

  const movieRecord = await getFilmRecordByTitleAndYear(normalizedTitle, movieYear);
  const title = movieRecord?.title ?? normalizedTitle;
  const year = movieRecord?.year ?? movieYear;

  return {
    key: getMovieConnectionEntityKey(title, year),
    lookupKey: getFilmKey(title, year),
    label: formatMoviePathLabel(title, year),
    imageUrl: getMoviePosterUrl(movieRecord),
    popularity: popularity ?? (movieRecord ? getMoviePopularity(movieRecord) : 0),
    tmdbId: getValidTmdbEntityId(movieRecord?.tmdbId ?? movieRecord?.id),
    movieRecord,
  };
}

function getPersonChildCandidateQuality(candidate: PersonChildCandidate): number {
  return (
    (candidate.personRecord ? 8 : 0) +
    (candidate.tmdbId !== null ? 4 : 0) +
    (candidate.imageUrl ? 2 : 0) +
    (candidate.popularity > 0 ? 1 : 0)
  );
}

function shouldReplacePersonChildCandidate(
  currentCandidate: PersonChildCandidate,
  nextCandidate: PersonChildCandidate,
): boolean {
  const qualityDifference =
    getPersonChildCandidateQuality(nextCandidate) - getPersonChildCandidateQuality(currentCandidate);
  if (qualityDifference !== 0) {
    return qualityDifference > 0;
  }

  if (nextCandidate.popularity !== currentCandidate.popularity) {
    return nextCandidate.popularity > currentCandidate.popularity;
  }

  return nextCandidate.key.localeCompare(currentCandidate.key) < 0;
}

function getMovieChildCandidateQuality(candidate: MovieChildCandidate): number {
  return (
    (candidate.movieRecord ? 8 : 0) +
    (candidate.tmdbId !== null ? 4 : 0) +
    (candidate.imageUrl ? 2 : 0) +
    (candidate.popularity > 0 ? 1 : 0)
  );
}

function shouldReplaceMovieChildCandidate(
  currentCandidate: MovieChildCandidate,
  nextCandidate: MovieChildCandidate,
): boolean {
  const qualityDifference =
    getMovieChildCandidateQuality(nextCandidate) - getMovieChildCandidateQuality(currentCandidate);
  if (qualityDifference !== 0) {
    return qualityDifference > 0;
  }

  if (nextCandidate.popularity !== currentCandidate.popularity) {
    return nextCandidate.popularity > currentCandidate.popularity;
  }

  return nextCandidate.key.localeCompare(currentCandidate.key) < 0;
}

function mergePersonChildCandidate(
  candidatesByLookupKey: Map<string, PersonChildCandidate>,
  candidate: PersonChildCandidate,
) {
  const currentCandidate = candidatesByLookupKey.get(candidate.lookupKey);
  if (!currentCandidate || shouldReplacePersonChildCandidate(currentCandidate, candidate)) {
    candidatesByLookupKey.set(candidate.lookupKey, candidate);
  }
}

function mergeMovieChildCandidate(
  candidatesByLookupKey: Map<string, MovieChildCandidate>,
  candidate: MovieChildCandidate,
) {
  const currentCandidate = candidatesByLookupKey.get(candidate.lookupKey);
  if (!currentCandidate || shouldReplaceMovieChildCandidate(currentCandidate, candidate)) {
    candidatesByLookupKey.set(candidate.lookupKey, candidate);
  }
}

async function getMovieDirectChildren(
  movieRecord: FilmRecord,
): Promise<PersonChildCandidate[]> {
  const candidatesByLookupKey = new Map<string, PersonChildCandidate>();
  const credits = getAssociatedPeopleFromMovieCredits(movieRecord);

  if (credits.length > 0) {
    const creditCandidates = await Promise.all(
      credits.map((credit) =>
        createPersonChildCandidateFromName(
          credit.name ?? "",
          credit.popularity ?? null,
          getValidTmdbEntityId(credit.id),
        ).then((candidate) => candidate
          ? {
            ...candidate,
            imageUrl:
              candidate.imageUrl ??
              getPosterUrl(credit.profile_path, "w300_and_h450_face") ??
              null,
          }
          : null)),
    );

    creditCandidates.forEach((candidate) => {
      if (candidate) {
        mergePersonChildCandidate(candidatesByLookupKey, candidate);
      }
    });
  }

  const fallbackCandidates = await Promise.all(
    movieRecord.personConnectionKeys.map((personName) =>
      createPersonChildCandidateFromName(personName)),
  );

  fallbackCandidates.forEach((candidate) => {
    if (candidate) {
      mergePersonChildCandidate(candidatesByLookupKey, candidate);
    }
  });

  return [...candidatesByLookupKey.values()];
}

async function getPersonDirectChildren(
  personRecord: PersonRecord,
): Promise<MovieChildCandidate[]> {
  const candidatesByLookupKey = new Map<string, MovieChildCandidate>();
  const credits = getAssociatedMoviesFromPersonCredits(personRecord);

  if (credits.length > 0) {
    const creditCandidates = await Promise.all(
      credits.map((credit) =>
        createMovieChildCandidateFromParts(
          getMovieTitleFromCredit(credit),
          getMovieYearFromCredit(credit),
          credit.popularity ?? null,
        ).then((candidate) => candidate
          ? {
            ...candidate,
            imageUrl: candidate.imageUrl ?? getPosterUrl(credit.poster_path) ?? null,
          }
          : null)),
    );

    creditCandidates.forEach((candidate) => {
      if (candidate) {
        mergeMovieChildCandidate(candidatesByLookupKey, candidate);
      }
    });
  }

  const fallbackCandidates = await Promise.all(
    personRecord.movieConnectionKeys.map(async (movieKey) => {
      const movie = parseMoviePathLabel(movieKey);
      return createMovieChildCandidateFromParts(movie.name, movie.year);
    }),
  );

  fallbackCandidates.forEach((candidate) => {
    if (candidate) {
      mergeMovieChildCandidate(candidatesByLookupKey, candidate);
    }
  });

  return [...candidatesByLookupKey.values()];
}

function compareMovieChildCandidates(
  left: MovieChildCandidate,
  right: MovieChildCandidate,
): number {
  if (right.popularity !== left.popularity) {
    return right.popularity - left.popularity;
  }

  return left.key.localeCompare(right.key);
}

function compareMovieRecordsByBoost(left: FilmRecord, right: FilmRecord): number {
  const popularityDifference = getMoviePopularity(right) - getMoviePopularity(left);
  if (popularityDifference !== 0) {
    return popularityDifference;
  }

  return getMovieRecordKey(left).localeCompare(getMovieRecordKey(right));
}

function comparePersonChildCandidates(
  left: PersonChildCandidate,
  right: PersonChildCandidate,
): number {
  if (right.popularity !== left.popularity) {
    return right.popularity - left.popularity;
  }

  return left.key.localeCompare(right.key);
}

function comparePersonRecordsByBoost(left: PersonRecord, right: PersonRecord): number {
  const popularityDifference = getPersonPopularity(right) - getPersonPopularity(left);
  if (popularityDifference !== 0) {
    return popularityDifference;
  }

  return getPersonRecordKey(left).localeCompare(getPersonRecordKey(right));
}

function createPreviewEntityFromMovieRecord(movieRecord: FilmRecord): ConnectionBoostPreviewEntity {
  const movieName = formatMoviePathLabel(movieRecord.title, movieRecord.year);
  const popularity = getMoviePopularity(movieRecord);

  return {
    key: getMovieRecordKey(movieRecord),
    kind: "movie",
    name: movieName,
    imageUrl: getMoviePosterUrl(movieRecord),
    popularity,
    tooltipText: buildEntityTooltipText(movieName, popularity),
  };
}

function createPreviewEntityFromPersonRecord(
  personRecord: PersonRecord,
): ConnectionBoostPreviewEntity {
  const popularity = getPersonPopularity(personRecord);

  return {
    key: getPersonRecordKey(personRecord),
    kind: "person",
    name: personRecord.name,
    imageUrl: getPersonProfileImageUrl(personRecord),
    popularity,
    tooltipText: buildEntityTooltipText(personRecord.name, popularity),
  };
}

function createPreviewEntityFromMovieChildCandidate(
  candidate: MovieChildCandidate,
): ConnectionBoostPreviewEntity {
  if (candidate.movieRecord) {
    return createPreviewEntityFromMovieRecord(candidate.movieRecord);
  }

  return {
    key: candidate.key,
    kind: "movie",
    name: candidate.label,
    imageUrl: candidate.imageUrl,
    popularity: candidate.popularity,
    tooltipText: buildEntityTooltipText(candidate.label, candidate.popularity),
  };
}

function createPreviewEntityFromPersonChildCandidate(
  candidate: PersonChildCandidate,
): ConnectionBoostPreviewEntity {
  if (candidate.personRecord) {
    return createPreviewEntityFromPersonRecord(candidate.personRecord);
  }

  return {
    key: candidate.key,
    kind: "person",
    name: candidate.label,
    imageUrl: candidate.imageUrl,
    popularity: candidate.popularity,
    tooltipText: buildEntityTooltipText(candidate.label, candidate.popularity),
  };
}

async function resolveMovieBoostPreview(
  selectedMovieRecord: FilmRecord,
): Promise<ConnectionBoostPreview | null> {
  const selectedMovieKey = getMovieRecordKey(selectedMovieRecord);
  const directPeople = await getMovieDirectChildren(selectedMovieRecord);
  const movieCandidates = new Map<
    string,
    {
      movieRecord: FilmRecord;
      sharedPeopleByLookupKey: Map<string, PersonChildCandidate>;
    }
  >();

  await Promise.all(
    directPeople.map(async (personCandidate) => {
      const matchingMovies = await getFilmRecordsByPersonConnectionKey(personCandidate.lookupKey);

      matchingMovies.forEach((candidateMovie) => {
        const candidateMovieKey = getMovieRecordKey(candidateMovie);
        if (candidateMovieKey === selectedMovieKey) {
          return;
        }

        const currentCandidate = movieCandidates.get(candidateMovieKey);
        if (currentCandidate) {
          if (getMoviePopularity(candidateMovie) > getMoviePopularity(currentCandidate.movieRecord)) {
            currentCandidate.movieRecord = candidateMovie;
          }
          mergePersonChildCandidate(currentCandidate.sharedPeopleByLookupKey, personCandidate);
          return;
        }

        const sharedPeopleByLookupKey = new Map<string, PersonChildCandidate>();
        mergePersonChildCandidate(sharedPeopleByLookupKey, personCandidate);
        movieCandidates.set(candidateMovieKey, {
          movieRecord: candidateMovie,
          sharedPeopleByLookupKey,
        });
      });
    }),
  );

  const bestDistanceTwoMovie = [...movieCandidates.values()]
    .sort((left, right) => compareMovieRecordsByBoost(left.movieRecord, right.movieRecord))[0];

  if (!bestDistanceTwoMovie) {
    return null;
  }

  const bestSharedPerson = [...bestDistanceTwoMovie.sharedPeopleByLookupKey.values()]
    .sort(comparePersonChildCandidates)[0];
  if (!bestSharedPerson) {
    return null;
  }

  return {
    distanceTwo: createPreviewEntityFromMovieRecord(bestDistanceTwoMovie.movieRecord),
    sharedConnection: createPreviewEntityFromPersonChildCandidate(bestSharedPerson),
  };
}

async function resolvePersonBoostPreview(
  selectedPersonRecord: PersonRecord,
): Promise<ConnectionBoostPreview | null> {
  const selectedPersonKey = getPersonRecordKey(selectedPersonRecord);
  const directMovies = await getPersonDirectChildren(selectedPersonRecord);
  const personCandidates = new Map<
    string,
    {
      personRecord: PersonRecord;
      sharedMoviesByLookupKey: Map<string, MovieChildCandidate>;
    }
  >();

  await Promise.all(
    directMovies.map(async (movieCandidate) => {
      const matchingPeople = await getPersonRecordsByMovieKey(movieCandidate.lookupKey);

      matchingPeople.forEach((candidatePerson) => {
        const candidatePersonKey = getPersonRecordKey(candidatePerson);
        if (candidatePersonKey === selectedPersonKey) {
          return;
        }

        const currentCandidate = personCandidates.get(candidatePersonKey);
        if (currentCandidate) {
          if (getPersonPopularity(candidatePerson) > getPersonPopularity(currentCandidate.personRecord)) {
            currentCandidate.personRecord = candidatePerson;
          }
          mergeMovieChildCandidate(currentCandidate.sharedMoviesByLookupKey, movieCandidate);
          return;
        }

        const sharedMoviesByLookupKey = new Map<string, MovieChildCandidate>();
        mergeMovieChildCandidate(sharedMoviesByLookupKey, movieCandidate);
        personCandidates.set(candidatePersonKey, {
          personRecord: candidatePerson,
          sharedMoviesByLookupKey,
        });
      });
    }),
  );

  const bestDistanceTwoPerson = [...personCandidates.values()]
    .sort((left, right) => comparePersonRecordsByBoost(left.personRecord, right.personRecord))[0];

  if (!bestDistanceTwoPerson) {
    return null;
  }

  const bestSharedMovie = [...bestDistanceTwoPerson.sharedMoviesByLookupKey.values()]
    .sort(compareMovieChildCandidates)[0];
  if (!bestSharedMovie) {
    return null;
  }

  return {
    distanceTwo: createPreviewEntityFromPersonRecord(bestDistanceTwoPerson.personRecord),
    sharedConnection: createPreviewEntityFromMovieChildCandidate(bestSharedMovie),
  };
}

export async function resolveConnectionBoostPreview(
  youngestSelectedCard: YoungestSelectedCard | null,
): Promise<ConnectionBoostPreview | null> {
  if (!youngestSelectedCard || youngestSelectedCard.kind === "cinenerdle") {
    return null;
  }

  if (youngestSelectedCard.kind === "movie") {
    const selectedMovieRecord = await resolveSelectedMovieRecord(youngestSelectedCard);
    if (!selectedMovieRecord) {
      return null;
    }

    return resolveMovieBoostPreview(selectedMovieRecord);
  }

  const selectedPersonRecord = await resolveSelectedPersonRecord(youngestSelectedCard);
  if (!selectedPersonRecord) {
    return null;
  }

  return resolvePersonBoostPreview(selectedPersonRecord);
}

import {
  getMovieConnectionEntityKey,
  getPersonConnectionEntityKey,
} from "./generators/cinenerdle2/connection_graph";
import {
  getFilmRecordById,
  getFilmRecordByTitleAndYear,
  getMoviePopularityByLabels,
  getFilmRecordsByPersonConnectionKey,
  getPersonPopularityByNames,
  getPersonRecordById,
  getPersonRecordByName,
  getPersonRecordsByMovieKey,
} from "./generators/cinenerdle2/indexed_db";
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
  normalizeTitle,
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

export type ConnectionMatchupPreview =
  | {
    kind: "versus";
    counterpart: ConnectionMatchupPreviewEntity;
    spoiler: ConnectionMatchupPreviewEntity;
    spoilerExplanation?: string;
  }
  | {
    kind: "counterpart-placeholder";
    counterpart: ConnectionMatchupPreviewEntity;
    placeholderLabel: string;
    placeholderExplanation: string;
  };

type MatchupDebugSummary = {
  key: string;
  kind: "movie" | "person";
  name: string;
};

type MatchupSpoilerSearchDebug = {
  reason: string;
  selected: MatchupDebugSummary;
  counterpart: MatchupDebugSummary;
  directChildren: {
    totalCandidates: number;
    sharedWithCounterpartCount: number;
    sharedWithCounterpartSamples: string[];
    exclusiveCount: number;
    exclusiveSamples: string[];
  };
};

type PersonChildCandidate = {
  key: string;
  lookupKey: string;
  label: string;
  imageUrl: string | null;
  popularity: number;
  tmdbId: number | null;
  personRecord: PersonRecord | null;
  matchKeys: string[];
};

type MovieChildCandidate = {
  key: string;
  lookupKey: string;
  label: string;
  imageUrl: string | null;
  popularity: number;
  tmdbId: number | null;
  movieRecord: FilmRecord | null;
  matchKeys: string[];
};

const NO_EXCLUSIVE_SPOILER_LABEL = "No exclusive spoiler";
const NO_EXCLUSIVE_SPOILER_EXPLANATION =
  "No direct connection unique to the selected item";

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

function getPersonMatchKeys(name: string, tmdbId: number | null): string[] {
  const normalizedName = normalizeName(name);
  const matchKeys = new Set<string>();

  if (tmdbId !== null) {
    matchKeys.add(getPersonConnectionEntityKey(name, tmdbId));
  }

  if (normalizedName) {
    matchKeys.add(getPersonConnectionEntityKey(normalizedName, null));
  }

  return [...matchKeys];
}

function getMovieMatchKeys(title: string, year: string): string[] {
  return [getMovieConnectionEntityKey(title, year)];
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
    matchKeys: getPersonMatchKeys(label, resolvedTmdbId),
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
  const label = formatMoviePathLabel(title, year);

  return {
    key: getMovieConnectionEntityKey(title, year),
    lookupKey: getFilmKey(title, year),
    label,
    imageUrl: getMoviePosterUrl(movieRecord),
    popularity: popularity ?? (movieRecord ? getMoviePopularity(movieRecord) : 0),
    tmdbId: getValidTmdbEntityId(movieRecord?.tmdbId ?? movieRecord?.id),
    movieRecord,
    matchKeys: getMovieMatchKeys(title, year),
  };
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
      if (!candidate) {
        return;
      }

      mergePersonChildCandidate(candidatesByLookupKey, candidate);
    });
  }

  const fallbackCandidates = await Promise.all(
    movieRecord.personConnectionKeys.map(async (personId) => {
      const validPersonId = getValidTmdbEntityId(personId);
      if (validPersonId === null) {
        return null;
      }

      const personRecord = await getPersonRecordById(validPersonId);
      return createPersonChildCandidateFromName(
        personRecord?.name ?? "",
        null,
        validPersonId,
      );
    }),
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
      if (!candidate) {
        return;
      }

      mergeMovieChildCandidate(candidatesByLookupKey, candidate);
    });
  }

  const fallbackCandidates = await Promise.all(
    personRecord.movieConnectionKeys.map(async (movieId) => {
      const validMovieId = getValidTmdbEntityId(movieId);
      if (validMovieId === null) {
        return null;
      }

      const movieRecord = await getFilmRecordById(validMovieId);
      return movieRecord
        ? createMovieChildCandidateFromParts(movieRecord.title, movieRecord.year)
        : null;
    }),
  );

  fallbackCandidates.forEach((candidate) => {
    if (candidate) {
      mergeMovieChildCandidate(candidatesByLookupKey, candidate);
    }
  });

  return [...candidatesByLookupKey.values()];
}

function getMovieConnectedPersonMatchKeys(movieRecord: FilmRecord): Set<string> {
  const connectedKeys = new Set<string>();
  const credits = getAssociatedPeopleFromMovieCredits(movieRecord);

  credits.forEach((credit) => {
    const personName = normalizeWhitespace(credit.name ?? "");
    if (!personName) {
      return;
    }

    getPersonMatchKeys(
      personName,
      getValidTmdbEntityId(credit.id),
    ).forEach((matchKey) => connectedKeys.add(matchKey));
  });

  movieRecord.personConnectionKeys.forEach((personId) => {
    const validPersonId = getValidTmdbEntityId(personId);
    if (validPersonId === null) {
      return;
    }

    getPersonMatchKeys("", validPersonId).forEach((matchKey) => connectedKeys.add(matchKey));
  });

  return connectedKeys;
}

async function getPersonConnectedMovieMatchKeys(personRecord: PersonRecord): Promise<Set<string>> {
  const connectedKeys = new Set<string>();
  const credits = getAssociatedMoviesFromPersonCredits(personRecord);

  credits.forEach((credit) => {
    const movieTitle = getMovieTitleFromCredit(credit);
    if (!normalizeWhitespace(movieTitle)) {
      return;
    }

    getMovieMatchKeys(
      movieTitle,
      getMovieYearFromCredit(credit),
    ).forEach((matchKey) => connectedKeys.add(matchKey));
  });

  const fallbackMovieRecords = await Promise.all(
    personRecord.movieConnectionKeys.map(async (movieId) => {
      const validMovieId = getValidTmdbEntityId(movieId);
      return validMovieId === null ? null : getFilmRecordById(validMovieId);
    }),
  );
  fallbackMovieRecords.forEach((movieRecord) => {
    if (!movieRecord) {
      return;
    }

    getMovieMatchKeys(movieRecord.title, movieRecord.year)
      .forEach((matchKey) => connectedKeys.add(matchKey));
  });

  return connectedKeys;
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

function comparePersonChildCandidates(
  left: PersonChildCandidate,
  right: PersonChildCandidate,
): number {
  if (right.popularity !== left.popularity) {
    return right.popularity - left.popularity;
  }

  return left.key.localeCompare(right.key);
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
  const popularityByPersonName = await getPersonPopularityByNames([...new Set(labels)]);

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
  const popularityByMovieLabel = await getMoviePopularityByLabels([...new Set(labels)]);

  const labelsWithPopularity = [...new Set(labels)].map((label) => {
    return {
      label,
      popularity: popularityByMovieLabel.get(normalizeTitle(label)) ?? 0,
    };
  });

  return labelsWithPopularity
    .sort(compareSharedConnectionLabelsByPopularity)
    .map(({ label }) => label);
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

function buildCounterpartTooltipText(
  entityName: string,
  popularity: number,
  sharedConnectionLabels: string[],
): string {
  return [
    entityName,
    `Popularity: ${Number(popularity.toFixed(2)).toString()}`,
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

function createPreviewEntityFromPersonChildCandidate(
  candidate: PersonChildCandidate,
): ConnectionMatchupPreviewEntity {
  if (candidate.personRecord) {
    return createPreviewEntityFromPersonRecord(candidate.personRecord);
  }

  return {
    key: candidate.key,
    kind: "person",
    name: candidate.label,
    imageUrl: candidate.imageUrl,
    popularity: candidate.popularity,
    tooltipText: candidate.label,
  };
}

function createPreviewEntityFromMovieChildCandidate(
  candidate: MovieChildCandidate,
): ConnectionMatchupPreviewEntity {
  if (candidate.movieRecord) {
    return createPreviewEntityFromMovieRecord(candidate.movieRecord);
  }

  return {
    key: candidate.key,
    kind: "movie",
    name: candidate.label,
    imageUrl: candidate.imageUrl,
    popularity: candidate.popularity,
    tooltipText: candidate.label,
  };
}

function appendDebugSample(samples: string[], value: string) {
  if (!value || samples.includes(value) || samples.length >= 5) {
    return;
  }

  samples.push(value);
}

function createSelectedMovieSummary(movieRecord: FilmRecord): MatchupDebugSummary {
  return {
    key: getMovieRecordKey(movieRecord),
    kind: "movie",
    name: formatMoviePathLabel(movieRecord.title, movieRecord.year),
  };
}

function createSelectedPersonSummary(personRecord: PersonRecord): MatchupDebugSummary {
  return {
    key: getPersonRecordKey(personRecord),
    kind: "person",
    name: personRecord.name,
  };
}

function createCounterpartMovieSummary(movieRecord: FilmRecord): MatchupDebugSummary {
  return {
    key: getMovieRecordKey(movieRecord),
    kind: "movie",
    name: formatMoviePathLabel(movieRecord.title, movieRecord.year),
  };
}

function createCounterpartPersonSummary(personRecord: PersonRecord): MatchupDebugSummary {
  return {
    key: getPersonRecordKey(personRecord),
    kind: "person",
    name: personRecord.name,
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
  const connectedPeople = await getMovieDirectChildren(movieRecord);

  await Promise.all(
    connectedPeople.map(async (personCandidate) => {
      const matchingMovies = await getFilmRecordsByPersonConnectionKey(personCandidate.lookupKey);
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
          currentCandidate.sharedConnectionLabels.add(personCandidate.label);
          if (getMoviePopularity(candidateMovie) > getMoviePopularity(currentCandidate.movieRecord)) {
            currentCandidate.movieRecord = candidateMovie;
          }
          return;
        }

        candidates.set(candidateMovieKey, {
          count: 1,
          movieRecord: candidateMovie,
          sharedConnectionLabels: new Set([personCandidate.label]),
        });
      });
    }),
  );

  const bestCandidate = [...candidates.values()]
    .sort((left, right) =>
      compareMovieCandidates(
        { count: left.count, movieRecord: left.movieRecord },
        { count: right.count, movieRecord: right.movieRecord },
      ))[0];

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
  const connectedMovies = await getPersonDirectChildren(personRecord);

  await Promise.all(
    connectedMovies.map(async (movieCandidate) => {
      const matchingPeople = await getPersonRecordsByMovieKey(movieCandidate.lookupKey);
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
          currentCandidate.sharedConnectionLabels.add(movieCandidate.label);
          if (getPersonPopularity(candidatePerson) > getPersonPopularity(currentCandidate.personRecord)) {
            currentCandidate.personRecord = candidatePerson;
          }
          return;
        }

        candidates.set(candidatePersonKey, {
          count: 1,
          personRecord: candidatePerson,
          sharedConnectionLabels: new Set([movieCandidate.label]),
        });
      });
    }),
  );

  const bestCandidate = [...candidates.values()]
    .sort((left, right) =>
      comparePersonCandidates(
        { count: left.count, personRecord: left.personRecord },
        { count: right.count, personRecord: right.personRecord },
      ))[0];

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

async function findSelectedMovieSpoiler(
  selectedMovieRecord: FilmRecord,
  counterpartMovieRecord: FilmRecord,
): Promise<{ spoiler: ConnectionMatchupPreviewEntity | null; debug: MatchupSpoilerSearchDebug }> {
  const directChildren = await getMovieDirectChildren(selectedMovieRecord);
  const counterpartMatchKeys = getMovieConnectedPersonMatchKeys(counterpartMovieRecord);
  const exclusiveChildren: PersonChildCandidate[] = [];
  const debug: MatchupSpoilerSearchDebug = {
    reason: "",
    selected: createSelectedMovieSummary(selectedMovieRecord),
    counterpart: createCounterpartMovieSummary(counterpartMovieRecord),
    directChildren: {
      totalCandidates: directChildren.length,
      sharedWithCounterpartCount: 0,
      sharedWithCounterpartSamples: [],
      exclusiveCount: 0,
      exclusiveSamples: [],
    },
  };

  directChildren.forEach((candidate) => {
    if (candidate.matchKeys.some((matchKey) => counterpartMatchKeys.has(matchKey))) {
      debug.directChildren.sharedWithCounterpartCount += 1;
      appendDebugSample(debug.directChildren.sharedWithCounterpartSamples, candidate.label);
      return;
    }

    debug.directChildren.exclusiveCount += 1;
    appendDebugSample(debug.directChildren.exclusiveSamples, candidate.label);
    exclusiveChildren.push(candidate);
  });

  const bestSpoiler = [...exclusiveChildren].sort(comparePersonChildCandidates)[0];
  if (!bestSpoiler) {
    debug.reason = "no_unique_person_connected_to_selected_movie";
    return {
      spoiler: null,
      debug,
    };
  }

  debug.reason = "found_unique_person_connected_to_selected_movie";
  return {
    spoiler: createPreviewEntityFromPersonChildCandidate(bestSpoiler),
    debug,
  };
}

async function findSelectedPersonSpoiler(
  selectedPersonRecord: PersonRecord,
  counterpartPersonRecord: PersonRecord,
): Promise<{ spoiler: ConnectionMatchupPreviewEntity | null; debug: MatchupSpoilerSearchDebug }> {
  const directChildren = await getPersonDirectChildren(selectedPersonRecord);
  const counterpartMatchKeys = await getPersonConnectedMovieMatchKeys(counterpartPersonRecord);
  const exclusiveChildren: MovieChildCandidate[] = [];
  const debug: MatchupSpoilerSearchDebug = {
    reason: "",
    selected: createSelectedPersonSummary(selectedPersonRecord),
    counterpart: createCounterpartPersonSummary(counterpartPersonRecord),
    directChildren: {
      totalCandidates: directChildren.length,
      sharedWithCounterpartCount: 0,
      sharedWithCounterpartSamples: [],
      exclusiveCount: 0,
      exclusiveSamples: [],
    },
  };

  directChildren.forEach((candidate) => {
    if (candidate.matchKeys.some((matchKey) => counterpartMatchKeys.has(matchKey))) {
      debug.directChildren.sharedWithCounterpartCount += 1;
      appendDebugSample(debug.directChildren.sharedWithCounterpartSamples, candidate.label);
      return;
    }

    debug.directChildren.exclusiveCount += 1;
    appendDebugSample(debug.directChildren.exclusiveSamples, candidate.label);
    exclusiveChildren.push(candidate);
  });

  const bestSpoiler = [...exclusiveChildren].sort(compareMovieChildCandidates)[0];
  if (!bestSpoiler) {
    debug.reason = "no_unique_movie_connected_to_selected_person";
    return {
      spoiler: null,
      debug,
    };
  }

  debug.reason = "found_unique_movie_connected_to_selected_person";
  return {
    spoiler: createPreviewEntityFromMovieChildCandidate(bestSpoiler),
    debug,
  };
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

    const spoilerResult = await findSelectedMovieSpoiler(
      selectedMovieRecord,
      counterpartMovie.movieRecord,
    );
    if (!spoilerResult.spoiler) {
      return {
        kind: "counterpart-placeholder",
        counterpart: createPreviewEntityFromMovieRecord(
          counterpartMovie.movieRecord,
          counterpartMovie.sharedConnectionLabels,
        ),
        placeholderLabel: NO_EXCLUSIVE_SPOILER_LABEL,
        placeholderExplanation: NO_EXCLUSIVE_SPOILER_EXPLANATION,
      };
    }

    return {
      kind: "versus",
      counterpart: createPreviewEntityFromMovieRecord(
        counterpartMovie.movieRecord,
        counterpartMovie.sharedConnectionLabels,
      ),
      spoiler: spoilerResult.spoiler,
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

  const spoilerResult = await findSelectedPersonSpoiler(
    selectedPersonRecord,
    counterpartPerson.personRecord,
  );
  if (!spoilerResult.spoiler) {
    return {
      kind: "counterpart-placeholder",
      counterpart: createPreviewEntityFromPersonRecord(
        counterpartPerson.personRecord,
        counterpartPerson.sharedConnectionLabels,
      ),
      placeholderLabel: NO_EXCLUSIVE_SPOILER_LABEL,
      placeholderExplanation: NO_EXCLUSIVE_SPOILER_EXPLANATION,
    };
  }

  return {
    kind: "versus",
    counterpart: createPreviewEntityFromPersonRecord(
      counterpartPerson.personRecord,
      counterpartPerson.sharedConnectionLabels,
    ),
    spoiler: spoilerResult.spoiler,
  };
}

import {
  getFilmRecordByTitleAndYear,
  saveFilmRecord,
  getPersonRecordsByMovieId,
} from "./generators/cinenerdle2/indexed_db";
import {
  hasMovieFullState,
  prepareConnectionEntityForPreview,
  prepareSelectedMovie,
} from "./generators/cinenerdle2/tmdb";
import type { FilmRecord } from "./generators/cinenerdle2/types";
import {
  formatMoviePathLabel,
  getMovieCardKey,
  getValidTmdbEntityId,
  parseMoviePathLabel,
} from "./generators/cinenerdle2/utils";

export type PersonCoverCandidate = {
  tmdbId: number;
  popularity: number;
  movieConnectionKeys: number[];
};

export type PersonCoverSelectionStrategy = "approximate" | "exact";

export type PersonCoverSelectionResult = {
  personTmdbIds: number[];
  strategy: PersonCoverSelectionStrategy;
};

export type ResolvedMovieCoverRecord = {
  inputLabel: string;
  movieRecord: FilmRecord & {
    rawTmdbMovie: NonNullable<FilmRecord["rawTmdbMovie"]>;
    rawTmdbMovieCreditsResponse: NonNullable<FilmRecord["rawTmdbMovieCreditsResponse"]>;
  };
  tmdbId: number;
};

type NormalizedCandidate = {
  tmdbId: number;
  popularity: number;
  coverageMask: bigint;
  coverageCount: number;
};

type BestSolution = {
  ids: number[];
  totalPopularity: number;
};

const EXACT_COVER_MOVIE_LIMIT = 24;
const MOVIE_RESOLUTION_CONCURRENCY = 6;
const PERSON_RECORD_LOOKUP_CONCURRENCY = 12;

function normalizePositiveTmdbId(candidateId: number | string | null | undefined): number | null {
  const validTmdbId = getValidTmdbEntityId(candidateId);
  if (validTmdbId === null || !Number.isInteger(validTmdbId) || validTmdbId <= 0) {
    return null;
  }

  return validTmdbId;
}

function normalizePopularity(popularity: number): number {
  if (!Number.isFinite(popularity)) {
    return 0;
  }

  return Math.max(popularity, 0);
}

function countSetBits(mask: bigint): number {
  let remainingMask = mask;
  let count = 0;

  while (remainingMask > 0n) {
    remainingMask &= remainingMask - 1n;
    count += 1;
  }

  return count;
}

function compareSortedIdArrays(leftIds: number[], rightIds: number[]): number {
  const maxLength = Math.max(leftIds.length, rightIds.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftId = leftIds[index] ?? Number.POSITIVE_INFINITY;
    const rightId = rightIds[index] ?? Number.POSITIVE_INFINITY;
    if (leftId !== rightId) {
      return leftId - rightId;
    }
  }

  return 0;
}

function insertSortedId(ids: number[], nextId: number): number[] {
  const nextIds = [...ids, nextId];
  nextIds.sort((leftId, rightId) => leftId - rightId);
  return nextIds;
}

function isBetterSolution(
  nextIds: number[],
  nextTotalPopularity: number,
  bestSolution: BestSolution | null,
): boolean {
  if (!bestSolution) {
    return true;
  }

  if (nextIds.length !== bestSolution.ids.length) {
    return nextIds.length < bestSolution.ids.length;
  }

  if (nextTotalPopularity !== bestSolution.totalPopularity) {
    return nextTotalPopularity > bestSolution.totalPopularity;
  }

  return compareSortedIdArrays(nextIds, bestSolution.ids) < 0;
}

function normalizeRequestedMovieTmdbIds(movieTmdbIds: number[]): number[] {
  const invalidMovieIds = movieTmdbIds.flatMap((movieTmdbId) =>
    normalizePositiveTmdbId(movieTmdbId) === null ? [String(movieTmdbId)] : []);

  if (invalidMovieIds.length > 0) {
    throw new Error(`Invalid TMDB movie ids: ${invalidMovieIds.join(", ")}`);
  }

  return Array.from(new Set(
    movieTmdbIds.map((movieTmdbId) => normalizePositiveTmdbId(movieTmdbId)!),
  )).sort((leftId, rightId) => leftId - rightId);
}

function normalizeMovieLabels(movieLabels: string[]): string[] {
  return movieLabels
    .map((movieLabel) => movieLabel.trim())
    .filter(Boolean);
}

async function mapWithConcurrencyLimit<TInput, TOutput>(
  values: TInput[],
  concurrencyLimit: number,
  mapper: (value: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (values.length === 0) {
    return [];
  }

  const results = new Array<TOutput>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrencyLimit, 1), values.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(values[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

async function ensureMovieHasPersonRecords(
  movieRecord: ResolvedMovieCoverRecord["movieRecord"],
  formattedMovieLabel: string,
  movieName: string,
  movieYear: string,
): Promise<ResolvedMovieCoverRecord["movieRecord"]> {
  const tmdbId = getValidTmdbEntityId(movieRecord.tmdbId ?? movieRecord.id);
  if (tmdbId === null) {
    throw new Error(`Unable to resolve movie: ${formattedMovieLabel}`);
  }

  const existingPersonRecords = await getPersonRecordsByMovieId(tmdbId);
  if (existingPersonRecords.length > 0) {
    return movieRecord;
  }

  await saveFilmRecord(movieRecord);

  const derivedPersonRecords = await getPersonRecordsByMovieId(tmdbId);
  if (derivedPersonRecords.length > 0) {
    return movieRecord;
  }

  const refreshedMovieRecord = await prepareSelectedMovie(
    movieName,
    movieYear,
    tmdbId,
    {
      forceRefresh: true,
    },
  );
  const refreshedPersonRecords = await getPersonRecordsByMovieId(tmdbId);
  if (
    refreshedMovieRecord &&
    hasMovieFullState(refreshedMovieRecord) &&
    refreshedPersonRecords.length > 0
  ) {
    return refreshedMovieRecord;
  }

  throw new Error(`Unable to derive connected people for movie: ${formattedMovieLabel}`);
}

async function resolveMovieRecordForLabel(
  inputLabel: string,
): Promise<ResolvedMovieCoverRecord> {
  const parsedMovie = parseMoviePathLabel(inputLabel);
  const formattedMovieLabel = formatMoviePathLabel(parsedMovie.name, parsedMovie.year);
  const localMovieRecord = await getFilmRecordByTitleAndYear(parsedMovie.name, parsedMovie.year);
  const resolvedMovieRecord = hasMovieFullState(localMovieRecord)
    ? localMovieRecord
    : await prepareConnectionEntityForPreview({
      key: getMovieCardKey(parsedMovie.name, parsedMovie.year),
      kind: "movie",
      name: formattedMovieLabel,
      year: parsedMovie.year,
    });
  const validMovieRecord =
    resolvedMovieRecord && "title" in resolvedMovieRecord && hasMovieFullState(resolvedMovieRecord)
      ? resolvedMovieRecord
      : null;
  const tmdbId = getValidTmdbEntityId(validMovieRecord?.tmdbId ?? validMovieRecord?.id);

  if (!validMovieRecord || tmdbId === null) {
    throw new Error(`Unable to resolve movie: ${formattedMovieLabel}`);
  }

  const movieRecordWithPeople = await ensureMovieHasPersonRecords(
    validMovieRecord,
    formattedMovieLabel,
    parsedMovie.name,
    parsedMovie.year,
  );

  return {
    inputLabel: formattedMovieLabel,
    movieRecord: movieRecordWithPeople,
    tmdbId,
  };
}

export async function resolveMovieCoverRecordsForLabels(
  movieLabels: string[],
): Promise<ResolvedMovieCoverRecord[]> {
  const normalizedMovieLabels = normalizeMovieLabels(movieLabels);
  if (normalizedMovieLabels.length === 0) {
    return [];
  }

  const resolvedMovies = await mapWithConcurrencyLimit(
    normalizedMovieLabels,
    MOVIE_RESOLUTION_CONCURRENCY,
    async (movieLabel) => resolveMovieRecordForLabel(movieLabel),
  );
  const seenMovieTmdbIds = new Set<number>();
  const dedupedMovies = resolvedMovies.filter((resolvedMovie) => {
    if (seenMovieTmdbIds.has(resolvedMovie.tmdbId)) {
      return false;
    }

    seenMovieTmdbIds.add(resolvedMovie.tmdbId);
    return true;
  });
  return dedupedMovies;
}

function mergeCandidates(
  requestedMovieIds: number[],
  candidates: ReadonlyArray<PersonCoverCandidate>,
): NormalizedCandidate[] {
  const requestedMovieIdSet = new Set(requestedMovieIds);
  const requestedMovieBitById = new Map(
    requestedMovieIds.map((movieTmdbId, index) => [movieTmdbId, 1n << BigInt(index)] as const),
  );
  const mergedCandidatesByTmdbId = new Map<number, { popularity: number; coveredMovieIds: Set<number> }>();

  candidates.forEach((candidate) => {
    const personTmdbId = normalizePositiveTmdbId(candidate.tmdbId);
    if (personTmdbId === null) {
      return;
    }

    const mergedCandidate = mergedCandidatesByTmdbId.get(personTmdbId) ?? {
      popularity: 0,
      coveredMovieIds: new Set<number>(),
    };
    mergedCandidate.popularity = Math.max(
      mergedCandidate.popularity,
      normalizePopularity(candidate.popularity),
    );

    candidate.movieConnectionKeys.forEach((movieTmdbId) => {
      const validMovieTmdbId = normalizePositiveTmdbId(movieTmdbId);
      if (validMovieTmdbId !== null && requestedMovieIdSet.has(validMovieTmdbId)) {
        mergedCandidate.coveredMovieIds.add(validMovieTmdbId);
      }
    });

    mergedCandidatesByTmdbId.set(personTmdbId, mergedCandidate);
  });

  return [...mergedCandidatesByTmdbId.entries()]
    .flatMap(([personTmdbId, mergedCandidate]) => {
      let coverageMask = 0n;

      mergedCandidate.coveredMovieIds.forEach((movieTmdbId) => {
        coverageMask |= requestedMovieBitById.get(movieTmdbId) ?? 0n;
      });

      if (coverageMask === 0n) {
        return [];
      }

      return [{
        tmdbId: personTmdbId,
        popularity: mergedCandidate.popularity,
        coverageMask,
        coverageCount: countSetBits(coverageMask),
      }];
    });
}

function pruneDominatedCandidates(candidates: NormalizedCandidate[]): NormalizedCandidate[] {
  return candidates.filter((candidate, candidateIndex) =>
    !candidates.some((otherCandidate, otherCandidateIndex) => {
      if (candidateIndex === otherCandidateIndex) {
        return false;
      }

      const isSuperset =
        (otherCandidate.coverageMask | candidate.coverageMask) === otherCandidate.coverageMask;
      if (!isSuperset) {
        return false;
      }

      if (otherCandidate.popularity > candidate.popularity) {
        return true;
      }

      return (
        otherCandidate.popularity === candidate.popularity &&
        otherCandidate.tmdbId <= candidate.tmdbId
      );
    }),
  );
}

function getUncoveredMovieIds(
  requestedMovieIds: number[],
  candidates: NormalizedCandidate[],
): number[] {
  let coveredMask = 0n;
  candidates.forEach((candidate) => {
    coveredMask |= candidate.coverageMask;
  });

  return requestedMovieIds.filter((_movieTmdbId, index) =>
    (coveredMask & (1n << BigInt(index))) === 0n);
}

function prepareCandidatesForMovieIds(
  requestedMovieIds: number[],
  candidates: ReadonlyArray<PersonCoverCandidate>,
): NormalizedCandidate[] {
  const preparedCandidates = pruneDominatedCandidates(
    mergeCandidates(requestedMovieIds, candidates),
  ).sort((leftCandidate, rightCandidate) => {
    if (rightCandidate.coverageCount !== leftCandidate.coverageCount) {
      return rightCandidate.coverageCount - leftCandidate.coverageCount;
    }

    if (rightCandidate.popularity !== leftCandidate.popularity) {
      return rightCandidate.popularity - leftCandidate.popularity;
    }

    return leftCandidate.tmdbId - rightCandidate.tmdbId;
  });
  const uncoveredMovieIds = getUncoveredMovieIds(requestedMovieIds, preparedCandidates);
  if (uncoveredMovieIds.length > 0) {
    throw new Error(`Unable to cover movie TMDB ids: ${uncoveredMovieIds.join(", ")}`);
  }

  return preparedCandidates;
}

function selectExactBestPersonTmdbIdsForMovieIds(
  requestedMovieIds: number[],
  preparedCandidates: NormalizedCandidate[],
): number[] {
  const fullCoverageMask = (1n << BigInt(requestedMovieIds.length)) - 1n;
  const bestSolutionByCoverageMask = new Map<bigint, BestSolution>();
  bestSolutionByCoverageMask.set(0n, {
    ids: [],
    totalPopularity: 0,
  });

  preparedCandidates.forEach((candidate) => {
    const currentSolutions = Array.from(bestSolutionByCoverageMask.entries());

    currentSolutions.forEach(([coveredMask, solution]) => {
      const nextCoveredMask = coveredMask | candidate.coverageMask;
      if (nextCoveredMask === coveredMask) {
        return;
      }

      const nextSolution = {
        ids: insertSortedId(solution.ids, candidate.tmdbId),
        totalPopularity: solution.totalPopularity + candidate.popularity,
      };
      const existingBestSolution = bestSolutionByCoverageMask.get(nextCoveredMask) ?? null;
      if (isBetterSolution(
        nextSolution.ids,
        nextSolution.totalPopularity,
        existingBestSolution,
      )) {
        bestSolutionByCoverageMask.set(nextCoveredMask, nextSolution);
      }
    });
  });

  const bestSolution = bestSolutionByCoverageMask.get(fullCoverageMask) ?? null;
  if (!bestSolution) {
    throw new Error(`Unable to cover movie TMDB ids: ${requestedMovieIds.join(", ")}`);
  }

  return bestSolution.ids;
}

function pruneRedundantSelectedCandidates(selectedCandidates: NormalizedCandidate[]): NormalizedCandidate[] {
  return selectedCandidates.filter((candidate, candidateIndex) => {
    let coveredMaskWithoutCandidate = 0n;

    selectedCandidates.forEach((otherCandidate, otherCandidateIndex) => {
      if (candidateIndex !== otherCandidateIndex) {
        coveredMaskWithoutCandidate |= otherCandidate.coverageMask;
      }
    });

    return (coveredMaskWithoutCandidate & candidate.coverageMask) !== candidate.coverageMask;
  });
}

function selectApproximateBestPersonTmdbIdsForMovieIds(
  requestedMovieIds: number[],
  preparedCandidates: NormalizedCandidate[],
): number[] {
  let uncoveredMask = (1n << BigInt(requestedMovieIds.length)) - 1n;
  const selectedCandidates: NormalizedCandidate[] = [];
  const remainingCandidates = [...preparedCandidates];

  while (uncoveredMask !== 0n) {
    let bestCandidateIndex = -1;
    let bestNewCoverageCount = 0;

    remainingCandidates.forEach((candidate, candidateIndex) => {
      const uncoveredCoverageMask = candidate.coverageMask & uncoveredMask;
      if (uncoveredCoverageMask === 0n) {
        return;
      }

      const newCoverageCount = countSetBits(uncoveredCoverageMask);
      const currentBestCandidate =
        bestCandidateIndex >= 0 ? remainingCandidates[bestCandidateIndex] : null;
      const shouldReplaceBestCandidate =
        newCoverageCount > bestNewCoverageCount ||
        (newCoverageCount === bestNewCoverageCount &&
          (currentBestCandidate === null ||
            candidate.popularity > currentBestCandidate.popularity ||
            (candidate.popularity === currentBestCandidate.popularity &&
              candidate.tmdbId < currentBestCandidate.tmdbId)));

      if (!shouldReplaceBestCandidate) {
        return;
      }

      bestCandidateIndex = candidateIndex;
      bestNewCoverageCount = newCoverageCount;
    });

    if (bestCandidateIndex < 0) {
      throw new Error(`Unable to cover movie TMDB ids: ${requestedMovieIds.join(", ")}`);
    }

    const [nextCandidate] = remainingCandidates.splice(bestCandidateIndex, 1);
    selectedCandidates.push(nextCandidate);
    uncoveredMask &= ~nextCandidate.coverageMask;
  }

  return pruneRedundantSelectedCandidates(selectedCandidates)
    .map((candidate) => candidate.tmdbId)
    .sort((leftId, rightId) => leftId - rightId);
}

export function selectBestPersonCoverForMovieIds(
  movieTmdbIds: number[],
  candidates: ReadonlyArray<PersonCoverCandidate>,
): PersonCoverSelectionResult {
  const requestedMovieIds = normalizeRequestedMovieTmdbIds(movieTmdbIds);
  if (requestedMovieIds.length === 0) {
    return {
      personTmdbIds: [],
      strategy: "exact",
    };
  }

  const preparedCandidates = prepareCandidatesForMovieIds(requestedMovieIds, candidates);
  const strategy: PersonCoverSelectionStrategy =
    requestedMovieIds.length > EXACT_COVER_MOVIE_LIMIT ? "approximate" : "exact";

  return {
    personTmdbIds: strategy === "exact"
      ? selectExactBestPersonTmdbIdsForMovieIds(requestedMovieIds, preparedCandidates)
      : selectApproximateBestPersonTmdbIdsForMovieIds(requestedMovieIds, preparedCandidates),
    strategy,
  };
}

export function selectBestPersonTmdbIdsForMovieIds(
  movieTmdbIds: number[],
  candidates: ReadonlyArray<PersonCoverCandidate>,
): number[] {
  return selectBestPersonCoverForMovieIds(movieTmdbIds, candidates).personTmdbIds;
}

export async function getBestPersonCoverForMovieIds(
  movieTmdbIds: number[],
): Promise<PersonCoverSelectionResult> {
  const requestedMovieIds = normalizeRequestedMovieTmdbIds(movieTmdbIds);
  if (requestedMovieIds.length === 0) {
    return {
      personTmdbIds: [],
      strategy: "exact",
    };
  }

  const personRecordsByMovieId = await mapWithConcurrencyLimit(
    requestedMovieIds,
    PERSON_RECORD_LOOKUP_CONCURRENCY,
    async (movieTmdbId) => [movieTmdbId, await getPersonRecordsByMovieId(movieTmdbId)] as const,
  );
  const uncoveredMovieIds = personRecordsByMovieId
    .filter(([, personRecords]) => personRecords.length === 0)
    .map(([movieTmdbId]) => movieTmdbId);

  if (uncoveredMovieIds.length > 0) {
    throw new Error(`Unable to cover movie TMDB ids: ${uncoveredMovieIds.join(", ")}`);
  }

  const candidateCoverageByPersonTmdbId = new Map<number, PersonCoverCandidate>();
  personRecordsByMovieId.forEach(([movieTmdbId, personRecords]) => {
    personRecords.forEach((personRecord) => {
      const personTmdbId =
        normalizePositiveTmdbId(personRecord.tmdbId ?? personRecord.id) ?? personRecord.id;
      const existingCandidate = candidateCoverageByPersonTmdbId.get(personTmdbId) ?? {
        tmdbId: personTmdbId,
        popularity: 0,
        movieConnectionKeys: [],
      };
      existingCandidate.popularity = Math.max(
        existingCandidate.popularity,
        personRecord.rawTmdbPerson?.popularity ?? 0,
      );
      if (!existingCandidate.movieConnectionKeys.includes(movieTmdbId)) {
        existingCandidate.movieConnectionKeys.push(movieTmdbId);
      }
      candidateCoverageByPersonTmdbId.set(personTmdbId, existingCandidate);
    });
  });
  const candidates = Array.from(candidateCoverageByPersonTmdbId.values());
  return selectBestPersonCoverForMovieIds(requestedMovieIds, candidates);
}

export async function getBestPersonTmdbIdsForMovieIds(movieTmdbIds: number[]): Promise<number[]> {
  return (await getBestPersonCoverForMovieIds(movieTmdbIds)).personTmdbIds;
}

export async function getBestPersonTmdbIdsForMovieLabels(movieLabels: string[]): Promise<number[]> {
  const resolvedMovies = await resolveMovieCoverRecordsForLabels(movieLabels);

  return getBestPersonTmdbIdsForMovieIds(
    resolvedMovies.map((resolvedMovie) => resolvedMovie.tmdbId),
  );
}

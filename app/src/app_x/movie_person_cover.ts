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
  if (
    refreshedMovieRecord &&
    hasMovieFullState(refreshedMovieRecord) &&
    (await getPersonRecordsByMovieId(tmdbId)).length > 0
  ) {
    return refreshedMovieRecord;
  }

  throw new Error(`Unable to derive connected people for movie: ${formattedMovieLabel}`);
}

async function resolveMovieRecordForLabel(inputLabel: string): Promise<ResolvedMovieCoverRecord> {
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

  const resolvedMovies = await Promise.all(
    normalizedMovieLabels.map((movieLabel) => resolveMovieRecordForLabel(movieLabel)),
  );
  const seenMovieTmdbIds = new Set<number>();

  return resolvedMovies.filter((resolvedMovie) => {
    if (seenMovieTmdbIds.has(resolvedMovie.tmdbId)) {
      return false;
    }

    seenMovieTmdbIds.add(resolvedMovie.tmdbId);
    return true;
  });
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

export function selectBestPersonTmdbIdsForMovieIds(
  movieTmdbIds: number[],
  candidates: ReadonlyArray<PersonCoverCandidate>,
): number[] {
  const requestedMovieIds = normalizeRequestedMovieTmdbIds(movieTmdbIds);
  if (requestedMovieIds.length === 0) {
    return [];
  }

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

  const fullCoverageMask = (1n << BigInt(requestedMovieIds.length)) - 1n;
  let bestSolution: BestSolution | null = null;

  function getBranchCandidateIndexes(
    uncoveredMask: bigint,
    startIndex: number,
  ): number[] | null {
    let bestCandidateIndexes: number[] | null = null;

    for (let movieIndex = 0; movieIndex < requestedMovieIds.length; movieIndex += 1) {
      const movieMask = 1n << BigInt(movieIndex);
      if ((uncoveredMask & movieMask) === 0n) {
        continue;
      }

      const candidateIndexes: number[] = [];
      for (let candidateIndex = startIndex; candidateIndex < preparedCandidates.length; candidateIndex += 1) {
        if ((preparedCandidates[candidateIndex].coverageMask & movieMask) !== 0n) {
          candidateIndexes.push(candidateIndex);
        }
      }

      if (candidateIndexes.length === 0) {
        return null;
      }

      if (!bestCandidateIndexes || candidateIndexes.length < bestCandidateIndexes.length) {
        bestCandidateIndexes = candidateIndexes;
      }
    }

    return bestCandidateIndexes;
  }

  function getLowerBoundAdditionalCandidates(
    uncoveredMask: bigint,
    startIndex: number,
  ): number {
    let maxNewCoverageCount = 0;

    for (let candidateIndex = startIndex; candidateIndex < preparedCandidates.length; candidateIndex += 1) {
      const newCoverageCount = countSetBits(
        preparedCandidates[candidateIndex].coverageMask & uncoveredMask,
      );
      if (newCoverageCount > maxNewCoverageCount) {
        maxNewCoverageCount = newCoverageCount;
      }
    }

    if (maxNewCoverageCount === 0) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.ceil(countSetBits(uncoveredMask) / maxNewCoverageCount);
  }

  function search(
    coveredMask: bigint,
    startIndex: number,
    chosenTmdbIds: number[],
    totalPopularity: number,
  ) {
    if (coveredMask === fullCoverageMask) {
      const sortedTmdbIds = [...chosenTmdbIds].sort((leftId, rightId) => leftId - rightId);
      if (isBetterSolution(sortedTmdbIds, totalPopularity, bestSolution)) {
        bestSolution = {
          ids: sortedTmdbIds,
          totalPopularity,
        };
      }
      return;
    }

    const uncoveredMask = fullCoverageMask & ~coveredMask;
    const additionalCandidateLowerBound = getLowerBoundAdditionalCandidates(uncoveredMask, startIndex);
    if (!Number.isFinite(additionalCandidateLowerBound)) {
      return;
    }

    if (
      bestSolution &&
      chosenTmdbIds.length + additionalCandidateLowerBound > bestSolution.ids.length
    ) {
      return;
    }

    const branchCandidateIndexes = getBranchCandidateIndexes(uncoveredMask, startIndex);
    if (!branchCandidateIndexes) {
      return;
    }

    for (const candidateIndex of branchCandidateIndexes) {
      const candidate = preparedCandidates[candidateIndex];
      const nextCoveredMask = coveredMask | candidate.coverageMask;
      if (nextCoveredMask === coveredMask) {
        continue;
      }

      if (
        bestSolution &&
        chosenTmdbIds.length + 1 > bestSolution.ids.length
      ) {
        return;
      }

      search(
        nextCoveredMask,
        candidateIndex + 1,
        [...chosenTmdbIds, candidate.tmdbId],
        totalPopularity + candidate.popularity,
      );
    }
  }

  search(0n, 0, [], 0);

  if (!bestSolution) {
    throw new Error(`Unable to cover movie TMDB ids: ${requestedMovieIds.join(", ")}`);
  }

  return (bestSolution as BestSolution).ids;
}

export async function getBestPersonTmdbIdsForMovieIds(movieTmdbIds: number[]): Promise<number[]> {
  const requestedMovieIds = normalizeRequestedMovieTmdbIds(movieTmdbIds);
  if (requestedMovieIds.length === 0) {
    return [];
  }

  const personRecordsByMovieId = await Promise.all(
    requestedMovieIds.map(async (movieTmdbId) => [movieTmdbId, await getPersonRecordsByMovieId(movieTmdbId)] as const),
  );
  const uncoveredMovieIds = personRecordsByMovieId
    .filter(([, personRecords]) => personRecords.length === 0)
    .map(([movieTmdbId]) => movieTmdbId);

  if (uncoveredMovieIds.length > 0) {
    throw new Error(`Unable to cover movie TMDB ids: ${uncoveredMovieIds.join(", ")}`);
  }

  return selectBestPersonTmdbIdsForMovieIds(
    requestedMovieIds,
    personRecordsByMovieId.flatMap(([, personRecords]) =>
      personRecords.map((personRecord) => ({
        tmdbId: normalizePositiveTmdbId(personRecord.tmdbId ?? personRecord.id) ?? personRecord.id,
        popularity: personRecord.rawTmdbPerson?.popularity ?? 0,
        movieConnectionKeys: personRecord.movieConnectionKeys,
      }))),
  );
}

export async function getBestPersonTmdbIdsForMovieLabels(movieLabels: string[]): Promise<number[]> {
  const resolvedMovies = await resolveMovieCoverRecordsForLabels(movieLabels);

  return getBestPersonTmdbIdsForMovieIds(
    resolvedMovies.map((resolvedMovie) => resolvedMovie.tmdbId),
  );
}

import { TMDB_POSTER_BASE_URL } from "./constants";
import type {
  FilmRecord,
  PersonRecord,
  TmdbMovieCredit,
  TmdbMovieCreditsResponse,
  TmdbPersonCredit,
  TmdbPersonMovieCreditsResponse,
} from "./types";

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeName(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

export function normalizeTitle(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

export function formatFallbackPersonDisplayName(value: string): string {
  const normalizedValue = normalizeWhitespace(value);
  if (!normalizedValue) {
    return "";
  }

  const isAllLowercase = normalizedValue === normalizedValue.toLowerCase();
  const isAllUppercase = normalizedValue === normalizedValue.toUpperCase();
  if (!isAllLowercase && !isAllUppercase) {
    return normalizedValue;
  }

  if (normalizedValue.includes(".")) {
    return normalizedValue;
  }

  return normalizedValue
    .toLowerCase()
    .replace(/(^|[\s'-])\p{L}/gu, (match) => match.toUpperCase());
}

export function formatMoviePathLabel(name: string, year = ""): string {
  return year ? `${name} (${year})` : name;
}

export function parseMoviePathLabel(label: string): {
  kind: "movie";
  name: string;
  year: string;
} {
  const match = normalizeWhitespace(label).match(/^(.*) \((\d{4})\)$/);

  if (!match) {
    return {
      kind: "movie",
      name: normalizeWhitespace(label),
      year: "",
    };
  }

  return {
    kind: "movie",
    name: normalizeWhitespace(match[1]),
    year: match[2],
  };
}

export function getFilmKey(title: string, year = ""): string {
  return year
    ? `${normalizeTitle(title)} (${year.trim()})`
    : normalizeTitle(title);
}

export function getCinenerdleMovieId(title: string, year = ""): string {
  return getFilmKey(title, year);
}

export function getCinenerdlePersonId(name: string): string {
  return normalizeName(name);
}

export function getPersonCardKey(name: string, id?: number | string | null): string {
  return `person:${id ?? normalizeName(name)}`;
}

export function getMovieCardKey(
  title: string,
  year = "",
  id?: number | string | null,
): string {
  return `movie:${id ?? getFilmKey(title, year)}`;
}

export function getMovieTitleFromCredit(credit: TmdbMovieCredit): string {
  return credit.title ?? credit.original_title ?? "";
}

export function getMovieYearFromCredit(credit: TmdbMovieCredit): string {
  return credit.release_date?.slice(0, 4) ?? "";
}

export function getMovieKeyFromCredit(credit: TmdbMovieCredit): string {
  return getFilmKey(getMovieTitleFromCredit(credit), getMovieYearFromCredit(credit));
}

export function getValidTmdbEntityId(
  candidateId: number | string | null | undefined,
): number | null {
  if (typeof candidateId === "number" && Number.isFinite(candidateId)) {
    return candidateId;
  }

  if (typeof candidateId === "string" && /^\d+$/.test(candidateId)) {
    return Number(candidateId);
  }

  return null;
}

export function getPosterUrl(path: string | null | undefined, size = "w185") {
  if (!path) {
    return null;
  }

  return `${TMDB_POSTER_BASE_URL}/${size}${path}`;
}

export function getPersonProfileImageUrl(personRecord: PersonRecord | null) {
  return getPosterUrl(personRecord?.rawTmdbPerson?.profile_path ?? null);
}

export function getMoviePosterUrl(movieRecord: FilmRecord | null) {
  return getPosterUrl(movieRecord?.rawTmdbMovie?.poster_path ?? null);
}

export function getTmdbMovieCredits(personRecord: PersonRecord | null): TmdbMovieCredit[] {
  const credits: TmdbPersonMovieCreditsResponse =
    personRecord?.rawTmdbMovieCreditsResponse ?? {};

  return [
    ...(credits.cast ?? []).map((credit) => ({
      ...credit,
      creditType: "cast" as const,
    })),
    ...(credits.crew ?? []).map((credit) => ({
      ...credit,
      creditType: "crew" as const,
    })),
  ];
}

export function isZeroVoteFilmRecord(
  filmRecord: FilmRecord | null | undefined,
): boolean {
  return filmRecord?.rawTmdbMovie?.vote_count === 0;
}

export function isZeroVoteTmdbMovieCredit(
  credit: TmdbMovieCredit | null | undefined,
): boolean {
  return credit?.vote_count === 0;
}

export function isAllowedBfsTmdbMovieCredit(credit: TmdbMovieCredit): boolean {
  if (
    credit.creditType === "cast" &&
    typeof credit.character === "string" &&
    credit.character.toLowerCase().includes("(uncredited)")
  ) {
    return false;
  }

  if (credit.creditType === "cast") {
    return true;
  }

  return isAllowedConnectionCrewJob(credit.job);
}

export function getUniqueSortedTmdbMovieCredits(
  personRecord: PersonRecord | null,
): TmdbMovieCredit[] {
  const seenIds = new Set<number>();

  return getTmdbMovieCredits(personRecord)
    .filter((credit) => {
      if (!credit.id || seenIds.has(credit.id)) {
        return false;
      }

      seenIds.add(credit.id);
      return true;
    })
    .sort((left, right) => (right.popularity ?? 0) - (left.popularity ?? 0));
}

type DualMergeCredit = {
  popularity?: number;
  order?: number;
  creditType?: "cast" | "crew";
};

function sortCreditsForOrderedTurns<T extends DualMergeCredit>(queue: T[]): T[] {
  return [...queue].sort((left, right) => {
    const leftOrder = typeof left.order === "number" ? left.order : Number.POSITIVE_INFINITY;
    const rightOrder = typeof right.order === "number" ? right.order : Number.POSITIVE_INFINITY;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return 0;
  });
}

function getMostPopularQueueIndex<T extends DualMergeCredit>(queue: T[]): number {
  let bestIndex = 0;
  let bestPopularity = queue[0]?.popularity ?? 0;

  for (let index = 1; index < queue.length; index += 1) {
    const popularity = queue[index]?.popularity ?? 0;
    if (popularity > bestPopularity) {
      bestIndex = index;
      bestPopularity = popularity;
    }
  }

  return bestIndex;
}

function mergeAlternatingDualQueues<TCast extends DualMergeCredit, TCrew extends DualMergeCredit>(
  castQueue: TCast[],
  crewQueue: TCrew[],
): Array<TCast | TCrew> {
  const remainingCast = [...castQueue];
  const remainingCrew = [...crewQueue];
  const merged: Array<TCast | TCrew> = [];
  let useOrderedTurn = true;

  while (remainingCast.length > 0 || remainingCrew.length > 0) {
    if (remainingCast.length === 0) {
      const crewIndex = useOrderedTurn ? 0 : getMostPopularQueueIndex(remainingCrew);
      merged.push(remainingCrew.splice(crewIndex, 1)[0]);
      useOrderedTurn = !useOrderedTurn;
      continue;
    }

    if (remainingCrew.length === 0) {
      const castIndex = useOrderedTurn ? 0 : getMostPopularQueueIndex(remainingCast);
      merged.push(remainingCast.splice(castIndex, 1)[0]);
      useOrderedTurn = !useOrderedTurn;
      continue;
    }

    const castIndex = useOrderedTurn ? 0 : getMostPopularQueueIndex(remainingCast);
    const crewIndex = useOrderedTurn ? 0 : getMostPopularQueueIndex(remainingCrew);
    const castPopularity = remainingCast[castIndex]?.popularity ?? 0;
    const crewPopularity = remainingCrew[crewIndex]?.popularity ?? 0;

    if (castPopularity >= crewPopularity) {
      merged.push(remainingCast.splice(castIndex, 1)[0]);
    } else {
      merged.push(remainingCrew.splice(crewIndex, 1)[0]);
    }

    useOrderedTurn = !useOrderedTurn;
  }

  return merged;
}

function sortCreditGroupForDisplay<T extends DualMergeCredit>(credits: T[]): T[] {
  return [...credits].sort((left, right) => {
    if (left.creditType === "cast" && right.creditType !== "cast") {
      return -1;
    }

    if (left.creditType !== "cast" && right.creditType === "cast") {
      return 1;
    }

    const leftOrder = typeof left.order === "number" ? left.order : Number.POSITIVE_INFINITY;
    const rightOrder = typeof right.order === "number" ? right.order : Number.POSITIVE_INFINITY;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    const popularityDifference = (right.popularity ?? 0) - (left.popularity ?? 0);
    if (popularityDifference !== 0) {
      return popularityDifference;
    }

    return 0;
  });
}

function getMovieCreditIdentityKey(credit: TmdbMovieCredit): string | null {
  const tmdbId = getValidTmdbEntityId(credit.id);
  return tmdbId !== null ? `tmdb:${tmdbId}` : null;
}

function getPersonCreditIdentityKey(credit: TmdbPersonCredit): string | null {
  const normalizedName = normalizeName(credit.name ?? "");
  if (!normalizedName) {
    return null;
  }

  const tmdbId = getValidTmdbEntityId(credit.id);
  return tmdbId !== null ? `tmdb:${tmdbId}` : `name:${normalizedName}`;
}

function getMergedMovieCreditsWithTypes(personRecord: PersonRecord | null): TmdbMovieCredit[] {
  const credits: TmdbPersonMovieCreditsResponse =
    personRecord?.rawTmdbMovieCreditsResponse ?? {};
  const castQueue = sortCreditsForOrderedTurns((credits.cast ?? []).map((credit) => ({
    ...credit,
    creditType: "cast" as const,
  })));
  const crewQueue = sortCreditsForOrderedTurns((credits.crew ?? []).map((credit) => ({
    ...credit,
    creditType: "crew" as const,
  })));
  const candidates = mergeAlternatingDualQueues(castQueue, crewQueue);

  return candidates.filter((credit) => Boolean(getMovieCreditIdentityKey(credit)));
}

function getMergedPersonCreditsWithTypes(movieRecord: FilmRecord | null): TmdbPersonCredit[] {
  const credits: TmdbMovieCreditsResponse =
    movieRecord?.rawTmdbMovieCreditsResponse ?? {};
  const castQueue = sortCreditsForOrderedTurns(
    [...(credits.cast ?? [])]
      .filter(isAllowedMovieCastCredit)
      .map((credit) => ({
        ...credit,
        creditType: "cast" as const,
      })),
  );
  const crewQueue = sortCreditsForOrderedTurns((credits.crew ?? [])
    .map((credit) => ({
      ...credit,
      creditType: "crew" as const,
    })));
  const candidates = mergeAlternatingDualQueues(castQueue, crewQueue);

  return candidates.filter((credit) => Boolean(getPersonCreditIdentityKey(credit)));
}

export function getAssociatedMovieCreditGroupsFromPersonCredits(
  personRecord: PersonRecord | null,
): TmdbMovieCredit[][] {
  const groups = new Map<string, TmdbMovieCredit[]>();
  const orderedGroups: TmdbMovieCredit[][] = [];

  getMergedMovieCreditsWithTypes(personRecord).forEach((credit) => {
    const identityKey = getMovieCreditIdentityKey(credit);
    if (!identityKey) {
      return;
    }

    const existingGroup = groups.get(identityKey);
    if (existingGroup) {
      existingGroup.push(credit);
      return;
    }

    const nextGroup = [credit];
    groups.set(identityKey, nextGroup);
    orderedGroups.push(nextGroup);
  });

  return orderedGroups
    .map((group) => sortCreditGroupForDisplay(group));
}

export function getAssociatedMoviesFromPersonCredits(
  personRecord: PersonRecord | null,
): TmdbMovieCredit[] {
  return getAssociatedMovieCreditGroupsFromPersonCredits(personRecord)
    .map((group) => group[0])
    .filter((credit): credit is TmdbMovieCredit => Boolean(credit));
}

export function getAllowedConnectedTmdbMovieCredits(
  personRecord: PersonRecord | null,
): TmdbMovieCredit[] {
  return getTmdbMovieCredits(personRecord).filter(isAllowedBfsTmdbMovieCredit);
}

function isAllowedConnectionCrewJob(job: string | undefined): boolean {
  const normalizedJob = normalizeName(job ?? "");

  return (
    normalizedJob === "director" ||
    normalizedJob === "writer" ||
    normalizedJob === "screenplay" ||
    normalizedJob === "story" ||
    normalizedJob === "original story" ||
    normalizedJob === "adaptation" ||
    normalizedJob === "teleplay" ||
    normalizedJob.includes("director of photography") ||
    normalizedJob.includes("cinematograph") ||
    normalizedJob.includes("composer")
  );
}

function isAllowedMovieCastCredit(credit: TmdbPersonCredit): boolean {
  return !normalizeName(credit.character ?? "").includes("(uncredited)");
}

function isAllowedMovieCrewCredit(credit: TmdbPersonCredit): boolean {
  return isAllowedConnectionCrewJob(credit.job);
}

export function getAssociatedPeopleFromMovieCredits(
  movieRecord: FilmRecord | null,
): TmdbPersonCredit[] {
  return getAssociatedPersonCreditGroupsFromMovieCredits(movieRecord)
    .map((group) => group[0])
    .filter((credit): credit is TmdbPersonCredit => Boolean(credit));
}

export function getAssociatedPersonCreditGroupsFromMovieCredits(
  movieRecord: FilmRecord | null,
): TmdbPersonCredit[][] {
  const groups = new Map<string, TmdbPersonCredit[]>();
  const orderedGroups: TmdbPersonCredit[][] = [];

  getMergedPersonCreditsWithTypes(movieRecord).forEach((credit) => {
    const identityKey = getPersonCreditIdentityKey(credit);
    if (!identityKey) {
      return;
    }

    const existingGroup = groups.get(identityKey);
    if (existingGroup) {
      existingGroup.push(credit);
      return;
    }

    const nextGroup = [credit];
    groups.set(identityKey, nextGroup);
    orderedGroups.push(nextGroup);
  });

  return orderedGroups
    .filter((group) => group.some((credit) =>
      credit.creditType === "cast" ? isAllowedMovieCastCredit(credit) : isAllowedMovieCrewCredit(credit)))
    .map((group) => sortCreditGroupForDisplay(group));
}

export function getAssociatedPeopleFromMovieCreditsForSnapshot(
  movieRecord: FilmRecord | null,
): TmdbPersonCredit[] {
  return getAssociatedPersonCreditGroupsFromMovieCredits(movieRecord).flat();
}

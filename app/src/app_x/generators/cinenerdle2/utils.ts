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
  const credits: TmdbMovieCreditsResponse =
    movieRecord?.rawTmdbMovieCreditsResponse ?? {};
  const seenPeople = new Set<string>();
  const castQueue = [...(credits.cast ?? [])]
    .filter(isAllowedMovieCastCredit)
    .map((credit) => ({
      ...credit,
      creditType: "cast" as const,
    }))
    .sort((left, right) => left.order - right.order);
  const crewQueue = (credits.crew ?? [])
    .filter(isAllowedMovieCrewCredit)
    .map((credit) => ({
      ...credit,
      creditType: "crew" as const,
    }));
  const candidates: TmdbPersonCredit[] = [];
  let castIndex = 0;
  let crewIndex = 0;

  while (castIndex < castQueue.length || crewIndex < crewQueue.length) {
    if (castIndex >= castQueue.length) {
      candidates.push(crewQueue[crewIndex]);
      crewIndex += 1;
      continue;
    }

    if (crewIndex >= crewQueue.length) {
      candidates.push(castQueue[castIndex]);
      castIndex += 1;
      continue;
    }

    const castHead = castQueue[castIndex];
    const crewHead = crewQueue[crewIndex];

    if ((castHead.popularity ?? 0) >= (crewHead.popularity ?? 0)) {
      candidates.push(castHead);
      castIndex += 1;
      continue;
    }

    candidates.push(crewHead);
    crewIndex += 1;
  }

  return candidates
    .filter((credit) => {
      const normalizedName = normalizeName(credit.name ?? "");
      const personIdentity = credit.id
        ? `tmdb:${credit.id}`
        : `name:${normalizedName}`;

      if (!normalizedName || seenPeople.has(personIdentity)) {
        return false;
      }

      seenPeople.add(personIdentity);
      return true;
    });
}

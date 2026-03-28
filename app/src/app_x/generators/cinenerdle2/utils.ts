import { TMDB_POSTER_BASE_URL } from "./constants";
import type {
  CinenerdleDailyStarter,
  FilmRecord,
  PeopleByRole,
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
  return (
    movieRecord?.rawCinenerdleDailyStarter?.posterUrl ??
    getPosterUrl(movieRecord?.rawTmdbMovie?.poster_path ?? null)
  );
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

function isAllowedMoviePersonCredit(credit: TmdbPersonCredit): boolean {
  if (credit.character) {
    return !credit.character.toLowerCase().includes("(uncredited)");
  }

  return isAllowedConnectionCrewJob(credit.job);
}

export function getAssociatedPeopleFromMovieCredits(
  movieRecord: FilmRecord | null,
): TmdbPersonCredit[] {
  const credits: TmdbMovieCreditsResponse =
    movieRecord?.rawTmdbMovieCreditsResponse ?? {};
  const seenPeople = new Set<string>();
  const candidates = [
    ...(credits.cast ?? []).map((credit) => ({
      ...credit,
      creditType: "cast" as const,
    })),
    ...(credits.crew ?? [])
      .filter(isAllowedMoviePersonCredit)
      .map((credit) => ({
        ...credit,
        creditType: "crew" as const,
      })),
  ];

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
    })
    .sort((left, right) => (right.popularity ?? 0) - (left.popularity ?? 0));
}

export function getMovieCreditPersonPopularityLookup(
  movieRecord: FilmRecord | null,
): Map<string, number> {
  const credits: TmdbMovieCreditsResponse =
    movieRecord?.rawTmdbMovieCreditsResponse ?? {};
  const popularityByName = new Map<string, number>();

  [...(credits.cast ?? []), ...(credits.crew ?? [])].forEach((credit) => {
    const normalizedName = normalizeName(credit.name ?? "");
    if (!normalizedName) {
      return;
    }

    popularityByName.set(
      normalizedName,
      Math.max(popularityByName.get(normalizedName) ?? 0, credit.popularity ?? 0),
    );
  });

  return popularityByName;
}

export function createEmptyPeopleByRole(): PeopleByRole {
  return {
    cast: [],
    directors: [],
    writers: [],
    composers: [],
  };
}

export function buildPeopleByRoleFromStarter(
  starter: CinenerdleDailyStarter | null | undefined,
): PeopleByRole {
  return {
    cast: starter?.cast?.filter(Boolean) ?? [],
    directors: starter?.directors?.filter(Boolean) ?? [],
    writers: starter?.writers?.filter(Boolean) ?? [],
    composers: starter?.composers?.filter(Boolean) ?? [],
  };
}

export function getSnapshotPeopleByRole(
  filmRecord: FilmRecord | null,
): PeopleByRole {
  return filmRecord?.starterPeopleByRole ?? createEmptyPeopleByRole();
}

export function getSnapshotConnectionLabels(filmRecord: FilmRecord | null): string[] {
  const peopleByRole = getSnapshotPeopleByRole(filmRecord);

  return [
    ...peopleByRole.cast,
    ...peopleByRole.directors,
    ...peopleByRole.writers,
    ...peopleByRole.composers,
  ];
}

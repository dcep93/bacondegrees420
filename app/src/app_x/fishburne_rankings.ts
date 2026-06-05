import {
  getFilmRecordById,
} from "./generators/cinenerdle2/indexed_db";
import {
  fetchAndCacheMovie,
  hasMovieFullState,
  prepareSelectedPerson,
} from "./generators/cinenerdle2/tmdb";
import type {
  FilmRecord,
  PersonRecord,
  TmdbMovieCredit,
  TmdbPersonCredit,
} from "./generators/cinenerdle2/types";
import {
  getAllowedConnectedTmdbMovieCredits,
  getAssociatedPeopleFromMovieCredits,
  getMovieTitleFromCredit,
  getMovieYearFromCredit,
  getValidTmdbEntityId,
  normalizeName,
  normalizeWhitespace,
} from "./generators/cinenerdle2/utils";

export const LAURENCE_FISHBURNE_NAME = "Laurence Fishburne";
export const LAURENCE_FISHBURNE_TMDB_ID = 2975;

export type FishburneRankedMovieStatus =
  | "ranked"
  | "missingMovieRecord"
  | "noConnection";

export type FishburneRankedMovieConnection = {
  creditType: "cast" | "crew";
  name: string;
  popularity: number;
  roleLabel: string;
  tmdbId: number | null;
};

export type FishburneRankedMovie = {
  movie: {
    popularity: number;
    title: string;
    tmdbId: number;
    year: string;
  };
  status: FishburneRankedMovieStatus;
  topConnection: FishburneRankedMovieConnection | null;
};

type FishburneMovieCandidate = {
  credit: TmdbMovieCredit;
  popularity: number;
  title: string;
  tmdbId: number;
  year: string;
};

type FishburneRankingDependencies = {
  fetchMovie: typeof fetchAndCacheMovie;
  getCachedMovieRecordById: typeof getFilmRecordById;
  getMovieConnections: typeof getAssociatedPeopleFromMovieCredits;
  getPersonMovies: typeof getAllowedConnectedTmdbMovieCredits;
  preparePerson: typeof prepareSelectedPerson;
};

const defaultDependencies: FishburneRankingDependencies = {
  fetchMovie: fetchAndCacheMovie,
  getCachedMovieRecordById: getFilmRecordById,
  getMovieConnections: getAssociatedPeopleFromMovieCredits,
  getPersonMovies: getAllowedConnectedTmdbMovieCredits,
  preparePerson: prepareSelectedPerson,
};

function isLaurenceFishburneCredit(credit: TmdbPersonCredit): boolean {
  const tmdbId = getValidTmdbEntityId(credit.id);
  if (tmdbId === LAURENCE_FISHBURNE_TMDB_ID) {
    return true;
  }

  return normalizeName(credit.name ?? "") === normalizeName(LAURENCE_FISHBURNE_NAME);
}

function getPersonCreditRoleLabel(credit: TmdbPersonCredit): string {
  return normalizeWhitespace(
    credit.creditType === "crew"
      ? credit.job ?? credit.department ?? ""
      : credit.character ?? "",
  );
}

function createRankedMovieConnection(
  credit: TmdbPersonCredit,
): FishburneRankedMovieConnection | null {
  const name = normalizeWhitespace(credit.name ?? "");
  if (!name) {
    return null;
  }

  return {
    creditType: credit.creditType === "crew" ? "crew" : "cast",
    name,
    popularity: credit.popularity ?? 0,
    roleLabel: getPersonCreditRoleLabel(credit),
    tmdbId: getValidTmdbEntityId(credit.id),
  };
}

export function getMostPopularNonFishburneConnection(
  movieRecord: FilmRecord | null,
  getMovieConnections: typeof getAssociatedPeopleFromMovieCredits = getAssociatedPeopleFromMovieCredits,
): FishburneRankedMovieConnection | null {
  return getMovieConnections(movieRecord)
    .filter((credit) => !isLaurenceFishburneCredit(credit))
    .map(createRankedMovieConnection)
    .filter((connection): connection is FishburneRankedMovieConnection => connection !== null)
    .sort((left, right) => right.popularity - left.popularity)[0] ?? null;
}

function buildFishburneMovieCandidates(
  personRecord: PersonRecord,
  getPersonMovies: typeof getAllowedConnectedTmdbMovieCredits,
): FishburneMovieCandidate[] {
  const candidatesByTmdbId = new Map<number, FishburneMovieCandidate>();

  getPersonMovies(personRecord).forEach((credit) => {
    const tmdbId = getValidTmdbEntityId(credit.id);
    const title = normalizeWhitespace(getMovieTitleFromCredit(credit));
    if (tmdbId === null || !title) {
      return;
    }

    if (candidatesByTmdbId.has(tmdbId)) {
      return;
    }

    candidatesByTmdbId.set(tmdbId, {
      credit,
      popularity: credit.popularity ?? 0,
      title,
      tmdbId,
      year: getMovieYearFromCredit(credit),
    });
  });

  return [...candidatesByTmdbId.values()];
}

async function hydrateFishburneMovieCandidate(
  candidate: FishburneMovieCandidate,
  dependencies: FishburneRankingDependencies,
): Promise<FilmRecord | null> {
  const cachedMovieRecord = await dependencies.getCachedMovieRecordById(candidate.tmdbId);
  if (hasMovieFullState(cachedMovieRecord)) {
    return cachedMovieRecord;
  }

  return dependencies.fetchMovie(
    candidate.title,
    candidate.year,
    "fetch",
    candidate.tmdbId,
    {
      skipFollowOnPrefetch: true,
    },
  );
}

export async function getFishburneRankedMovies(options: {
  dependencies?: Partial<FishburneRankingDependencies>;
  onProgress?: (progress: { completed: number; total: number }) => void;
} = {}): Promise<FishburneRankedMovie[]> {
  const dependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };
  const personRecord = await dependencies.preparePerson(
    LAURENCE_FISHBURNE_NAME,
    LAURENCE_FISHBURNE_TMDB_ID,
  );
  if (!personRecord) {
    return [];
  }

  const candidates = buildFishburneMovieCandidates(personRecord, dependencies.getPersonMovies);
  const rows: FishburneRankedMovie[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const movieRecord = await hydrateFishburneMovieCandidate(candidate, dependencies);
    const topConnection = movieRecord
      ? getMostPopularNonFishburneConnection(movieRecord, dependencies.getMovieConnections)
      : null;

    rows.push({
      movie: {
        popularity: movieRecord?.popularity ?? candidate.popularity,
        title: movieRecord?.title ?? candidate.title,
        tmdbId: getValidTmdbEntityId(movieRecord?.tmdbId ?? movieRecord?.id) ?? candidate.tmdbId,
        year: movieRecord?.year ?? candidate.year,
      },
      status: movieRecord
        ? topConnection
          ? "ranked"
          : "noConnection"
        : "missingMovieRecord",
      topConnection,
    });
    options.onProgress?.({
      completed: index + 1,
      total: candidates.length,
    });
  }

  return rows.sort(compareFishburneRankedMovies);
}

export function compareFishburneRankedMovies(
  left: FishburneRankedMovie,
  right: FishburneRankedMovie,
): number {
  const leftConnectionPopularity = left.topConnection?.popularity;
  const rightConnectionPopularity = right.topConnection?.popularity;
  const leftHasConnection = typeof leftConnectionPopularity === "number";
  const rightHasConnection = typeof rightConnectionPopularity === "number";

  if (leftHasConnection && rightHasConnection) {
    const popularityDifference = leftConnectionPopularity - rightConnectionPopularity;
    if (popularityDifference !== 0) {
      return popularityDifference;
    }
  } else if (leftHasConnection !== rightHasConnection) {
    return leftHasConnection ? -1 : 1;
  }

  const titleComparison = left.movie.title.localeCompare(right.movie.title);
  if (titleComparison !== 0) {
    return titleComparison;
  }

  return left.movie.year.localeCompare(right.movie.year);
}

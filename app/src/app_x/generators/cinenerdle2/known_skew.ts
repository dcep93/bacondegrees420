import { normalizeTitle } from "./utils";

type KnownMovieTitleSkew = {
  canonicalName: string;
  canonicalYear: string;
};

function createKnownMovieTitleSkewKey(name: string, year = ""): string {
  return `${normalizeTitle(name)}|${year.trim()}`;
}

const KNOWN_MOVIE_TITLE_SKEW_BY_KEY = new Map<string, KnownMovieTitleSkew>([
  [
    createKnownMovieTitleSkewKey(
      "Star Wars: Episode V - The Empire Strikes Back",
      "1980",
    ),
    {
      canonicalName: "The Empire Strikes Back",
      canonicalYear: "1980",
    },
  ],
  [
    createKnownMovieTitleSkewKey(
      "Star Wars: Episode VI - Return of the Jedi",
      "1983",
    ),
    {
      canonicalName: "Return of the Jedi",
      canonicalYear: "1983",
    },
  ],
]);

export function normalizeKnownMovieTitleSkew(name: string, year = ""): {
  name: string;
  year: string;
} {
  const skew =
    KNOWN_MOVIE_TITLE_SKEW_BY_KEY.get(createKnownMovieTitleSkewKey(name, year)) ?? null;

  if (!skew) {
    return {
      name,
      year,
    };
  }

  return {
    name: skew.canonicalName,
    year: skew.canonicalYear,
  };
}

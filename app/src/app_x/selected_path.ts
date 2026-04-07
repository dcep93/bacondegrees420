import { measureAsync } from "./perf";
import { parseHashSegments, buildPathNodesFromSegments } from "./generators/cinenerdle2/hash";
import { formatMoviePathLabel, getAssociatedMoviesFromPersonCredits, getAssociatedPeopleFromMovieCredits, getValidTmdbEntityId, normalizeName, normalizeWhitespace } from "./generators/cinenerdle2/utils";
import { getFilmRecordById, getFilmRecordByTitleAndYear, getPersonRecordById, getPersonRecordByName } from "./generators/cinenerdle2/indexed_db";
import { getMovieConnectionEntityKey, getPersonConnectionEntityKey } from "./generators/cinenerdle2/connection_graph";
import type { YoungestSelectedCard } from "./connection_matchup_preview";

export type SelectedPathTarget =
  | {
      kind: "cinenerdle";
      name: "cinenerdle";
      year: "";
    }
  | {
      kind: "movie";
      name: string;
      year: string;
    }
  | {
      kind: "person";
      name: string;
      tmdbId: number | null;
      year: "";
    };

export function getDocumentTitle(hashValue: string): string {
  const rootPathNode = buildPathNodesFromSegments(parseHashSegments(hashValue))[0];

  if (!rootPathNode || rootPathNode.kind === "cinenerdle" || rootPathNode.kind === "break") {
    return "BaconDegrees420";
  }

  return rootPathNode.kind === "movie"
    ? formatMoviePathLabel(rootPathNode.name, rootPathNode.year)
    : rootPathNode.name || "BaconDegrees420";
}

export function getHighestGenerationSelectedTarget(hashValue: string): SelectedPathTarget {
  const pathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue)).filter(
    (pathNode): pathNode is Exclude<typeof pathNode, { kind: "break" }> =>
      pathNode.kind === "cinenerdle" ||
      pathNode.kind === "movie" ||
      pathNode.kind === "person",
  );
  const selectedPathNode = pathNodes[pathNodes.length - 1];

  if (!selectedPathNode || selectedPathNode.kind === "cinenerdle") {
    return {
      kind: "cinenerdle",
      name: "cinenerdle",
      year: "",
    };
  }

  if (selectedPathNode.kind === "movie") {
    return {
      kind: "movie",
      name: selectedPathNode.name,
      year: selectedPathNode.year,
    };
  }

  return {
    kind: "person",
    name: selectedPathNode.name,
    tmdbId: selectedPathNode.tmdbId,
    year: "",
  };
}

export function getHighestGenerationSelectedLabel(hashValue: string): string {
  const selectedPathTarget = getHighestGenerationSelectedTarget(hashValue);

  if (selectedPathTarget.kind === "cinenerdle") {
    return "cinenerdle";
  }

  return selectedPathTarget.kind === "movie"
    ? formatMoviePathLabel(selectedPathTarget.name, selectedPathTarget.year)
    : selectedPathTarget.name;
}

export function getPreviewFallbackText(name: string): string {
  const words = normalizeWhitespace(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (words.length === 0) {
    return "?";
  }

  return words.map((word) => word[0]?.toUpperCase() ?? "").join("");
}

async function resolveYoungestSelectedPersonRecord(
  card: Extract<YoungestSelectedCard, { kind: "person" }>,
) {
  const tmdbId = getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id ?? null);
  if (tmdbId) {
    const personRecord = await getPersonRecordById(tmdbId);
    if (personRecord) {
      return personRecord;
    }
  }

  return getPersonRecordByName(card.name);
}

export async function getDirectConnectionOrdersForYoungestSelectedCard(
  card: YoungestSelectedCard | null,
): Promise<Record<string, number | null>> {
  return measureAsync(
    "app.getDirectConnectionOrdersForYoungestSelectedCard",
    async () => {
      if (!card || card.kind === "cinenerdle") {
        return {};
      }

      const directConnectionOrders = new Map<string, number | null>();
      const setDirectConnectionOrder = (key: string) => {
        if (!directConnectionOrders.has(key)) {
          directConnectionOrders.set(key, directConnectionOrders.size + 1);
        }
      };

      if (card.kind === "movie") {
        const movieRecord = await getFilmRecordByTitleAndYear(card.name, card.year);
        if (!movieRecord) {
          return {};
        }

        const tmdbCredits = getAssociatedPeopleFromMovieCredits(movieRecord);
        if (tmdbCredits.length > 0) {
          tmdbCredits.forEach((credit) => {
            const personName = credit.name ?? "";
            const personTmdbId = getValidTmdbEntityId(credit.id);
            if (personTmdbId || normalizeName(personName)) {
              setDirectConnectionOrder(getPersonConnectionEntityKey(personName, personTmdbId));
            }
          });
        } else {
          movieRecord.personConnectionKeys.forEach((personId) => {
            const validPersonId = getValidTmdbEntityId(personId);
            if (validPersonId !== null) {
              setDirectConnectionOrder(getPersonConnectionEntityKey("", validPersonId));
            }
          });
        }

        return Object.fromEntries(directConnectionOrders);
      }

      const personRecord = await resolveYoungestSelectedPersonRecord(card);
      if (!personRecord) {
        return {};
      }

      const movieCredits = getAssociatedMoviesFromPersonCredits(personRecord);
      if (movieCredits.length > 0) {
        movieCredits.forEach((credit) => {
          const movieName = credit.title ?? credit.original_title ?? "";
          if (movieName) {
            setDirectConnectionOrder(
              getMovieConnectionEntityKey(movieName, credit.release_date?.slice(0, 4) ?? ""),
            );
          }
        });
      } else {
        for (const movieId of personRecord.movieConnectionKeys) {
          const validMovieId = getValidTmdbEntityId(movieId);
          const movieRecord = validMovieId ? await getFilmRecordById(validMovieId) : null;
          if (movieRecord) {
            setDirectConnectionOrder(getMovieConnectionEntityKey(movieRecord.title, movieRecord.year));
          }
        }
      }

      return Object.fromEntries(directConnectionOrders);
    },
    {
      always: true,
      details: {
        cardKey: card?.key ?? "",
        cardKind: card?.kind ?? "none",
      },
      summarizeResult: (ordersByKey) => ({
        keyCount: Object.keys(ordersByKey).length,
      }),
    },
  );
}

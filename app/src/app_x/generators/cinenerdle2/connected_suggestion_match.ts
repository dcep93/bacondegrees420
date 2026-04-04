import type { GeneratorNode } from "../../types/generator";
import type { CinenerdleCard } from "./view_types";
import { getValidTmdbEntityId } from "./utils";

export type ConnectedSuggestionMatchTarget = {
  bucket: "movie" | "person";
  id: number;
};

function getCardTmdbId(card: Extract<CinenerdleCard, { kind: "movie" | "person" }>): number | null {
  return getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id ?? null);
}

export function matchesConnectedSuggestionTarget(
  card: CinenerdleCard,
  target: ConnectedSuggestionMatchTarget,
): boolean {
  if (card.kind !== target.bucket) {
    return false;
  }

  return getCardTmdbId(card) === target.id;
}

export function findConnectedSuggestionCardIndex(
  row: GeneratorNode<CinenerdleCard>[],
  target: ConnectedSuggestionMatchTarget,
): number {
  return row.findIndex((node) => matchesConnectedSuggestionTarget(node.data, target));
}

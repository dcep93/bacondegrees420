import {
  buildPathNodesFromSegments,
  normalizeHashValue,
  parseHashSegments,
} from "./hash";
import { getValidTmdbEntityId, normalizeName, normalizeTitle } from "./utils";
import type { CinenerdleCard } from "./view_types";
import type { GeneratorTree } from "../../types/generator";

type SelectedPathCard = Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>;

function isSelectedPathCard(card: CinenerdleCard | null): card is SelectedPathCard {
  return (
    card?.kind === "cinenerdle" ||
    card?.kind === "movie" ||
    card?.kind === "person"
  );
}

export function getCardTmdbEntityId(card: CinenerdleCard): number | null {
  if (card.kind === "movie" || card.kind === "person") {
    return getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id);
  }

  return null;
}

export function applyHash(nextHash: string): void {
  const normalizedHash = normalizeHashValue(nextHash);

  if (!normalizedHash) {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    window.dispatchEvent(new Event("hashchange"));
    return;
  }

  window.location.hash = normalizedHash.replace(/^#/, "");
}

export function hasLoadedPath(hashValue: string): boolean {
  return buildPathNodesFromSegments(parseHashSegments(hashValue)).length > 1;
}

export function getSelectedPathCards(
  tree: GeneratorTree<CinenerdleCard>,
): SelectedPathCard[] {
  return tree
    .map((row) => row.find((node) => node.selected)?.data ?? null)
    .filter(isSelectedPathCard);
}

export function getYoungestSelectedCard(
  tree: GeneratorTree<CinenerdleCard>,
): SelectedPathCard | null {
  const selectedPathCards = getSelectedPathCards(tree);
  return selectedPathCards[selectedPathCards.length - 1] ?? null;
}

export function getYoungestSelectedGenerationIndex(
  tree: GeneratorTree<CinenerdleCard>,
): number {
  for (let rowIndex = tree.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const selectedCard = tree[rowIndex]?.find((node) => node.selected)?.data ?? null;
    if (
      selectedCard?.kind === "cinenerdle" ||
      selectedCard?.kind === "movie" ||
      selectedCard?.kind === "person"
    ) {
      return rowIndex;
    }
  }

  return 0;
}

export function areYoungestSelectedCardsEqual(
  left: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null,
  right: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right || left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "cinenerdle" && right.kind === "cinenerdle") {
    return true;
  }

  if (left.key === right.key) {
    return true;
  }

  if (left.kind === "movie" && right.kind === "movie") {
    const leftTmdbId = getCardTmdbEntityId(left);
    const rightTmdbId = getCardTmdbEntityId(right);

    if (leftTmdbId !== null && rightTmdbId !== null) {
      return leftTmdbId === rightTmdbId;
    }

    return (
      normalizeTitle(left.name) === normalizeTitle(right.name) &&
      left.year.trim() === right.year.trim()
    );
  }

  const leftTmdbId = getCardTmdbEntityId(left);
  const rightTmdbId = getCardTmdbEntityId(right);
  if (leftTmdbId !== null && rightTmdbId !== null) {
    return leftTmdbId === rightTmdbId;
  }

  return normalizeName(left.name) === normalizeName(right.name);
}

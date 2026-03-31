import type { ConnectionEntity } from "./connection_graph";
import {
  buildPathNodesFromSegments,
  createPathNode,
  normalizeHashValue,
  parseHashSegments,
  serializePathNodes,
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

export function matchesHighlightedConnectionEntity(
  card: CinenerdleCard,
  entity: ConnectionEntity,
): boolean {
  if (entity.kind === "cinenerdle") {
    return card.kind === "cinenerdle";
  }

  if (entity.kind === "movie") {
    if (card.kind !== "movie") {
      return false;
    }

    if (
      normalizeTitle(card.name) === normalizeTitle(entity.name) &&
      card.year.trim() === entity.year.trim()
    ) {
      return true;
    }

    const entityTmdbId = getValidTmdbEntityId(entity.tmdbId);
    const cardTmdbId = getCardTmdbEntityId(card);
    return entityTmdbId !== null && cardTmdbId !== null && entityTmdbId === cardTmdbId;
  }

  if (card.kind !== "person") {
    return false;
  }

  const entityTmdbId = getValidTmdbEntityId(entity.tmdbId);
  const cardTmdbId = getCardTmdbEntityId(card);
  if (entityTmdbId !== null && cardTmdbId !== null) {
    return entityTmdbId === cardTmdbId;
  }

  return normalizeName(card.name) === normalizeName(entity.name);
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

export function getPersonTmdbIdFromCard(
  card: Extract<CinenerdleCard, { kind: "person" }>,
): number | null {
  const recordTmdbId = getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id);
  if (recordTmdbId) {
    return recordTmdbId;
  }

  const keyMatch = card.key.match(/^person:(\d+)$/);
  return keyMatch ? getValidTmdbEntityId(keyMatch[1]) : null;
}

export function serializeSelectedTreePath(tree: GeneratorTree<CinenerdleCard>): string {
  const pathNodes = tree
    .map((row) => row.find((node) => node.selected)?.data ?? null)
    .filter((card): card is CinenerdleCard => card !== null)
    .map((card) => {
      if (card.kind === "cinenerdle") {
        return createPathNode("cinenerdle", "cinenerdle");
      }

      if (card.kind === "break" || card.kind === "dbinfo") {
        return createPathNode("break", "");
      }

      if (card.kind === "movie") {
        return createPathNode("movie", card.name, card.year);
      }

      return createPathNode("person", card.name, "", getPersonTmdbIdFromCard(card));
    });

  return serializePathNodes(pathNodes);
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

export function getYoungestSelectedCardParent(
  tree: GeneratorTree<CinenerdleCard>,
): SelectedPathCard | null {
  const selectedPathCards = getSelectedPathCards(tree);
  return selectedPathCards[selectedPathCards.length - 2] ?? null;
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

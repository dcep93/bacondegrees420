import type { AbstractGeneratorHandle } from "../../components/abstract_generator";
import type { GeneratorNode } from "../../types/generator";
import type { ConnectionEntity } from "./connection_graph";
import { getCardTmdbEntityId } from "./navigation";
import { normalizeName, normalizeTitle } from "./utils";
import type { CinenerdleCard } from "./view_types";

export type ConnectionPathAppendRevealTarget =
  Pick<ConnectionEntity, "key" | "kind" | "name" | "year" | "tmdbId">;

function doesCardMatchConnectionPathAppendTarget(
  card: CinenerdleCard,
  targetEntity: ConnectionPathAppendRevealTarget,
): boolean {
  if (card.kind !== targetEntity.kind) {
    return false;
  }

  if (card.kind === "cinenerdle") {
    return true;
  }

  if (card.key === targetEntity.key) {
    return true;
  }

  const cardTmdbId = getCardTmdbEntityId(card);
  if (cardTmdbId !== null && targetEntity.tmdbId !== null) {
    return cardTmdbId === targetEntity.tmdbId;
  }

  if (card.kind === "movie") {
    return (
      normalizeTitle(card.name) === normalizeTitle(targetEntity.name) &&
      card.year.trim() === targetEntity.year.trim()
    );
  }

  return normalizeName(card.name) === normalizeName(targetEntity.name);
}

export function getConnectionPathAppendRevealGenerationIndex(
  tree: GeneratorNode<CinenerdleCard>[][],
  targetEntity: ConnectionPathAppendRevealTarget,
): number | null {
  const targetGenerationIndex = tree.findIndex((row) =>
    row.some((node) =>
      node.selected && doesCardMatchConnectionPathAppendTarget(node.data, targetEntity)
    ),
  );

  if (targetGenerationIndex < 0) {
    return null;
  }

  return (tree[targetGenerationIndex + 1]?.length ?? 0) > 0
    ? targetGenerationIndex + 1
    : targetGenerationIndex;
}

export async function revealConnectionPathAppendTarget(
  generatorHandle: AbstractGeneratorHandle | null,
  generationIndex: number,
): Promise<void> {
  if (!generatorHandle) {
    return;
  }

  await generatorHandle.revealGeneration(generationIndex, {
    alignRowHorizontally: false,
  });

  await new Promise<void>((resolve) => {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      resolve();
      return;
    }

    window.requestAnimationFrame(() => {
      resolve();
    });
  });
  generatorHandle.alignTreeLikeRootBubble();
}

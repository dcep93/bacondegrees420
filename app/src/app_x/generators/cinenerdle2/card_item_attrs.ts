import type { GeneratorNode, GeneratorTree } from "../../types/generator";
import { getCinenerdleItemAttrCounts } from "./entity_card_ordering";
import {
  type CinenerdleItemAttrTarget,
  type CinenerdleItemAttrs,
  getCinenerdleItemAttrTargetFromCard,
  getItemAttrsForTargetFromSnapshot,
} from "./item_attrs";
import { getResolvedPersonMovieConnectionKeys } from "./records";
import type { CinenerdleCard } from "./view_types";
import {
  getAllowedConnectedTmdbMovieCredits,
  getAssociatedPeopleFromMovieCredits,
  getCinenerdlePersonId,
  getMovieKeyFromCredit,
  getValidTmdbEntityId,
} from "./utils";

function dedupeItemAttrs(itemAttrs: string[]): string[] {
  const seenAttrs = new Set<string>();
  const dedupedAttrs: string[] = [];

  itemAttrs.forEach((itemAttr) => {
    if (seenAttrs.has(itemAttr)) {
      return;
    }

    seenAttrs.add(itemAttr);
    dedupedAttrs.push(itemAttr);
  });

  return dedupedAttrs;
}

function areItemAttrArraysEqual(left: string[] | undefined, right: string[]): boolean {
  if (left === right) {
    return true;
  }

  if (!left || left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry === right[index]);
}

function areRowOrderMetadataEqual(
  left: GeneratorNode<CinenerdleCard>["rowOrderMetadata"],
  right: GeneratorNode<CinenerdleCard>["rowOrderMetadata"],
): boolean {
  return (left?.activeCount ?? 0) === (right?.activeCount ?? 0) &&
    (left?.passiveCount ?? 0) === (right?.passiveCount ?? 0);
}

function getMovieConnectionTargets(
  card: Extract<CinenerdleCard, { kind: "movie" }>,
): CinenerdleItemAttrTarget[] {
  const targets: CinenerdleItemAttrTarget[] = [];
  const seenTargets = new Set<string>();

  getAssociatedPeopleFromMovieCredits(card.record).forEach((credit) => {
    const name = credit.name?.trim() ?? "";
    const id = getValidTmdbEntityId(credit.id);
    const targetId = String(id ?? getCinenerdlePersonId(name));
    if (!name || seenTargets.has(targetId)) {
      return;
    }

    seenTargets.add(targetId);
    targets.push({
      bucket: "person",
      id: targetId,
      name,
    });
  });

  card.record?.personConnectionKeys.forEach((personName) => {
    const normalizedName = getCinenerdlePersonId(personName);
    if (!normalizedName || seenTargets.has(normalizedName)) {
      return;
    }

    seenTargets.add(normalizedName);
    targets.push({
      bucket: "person",
      id: normalizedName,
      name: personName,
    });
  });

  return targets;
}

function getPersonConnectionTargets(
  card: Extract<CinenerdleCard, { kind: "person" }>,
): CinenerdleItemAttrTarget[] {
  const targets: CinenerdleItemAttrTarget[] = [];
  const seenTargets = new Set<string>();
  const tmdbMovieIdsByMovieKey = new Map<string, number>();

  getAllowedConnectedTmdbMovieCredits(card.record).forEach((credit) => {
    const movieKey = getMovieKeyFromCredit(credit);
    const tmdbId = getValidTmdbEntityId(credit.id);
    if (!movieKey || tmdbId === null) {
      return;
    }

    tmdbMovieIdsByMovieKey.set(movieKey, tmdbId);
  });

  getResolvedPersonMovieConnectionKeys(card.record).forEach((movieKey) => {
    const targetId = String(tmdbMovieIdsByMovieKey.get(movieKey) ?? movieKey);
    if (!targetId || seenTargets.has(targetId)) {
      return;
    }

    seenTargets.add(targetId);
    targets.push({
      bucket: "film",
      id: targetId,
      name: movieKey,
    });
  });

  return targets;
}

function getConnectedItemAttrTargets(
  card: Extract<CinenerdleCard, { kind: "movie" | "person" }>,
): CinenerdleItemAttrTarget[] {
  return card.kind === "movie"
    ? getMovieConnectionTargets(card)
    : getPersonConnectionTargets(card);
}

function getEntityCardItemAttrTarget(
  card: Extract<CinenerdleCard, { kind: "movie" | "person" }>,
): CinenerdleItemAttrTarget | null {
  return getCinenerdleItemAttrTargetFromCard(card);
}

export function enrichCinenerdleCardWithItemAttrs(
  card: CinenerdleCard,
  itemAttrsSnapshot: CinenerdleItemAttrs,
): CinenerdleCard {
  if (card.kind !== "movie" && card.kind !== "person") {
    return card;
  }

  const itemAttrTarget = getEntityCardItemAttrTarget(card);
  const itemAttrs = itemAttrTarget
    ? getItemAttrsForTargetFromSnapshot(itemAttrsSnapshot, itemAttrTarget)
    : [];
  const connectedItemAttrs = dedupeItemAttrs(
    getConnectedItemAttrTargets(card).flatMap((target) =>
      getItemAttrsForTargetFromSnapshot(itemAttrsSnapshot, target)),
  );
  const inheritedItemAttrs = connectedItemAttrs.filter((itemAttr) => !itemAttrs.includes(itemAttr));
  const itemAttrCounts = getCinenerdleItemAttrCounts(itemAttrs, inheritedItemAttrs);

  if (
    areItemAttrArraysEqual(card.itemAttrs, itemAttrs) &&
    areItemAttrArraysEqual(card.connectedItemAttrs, connectedItemAttrs) &&
    areItemAttrArraysEqual(card.inheritedItemAttrs, inheritedItemAttrs) &&
    areRowOrderMetadataEqual(card.itemAttrCounts, itemAttrCounts)
  ) {
    return card;
  }

  return {
    ...card,
    itemAttrs,
    connectedItemAttrs,
    inheritedItemAttrs,
    itemAttrCounts,
  };
}

export function getCinenerdleCardRowOrderMetadata(
  card: CinenerdleCard,
): GeneratorNode<CinenerdleCard>["rowOrderMetadata"] {
  if (card.kind !== "movie" && card.kind !== "person") {
    return null;
  }

  return card.itemAttrCounts;
}

export function enrichCinenerdleTreeWithItemAttrs(
  tree: GeneratorTree<CinenerdleCard>,
  itemAttrsSnapshot: CinenerdleItemAttrs,
  options?: {
    generationIndexes?: number[];
  },
): GeneratorTree<CinenerdleCard> {
  const targetedGenerationIndexes = options?.generationIndexes
    ? new Set(options.generationIndexes)
    : null;
  let didChangeTree = false;
  const nextTree = tree.map((row, generationIndex) => {
    if (targetedGenerationIndexes && !targetedGenerationIndexes.has(generationIndex)) {
      return row;
    }

    let didChangeRow = false;
    const nextRow = row.map((node) => {
      const enrichedCard = enrichCinenerdleCardWithItemAttrs(node.data, itemAttrsSnapshot);
      const rowOrderMetadata = getCinenerdleCardRowOrderMetadata(enrichedCard);

      if (
        enrichedCard === node.data &&
        areRowOrderMetadataEqual(node.rowOrderMetadata, rowOrderMetadata)
      ) {
        return node;
      }

      didChangeRow = true;
      return {
        ...node,
        data: enrichedCard,
        rowOrderMetadata,
      };
    });

    if (!didChangeRow) {
      return row;
    }

    didChangeTree = true;
    return nextRow;
  });

  return didChangeTree ? nextTree : tree;
}

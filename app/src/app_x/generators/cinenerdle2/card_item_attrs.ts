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

  return {
    ...card,
    itemAttrs,
    connectedItemAttrs,
    inheritedItemAttrs,
    itemAttrCounts: getCinenerdleItemAttrCounts(itemAttrs, inheritedItemAttrs),
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
): GeneratorTree<CinenerdleCard> {
  return tree.map((row) =>
    row.map((node) => {
      const enrichedCard = enrichCinenerdleCardWithItemAttrs(node.data, itemAttrsSnapshot);
      return {
        ...node,
        data: enrichedCard,
        rowOrderMetadata: getCinenerdleCardRowOrderMetadata(enrichedCard),
      };
    }),
  );
}

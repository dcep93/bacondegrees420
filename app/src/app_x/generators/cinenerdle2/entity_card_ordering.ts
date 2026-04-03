import type { GeneratorCardRowOrderMetadata } from "../../types/generator";

export function getCinenerdleItemAttrCounts(
  itemAttrs: string[],
  inheritedItemAttrs: string[],
): GeneratorCardRowOrderMetadata {
  return {
    activeCount: itemAttrs.length,
    passiveCount: inheritedItemAttrs.length,
  };
}

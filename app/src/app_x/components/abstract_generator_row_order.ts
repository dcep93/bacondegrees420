import { getDataKey } from "../generators/generator_runtime";
import type { GeneratorCardRowOrderMetadata, GeneratorNode } from "../types/generator";

export type GeneratorRowEntry<T> = {
  dataKey: string;
  metadata: GeneratorCardRowOrderMetadata;
  node: GeneratorNode<T>;
  originalCol: number;
};

export function areGeneratorCardRowOrderMetadataEqual(
  left: GeneratorCardRowOrderMetadata | null | undefined,
  right: GeneratorCardRowOrderMetadata | null | undefined,
): boolean {
  return (left?.activeCount ?? 0) === (right?.activeCount ?? 0) &&
    (left?.passiveCount ?? 0) === (right?.passiveCount ?? 0);
}

export function getSortedGeneratorRowEntries<T>(
  row: GeneratorNode<T>[],
  metadataByDataKey: ReadonlyMap<string, GeneratorCardRowOrderMetadata> = new Map(),
): GeneratorRowEntry<T>[] {
  return row
    .map((node, originalCol) => {
      const dataKey = getDataKey(node.data, originalCol);
      return {
        dataKey,
        metadata: metadataByDataKey.get(dataKey) ?? {
          activeCount: 0,
          passiveCount: 0,
        },
        node,
        originalCol,
      };
    })
    .sort((left, right) => {
      const activeCountDifference = right.metadata.activeCount - left.metadata.activeCount;
      if (activeCountDifference !== 0) {
        return activeCountDifference;
      }

      const passiveCountDifference = right.metadata.passiveCount - left.metadata.passiveCount;
      if (passiveCountDifference !== 0) {
        return passiveCountDifference;
      }

      return left.originalCol - right.originalCol;
    });
}

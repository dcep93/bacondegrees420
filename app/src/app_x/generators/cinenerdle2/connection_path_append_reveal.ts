import type { AbstractGeneratorHandle } from "../../components/abstract_generator";
import type { GeneratorNode } from "../../types/generator";
import type { CinenerdleCard } from "./view_types";

export function getConnectionPathAppendRevealGenerationIndex(
  tree: GeneratorNode<CinenerdleCard>[][],
  targetEntityKey: string,
): number | null {
  const targetGenerationIndex = tree.findIndex((row) =>
    row.some((node) => node.selected && node.data.key === targetEntityKey),
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
  generatorHandle.alignTreeLikeRootBubble();
}

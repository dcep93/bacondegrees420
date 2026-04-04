import { describe, expect, it, vi } from "vitest";
import type { AbstractGeneratorHandle } from "../../../components/abstract_generator";
import type { GeneratorNode } from "../../../types/generator";
import type { CinenerdleCard } from "../view_types";
import {
  getConnectionPathAppendRevealGenerationIndex,
  revealConnectionPathAppendTarget,
} from "../connection_path_append_reveal";

function createNode(
  key: string,
  options?: {
    selected?: boolean;
  },
): GeneratorNode<CinenerdleCard> {
  return {
    selected: options?.selected ?? false,
    data: {
      key,
      kind: "movie",
      name: key,
      year: "2000",
      popularity: 0,
      popularitySource: null,
      imageUrl: null,
      subtitle: "2000",
      subtitleDetail: "",
      connectionCount: null,
      sources: [],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: null,
    },
  };
}

describe("getConnectionPathAppendRevealGenerationIndex", () => {
  it("reveals the child generation when the appended target gained children", () => {
    const tree = [
      [createNode("root", { selected: true })],
      [createNode("willem-dafoe", { selected: true })],
      [createNode("spider-man", { selected: true })],
      [createNode("child-of-spider-man")],
    ];

    expect(getConnectionPathAppendRevealGenerationIndex(tree, "spider-man")).toBe(3);
  });

  it("falls back to the target generation when no child row was appended", () => {
    const tree = [
      [createNode("root", { selected: true })],
      [createNode("willem-dafoe", { selected: true })],
      [createNode("spider-man", { selected: true })],
    ];

    expect(getConnectionPathAppendRevealGenerationIndex(tree, "spider-man")).toBe(2);
  });
});

describe("revealConnectionPathAppendTarget", () => {
  it("reveals the appended generation before aligning the tree like GEN 0", async () => {
    const callOrder: string[] = [];
    const generatorHandle: AbstractGeneratorHandle = {
      alignTreeLikeRootBubble: vi.fn(() => {
        callOrder.push("align");
      }),
      revealGeneration: vi.fn(async () => {
        callOrder.push("reveal");
      }),
      scrollToCard: vi.fn(),
      selectCard: vi.fn(),
    };

    await revealConnectionPathAppendTarget(generatorHandle, 3);

    expect(generatorHandle.revealGeneration).toHaveBeenCalledWith(3, {
      alignRowHorizontally: false,
    });
    expect(generatorHandle.alignTreeLikeRootBubble).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["reveal", "align"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  applyGeneratorUpdate,
  createGeneratorState,
  findMatchingYoungestGenerationIndex,
  getRowSignature,
  reduceGeneratorLifecycleEvent,
  resolveGeneratorTree,
} from "../generator_runtime";
import type { GeneratorNode } from "../../types/generator";

type TestNode = {
  key: string;
};

function createNode(key: string, selected = false, disabled = false): GeneratorNode<TestNode> {
  return {
    selected,
    disabled,
    data: { key },
  };
}

describe("generator_runtime", () => {
  it("emits an initialize effect without mutating the initial state", () => {
    const state = createGeneratorState<{ key: string }, { name: string }>({ name: "test" });

    const transition = reduceGeneratorLifecycleEvent(state, { type: "initialize" });

    expect(transition.state).toEqual(state);
    expect(transition.effects).toEqual([{ type: "load-initial-tree" }]);
  });

  it("normalizes selection, truncates descendants, and creates a placeholder row", () => {
    const state = createGeneratorState(
      { name: "test" },
      [
        [createNode("root-a", true), createNode("root-b")],
        [createNode("child-a", true), createNode("child-b")],
        [createNode("grandchild-a", true)],
      ],
    );

    const transition = reduceGeneratorLifecycleEvent(state, {
      type: "select",
      row: 1,
      col: 1,
      optimisticSelection: true,
    });

    expect(transition.state.tree).toEqual([
      [createNode("root-a", true), createNode("root-b")],
      [createNode("child-a"), createNode("child-b", true)],
    ]);
    expect(transition.state.renderTreeOverride).toEqual([
      [createNode("root-a", true), createNode("root-b")],
      [createNode("child-a"), createNode("child-b", true)],
      [createNode("grandchild-a")],
    ]);
    expect(transition.state.placeholderRowIndex).toBe(2);
    expect(transition.effects).toEqual([{
      type: "load-selected-card",
      row: 1,
      col: 1,
      removedDescendantRows: true,
      tree: [
        [createNode("root-a", true), createNode("root-b")],
        [createNode("child-a"), createNode("child-b", true)],
      ],
    }]);
  });

  it("creates a placeholder row even when the selection does not splice descendants", () => {
    const state = createGeneratorState(
      { name: "test" },
      [
        [createNode("root-a", true), createNode("root-b")],
      ],
    );

    const transition = reduceGeneratorLifecycleEvent(state, {
      type: "select",
      row: 0,
      col: 1,
      optimisticSelection: true,
    });

    expect(transition.state.tree).toEqual([
      [createNode("root-a"), createNode("root-b", true)],
    ]);
    expect(transition.state.renderTreeOverride).toEqual([
      [createNode("root-a"), createNode("root-b", true)],
      [createNode("root-b")],
    ]);
    expect(transition.state.placeholderRowIndex).toBe(1);
    expect(transition.effects).toEqual([{
      type: "load-selected-card",
      row: 0,
      col: 1,
      removedDescendantRows: false,
      tree: [
        [createNode("root-a"), createNode("root-b", true)],
      ],
    }]);
  });

  it("skips placeholder rows when optimistic selection is disabled", () => {
    const state = createGeneratorState(
      { name: "test" },
      [
        [createNode("root-a", true)],
        [createNode("child-a", true)],
      ],
    );

    const transition = reduceGeneratorLifecycleEvent(state, {
      type: "select",
      row: 0,
      col: 0,
      optimisticSelection: false,
    });

    expect(transition.state.renderTreeOverride).toBeNull();
    expect(transition.state.placeholderRowIndex).toBeNull();
  });

  it("resolves the rendered tree from overrides first", () => {
    const state = {
      ...createGeneratorState<{ key: string }, undefined>(undefined),
      tree: [[createNode("tree")]],
      renderTreeOverride: [[createNode("override")]],
    };

    expect(resolveGeneratorTree(state)[0]?.[0]?.data.key).toBe("override");
  });

  it("clears placeholder rendering when a tree update lands", () => {
    const state = {
      ...createGeneratorState<{ key: string }, undefined>(undefined),
      renderTreeOverride: [[createNode("override")]],
      placeholderRowIndex: 1,
    };

    const nextState = applyGeneratorUpdate(state, {
      tree: [[createNode("tree")]],
    });

    expect(nextState.tree?.[0]?.[0]?.data.key).toBe("tree");
    expect(nextState.renderTreeOverride).toBeNull();
    expect(nextState.placeholderRowIndex).toBeNull();
  });

  it("finds a matching node in the youngest generation", () => {
    const result = findMatchingYoungestGenerationIndex(
      [
        [createNode("root")],
        [createNode("child-a"), createNode("child-b", true)],
      ],
      (node) => node.data.key === "child-b",
    );

    expect(result).toEqual({
      didMatch: true,
      generationIndex: 1,
      matchingIndex: 1,
    });
  });

  it("captures row signatures for selection, disabled, and placeholder state", () => {
    expect(getRowSignature([
      createNode("alpha", true),
      {
        selected: false,
        disabled: true,
        data: {
          key: "beta",
          isPlaceholder: true,
        } as TestNode & { isPlaceholder: true },
      },
    ])).toBe("alpha:1:0:0|beta:0:1:1");
  });
});

import { describe, expect, it } from "vitest";
import {
  applyGeneratorUpdate,
  createGeneratorState,
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

  it("normalizes selection while keeping previous descendants visible", () => {
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
    });

    expect(transition.state.tree).toEqual([
      [createNode("root-a", true), createNode("root-b")],
      [createNode("child-a"), createNode("child-b", true)],
      [createNode("grandchild-a")],
    ]);
    expect(transition.effects).toEqual([{
      type: "load-selected-card",
      row: 1,
      col: 1,
      removedDescendantRows: true,
      tree: [
        [createNode("root-a", true), createNode("root-b")],
        [createNode("child-a"), createNode("child-b", true)],
        [createNode("grandchild-a")],
      ],
    }]);
  });

  it("keeps the selected row when the selection does not splice descendants", () => {
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
    });

    expect(transition.state.tree).toEqual([
      [createNode("root-a"), createNode("root-b", true)],
    ]);
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


  it("does not mark descendants as removed when clicking an already selected ancestor", () => {
    const state = createGeneratorState(
      { name: "test" },
      [
        [createNode("root-a", true), createNode("root-b")],
        [createNode("child-a", true), createNode("child-b")],
      ],
    );

    const transition = reduceGeneratorLifecycleEvent(state, {
      type: "select",
      row: 0,
      col: 0,
    });

    expect(transition.state.tree).toEqual([
      [createNode("root-a", true), createNode("root-b")],
      [createNode("child-a"), createNode("child-b")],
    ]);
    expect(transition.effects).toEqual([{
      type: "load-selected-card",
      row: 0,
      col: 0,
      removedDescendantRows: false,
      tree: [
        [createNode("root-a", true), createNode("root-b")],
        [createNode("child-a"), createNode("child-b")],
      ],
    }]);
  });

  it("resolves the rendered tree from state", () => {
    const state = {
      ...createGeneratorState<{ key: string }, undefined>(undefined),
      tree: [[createNode("tree")]],
    };

    expect(resolveGeneratorTree(state)[0]?.[0]?.data.key).toBe("tree");
  });

  it("applies tree updates directly", () => {
    const state = createGeneratorState<{ key: string }, undefined>(undefined);

    const nextState = applyGeneratorUpdate(state, {
      tree: [[createNode("tree")]],
    });

    expect(nextState.tree?.[0]?.[0]?.data.key).toBe("tree");
  });

  it("captures row signatures for selection and disabled state", () => {
    expect(getRowSignature([
      createNode("alpha", true),
      {
        selected: false,
        disabled: true,
        data: { key: "beta" },
      },
    ])).toBe("alpha:1:0|beta:0:1");
  });
});

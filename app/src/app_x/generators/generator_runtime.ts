import type {
  GeneratorLifecycleEffect,
  GeneratorLifecycleEvent,
  GeneratorNode,
  GeneratorState,
  GeneratorTransition,
  GeneratorTree,
  GeneratorUpdate,
} from "../types/generator";

export function createGeneratorState<T, TMeta = undefined>(
  meta: TMeta,
  tree: GeneratorTree<T> | null = null,
): GeneratorState<T, TMeta> {
  return {
    tree,
    meta,
  };
}

export function isDisabledNode<T>(node: GeneratorNode<T>): boolean {
  return node.disabled === true;
}

export function getDataKey<T>(data: T, fallbackIndex: number): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "key" in data &&
    (typeof data.key === "string" || typeof data.key === "number")
  ) {
    return String(data.key);
  }

  return String(fallbackIndex);
}

export function getRowSignature<T>(row: GeneratorNode<T>[]): string {
  return row
    .map((node, index) => {
      const dataKey = getDataKey(node.data, index);
      return `${dataKey}:${node.selected ? "1" : "0"}:${isDisabledNode(node) ? "1" : "0"}`;
    })
    .join("|");
}

export function resolveGeneratorTree<T, TMeta = undefined>(
  state: GeneratorState<T, TMeta>,
): GeneratorTree<T> {
  return state.tree ?? [];
}

export function applyGeneratorUpdate<T, TMeta = undefined>(
  state: GeneratorState<T, TMeta>,
  update: GeneratorUpdate<T, TMeta> | null | undefined,
): GeneratorState<T, TMeta> {
  if (!update) {
    return state;
  }

  return {
    ...state,
    ...update,
  };
}

export function reduceGeneratorLifecycleEvent<T, TMeta = undefined>(
  state: GeneratorState<T, TMeta>,
  event: GeneratorLifecycleEvent,
): GeneratorTransition<T, TMeta, GeneratorLifecycleEffect<T>> {
  if (event.type === "initialize") {
    return {
      state,
      effects: [{ type: "load-initial-tree" }],
    };
  }

  const tree = state.tree;
  const selectedRow = tree?.[event.row];
  const selectedNode = selectedRow?.[event.col];

  if (!tree || !selectedRow || !selectedNode || isDisabledNode(selectedNode)) {
    return {
      state,
      effects: [],
    };
  }

  const selectedNodeWasAlreadySelected = selectedNode.selected;
  const removedDescendantRows = !selectedNodeWasAlreadySelected && tree.length > event.row + 1;
  const normalizedTree = tree.map((generation, generationIndex) =>
    generation.map((node, colIndex) => ({
      ...node,
      selected:
        generationIndex < event.row
          ? node.selected
          : generationIndex === event.row
            ? colIndex === event.col
            : false,
    })),
  );

  return {
    state: {
      ...state,
      tree: normalizedTree,
    },
    effects: [{
      type: "load-selected-card",
      removedDescendantRows,
      row: event.row,
      col: event.col,
      tree: normalizedTree,
    }],
  };
}

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
    renderTreeOverride: null,
    placeholderRowIndex: null,
    meta,
  };
}

export function isPlaceholderData<T>(data: T): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "isPlaceholder" in data &&
    data.isPlaceholder === true
  );
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
      return `${dataKey}:${node.selected ? "1" : "0"}:${isDisabledNode(node) ? "1" : "0"}:${isPlaceholderData(node.data) ? "1" : "0"}`;
    })
    .join("|");
}

export function resolveGeneratorTree<T, TMeta = undefined>(
  state: GeneratorState<T, TMeta>,
): GeneratorTree<T> {
  return state.renderTreeOverride ?? state.tree ?? [];
}

export function findMatchingYoungestGenerationIndex<T>(
  tree: GeneratorTree<T>,
  matchesNode: (node: GeneratorNode<T>) => boolean,
): {
  didMatch: boolean;
  generationIndex: number;
  matchingIndex: number;
} {
  if (tree.length === 0) {
    return {
      didMatch: false,
      generationIndex: -1,
      matchingIndex: -1,
    };
  }

  const generationIndex = tree.length - 1;
  const row = tree[generationIndex];
  const matchingIndex = row?.findIndex((node) => matchesNode(node)) ?? -1;

  return {
    didMatch: matchingIndex >= 0,
    generationIndex,
    matchingIndex,
  };
}

export function applyGeneratorUpdate<T, TMeta = undefined>(
  state: GeneratorState<T, TMeta>,
  update: GeneratorUpdate<T, TMeta> | null | undefined,
): GeneratorState<T, TMeta> {
  if (!update) {
    return state;
  }

  const nextState: GeneratorState<T, TMeta> = {
    ...state,
    ...update,
  };

  if ("tree" in update && !("renderTreeOverride" in update)) {
    nextState.renderTreeOverride = null;
  }

  if ("tree" in update && !("placeholderRowIndex" in update)) {
    nextState.placeholderRowIndex = null;
  }

  return nextState;
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

  const removedDescendantRows = tree.length > event.row + 1;
  const normalizedTree = tree
    .slice(0, event.row + 1)
    .map((generation, generationIndex) =>
      generation.map((node, colIndex) => ({
        ...node,
        selected: generationIndex === event.row ? colIndex === event.col : node.selected,
      })),
    );

  let renderTreeOverride = null;
  let placeholderRowIndex = null;

  if (event.optimisticSelection) {
    const placeholderSourceRow = tree[event.row + 1] ?? [selectedNode];
    const placeholderRow = placeholderSourceRow.map((node) => ({
      ...node,
      selected: false,
    }));
    renderTreeOverride = [...normalizedTree, placeholderRow];
    placeholderRowIndex = event.row + 1;
  }

  return {
    state: {
      ...state,
      tree: normalizedTree,
      renderTreeOverride,
      placeholderRowIndex,
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

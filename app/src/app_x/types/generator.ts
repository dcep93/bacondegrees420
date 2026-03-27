import type { ReactElement } from "react";

export type GeneratorNode<T> = {
  selected: boolean;
  data: T;
};

export type GeneratorTree<T> = GeneratorNode<T>[][];

export type GeneratorTreeState<T> = GeneratorTree<T> | null;

export type SetGeneratorTree<T> = (
  nextTree:
    | GeneratorTreeState<T>
    | ((prevTree: GeneratorTreeState<T>) => GeneratorTreeState<T>),
) => void;

export type GeneratorSelectionContext<T> = {
  row: number;
  col: number;
  tree: GeneratorTree<T>;
  setTree: SetGeneratorTree<T>;
};

export type GeneratorController<T> = {
  initTree: (setTree: SetGeneratorTree<T>) => void;
  afterCardSelected: (context: GeneratorSelectionContext<T>) => void;
  renderCard: (
    row: number,
    col: number,
    tree: GeneratorTree<T>,
  ) => ReactElement;
};

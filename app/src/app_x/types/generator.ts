import type { ReactElement } from "react";

export type GeneratorNode<T> = {
  selected: boolean;
  disabled?: boolean;
  data: T;
};

export type GeneratorTree<T> = GeneratorNode<T>[][];

export type GeneratorTreeState<T> = GeneratorTree<T> | null;

export type GeneratorState<T, TMeta = undefined> = {
  tree: GeneratorTreeState<T>;
  meta: TMeta;
};

export type GeneratorUpdate<T, TMeta = undefined> =
  Partial<GeneratorState<T, TMeta>>;

export type GeneratorLifecycleEvent =
  | {
      type: "initialize";
    }
  | {
      type: "select";
      row: number;
      col: number;
    };

export type GeneratorLifecycleEffect<T> =
  | {
      type: "load-initial-tree";
    }
  | {
      type: "load-selected-card";
      isReselection: boolean;
      removedDescendantRows: boolean;
      row: number;
      col: number;
      tree: GeneratorTree<T>;
    };

export type GeneratorTransition<T, TMeta = undefined, TEffect = never> = {
  state: GeneratorState<T, TMeta>;
  effects: TEffect[];
};

export type GeneratorEffectContext<T, TMeta = undefined> = {
  applyUpdate: (
    nextUpdate:
      | GeneratorUpdate<T, TMeta>
      | null
      | undefined
      | ((prevState: GeneratorState<T, TMeta>) => GeneratorUpdate<T, TMeta> | null | undefined),
  ) => void;
  getState: () => GeneratorState<T, TMeta>;
  lifecycleId: number;
  selectionId: number;
  scrollGenerationIntoVerticalView: (generationIndex: number) => Promise<void>;
  scrollGenerationLikeBubble: (generationIndex: number) => Promise<void>;
};

export type GeneratorCardRenderContext<T> = {
  row: number;
  col: number;
  node: GeneratorNode<T>;
  selectedAncestorData: T[];
  selectedChildData: T | null;
  selectedDescendantData: T[];
  selectedParentData: T | null;
};

export type GeneratorController<T, TMeta = undefined, TEffect = never> = {
  createInitialState: () => GeneratorState<T, TMeta>;
  reduce: (
    state: GeneratorState<T, TMeta>,
    event: GeneratorLifecycleEvent,
  ) => GeneratorTransition<T, TMeta, TEffect>;
  runEffect: (
    effect: TEffect,
    context: GeneratorEffectContext<T, TMeta>,
  ) => Promise<void>;
  renderCard: (context: GeneratorCardRenderContext<T>) => ReactElement;
};

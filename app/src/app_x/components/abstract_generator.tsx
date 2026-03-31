import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyGeneratorUpdate,
  getDataKey,
  isDisabledNode,
  resolveGeneratorTree,
} from "../generators/generator_runtime";
import "../styles/abstract_generator.css";
import type {
  GeneratorController,
  GeneratorNode,
  GeneratorState,
  GeneratorTree,
  GeneratorUpdate,
} from "../types/generator";

export type AbstractGeneratorTreeRefreshRequest<T> = {
  requestKey: string;
  run: (tree: GeneratorTree<T>) => Promise<GeneratorTree<T> | null>;
};

export type AbstractGeneratorProps<T, TMeta = undefined, TEffect = never> =
  GeneratorController<T, TMeta, TEffect> & {
    getRowPresentation?: (
      row: GeneratorNode<T>[],
      generationIndex: number,
    ) => {
      cardButtonClassName?: string;
      className?: string;
      hideBubble?: boolean;
      trackClassName?: string;
    };
    shouldAutoScrollMountedGeneration?: (info: {
      generationIndex: number;
      row: GeneratorNode<T>[];
      tree: GeneratorTree<T>;
    }) => boolean;
    onTreeChange?: (tree: GeneratorTree<T>) => void;
    resetKey?: number | string;
    treeRefreshRequest?: AbstractGeneratorTreeRefreshRequest<T> | null;
  };

function schedulePostSelectionWork(work: () => void) {
  if (typeof window === "undefined") {
    work();
    return;
  }

  window.requestAnimationFrame(() => {
    work();
  });
}

function initializeGeneratorState<T, TMeta, TEffect>(
  createInitialState: () => GeneratorState<T, TMeta>,
  reduce: GeneratorController<T, TMeta, TEffect>["reduce"],
): {
  effects: TEffect[];
  state: GeneratorState<T, TMeta>;
} {
  const initialState = createInitialState();
  const transition = reduce(initialState, { type: "initialize" });

  return {
    effects: transition.effects,
    state: transition.state,
  };
}

function scrollElementToLeft(
  element: HTMLDivElement,
  left: number,
  behavior: ScrollBehavior,
) {
  if (behavior === "smooth") {
    element.scrollTo({
      left,
      behavior,
    });
    return;
  }

  const previousInlineScrollBehavior = element.style.scrollBehavior;
  element.style.scrollBehavior = "auto";
  element.scrollTo({
    left,
    behavior: "auto",
  });
  element.style.scrollBehavior = previousInlineScrollBehavior;
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    schedulePostSelectionWork(() => {
      resolve();
    });
  });
}

export function AbstractGenerator<T, TMeta = undefined, TEffect = never>({
  createInitialState,
  getRowPresentation,
  onTreeChange,
  reduce,
  renderCard,
  runEffect,
  shouldAutoScrollMountedGeneration,
  treeRefreshRequest = null,
}: AbstractGeneratorProps<T, TMeta, TEffect>) {
  const [initialTransition] = useState<{
    effects: TEffect[];
    state: GeneratorState<T, TMeta>;
  }>(() => initializeGeneratorState(createInitialState, reduce));

  const [state, setState] = useState<GeneratorState<T, TMeta>>(
    () => initialTransition.state,
  );
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const mountedRef = useRef(true);
  const activeLifecycleRef = useRef(0);
  const activeSelectionRef = useRef(0);
  const lastHandledTreeRefreshRequestKeyRef = useRef<string | null>(null);
  const mountedGenerationIndexesRef = useRef<Set<number>>(new Set());
  const stateRef = useRef(state);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const createGuardedApplyUpdate = useCallback(
    (lifecycleId: number, selectionId: number) =>
      (
        nextUpdate:
          | GeneratorUpdate<T, TMeta>
          | null
          | undefined
          | ((prevState: GeneratorState<T, TMeta>) => GeneratorUpdate<T, TMeta> | null | undefined),
      ) => {
        if (
          !mountedRef.current ||
          activeLifecycleRef.current !== lifecycleId ||
          activeSelectionRef.current !== selectionId
        ) {
          return;
        }

        startTransition(() => {
          setState((prevState) => {
            if (
              !mountedRef.current ||
              activeLifecycleRef.current !== lifecycleId ||
              activeSelectionRef.current !== selectionId
            ) {
              return prevState;
            }

            const resolvedUpdate = typeof nextUpdate === "function"
              ? nextUpdate(prevState)
              : nextUpdate;
            const nextState = applyGeneratorUpdate(prevState, resolvedUpdate);
            stateRef.current = nextState;
            return nextState;
          });
        });
      },
    [],
  );

  useEffect(() => {
    if (
      treeRefreshRequest === null ||
      treeRefreshRequest.requestKey === lastHandledTreeRefreshRequestKeyRef.current
    ) {
      return;
    }

    lastHandledTreeRefreshRequestKeyRef.current = treeRefreshRequest.requestKey;

    const lifecycleId = activeLifecycleRef.current;
    const selectionId = activeSelectionRef.current;
    const applyUpdate = createGuardedApplyUpdate(lifecycleId, selectionId);
    const currentTree = resolveGeneratorTree(stateRef.current);

    void treeRefreshRequest.run(currentTree)
      .then((nextTree) => {
        if (!nextTree) {
          return;
        }

        applyUpdate({
          tree: nextTree,
        });
      })
      .catch(() => { });
  }, [createGuardedApplyUpdate, treeRefreshRequest]);

  const resolvedTree = useMemo(
    () => resolveGeneratorTree(state),
    [state],
  );

  useEffect(() => {
    onTreeChange?.(resolvedTree);
  }, [onTreeChange, resolvedTree]);

  const generations = resolvedTree.map((row, generationIndex) => ({
    row,
    generationIndex,
  }));
  const renderedGenerations = [...generations].reverse();

  const scrollToCardIndex = useCallback((
    generationIndex: number,
    cardIndex: number,
    options?: {
      alignment?: "center" | "start";
      behavior?: ScrollBehavior;
    },
  ) => {
    const alignment = options?.alignment ?? "center";
    const behavior = options?.behavior ?? "smooth";
    const targetNode = resolvedTree[generationIndex]?.[cardIndex];

    if (!targetNode) {
      return;
    }

    const rowTrack = rowRefs.current[generationIndex];
    const targetCard = cardRefs.current[
      `${generationIndex}:${getDataKey(targetNode.data, cardIndex)}`
    ];

    if (targetCard && rowTrack) {
      const startAlignedScrollLeft = targetCard.offsetLeft - (targetCard.clientWidth / 2)
      const referenceIndex = resolvedTree[0]?.findIndex((node) => node.selected) ?? -1;
      const referenceCard = referenceIndex >= 0
        ? cardRefs.current[
        `0:${getDataKey(resolvedTree[0][referenceIndex].data, referenceIndex)}`
        ]
        : null;
      if (referenceCard) {
        const centeredScrollLeft = startAlignedScrollLeft - referenceCard!.offsetLeft + referenceCard.clientWidth / 2
        const targetScrollLeft = alignment === "start" ? startAlignedScrollLeft : centeredScrollLeft;

        scrollElementToLeft(rowTrack, targetScrollLeft, behavior);
      }
      return;
    }

    if (targetCard) {
      targetCard.scrollIntoView({
        behavior,
        block: "nearest",
        inline: alignment,
      });
    }
  }, [resolvedTree]);

  const handleScrollToSelected = useCallback((generationIndex: number) => {
    const selectedRow = resolvedTree[generationIndex];
    const selectedIndex = selectedRow?.findIndex((node) => node.selected) ?? -1;

    if (selectedIndex < 0) {
      if (!selectedRow || selectedRow.length === 0) {
        return;
      }

      scrollToCardIndex(generationIndex, 0, {
        alignment: "start",
        behavior: "smooth",
      });
      return;
    }

    scrollToCardIndex(generationIndex, selectedIndex, {
      behavior: "smooth",
    });
  }, [resolvedTree, scrollToCardIndex]);

  const handleBubbleClick = useCallback((generationIndex: number) => {
    if (generationIndex === 0) {
      resolvedTree.forEach((_, rowIndex) => {
        handleScrollToSelected(rowIndex);
      });
      return;
    }

    handleScrollToSelected(generationIndex);
  }, [handleScrollToSelected, resolvedTree]);

  const scrollGenerationLikeBubble = useCallback(async (generationIndex: number) => {
    await waitForNextFrame();

    if (!mountedRef.current) {
      return;
    }

    handleBubbleClick(generationIndex);
  }, [handleBubbleClick]);

  const runEffects = useCallback(async (
    effects: TEffect[],
    lifecycleId: number,
    selectionId: number,
  ) => {
    const applyUpdate = createGuardedApplyUpdate(lifecycleId, selectionId);

    for (const effect of effects) {
      if (
        !mountedRef.current ||
        activeLifecycleRef.current !== lifecycleId ||
        activeSelectionRef.current !== selectionId
      ) {
        return;
      }

      await runEffect(effect, {
        applyUpdate,
        getState: () => stateRef.current,
        lifecycleId,
        selectionId,
        scrollGenerationLikeBubble,
      });
    }
  }, [createGuardedApplyUpdate, runEffect, scrollGenerationLikeBubble]);

  useEffect(() => {
    const lifecycleId = activeLifecycleRef.current + 1;
    activeLifecycleRef.current = lifecycleId;
    activeSelectionRef.current = 0;
    stateRef.current = initialTransition.state;
    void runEffects(initialTransition.effects, lifecycleId, activeSelectionRef.current);
  }, [initialTransition, runEffects]);

  useLayoutEffect(() => {
    const previouslyMountedGenerationIndexes = mountedGenerationIndexesRef.current;
    const nextMountedGenerationIndexes = new Set<number>();

    resolvedTree.forEach((row, generationIndex) => {
      nextMountedGenerationIndexes.add(generationIndex);

      if (
        previouslyMountedGenerationIndexes.has(generationIndex) ||
        !shouldAutoScrollMountedGeneration?.({
          generationIndex,
          row,
          tree: resolvedTree,
        })
      ) {
        return;
      }

      schedulePostSelectionWork(() => {
        handleBubbleClick(generationIndex);
      });
    });

    mountedGenerationIndexesRef.current = nextMountedGenerationIndexes;
  }, [handleBubbleClick, resolvedTree, shouldAutoScrollMountedGeneration]);

  const handleCardSelect = useCallback((row: number, col: number) => {
    const currentTree = stateRef.current.tree;
    const selectedRow = currentTree?.[row];
    const selectedNode = selectedRow?.[col] ?? null;
    if (!selectedRow || !selectedNode || isDisabledNode(selectedNode)) {
      return;
    }

    const nextSelectionId = activeSelectionRef.current + 1;
    activeSelectionRef.current = nextSelectionId;

    const transition = reduce(stateRef.current, {
      type: "select",
      row,
      col,
    });

    stateRef.current = transition.state;
    setState(transition.state);

    schedulePostSelectionWork(() => {
      void runEffects(
        transition.effects,
        activeLifecycleRef.current,
        nextSelectionId,
      );
    });
  }, [reduce, runEffects]);

  return (
    <section
      aria-busy={state.tree === null}
      aria-label="Generator"
      className="abstract-generator"
    >
      {renderedGenerations.map(({ row, generationIndex }) => {
        const rowPresentation = getRowPresentation?.(row, generationIndex) ?? {};

        return (
          <div
            className={[
              "generator-row",
              rowPresentation.className ?? "",
            ].filter(Boolean).join(" ")}
            key={generationIndex}
          >
            {rowPresentation.hideBubble ? null : (
              <button
                className="generator-row-bubble"
                onClick={() => handleBubbleClick(generationIndex)}
                type="button"
              >
                {`GEN ${generationIndex}`}
              </button>
            )}

            <div
              className={[
                "generator-row-track",
                generationIndex === 0 ? "generator-row-track-root" : "",
                rowPresentation.trackClassName ?? "",
              ].filter(Boolean).join(" ")}
              ref={(element) => {
                rowRefs.current[generationIndex] = element;
              }}
            >
              {row.map((node, col) => {
                const dataKey = getDataKey(node.data, col);
                const refKey = `${generationIndex}:${dataKey}`;

                return (
                  <div
                    aria-disabled={isDisabledNode(node)}
                    className={[
                      "generator-card-button",
                      isDisabledNode(node) ? "generator-card-button-disabled" : "",
                      rowPresentation.cardButtonClassName ?? "",
                    ].filter(Boolean).join(" ")}
                    key={refKey}
                    onClick={() => handleCardSelect(generationIndex, col)}
                    ref={(element) => {
                      cardRefs.current[refKey] = element;
                    }}
                  >
                    {renderCard({
                      row: generationIndex,
                      col,
                      node,
                      tree: resolvedTree,
                      state,
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

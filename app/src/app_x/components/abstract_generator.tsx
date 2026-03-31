import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyGeneratorUpdate,
  findMatchingYoungestGenerationIndex,
  getDataKey,
  isDisabledNode,
  isPlaceholderData,
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

export type AbstractGeneratorFocusRequest<T> = {
  requestKey: string;
  targetGeneration: "youngest";
  matchesNode: (node: GeneratorNode<T>) => boolean;
};

export type AbstractGeneratorActivationRequest<T> = {
  requestKey: string;
  targetGeneration: "youngest";
  matchesNode: (node: GeneratorNode<T>) => boolean;
};

export type AbstractGeneratorProps<T, TMeta = undefined, TEffect = never> =
  GeneratorController<T, TMeta, TEffect> & {
    activationRequest?: AbstractGeneratorActivationRequest<T> | null;
    focusRequest?: AbstractGeneratorFocusRequest<T> | null;
    getRowPresentation?: (
      row: GeneratorNode<T>[],
      generationIndex: number,
    ) => {
      cardButtonClassName?: string;
      className?: string;
      hideBubble?: boolean;
      trackClassName?: string;
    };
    onActivationHandled?: (requestKey: string, didActivate: boolean) => void;
    onCardSelectionAttempt?: (info: {
      col: number;
      node: GeneratorNode<T> | null;
      row: number;
    }) => void;
    onFocusRequestMatchChange?: (didMatch: boolean) => void;
    onTreeChange?: (tree: GeneratorTree<T>) => void;
    optimisticSelection?: boolean;
    resetKey?: number | string;
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

export function AbstractGenerator<T, TMeta = undefined, TEffect = never>({
  activationRequest = null,
  createInitialState,
  focusRequest = null,
  getRowPresentation,
  onActivationHandled,
  onCardSelectionAttempt,
  onFocusRequestMatchChange,
  onTreeChange,
  optimisticSelection = true,
  reduce,
  renderCard,
  runEffect,
}: AbstractGeneratorProps<T, TMeta, TEffect>) {
  const [initialTransition] = useState<{
    effects: TEffect[];
    state: GeneratorState<T, TMeta>;
  }>(() => initializeGeneratorState(createInitialState, reduce));

  const [state, setState] = useState<GeneratorState<T, TMeta>>(
    () => initialTransition.state,
  );
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const mountedRef = useRef(true);
  const activeLifecycleRef = useRef(0);
  const activeSelectionRef = useRef(0);
  const lastHandledActivationRequestKeyRef = useRef<string | null>(null);
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
      });
    }
  }, [createGuardedApplyUpdate, runEffect]);

  useEffect(() => {
    const lifecycleId = activeLifecycleRef.current + 1;
    activeLifecycleRef.current = lifecycleId;
    activeSelectionRef.current = 0;
    stateRef.current = initialTransition.state;
    void runEffects(initialTransition.effects, lifecycleId, activeSelectionRef.current);
  }, [initialTransition, runEffects]);

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
      const maxScrollLeft = Math.max(0, rowTrack.scrollWidth - rowTrack.clientWidth);
      const trackPaddingLeft = Number.parseFloat(window.getComputedStyle(rowTrack).paddingLeft) || 0;
      const startAlignedScrollLeft = Math.max(
        0,
        Math.min(
          targetCard.offsetLeft - trackPaddingLeft,
          maxScrollLeft,
        ),
      );
      const referenceIndex = resolvedTree[0]?.findIndex((node) => node.selected) ?? -1;
      const referenceCard = referenceIndex >= 0
        ? cardRefs.current[
          `0:${getDataKey(resolvedTree[0][referenceIndex].data, referenceIndex)}`
        ]
        : null;
      const centeredScrollLeft = Math.max(
        0,
        Math.min(
          referenceCard
            ? startAlignedScrollLeft - referenceCard.offsetLeft
            : startAlignedScrollLeft,
          maxScrollLeft,
        ),
      );
      const targetScrollLeft = alignment === "start" ? startAlignedScrollLeft : centeredScrollLeft;

      scrollElementToLeft(rowTrack, targetScrollLeft, behavior);
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
      return;
    }

    scrollToCardIndex(generationIndex, selectedIndex, {
      behavior: "smooth",
    });
  }, [resolvedTree, scrollToCardIndex]);

  const handleCardSelect = useCallback((row: number, col: number) => {
    const currentTree = stateRef.current.tree;
    const selectedRow = currentTree?.[row];
    const selectedNode = selectedRow?.[col] ?? null;
    onCardSelectionAttempt?.({
      col,
      node: selectedNode,
      row,
    });
    if (!selectedRow || !selectedNode || isDisabledNode(selectedNode)) {
      return;
    }

    const nextSelectionId = activeSelectionRef.current + 1;
    activeSelectionRef.current = nextSelectionId;

    const transition = reduce(stateRef.current, {
      type: "select",
      row,
      col,
      optimisticSelection,
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
  }, [onCardSelectionAttempt, optimisticSelection, reduce, runEffects]);

  useLayoutEffect(() => {
    if (
      focusRequest === null ||
      state.renderTreeOverride !== null ||
      state.placeholderRowIndex !== null ||
      resolvedTree.length === 0
    ) {
      onFocusRequestMatchChange?.(false);
      return;
    }

    if (focusRequest.targetGeneration !== "youngest") {
      onFocusRequestMatchChange?.(false);
      return;
    }

    const { didMatch } = findMatchingYoungestGenerationIndex(
      resolvedTree,
      focusRequest.matchesNode,
    );

    onFocusRequestMatchChange?.(didMatch);
  }, [
    focusRequest,
    onFocusRequestMatchChange,
    resolvedTree,
    state.placeholderRowIndex,
    state.renderTreeOverride,
  ]);

  useLayoutEffect(() => {
    if (
      activationRequest === null ||
      activationRequest.requestKey === lastHandledActivationRequestKeyRef.current
    ) {
      return;
    }

    lastHandledActivationRequestKeyRef.current = activationRequest.requestKey;

    if (
      state.renderTreeOverride !== null ||
      state.placeholderRowIndex !== null ||
      resolvedTree.length === 0 ||
      activationRequest.targetGeneration !== "youngest"
    ) {
      onActivationHandled?.(activationRequest.requestKey, false);
      return;
    }

    const { didMatch, generationIndex, matchingIndex } = findMatchingYoungestGenerationIndex(
      resolvedTree,
      activationRequest.matchesNode,
    );

    if (!didMatch) {
      onActivationHandled?.(activationRequest.requestKey, false);
      return;
    }

    schedulePostSelectionWork(() => {
      handleCardSelect(generationIndex, matchingIndex);
      onActivationHandled?.(activationRequest.requestKey, true);
    });
  }, [
    activationRequest,
    handleCardSelect,
    onActivationHandled,
    resolvedTree,
    state.placeholderRowIndex,
    state.renderTreeOverride,
  ]);

  return (
    <section
      aria-busy={state.tree === null}
      aria-label="Generator"
      className="abstract-generator"
    >
      {renderedGenerations.map(({ row, generationIndex }) => {
        const selectedCol = row.findIndex((node) => node.selected);
        const hasSelection = selectedCol >= 0;
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
                disabled={!hasSelection}
                onClick={() => handleScrollToSelected(generationIndex)}
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
                const isPlaceholder =
                  isPlaceholderData(node.data) || generationIndex === state.placeholderRowIndex;

                return (
                  <button
                    aria-disabled={isDisabledNode(node)}
                    aria-pressed={node.selected}
                    className={[
                      "generator-card-button",
                      isPlaceholder ? "generator-card-button-placeholder" : "",
                      isDisabledNode(node) ? "generator-card-button-disabled" : "",
                      rowPresentation.cardButtonClassName ?? "",
                    ].filter(Boolean).join(" ")}
                    disabled={isPlaceholder}
                    key={refKey}
                    onClick={() => handleCardSelect(generationIndex, col)}
                    ref={(element) => {
                      cardRefs.current[refKey] = element;
                    }}
                    tabIndex={isPlaceholder || isDisabledNode(node) ? -1 : undefined}
                    type="button"
                  >
                    {renderCard({
                      row: generationIndex,
                      col,
                      node,
                      tree: resolvedTree,
                      state,
                    })}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "../styles/abstract_generator.css";
import {
  applyGeneratorUpdate,
  findMatchingYoungestGenerationIndex,
  getDataKey,
  isDisabledNode,
  isPlaceholderData,
  resolveGeneratorTree,
} from "../generators/generator_runtime";
import { resolveTreeChangeScrollSuppression } from "./abstract_generator_scroll";
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
    scrollSessionKey?: number | string;
    visuallyHidden?: boolean;
    suppressTreeChangeScrollKey?: number | string | null;
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

function getGenerationLineageSignature<T>(
  tree: GeneratorTree<T>,
  generationIndex: number,
): string {
  const selectedKeys: string[] = [];

  for (let index = 0; index <= generationIndex; index += 1) {
    const row = tree[index];
    const selectedIndex = row?.findIndex((node) => node.selected) ?? -1;

    if (selectedIndex < 0) {
      if (index === generationIndex) {
        break;
      }

      selectedKeys.push("unselected");
      continue;
    }

    const selectedNode = row?.[selectedIndex];
    if (!selectedNode) {
      continue;
    }

    selectedKeys.push(getDataKey(selectedNode.data, selectedIndex));
  }

  return `${generationIndex}:${selectedKeys.join(">")}`;
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
  scrollSessionKey,
  visuallyHidden = false,
  suppressTreeChangeScrollKey = null,
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
  const hasHandledSelectionRef = useRef(false);
  const activeSuppressTreeChangeScrollKeyRef = useRef<number | string | null>(null);
  const stableLineageSignaturesRef = useRef<string[]>([]);
  const lastHandledActivationRequestKeyRef = useRef<string | null>(null);
  const lastSeenSuppressTreeChangeScrollKeyRef = useRef<number | string | null>(null);
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

  useEffect(() => {
    hasHandledSelectionRef.current = false;
    activeSuppressTreeChangeScrollKeyRef.current = null;
  }, [scrollSessionKey]);

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
    stableLineageSignaturesRef.current = [];
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
    const row = resolvedTree[generationIndex];
    const targetNode = row?.[cardIndex];

    if (!row || !targetNode) {
      return;
    }

    const rowElement = rowRefs.current[generationIndex];
    const targetCard = cardRefs.current[
      `${generationIndex}:${getDataKey(targetNode.data, cardIndex)}`
    ];

    if (targetCard && rowElement) {
      const maxScrollLeft = Math.max(0, rowElement.scrollWidth - rowElement.clientWidth);
      const centeredScrollLeft = Math.max(
        0,
        Math.min(
          targetCard.offsetLeft - (rowElement.clientWidth - targetCard.offsetWidth) / 2,
          maxScrollLeft,
        ),
      );
      const trackPaddingLeft = Number.parseFloat(window.getComputedStyle(rowElement).paddingLeft) || 0;
      const startAlignedScrollLeft = Math.max(
        0,
        Math.min(
          targetCard.offsetLeft - trackPaddingLeft,
          maxScrollLeft,
        ),
      );
      const targetScrollLeft = alignment === "start" ? startAlignedScrollLeft : centeredScrollLeft;

      scrollElementToLeft(
        rowElement,
        targetScrollLeft,
        behavior,
      );
      return;
    }

    if (targetCard) {
      targetCard.scrollIntoView({
        behavior,
        block: "nearest",
        inline: alignment,
      });
      return;
    }

    if (rowElement) {
      scrollElementToLeft(rowElement, 0, behavior);
    }
  }, [resolvedTree]);

  const scrollPastLeadingSpacer = useCallback((
    generationIndex: number,
    options?: {
      behavior?: ScrollBehavior;
    },
  ) => {
    const behavior = options?.behavior ?? "smooth";
    const row = resolvedTree[generationIndex];
    const rowElement = rowRefs.current[generationIndex];

    if (!rowElement || !row || row.length === 0) {
      return;
    }

    const maxScrollLeft = Math.max(0, rowElement.scrollWidth - rowElement.clientWidth);
    const spacerTargetScrollLeft = Math.min(rowElement.clientWidth, maxScrollLeft);

    scrollElementToLeft(rowElement, spacerTargetScrollLeft, behavior);
  }, [resolvedTree]);

  const handleScrollToSelected = useCallback((
    generationIndex: number,
    options?: {
      behavior?: ScrollBehavior;
    },
  ) => {
    const selectedRow = resolvedTree[generationIndex];
    const selectedIndex = selectedRow?.findIndex((node) => node.selected) ?? -1;

    if (selectedIndex < 0) {
      return;
    }

    scrollToCardIndex(generationIndex, selectedIndex, options);
  }, [resolvedTree, scrollToCardIndex]);

  useLayoutEffect(() => {
    if (state.renderTreeOverride !== null || state.placeholderRowIndex !== null) {
      return;
    }

    const nextStableLineageSignatures = resolvedTree.map((_, generationIndex) =>
      getGenerationLineageSignature(resolvedTree, generationIndex),
    );
    const previousStableLineageSignatures = stableLineageSignaturesRef.current;
    stableLineageSignaturesRef.current = nextStableLineageSignatures;
    const selectedGenerationIndexesToScroll: number[] = [];
    const unselectedGenerationIndexesToReveal: number[] = [];

    for (let generationIndex = 0; generationIndex < resolvedTree.length; generationIndex += 1) {
      const row = resolvedTree[generationIndex];
      const hasSelection = row?.some((node) => node.selected) ?? false;
      const lineageChanged =
        previousStableLineageSignatures[generationIndex] !== nextStableLineageSignatures[generationIndex];

      if (!lineageChanged) {
        continue;
      }

      if (hasSelection) {
        selectedGenerationIndexesToScroll.push(generationIndex);
        continue;
      }

      if ((row?.length ?? 0) > 0) {
        unselectedGenerationIndexesToReveal.push(generationIndex);
      }
    }

    const scrollSuppressionResolution = resolveTreeChangeScrollSuppression({
      activeSuppressTreeChangeScrollKey: activeSuppressTreeChangeScrollKeyRef.current,
      hasPendingScrollWork:
        selectedGenerationIndexesToScroll.length > 0 ||
        unselectedGenerationIndexesToReveal.length > 0,
      lastSeenSuppressTreeChangeScrollKey:
        lastSeenSuppressTreeChangeScrollKeyRef.current,
      suppressTreeChangeScrollKey,
    });
    activeSuppressTreeChangeScrollKeyRef.current =
      scrollSuppressionResolution.nextActiveSuppressTreeChangeScrollKey;
    lastSeenSuppressTreeChangeScrollKeyRef.current =
      scrollSuppressionResolution.nextLastSeenSuppressTreeChangeScrollKey;

    if (!scrollSuppressionResolution.shouldRunScrollWork) {
      return;
    }

    const selectedRowScrollBehavior: ScrollBehavior = "smooth";
    const rowRevealBehavior: ScrollBehavior = "auto";

    selectedGenerationIndexesToScroll.forEach((generationIndex) => {
      handleScrollToSelected(generationIndex, {
        behavior: selectedRowScrollBehavior,
      });
    });

    unselectedGenerationIndexesToReveal.forEach((generationIndex) => {
      scrollPastLeadingSpacer(generationIndex, {
        behavior: rowRevealBehavior,
      });
    });
  }, [
    handleScrollToSelected,
    resolvedTree,
    scrollPastLeadingSpacer,
    state.placeholderRowIndex,
    state.renderTreeOverride,
    suppressTreeChangeScrollKey,
  ]);

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

    hasHandledSelectionRef.current = true;
    activeSuppressTreeChangeScrollKeyRef.current = null;
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

    const { didMatch, generationIndex, matchingIndex } = findMatchingYoungestGenerationIndex(
      resolvedTree,
      focusRequest.matchesNode,
    );

    onFocusRequestMatchChange?.(didMatch);

    if (!didMatch) {
      return;
    }

    scrollToCardIndex(generationIndex, matchingIndex, {
      behavior: "smooth",
    });
  }, [
    focusRequest,
    onFocusRequestMatchChange,
    resolvedTree,
    scrollToCardIndex,
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
      className={[
        "abstract-generator",
        visuallyHidden ? "abstract-generator-hidden" : "",
      ].filter(Boolean).join(" ")}
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
                onClick={() => handleScrollToSelected(generationIndex, {
                  behavior: "smooth",
                })}
                type="button"
              >
                {`GEN ${generationIndex}`}
              </button>
            )}

            <div
              className={[
                "generator-row-track",
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

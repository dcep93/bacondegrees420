import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "../styles/abstract_generator.css";
import type {
  GeneratorController,
  GeneratorNode,
  GeneratorTree,
  GeneratorTreeState,
  SetGeneratorTree,
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

export type AbstractGeneratorProps<T> = GeneratorController<T> & {
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

function getDataKey<T>(data: T, fallbackIndex: number): string {
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

function isPlaceholderData<T>(data: T): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "isPlaceholder" in data &&
    data.isPlaceholder === true
  );
}

function isDisabledNode<T>(node: GeneratorNode<T>): boolean {
  return node.disabled === true;
}

function getRowSignature<T>(row: GeneratorNode<T>[]): string {
  return row
    .map((node, index) => {
      const dataKey = getDataKey(node.data, index);
      return `${dataKey}:${node.selected ? "1" : "0"}:${isDisabledNode(node) ? "1" : "0"}:${isPlaceholderData(node.data) ? "1" : "0"}`;
    })
    .join("|");
}

export function AbstractGenerator<T>({
  activationRequest = null,
  initTree,
  afterCardSelected,
  focusRequest = null,
  getRowPresentation,
  onActivationHandled,
  onFocusRequestMatchChange,
  onTreeChange,
  optimisticSelection = true,
  renderCard,
  resetKey,
}: AbstractGeneratorProps<T>) {
  const [tree, setTree] = useState<GeneratorTreeState<T>>(null);
  const [renderTreeOverride, setRenderTreeOverride] = useState<GeneratorTreeState<T>>(null);
  const [placeholderRowIndex, setPlaceholderRowIndex] = useState<number | null>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const mountedRef = useRef(true);
  const activeLifecycleRef = useRef(0);
  const activeSelectionRef = useRef(0);
  const stableRowSignaturesRef = useRef<string[]>([]);
  const lastHandledActivationRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const createGuardedSetTree = useCallback(
    (lifecycleId: number, selectionId: number): SetGeneratorTree<T> =>
      (nextTree) => {
        if (
          !mountedRef.current ||
          activeLifecycleRef.current !== lifecycleId ||
          activeSelectionRef.current !== selectionId
        ) {
          return;
        }

        startTransition(() => {
          setRenderTreeOverride(null);
          setPlaceholderRowIndex(null);
          setTree((prevTree) => {
            if (
              !mountedRef.current ||
              activeLifecycleRef.current !== lifecycleId ||
              activeSelectionRef.current !== selectionId
            ) {
              return prevTree;
            }

            return typeof nextTree === "function" ? nextTree(prevTree) : nextTree;
          });
        });
      },
    [],
  );

  useEffect(() => {
    const lifecycleId = activeLifecycleRef.current + 1;
    activeLifecycleRef.current = lifecycleId;
    activeSelectionRef.current = 0;
    stableRowSignaturesRef.current = [];

    const guardedSetTree = createGuardedSetTree(lifecycleId, activeSelectionRef.current);
    initTree(guardedSetTree);
  }, [createGuardedSetTree, initTree, resetKey]);

  const resolvedTree: GeneratorTree<T> = useMemo(
    () => renderTreeOverride ?? tree ?? [],
    [renderTreeOverride, tree],
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
      `${generationIndex}:${getDataKey(
        targetNode.data,
        cardIndex,
      )}`
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

      rowElement.scrollTo({
        left: alignment === "start" ? startAlignedScrollLeft : centeredScrollLeft,
        behavior,
      });
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

    rowElement?.scrollTo({
      left: 0,
      behavior,
    });
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
    if (renderTreeOverride !== null || placeholderRowIndex !== null) {
      return;
    }

    const nextStableRowSignatures = resolvedTree.map((row) => getRowSignature(row));
    const previousStableRowSignatures = stableRowSignaturesRef.current;
    stableRowSignaturesRef.current = nextStableRowSignatures;
    const selectedGenerationIndexesToScroll: number[] = [];
    const unselectedGenerationIndexesToReveal: number[] = [];

    for (let generationIndex = 0; generationIndex < resolvedTree.length; generationIndex += 1) {
      const row = resolvedTree[generationIndex];
      const hasSelection = row?.some((node) => node.selected) ?? false;
      const rowChanged =
        previousStableRowSignatures[generationIndex] !== nextStableRowSignatures[generationIndex];

      if (!rowChanged) {
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

    if (
      selectedGenerationIndexesToScroll.length === 0 &&
      unselectedGenerationIndexesToReveal.length === 0
    ) {
      return;
    }

    selectedGenerationIndexesToScroll.forEach((generationIndex) => {
      handleScrollToSelected(generationIndex, {
        behavior: "auto",
      });
    });

    unselectedGenerationIndexesToReveal.forEach((generationIndex) => {
      scrollToCardIndex(generationIndex, 0, {
        alignment: "start",
        behavior: "auto",
      });
    });
  }, [
    handleScrollToSelected,
    placeholderRowIndex,
    renderTreeOverride,
    resolvedTree,
    scrollToCardIndex,
  ]);

  const handleCardSelect = useCallback((row: number, col: number) => {
    if (tree === null) {
      return;
    }

    const selectedRow = tree[row];
    if (!selectedRow || !selectedRow[col] || isDisabledNode(selectedRow[col])) {
      return;
    }
    const removedDescendantRows = tree.length > row + 1;
    const nextSelectionId = activeSelectionRef.current + 1;
    activeSelectionRef.current = nextSelectionId;

    const normalizedTree = tree
      .slice(0, row + 1)
      .map((generation, generationIndex) =>
        generation.map((node, colIndex) => ({
          ...node,
          selected:
            generationIndex === row ? colIndex === col : node.selected,
        })),
      );

    if (optimisticSelection && removedDescendantRows && tree[row + 1]) {
      const placeholderRow = tree[row + 1].map((node) => ({
        ...node,
        selected: false,
      }));
      const renderedTreeWithPlaceholder = [...normalizedTree, placeholderRow];
      setRenderTreeOverride(renderedTreeWithPlaceholder);
      setPlaceholderRowIndex(row + 1);
    } else {
      setRenderTreeOverride(null);
      setPlaceholderRowIndex(null);
    }

    const guardedSetTree = createGuardedSetTree(
      activeLifecycleRef.current,
      nextSelectionId,
    );

    schedulePostSelectionWork(() => {
      afterCardSelected({
        row,
        col,
        removedDescendantRows,
        tree: normalizedTree,
        setTree: guardedSetTree,
      });
    });
  }, [
    afterCardSelected,
    createGuardedSetTree,
    optimisticSelection,
    tree,
  ]);

  useLayoutEffect(() => {
    if (
      focusRequest === null ||
      renderTreeOverride !== null ||
      placeholderRowIndex !== null ||
      resolvedTree.length === 0
    ) {
      onFocusRequestMatchChange?.(false);
      return;
    }

    if (focusRequest.targetGeneration !== "youngest") {
      onFocusRequestMatchChange?.(false);
      return;
    }

    const generationIndex = resolvedTree.length - 1;
    const row = resolvedTree[generationIndex];
    const matchingIndex = row?.findIndex((node) => focusRequest.matchesNode(node)) ?? -1;
    const didMatch = matchingIndex >= 0;

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
    placeholderRowIndex,
    renderTreeOverride,
    resolvedTree,
    scrollToCardIndex,
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
      renderTreeOverride !== null ||
      placeholderRowIndex !== null ||
      resolvedTree.length === 0 ||
      activationRequest.targetGeneration !== "youngest"
    ) {
      onActivationHandled?.(activationRequest.requestKey, false);
      return;
    }

    const generationIndex = resolvedTree.length - 1;
    const row = resolvedTree[generationIndex];
    const matchingIndex = row?.findIndex((node) => activationRequest.matchesNode(node)) ?? -1;

    if (matchingIndex < 0) {
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
    placeholderRowIndex,
    renderTreeOverride,
    resolvedTree,
  ]);

  return (
    <section
      aria-busy={tree === null}
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
            ]
              .filter(Boolean)
              .join(" ")}
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
              ]
                .filter(Boolean)
                .join(" ")}
              ref={(element) => {
                rowRefs.current[generationIndex] = element;
              }}
            >
              {row.map((node, col) => (
                (() => {
                  const dataKey = getDataKey(node.data, col);
                  const refKey = `${generationIndex}:${dataKey}`;
                  const isPlaceholder =
                    isPlaceholderData(node.data) || generationIndex === placeholderRowIndex;

                  return (
                    <button
                      aria-disabled={isDisabledNode(node)}
                      aria-pressed={node.selected}
                      className={
                        [
                          "generator-card-button",
                          isPlaceholder ? "generator-card-button-placeholder" : "",
                          isDisabledNode(node) ? "generator-card-button-disabled" : "",
                          rowPresentation.cardButtonClassName ?? "",
                        ]
                          .filter(Boolean)
                          .join(" ")
                      }
                      disabled={isPlaceholder}
                      key={refKey}
                      onClick={() => handleCardSelect(generationIndex, col)}
                      ref={(element) => {
                        cardRefs.current[refKey] = element;
                      }}
                      tabIndex={isPlaceholder || isDisabledNode(node) ? -1 : undefined}
                      type="button"
                    >
                      {renderCard(generationIndex, col, resolvedTree)}
                    </button>
                  );
                })()
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

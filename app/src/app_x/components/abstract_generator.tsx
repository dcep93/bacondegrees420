import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  GeneratorController,
  GeneratorNode,
  GeneratorTree,
  GeneratorTreeState,
  SetGeneratorTree,
} from "../types/generator";
import { addCinenerdleDebugLog } from "../generators/cinenerdle2/debug";
import "../styles/abstract_generator.css";

export type AbstractGeneratorProps<T> = GeneratorController<T> & {
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

function getSelectedNodeSummary<T>(row: GeneratorNode<T>[] | undefined, generationIndex: number) {
  const selectedIndex = row?.findIndex((node) => node.selected) ?? -1;
  if (!row || selectedIndex < 0) {
    return {
      generationIndex,
      selectedIndex: -1,
      selectedKey: "",
    };
  }

  const selectedNode = row[selectedIndex];
  return {
    generationIndex,
    selectedIndex,
    selectedKey: getDataKey(selectedNode.data, selectedIndex),
  };
}

export function AbstractGenerator<T>({
  initTree,
  afterCardSelected,
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
    setRenderTreeOverride(null);
    setPlaceholderRowIndex(null);
    initTree(guardedSetTree);
  }, [createGuardedSetTree, initTree, resetKey]);

  const resolvedTree: GeneratorTree<T> = renderTreeOverride ?? tree ?? [];

  const generations = resolvedTree.map((row, generationIndex) => ({
    row,
    generationIndex,
  }));

  const renderedGenerations = [...generations].reverse();

  const handleScrollToSelected = useCallback((
    generationIndex: number,
    options?: {
      behavior?: ScrollBehavior;
      source?: "auto" | "manual";
    },
  ) => {
    const behavior = options?.behavior ?? "smooth";
    const source = options?.source ?? "manual";
    const selectedRow = resolvedTree[generationIndex];
    const selectedNode = selectedRow?.find((node) => node.selected) ?? null;

    if (!selectedRow || !selectedNode) {
      addCinenerdleDebugLog("generator.scrollToSelected.skipped", {
        generationIndex,
        source,
        reason: "missing-selected-row",
        rowLength: selectedRow?.length ?? 0,
      });
      return;
    }

    const selectedIndex = selectedRow.indexOf(selectedNode);
    const selectedKey = getDataKey(selectedNode.data, selectedIndex);
    const rowElement = rowRefs.current[generationIndex];
    const selectedCard = cardRefs.current[
      `${generationIndex}:${getDataKey(
        selectedNode.data,
        selectedIndex,
      )}`
    ];

    if (selectedCard && rowElement) {
      const maxScrollLeft = Math.max(0, rowElement.scrollWidth - rowElement.clientWidth);
      const centeredScrollLeft = Math.max(
        0,
        Math.min(
          selectedCard.offsetLeft - (rowElement.clientWidth - selectedCard.offsetWidth) / 2,
          maxScrollLeft,
        ),
      );

      addCinenerdleDebugLog("generator.scrollToSelected.card", {
        generationIndex,
        source,
        selectedIndex,
        selectedKey,
        rowScrollLeft: rowElement.scrollLeft,
        rowClientWidth: rowElement.clientWidth,
        rowScrollWidth: rowElement.scrollWidth,
        cardOffsetLeft: selectedCard.offsetLeft,
        cardOffsetWidth: selectedCard.offsetWidth,
        targetScrollLeft: Number(centeredScrollLeft.toFixed(2)),
      });

      rowElement.scrollTo({
        left: centeredScrollLeft,
        behavior,
      });
      return;
    }

    if (selectedCard) {
      addCinenerdleDebugLog("generator.scrollToSelected.cardFallback", {
        generationIndex,
        source,
        selectedIndex,
        selectedKey,
        reason: "missing-row-element",
      });
      selectedCard.scrollIntoView({
        behavior,
        block: "nearest",
        inline: "center",
      });
      return;
    }

    addCinenerdleDebugLog("generator.scrollToSelected.fallback", {
      generationIndex,
      source,
      selectedIndex,
      selectedKey,
      rowScrollWidth: rowElement?.scrollWidth ?? null,
    });
    rowElement?.scrollTo({
      left: 0,
      behavior,
    });
  }, [resolvedTree]);

  useLayoutEffect(() => {
    if (renderTreeOverride !== null || placeholderRowIndex !== null) {
      return;
    }

    const nextStableRowSignatures = resolvedTree.map((row) => getRowSignature(row));
    const previousStableRowSignatures = stableRowSignaturesRef.current;
    stableRowSignaturesRef.current = nextStableRowSignatures;
    const changedGenerationIndexes: number[] = [];
    const generationIndexesToScroll: number[] = [];

    for (let generationIndex = 0; generationIndex < resolvedTree.length; generationIndex += 1) {
      const row = resolvedTree[generationIndex];
      const hasSelection = row?.some((node) => node.selected) ?? false;
      const rowChanged =
        previousStableRowSignatures[generationIndex] !== nextStableRowSignatures[generationIndex];

      if (rowChanged) {
        changedGenerationIndexes.push(generationIndex);
      }

      if (hasSelection && rowChanged) {
        generationIndexesToScroll.push(generationIndex);
      }
    }

    if (changedGenerationIndexes.length > 0) {
      addCinenerdleDebugLog("generator.autoscroll.evaluate", {
        placeholderRowIndex,
        renderTreeOverrideActive: renderTreeOverride !== null,
        changedGenerationIndexes,
        chosenGenerationIndexes: generationIndexesToScroll,
        selectedRows: resolvedTree
          .map((row, generationIndex) => getSelectedNodeSummary(row, generationIndex))
          .filter((summary) => summary.selectedIndex >= 0),
      });
    }

    if (generationIndexesToScroll.length === 0) {
      return;
    }

    addCinenerdleDebugLog("generator.autoscroll.execute", {
      generationIndexesToScroll,
    });

    generationIndexesToScroll.forEach((generationIndex) => {
      handleScrollToSelected(generationIndex, {
        behavior: "auto",
        source: "auto",
      });
    });
  }, [handleScrollToSelected, placeholderRowIndex, renderTreeOverride, resolvedTree]);

  function handleCardSelect(row: number, col: number) {
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

    if (removedDescendantRows && tree[row + 1]) {
      const placeholderRow = tree[row + 1].map((node) => ({
        ...node,
        selected: false,
      }));
      addCinenerdleDebugLog("generator.placeholderRow.rendered", {
        row,
        col,
        placeholderRowIndex: row + 1,
        selectedKey: getDataKey(selectedRow[col].data, col),
      });
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
  }

  return (
    <section
      aria-busy={tree === null}
      aria-label="Generator"
      className="abstract-generator"
    >
      {renderedGenerations.map(({ row, generationIndex }) => {
        const selectedCol = row.findIndex((node) => node.selected);
        const hasSelection = selectedCol >= 0;

        return (
          <div className="generator-row" key={generationIndex}>
            <button
              className="generator-row-bubble"
              disabled={!hasSelection}
              onClick={() => handleScrollToSelected(generationIndex, {
                behavior: "smooth",
                source: "manual",
              })}
              type="button"
            >
              {`GEN ${generationIndex}`}
            </button>

            <div
              className="generator-row-track"
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

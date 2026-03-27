import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type {
  GeneratorController,
  GeneratorNode,
  GeneratorTree,
  GeneratorTreeState,
  SetGeneratorTree,
} from "../types/generator";
import { logCinenerdleDebug } from "../generators/cinenerdle2/debug";
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
          logCinenerdleDebug("abstractGenerator.setTree.ignored", {
            lifecycleId,
            activeLifecycleId: activeLifecycleRef.current,
            selectionId,
            activeSelectionId: activeSelectionRef.current,
          });
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
      const renderedTreeWithPlaceholder = [...normalizedTree, placeholderRow];
      setRenderTreeOverride(renderedTreeWithPlaceholder);
      setPlaceholderRowIndex(row + 1);
      logCinenerdleDebug("abstractGenerator.handleCardSelect.renderPlaceholderRow", {
        row,
        col,
        selectionId: nextSelectionId,
        originalRows: tree.length,
        renderedRows: renderedTreeWithPlaceholder.length,
        placeholderRowIndex: row + 1,
      });
    } else {
      setRenderTreeOverride(null);
      setPlaceholderRowIndex(null);
      logCinenerdleDebug("abstractGenerator.handleCardSelect.renderSelectionOnly", {
        row,
        col,
        selectionId: nextSelectionId,
        rows: normalizedTree.length,
      });
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

  function handleScrollToSelected(generationIndex: number) {
    const selectedRow = resolvedTree[generationIndex];
    const selectedNode = selectedRow?.find((node) => node.selected) ?? null;

    if (!selectedRow || !selectedNode) {
      return;
    }

    const selectedCard = cardRefs.current[
      `${generationIndex}:${getDataKey(
        selectedNode.data,
        selectedRow.indexOf(selectedNode),
      )}`
    ];

    if (selectedCard) {
      selectedCard.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
      return;
    }

    rowRefs.current[generationIndex]?.scrollTo({
      left: 0,
      behavior: "smooth",
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
              onClick={() => handleScrollToSelected(generationIndex)}
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

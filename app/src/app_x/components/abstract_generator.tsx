import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type {
  GeneratorController,
  GeneratorTree,
  GeneratorTreeState,
  SetGeneratorTree,
} from "../types/generator";
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

export function AbstractGenerator<T>({
  initTree,
  afterCardSelected,
  renderCard,
  resetKey,
}: AbstractGeneratorProps<T>) {
  const [tree, setTree] = useState<GeneratorTreeState<T>>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const mountedRef = useRef(true);
  const activeLifecycleRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const createGuardedSetTree = useCallback(
    (lifecycleId: number): SetGeneratorTree<T> =>
      (nextTree) => {
        if (
          !mountedRef.current ||
          activeLifecycleRef.current !== lifecycleId
        ) {
          return;
        }

        startTransition(() => {
          setTree((prevTree) => {
            if (
              !mountedRef.current ||
              activeLifecycleRef.current !== lifecycleId
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

    const guardedSetTree = createGuardedSetTree(lifecycleId);
    initTree(guardedSetTree);
  }, [createGuardedSetTree, initTree, resetKey]);

  const resolvedTree: GeneratorTree<T> = tree ?? [];

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
    if (!selectedRow || !selectedRow[col]) {
      return;
    }

    const normalizedTree = tree
      .slice(0, row + 1)
      .map((generation, generationIndex) =>
        generation.map((node, colIndex) => ({
          ...node,
          selected:
            generationIndex === row ? colIndex === col : node.selected,
        })),
      );

    const guardedSetTree = createGuardedSetTree(activeLifecycleRef.current);
    guardedSetTree(normalizedTree);

    schedulePostSelectionWork(() => {
      afterCardSelected({
        row,
        col,
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

                  return (
                    <button
                      aria-pressed={node.selected}
                      className="generator-card-button"
                      key={refKey}
                      onClick={() => handleCardSelect(generationIndex, col)}
                      ref={(element) => {
                        cardRefs.current[refKey] = element;
                      }}
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

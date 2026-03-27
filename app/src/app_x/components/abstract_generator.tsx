import { type ReactElement, useRef, useState } from "react";
import type { GeneratorNode } from "../types/generator";
import "../styles/abstract_generator.css";

export type AbstractGeneratorProps<T> = {
  initTree: () => GeneratorNode<T>[][];
  afterCardSelected: (
    row: number,
    col: number,
    prevTree: GeneratorNode<T>[][],
  ) => GeneratorNode<T>[][];
  renderCard: (
    row: number,
    col: number,
    tree: GeneratorNode<T>[][],
  ) => ReactElement;
};

export function AbstractGenerator<T>({
  initTree,
  afterCardSelected,
  renderCard,
}: AbstractGeneratorProps<T>) {
  const [tree, setTree] = useState(() => initTree());
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const generations = tree.map((row, generationIndex) => ({
    row,
    generationIndex,
  }));

  const renderedGenerations = [...generations].reverse();

  function handleCardSelect(row: number, col: number) {
    setTree((prevTree) => afterCardSelected(row, col, prevTree));
  }

  function handleScrollToSelected(generationIndex: number) {
    const selectedCol = tree[generationIndex]?.findIndex((node) => node.selected) ?? -1;

    if (selectedCol < 0) {
      return;
    }

    const selectedCard = cardRefs.current[`${generationIndex}:${selectedCol}`];

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
    <section className="abstract-generator" aria-label="Generator">
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
                <button
                  aria-pressed={node.selected}
                  className="generator-card-button"
                  key={`${generationIndex}:${col}:${String(node.data)}`}
                  onClick={() => handleCardSelect(generationIndex, col)}
                  ref={(element) => {
                    cardRefs.current[`${generationIndex}:${col}`] = element;
                  }}
                  type="button"
                >
                  {renderCard(generationIndex, col, tree)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

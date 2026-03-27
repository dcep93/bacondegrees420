import type { ReactElement } from "react";
import type { GeneratorNode } from "../types/generator";
import "../styles/number_generator.css";

type NumberGenerator = {
  initTree: () => GeneratorNode<number>[][];
  afterCardSelected: (
    row: number,
    col: number,
    prevTree: GeneratorNode<number>[][],
  ) => GeneratorNode<number>[][];
  renderCard: (
    row: number,
    col: number,
    tree: GeneratorNode<number>[][],
  ) => ReactElement;
};

function createChildRow(value: number): GeneratorNode<number>[] {
  const children: GeneratorNode<number>[] = [];

  for (let offset = -3; offset <= 3; offset += 1) {
    children.push({
      selected: false,
      data: value + offset,
    });
  }

  return children;
}

export function createNumberGenerator(seed: number): NumberGenerator {
  return {
    initTree: () => [[{ selected: false, data: seed }]],
    afterCardSelected: (row, col, prevTree) => {
      const nextTree = prevTree
        .slice(0, row + 1)
        .map((generation, generationIndex) =>
          generation.map((node, colIndex) => ({
            ...node,
            selected:
              generationIndex === row ? colIndex === col : node.selected,
          })),
        );

      const selectedValue = nextTree[row]?.[col]?.data;

      if (selectedValue === undefined) {
        return nextTree;
      }

      nextTree.push(createChildRow(selectedValue));
      return nextTree;
    },
    renderCard: (row, col, tree) => {
      const node = tree[row][col];

      return (
        <div
          className={
            node.selected
              ? "number-generator-card number-generator-card-selected"
              : "number-generator-card"
          }
        >
          <span className="number-generator-value">{node.data}</span>
        </div>
      );
    },
  };
}

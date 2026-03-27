import type { GeneratorController, GeneratorNode } from "../types/generator";
import "../styles/number_generator.css";

function createChildRow(value: number): GeneratorNode<number>[] {
  const children: GeneratorNode<number>[] = [];

  for (let offset = -10; offset <= 10; offset += 1) {
    children.push({
      selected: false,
      data: value + offset,
    });
  }

  return children;
}

export function readNumberGeneratorSeedFromHash(hash: string): number {
  const value = hash.replace(/^#/, "").trim();

  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createNumberGenerator(seed: number): GeneratorController<number> {
  return {
    initTree: (setTree) => {
      setTree([[{ selected: false, data: seed }]]);
    },
    afterCardSelected: ({ row, col, tree, setTree }) => {
      const selectedValue = tree[row]?.[col]?.data;

      if (selectedValue === undefined) {
        return;
      }

      setTree([...tree, createChildRow(selectedValue)]);
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

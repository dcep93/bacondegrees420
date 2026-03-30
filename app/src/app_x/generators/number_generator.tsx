import { createGeneratorState, reduceGeneratorLifecycleEvent } from "./generator_runtime";
import type { GeneratorController, GeneratorLifecycleEffect, GeneratorNode } from "../types/generator";
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

export function createNumberGenerator(
  seed: number,
): GeneratorController<number, { seed: number }, GeneratorLifecycleEffect<number>> {
  return {
    createInitialState: () => createGeneratorState({ seed }),
    reduce: reduceGeneratorLifecycleEvent,
    async runEffect(effect, { applyUpdate }) {
      if (effect.type === "load-initial-tree") {
        applyUpdate({
          tree: [[{ selected: false, data: seed }]],
        });
        return;
      }

      const selectedValue = effect.tree[effect.row]?.[effect.col]?.data;
      if (selectedValue === undefined) {
        return;
      }

      applyUpdate({
        tree: [...effect.tree, createChildRow(selectedValue)],
      });
    },
    renderCard({ node }) {
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

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AbstractGenerator } from "../components/abstract_generator";
import { createGeneratorState } from "../generators/generator_runtime";
import type {
  GeneratorCardRenderContext,
  GeneratorNode,
  GeneratorState,
  GeneratorTransition,
} from "../types/generator";

type TestCard = {
  key: string;
  label: string;
};

function makeNode(key: string, label: string): GeneratorNode<TestCard> {
  return {
    data: {
      key,
      label,
    },
    selected: false,
  };
}

function reduceTestEvent(
  state: GeneratorState<TestCard, undefined>,
): GeneratorTransition<TestCard, undefined, never> {
  return {
    effects: [],
    state,
  };
}

function renderTestCard({ node }: GeneratorCardRenderContext<TestCard, undefined>) {
  return <span>{node.data.label}</span>;
}

describe("AbstractGenerator", () => {
  it("renders generation rows from top to bottom and keeps the root track styling on generation 0", () => {
    const html = renderToStaticMarkup(
      <AbstractGenerator
        createInitialState={() => createGeneratorState(undefined, [
          [makeNode("root", "Root")],
          [makeNode("middle", "Middle")],
          [makeNode("leaf", "Leaf")],
        ])}
        reduce={reduceTestEvent}
        renderCard={renderTestCard}
        runEffect={async () => { }}
      />,
    );

    const gen0Index = html.indexOf("GEN 0");
    const gen1Index = html.indexOf("GEN 1");
    const gen2Index = html.indexOf("GEN 2");

    expect(gen0Index).toBeGreaterThanOrEqual(0);
    expect(gen1Index).toBeGreaterThan(gen0Index);
    expect(gen2Index).toBeGreaterThan(gen1Index);
    expect(html.slice(gen0Index, gen1Index)).toContain(
      "generator-row-track generator-row-track-root",
    );
  });
});

import { describe, expect, it } from "vitest";
import { getSortedGeneratorRowEntries } from "../abstract_generator_row_order";
import type { GeneratorCardRowOrderMetadata, GeneratorNode } from "../../types/generator";

type TestCard = {
  key: string;
  label: string;
};

function createNode(label: string): GeneratorNode<TestCard> {
  return {
    selected: false,
    data: {
      key: label.toLowerCase(),
      label,
    },
  };
}

function createMetadataMap(
  entries: Array<[string, GeneratorCardRowOrderMetadata]>,
): Map<string, GeneratorCardRowOrderMetadata> {
  return new Map(entries);
}

describe("getSortedGeneratorRowEntries", () => {
  it("sorts rows by active attrs, then passive attrs, then existing row order", () => {
    const row = [
      createNode("Alpha"),
      createNode("Beta"),
      createNode("Gamma"),
      createNode("Delta"),
    ];

    const sortedEntries = getSortedGeneratorRowEntries(
      row,
      createMetadataMap([
        ["alpha", { activeCount: 1, passiveCount: 3 }],
        ["beta", { activeCount: 2, passiveCount: 0 }],
        ["gamma", { activeCount: 2, passiveCount: 2 }],
        ["delta", { activeCount: 2, passiveCount: 2 }],
      ]),
    );

    expect(sortedEntries.map((entry) => entry.node.data.label)).toEqual([
      "Gamma",
      "Delta",
      "Beta",
      "Alpha",
    ]);
    expect(sortedEntries.map((entry) => entry.originalCol)).toEqual([2, 3, 1, 0]);
  });

  it("keeps the existing row order when cards have matching counts", () => {
    const row = [
      createNode("Alpha"),
      createNode("Beta"),
      createNode("Gamma"),
    ];

    const sortedEntries = getSortedGeneratorRowEntries(row);

    expect(sortedEntries.map((entry) => entry.node.data.label)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(sortedEntries.map((entry) => entry.originalCol)).toEqual([0, 1, 2]);
  });
});

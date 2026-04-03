import { describe, expect, it } from "vitest";
import { getSortedGeneratorRowEntries } from "../abstract_generator_row_order";
import {
  getGeneratorRowScrollLeft,
  getUnselectedRowScrollCardIndex,
} from "../abstract_generator_row_scroll";
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

describe("getGeneratorRowScrollLeft", () => {
  it("left-aligns the target card edge when start alignment is requested", () => {
    expect(getGeneratorRowScrollLeft({
      alignment: "start",
      maxScrollLeft: 800,
      targetLeft: 430,
      targetWidth: 184,
      trackPaddingLeft: 2,
      visibleAnchorX: 0,
    })).toBe(428);
  });

  it("aligns the target card center to the provided visible anchor", () => {
    expect(getGeneratorRowScrollLeft({
      alignment: "center",
      maxScrollLeft: 1200,
      targetLeft: 910,
      targetWidth: 184,
      trackPaddingLeft: 2,
      visibleAnchorX: 276,
    })).toBe(726);
  });

  it("clamps the computed scroll position into the scrollable range", () => {
    expect(getGeneratorRowScrollLeft({
      alignment: "start",
      maxScrollLeft: 300,
      targetLeft: 1,
      targetWidth: 184,
      trackPaddingLeft: 2,
      visibleAnchorX: 0,
    })).toBe(0);

    expect(getGeneratorRowScrollLeft({
      alignment: "center",
      maxScrollLeft: 300,
      targetLeft: 910,
      targetWidth: 184,
      trackPaddingLeft: 2,
      visibleAnchorX: 100,
    })).toBe(300);
  });
});

describe("getUnselectedRowScrollCardIndex", () => {
  it("uses the first rendered card when row order has been reprioritized", () => {
    expect(getUnselectedRowScrollCardIndex([5, 0, 2], 0)).toBe(5);
  });

  it("falls back to original column zero when no rendered order snapshot exists", () => {
    expect(getUnselectedRowScrollCardIndex([], 0)).toBe(0);
  });
});

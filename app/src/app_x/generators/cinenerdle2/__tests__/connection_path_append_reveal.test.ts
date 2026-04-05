import { describe, expect, it, vi } from "vitest";
import type { AbstractGeneratorHandle } from "../../../components/abstract_generator";
import type { GeneratorNode } from "../../../types/generator";
import type { ConnectionPathAppendRevealTarget } from "../connection_path_append_reveal";
import type { CinenerdleCard } from "../view_types";
import {
  getConnectionPathAppendRevealGenerationIndex,
  revealConnectionPathAppendTarget,
} from "../connection_path_append_reveal";

function createNode(
  key: string,
  options?: {
    kind?: "movie" | "person";
    name?: string;
    selected?: boolean;
    year?: string;
  },
): GeneratorNode<CinenerdleCard> {
  const kind = options?.kind ?? "movie";
  const baseCard = {
    key,
    name: options?.name ?? key,
    popularity: 0,
    popularitySource: null,
    imageUrl: null,
    subtitleDetail: "",
    connectionCount: null,
    sources: [] as Array<{ iconUrl: string; label: string }>,
    status: null,
  };

  if (kind === "movie") {
    return {
      selected: options?.selected ?? false,
      data: {
        ...baseCard,
        kind: "movie",
        year: options?.year ?? "2000",
        subtitle: options?.year ?? "2000",
        voteAverage: null,
        voteCount: null,
        record: null,
      },
    };
  }

  return {
    selected: options?.selected ?? false,
    data: {
      ...baseCard,
      kind: "person",
      subtitle: "",
      record: null,
    },
  };
}

function createRevealTarget(
  overrides: Partial<ConnectionPathAppendRevealTarget> = {},
): ConnectionPathAppendRevealTarget {
  return {
    key: "movie:spider-man:2002",
    kind: "movie",
    name: "Spider-Man",
    tmdbId: null,
    year: "2002",
    ...overrides,
  };
}

describe("getConnectionPathAppendRevealGenerationIndex", () => {
  it("reveals the child generation when the appended target gained children", () => {
    const tree = [
      [createNode("root", { selected: true })],
      [createNode("willem-dafoe", { selected: true })],
      [createNode("spider-man", { selected: true })],
      [createNode("child-of-spider-man")],
    ];

    expect(getConnectionPathAppendRevealGenerationIndex(
      tree,
      createRevealTarget({
        key: "spider-man",
        name: "spider-man",
        year: "2000",
      }),
    )).toBe(3);
  });

  it("falls back to the target generation when no child row was appended", () => {
    const tree = [
      [createNode("root", { selected: true })],
      [createNode("willem-dafoe", { selected: true })],
      [createNode("spider-man", { selected: true })],
    ];

    expect(getConnectionPathAppendRevealGenerationIndex(
      tree,
      createRevealTarget({
        key: "spider-man",
        name: "spider-man",
        year: "2000",
      }),
    )).toBe(2);
  });

  it("matches the selected row by semantic movie identity when the card key differs", () => {
    const tree = [
      [createNode("root", { name: "Root", selected: true })],
      [createNode("movie:299534", {
        name: "Ad Astra",
        selected: true,
        year: "2019",
      })],
      [createNode("child-of-ad-astra")],
    ];

    expect(getConnectionPathAppendRevealGenerationIndex(
      tree,
      createRevealTarget({
        key: "movie:ad astra:2019",
        name: "Ad Astra",
        tmdbId: null,
        year: "2019",
      }),
    )).toBe(2);
  });
});

describe("revealConnectionPathAppendTarget", () => {
  it("reveals the appended generation before aligning the tree like GEN 0", async () => {
    const callOrder: string[] = [];
    const generatorHandle: AbstractGeneratorHandle = {
      alignTreeLikeRootBubble: vi.fn(() => {
        callOrder.push("align");
      }),
      revealGeneration: vi.fn(async () => {
        callOrder.push("reveal");
      }),
      scrollToCard: vi.fn(),
      selectCard: vi.fn(),
    };

    await revealConnectionPathAppendTarget(generatorHandle, 3);

    expect(generatorHandle.revealGeneration).toHaveBeenCalledWith(3, {
      alignRowHorizontally: false,
    });
    expect(generatorHandle.alignTreeLikeRootBubble).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["reveal", "align"]);
  });
});

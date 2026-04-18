import { describe, expect, it } from "vitest";
import {
  appendConnectionEntityToHash,
  appendConnectionPathToHash,
  serializeConnectionEntityHash,
  serializeConnectionPathHash,
} from "../connection_hash";
import type { ConnectionEntity } from "../generators/cinenerdle2/connection_graph";

function makeConnectionEntity(
  overrides: Partial<ConnectionEntity> = {},
): ConnectionEntity {
  return {
    key: "movie:heat:1995",
    kind: "movie",
    name: "Heat",
    year: "1995",
    tmdbId: 949,
    label: "Heat (1995)",
    connectionCount: 12,
    hasCachedTmdbSource: true,
    imageUrl: null,
    popularity: 62.46,
    connectionRank: null,
    ...overrides,
  };
}

describe("connection hash helpers", () => {
  it("serializes a single entity as a root hash", () => {
    expect(serializeConnectionEntityHash(makeConnectionEntity())).toBe("#film|Heat+(1995)");
  });

  it("serializes a connection path from entity order", () => {
    expect(serializeConnectionPathHash([
      makeConnectionEntity(),
      makeConnectionEntity({
        key: "person:al-pacino",
        kind: "person",
        name: "Al Pacino",
        year: "",
        tmdbId: 1158,
        label: "Al Pacino",
      }),
    ])).toBe("#film|Heat+(1995)|Al+Pacino");
  });

  it("appends a connected suggestion to the current selected hash", () => {
    expect(appendConnectionEntityToHash(
      "#cinenerdle|Heat+(1995)",
      makeConnectionEntity({
        key: "person:al-pacino",
        kind: "person",
        name: "Al Pacino",
        year: "",
        tmdbId: 1158,
        label: "Al Pacino",
      }),
    )).toBe("#cinenerdle|Heat+(1995)|Al+Pacino");
  });

  it("appends a found bfs subpath onto the current tree hash", () => {
    const robinWilliams = makeConnectionEntity({
      key: "person:robin-williams",
      kind: "person",
      label: "Robin Williams",
      name: "Robin Williams",
      tmdbId: 53283,
      year: "",
    });
    const insomnia = makeConnectionEntity({
      key: "movie:insomnia:2002",
      label: "Insomnia (2002)",
      name: "Insomnia",
      tmdbId: 320,
      year: "2002",
    });

    expect(appendConnectionPathToHash(
      "#cinenerdle|Heat+(1995)",
      [insomnia, robinWilliams, makeConnectionEntity()],
      insomnia.key,
    )).toBe("#cinenerdle|Heat+(1995)|Robin+Williams|Insomnia+(2002)");

    expect(appendConnectionPathToHash(
      "#cinenerdle|Heat+(1995)",
      [insomnia, robinWilliams, makeConnectionEntity()],
      robinWilliams.key,
    )).toBe("#cinenerdle|Heat+(1995)|Robin+Williams");
  });

  it("dedupes overlapping bfs path segments that are already on the current tree hash", () => {
    const robinWilliams = makeConnectionEntity({
      key: "person:robin-williams",
      kind: "person",
      label: "Robin Williams",
      name: "Robin Williams",
      tmdbId: 53283,
      year: "",
    });
    const insomnia = makeConnectionEntity({
      key: "movie:insomnia:2002",
      label: "Insomnia (2002)",
      name: "Insomnia",
      tmdbId: 320,
      year: "2002",
    });

    expect(appendConnectionPathToHash(
      "#cinenerdle|Heat+(1995)|Robin+Williams",
      [insomnia, robinWilliams, makeConnectionEntity()],
      insomnia.key,
    )).toBe("#cinenerdle|Heat+(1995)|Robin+Williams|Insomnia+(2002)");
  });
});

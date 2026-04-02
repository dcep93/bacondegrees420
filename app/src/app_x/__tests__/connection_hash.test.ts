import { describe, expect, it } from "vitest";
import {
  appendConnectionEntityToHash,
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
});

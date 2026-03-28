import { describe, expect, it } from "vitest";
import { normalizeHashValue } from "./hash";

describe("normalizeHashValue", () => {
  it("canonicalizes movie-root hashes with whitespace and plus-delimited names", () => {
    expect(normalizeHashValue("#movie|  Heat   (1995) |  Al+Pacino  ")).toBe(
      "#film|Heat+(1995)|Al+Pacino",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  buildPathNodesFromSegments,
  createPathNode,
  getNextEntityKind,
  normalizeHashValue,
  parseHashSegments,
  serializePathNodes,
} from "../hash";

describe("createPathNode", () => {
  it("builds a cinenerdle root node with a canonical shape", () => {
    expect(createPathNode("cinenerdle", "ignored", "ignored")).toEqual({
      kind: "cinenerdle",
      name: "cinenerdle",
      year: "",
    });
  });

  it("normalizes person tmdb ids while keeping the original name", () => {
    expect(createPathNode("person", "Kenneth Collard", "", 123)).toEqual({
      kind: "person",
      name: "Kenneth Collard",
      year: "",
      tmdbId: 123,
    });
    expect(createPathNode("person", "Kenneth Collard", "", Number.NaN)).toEqual({
      kind: "person",
      name: "Kenneth Collard",
      year: "",
      tmdbId: null,
    });
  });

  it("builds movie and break nodes", () => {
    expect(createPathNode("movie", "Heat", "1995")).toEqual({
      kind: "movie",
      name: "Heat",
      year: "1995",
    });
    expect(createPathNode("break", "ignored", "ignored")).toEqual({
      kind: "break",
      name: "",
      year: "",
    });
  });
});

describe("getNextEntityKind", () => {
  it("alternates between movie and person, starting from cinenerdle as movie", () => {
    expect(getNextEntityKind("cinenerdle")).toBe("movie");
    expect(getNextEntityKind("movie")).toBe("person");
    expect(getNextEntityKind("person")).toBe("movie");
  });
});

describe("parseHashSegments", () => {
  it("returns an empty list for blank hashes", () => {
    expect(parseHashSegments("")).toEqual([]);
    expect(parseHashSegments("#")).toEqual([]);
  });

  it("decodes plus-delimited spaces, percent-encoding, and break segments", () => {
    expect(parseHashSegments("#film|Heat+(1995)|Al+Pacino%2FRobert+De+Niro||")).toEqual([
      "film",
      "Heat (1995)",
      "Al Pacino/Robert De Niro",
      "",
      "",
    ]);
  });

  it("trims surrounding whitespace around each segment", () => {
    expect(parseHashSegments("# film |  Heat+(1995)  |  Al+Pacino  ")).toEqual([
      "film",
      "Heat (1995)",
      "Al Pacino",
    ]);
  });
});

describe("buildPathNodesFromSegments", () => {
  it("returns an empty list for invalid or incomplete roots", () => {
    expect(buildPathNodesFromSegments(["unknown", "Heat (1995)"])).toEqual([]);
    expect(buildPathNodesFromSegments(["movie"])).toEqual([]);
  });

  it("builds a movie-root path for both movie and film roots", () => {
    expect(buildPathNodesFromSegments(["movie", "Heat (1995)", "Al Pacino"])).toEqual([
      createPathNode("movie", "Heat", "1995"),
      createPathNode("person", "Al Pacino"),
    ]);
    expect(buildPathNodesFromSegments(["film", "Heat (1995)", "Al Pacino"])).toEqual([
      createPathNode("movie", "Heat", "1995"),
      createPathNode("person", "Al Pacino"),
    ]);
  });

  it("builds a cinenerdle path with alternating entities and explicit breaks", () => {
    expect(
      buildPathNodesFromSegments([
        "cinenerdle",
        "Heat (1995)",
        "Al Pacino",
        "",
        "Kenneth Collard~~123",
      ]),
    ).toEqual([
      createPathNode("cinenerdle", "cinenerdle"),
      createPathNode("movie", "Heat", "1995"),
      createPathNode("person", "Al Pacino"),
      createPathNode("break"),
      createPathNode("person", "Kenneth Collard", "", 123),
    ]);
  });

  it("toggles the expected entity kind after consecutive breaks", () => {
    expect(
      buildPathNodesFromSegments([
        "cinenerdle",
        "Heat (1995)",
        "",
        "",
        "Collateral (2004)",
      ]),
    ).toEqual([
      createPathNode("cinenerdle", "cinenerdle"),
      createPathNode("movie", "Heat", "1995"),
      createPathNode("break"),
      createPathNode("break"),
      createPathNode("person", "Collateral (2004)"),
    ]);
  });

  it("parses person-root tmdb ids and keeps invalid suffixes as part of the name", () => {
    expect(
      buildPathNodesFromSegments(["person", "Kenneth Collard~~123", "Heat (1995)"]),
    ).toEqual([
      createPathNode("person", "Kenneth Collard", "", 123),
      createPathNode("movie", "Heat", "1995"),
    ]);

    expect(
      buildPathNodesFromSegments(["person", "Kenneth Collard~~abc", "Heat (1995)"]),
    ).toEqual([
      createPathNode("person", "Kenneth Collard~~abc"),
      createPathNode("movie", "Heat", "1995"),
    ]);
  });
});

describe("serializePathNodes", () => {
  it("returns an empty string for empty paths and break roots", () => {
    expect(serializePathNodes([])).toBe("");
    expect(serializePathNodes([createPathNode("break")])).toBe("");
  });

  it("serializes canonical movie and cinenerdle paths", () => {
    expect(
      serializePathNodes([
        createPathNode("movie", "Heat", "1995"),
        createPathNode("person", "Al Pacino"),
      ]),
    ).toBe("#film|Heat+(1995)|Al+Pacino");

    expect(
      serializePathNodes([
        createPathNode("cinenerdle", "cinenerdle"),
        createPathNode("movie", "Heat", "1995"),
        createPathNode("person", "Al Pacino"),
        createPathNode("break"),
        createPathNode("person", "Kenneth Collard", "", 123),
      ]),
    ).toBe("#cinenerdle|Heat+(1995)|Al+Pacino||Kenneth+Collard");
  });

  it("normalizes internal whitespace and percent-encodes special characters", () => {
    expect(
      serializePathNodes([
        createPathNode("person", "  Kenneth   Collard / Jr.  "),
        createPathNode("movie", "L.A. Confidential", "1997"),
      ]),
    ).toBe("#person|Kenneth+Collard+%2F+Jr.|L.A.+Confidential+(1997)");
  });

  it("keeps colons readable in canonical movie labels", () => {
    expect(
      serializePathNodes([
        createPathNode("cinenerdle", "cinenerdle"),
        createPathNode("movie", "Interstellar", "2014"),
        createPathNode("person", "Jessica Chastain"),
        createPathNode("movie", "Molly's Game", "2017"),
        createPathNode("person", "Idris Elba"),
        createPathNode("movie", "Avengers: Infinity War", "2018"),
      ]),
    ).toBe(
      "#cinenerdle|Interstellar+(2014)|Jessica+Chastain|Molly's+Game+(2017)|Idris+Elba|Avengers:+Infinity+War+(2018)",
    );
  });
});

describe("normalizeHashValue", () => {
  it("canonicalizes movie-root hashes with whitespace and plus-delimited names", () => {
    expect(normalizeHashValue("#movie|  Heat   (1995) |  Al+Pacino  ")).toBe(
      "#film|Heat+(1995)|Al+Pacino",
    );
  });

  it("canonicalizes person roots and strips embedded tmdb ids during serialization", () => {
    expect(normalizeHashValue("#person| Kenneth+Collard~~123 | Heat+(1995) ")).toBe(
      "#person|Kenneth+Collard|Heat+(1995)",
    );
  });

  it("round-trips canonical paths without ids", () => {
    const hashValue = "#cinenerdle|Heat+(1995)|Al+Pacino||Kenneth+Collard";

    expect(
      serializePathNodes(buildPathNodesFromSegments(parseHashSegments(hashValue))),
    ).toBe(hashValue);
  });

  it("canonicalizes encoded colons back to readable colons", () => {
    expect(
      normalizeHashValue(
        "#cinenerdle|Interstellar+(2014)|Jessica+Chastain|Molly's+Game+(2017)|Idris+Elba|Avengers%3A+Infinity+War+(2018)",
      ),
    ).toBe(
      "#cinenerdle|Interstellar+(2014)|Jessica+Chastain|Molly's+Game+(2017)|Idris+Elba|Avengers:+Infinity+War+(2018)",
    );
  });

  it("rewrites known skewed Star Wars movie titles to the TMDb title in cinenerdle hashes", () => {
    expect(
      normalizeHashValue(
        "#cinenerdle|Star+Wars:+Episode+IV+-+A+New+Hope+(1977)|Harrison+Ford|Star+Wars:+Episode+VI+-+Return+of+the+Jedi+(1983)|James+Earl+Jones|Star+Wars:+Episode+V+-+The+Empire+Strikes+Back+(1980)",
      ),
    ).toBe(
      "#cinenerdle|Star+Wars+(1977)|Harrison+Ford|Return+of+the+Jedi+(1983)|James+Earl+Jones|The+Empire+Strikes+Back+(1980)",
    );
  });
});

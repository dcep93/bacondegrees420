import { describe, expect, it } from "vitest";
import { resolveTreeChangeScrollSuppression } from "../components/abstract_generator_scroll";

describe("resolveTreeChangeScrollSuppression", () => {
  it("allows pending tree-change scroll work when no suppression key is provided", () => {
    expect(resolveTreeChangeScrollSuppression({
      activeSuppressTreeChangeScrollKey: null,
      hasPendingScrollWork: true,
      lastSeenSuppressTreeChangeScrollKey: null,
      suppressTreeChangeScrollKey: null,
    })).toEqual({
      nextActiveSuppressTreeChangeScrollKey: null,
      nextLastSeenSuppressTreeChangeScrollKey: null,
      shouldRunScrollWork: true,
    });
  });

  it("suppresses pending tree-change scroll work for a newly consumed suppression key", () => {
    expect(resolveTreeChangeScrollSuppression({
      activeSuppressTreeChangeScrollKey: null,
      hasPendingScrollWork: true,
      lastSeenSuppressTreeChangeScrollKey: null,
      suppressTreeChangeScrollKey: "explicit-fetch-1",
    })).toEqual({
      nextActiveSuppressTreeChangeScrollKey: "explicit-fetch-1",
      nextLastSeenSuppressTreeChangeScrollKey: "explicit-fetch-1",
      shouldRunScrollWork: false,
    });
  });

  it("keeps suppressing later redraws while the same refresh suppression key stays active", () => {
    expect(resolveTreeChangeScrollSuppression({
      activeSuppressTreeChangeScrollKey: "explicit-fetch-1",
      hasPendingScrollWork: true,
      lastSeenSuppressTreeChangeScrollKey: "explicit-fetch-1",
      suppressTreeChangeScrollKey: "explicit-fetch-1",
    })).toEqual({
      nextActiveSuppressTreeChangeScrollKey: "explicit-fetch-1",
      nextLastSeenSuppressTreeChangeScrollKey: "explicit-fetch-1",
      shouldRunScrollWork: false,
    });
  });

  it("allows tree-change scroll work again after the active suppression has been cleared", () => {
    expect(resolveTreeChangeScrollSuppression({
      activeSuppressTreeChangeScrollKey: null,
      hasPendingScrollWork: true,
      lastSeenSuppressTreeChangeScrollKey: "explicit-fetch-1",
      suppressTreeChangeScrollKey: "explicit-fetch-1",
    })).toEqual({
      nextActiveSuppressTreeChangeScrollKey: null,
      nextLastSeenSuppressTreeChangeScrollKey: "explicit-fetch-1",
      shouldRunScrollWork: true,
    });
  });
});

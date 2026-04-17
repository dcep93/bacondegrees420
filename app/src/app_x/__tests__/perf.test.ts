import { beforeEach, describe, expect, it } from "vitest";
import { getCinenerdleDebugEntries, clearCinenerdleDebugLog } from "../generators/cinenerdle2/debug_log";
import { logPerfSinceMark, markPerf, measureAsync, measureSync } from "../perf";

describe("perf clipboard logging", () => {
  beforeEach(() => {
    clearCinenerdleDebugLog();
  });

  it("does not mirror unrelated async work into the cinenerdle debug log", async () => {
    const result = await measureAsync(
      "unit-test.async",
      async () => "done",
      {
        always: true,
        details: {
          scope: "test",
        },
        summarizeResult: (value) => ({
          value,
        }),
      },
    );

    expect(result).toBe("done");
    expect(getCinenerdleDebugEntries()).toEqual([]);
  });

  it("does not mirror unrelated sync failures into the cinenerdle debug log", () => {
    expect(() =>
      measureSync(
        "unit-test.sync-error",
        () => {
          throw new Error("boom");
        },
      )).toThrow("boom");

    expect(getCinenerdleDebugEntries()).toEqual([]);
  });

  it("does not mirror tracked startup perf into the cinenerdle debug log by default", async () => {
    await measureAsync(
      "idb.openIndexedDb",
      async () => "done",
      {
        always: true,
        details: {
          databaseName: "cinenerdle2",
        },
        summarizeResult: (value) => ({
          value,
        }),
      },
    );

    expect(getCinenerdleDebugEntries()).toEqual([]);
  });

  it("does not mirror tracked elapsed-time mark entries to the cinenerdle debug log by default", () => {
    markPerf("unit-test-mark");
    logPerfSinceMark("controller.initTree", "unit-test-mark", {
      scope: "mark",
    });

    expect(getCinenerdleDebugEntries()).toEqual([]);
  });
});

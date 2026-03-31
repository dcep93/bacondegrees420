import { beforeEach, describe, expect, it } from "vitest";
import { getCinenerdleDebugEntries, clearCinenerdleDebugLog } from "../generators/cinenerdle2/debug_log";
import { logPerfSinceMark, markPerf, measureAsync, measureSync } from "../perf";

describe("perf clipboard logging", () => {
  beforeEach(() => {
    clearCinenerdleDebugLog();
  });

  it("does not add measured async work to the cinenerdle debug log after a log reset", async () => {
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

  it("does not add measured sync failures to the cinenerdle debug log after a log reset", () => {
    expect(() =>
      measureSync(
        "unit-test.sync-error",
        () => {
          throw new Error("boom");
        },
      )).toThrow("boom");

    expect(getCinenerdleDebugEntries()).toEqual([]);
  });

  it("does not add elapsed-time mark entries to the cinenerdle debug log after a log reset", () => {
    markPerf("unit-test-mark");
    logPerfSinceMark("unit-test.since-mark", "unit-test-mark", {
      scope: "mark",
    });

    expect(getCinenerdleDebugEntries()).toEqual([]);
  });
});

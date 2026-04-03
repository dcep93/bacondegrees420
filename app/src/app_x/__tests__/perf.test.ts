import { beforeEach, describe, expect, it } from "vitest";
import { getCinenerdleDebugEntries, clearCinenerdleDebugLog } from "../generators/cinenerdle2/debug_log";
import { logPerfSinceMark, markPerf, measureAsync, measureSync } from "../perf";

describe("perf clipboard logging", () => {
  beforeEach(() => {
    clearCinenerdleDebugLog();
  });

  it("adds measured async work to the cinenerdle debug log", async () => {
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
    expect(getCinenerdleDebugEntries()).toEqual([
      expect.objectContaining({
        event: "perf:unit-test.async",
        details: {
          elapsedMs: expect.any(Number),
          scope: "test",
          status: "ok",
          value: "done",
        },
      }),
    ]);
  });

  it("adds measured sync failures to the cinenerdle debug log", () => {
    expect(() =>
      measureSync(
        "unit-test.sync-error",
        () => {
          throw new Error("boom");
        },
      )).toThrow("boom");

    expect(getCinenerdleDebugEntries()).toEqual([
      expect.objectContaining({
        event: "perf:unit-test.sync-error",
        details: {
          elapsedMs: expect.any(Number),
          errorMessage: "boom",
          status: "error",
        },
      }),
    ]);
  });

  it("adds elapsed-time mark entries to the cinenerdle debug log", () => {
    markPerf("unit-test-mark");
    logPerfSinceMark("unit-test.since-mark", "unit-test-mark", {
      scope: "mark",
    });

    expect(getCinenerdleDebugEntries()).toEqual([
      expect.objectContaining({
        event: "perf:unit-test.since-mark",
        details: {
          elapsedMs: expect.any(Number),
          markName: "unit-test-mark",
          scope: "mark",
        },
      }),
    ]);
  });
});

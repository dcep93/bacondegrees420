import { beforeEach, describe, expect, it } from "vitest";
import { getCinenerdleDebugEntries, clearCinenerdleDebugLog } from "../generators/cinenerdle2/debug_log";
import { logPerfSinceMark, markPerf, measureAsync, measureSync } from "../perf";

describe("perf clipboard logging", () => {
  beforeEach(() => {
    clearCinenerdleDebugLog();
  });

  it("logs measured async work to the cinenerdle debug log", async () => {
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
        details: expect.objectContaining({
          scope: "test",
          status: "ok",
          value: "done",
        }),
      }),
    ]);
  });

  it("logs measured sync failures to the cinenerdle debug log", () => {
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
        details: expect.objectContaining({
          errorMessage: "boom",
          status: "error",
        }),
      }),
    ]);
  });

  it("logs elapsed time from perf marks", () => {
    markPerf("unit-test-mark");
    logPerfSinceMark("unit-test.since-mark", "unit-test-mark", {
      scope: "mark",
    });

    expect(getCinenerdleDebugEntries()).toEqual([
      expect.objectContaining({
        event: "perf:unit-test.since-mark",
        details: expect.objectContaining({
          markName: "unit-test-mark",
          scope: "mark",
        }),
      }),
    ]);
  });
});

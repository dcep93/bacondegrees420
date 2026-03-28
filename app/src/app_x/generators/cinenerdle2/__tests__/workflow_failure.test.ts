import { describe, expect, it } from "vitest";

describe("workflow test execution sentinel", () => {
  it("fails intentionally so CI proves it is running the test suite", () => {
    expect("GitHub Actions should report this failure").toBe("This test is expected to fail");
  });
});

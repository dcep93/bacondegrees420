import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("window", { alert: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("alerts once per message but logs and throws on every occurrence", async () => {
  const { throwCinenerdleValidationError } = await import("../validation");
  const firstDetails = { tmdbId: 1297467, attempt: 1 };
  const nextDetails = { tmdbId: 1297467, attempt: 2 };

  expect(() => throwCinenerdleValidationError("Film error", firstDetails)).toThrow("Film error");
  expect(() => throwCinenerdleValidationError("Different error")).toThrow("Different error");
  expect(() => throwCinenerdleValidationError("Film error", nextDetails)).toThrow("Film error");
  expect(() => throwCinenerdleValidationError("Different error")).toThrow("Different error");

  expect(window.alert).toHaveBeenCalledTimes(2);
  expect(window.alert).toHaveBeenNthCalledWith(1, "Film error");
  expect(window.alert).toHaveBeenNthCalledWith(2, "Different error");
  expect(console.error).toHaveBeenCalledTimes(4);
  expect(console.error).toHaveBeenNthCalledWith(1, "Film error", firstDetails);
  expect(console.error).toHaveBeenNthCalledWith(2, "Different error");
  expect(console.error).toHaveBeenNthCalledWith(3, "Film error", nextDetails);
  expect(console.error).toHaveBeenNthCalledWith(4, "Different error");
});

it("allows the same message to alert again in a new runtime", async () => {
  const firstRuntime = await import("../validation");
  expect(() => firstRuntime.throwCinenerdleValidationError("Film error")).toThrow("Film error");

  vi.resetModules();
  const nextRuntime = await import("../validation");
  expect(() => nextRuntime.throwCinenerdleValidationError("Film error")).toThrow("Film error");

  expect(window.alert).toHaveBeenCalledTimes(2);
  expect(console.error).toHaveBeenCalledTimes(2);
});

it("still logs and throws when no browser window is available", async () => {
  vi.stubGlobal("window", undefined);
  const { throwCinenerdleValidationError } = await import("../validation");

  expect(() => throwCinenerdleValidationError("Film error")).toThrow("Film error");
  expect(() => throwCinenerdleValidationError("Film error")).toThrow("Film error");
  expect(console.error).toHaveBeenCalledTimes(2);
});

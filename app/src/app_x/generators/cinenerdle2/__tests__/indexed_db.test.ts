import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

type MockDeleteRequest = {
  error: Error | null;
  onblocked: null | (() => void);
  onerror: null | (() => void);
  onsuccess: null | (() => void);
};

function setMockWindow() {
  const getItem = vi.fn().mockReturnValue(null);
  const removeItem = vi.fn();
  const setItem = vi.fn();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem,
        removeItem,
        setItem,
      },
    },
  });

  return {
    getItem,
    removeItem,
    setItem,
  };
}

function createDeleteRequest(
  outcome: "success" | "error" | "blocked",
  errorMessage = "Unable to delete IndexedDB",
): MockDeleteRequest {
  const request: MockDeleteRequest = {
    error: outcome === "error" ? new Error(errorMessage) : null,
    onblocked: null,
    onerror: null,
    onsuccess: null,
  };

  queueMicrotask(() => {
    if (outcome === "success") {
      request.onsuccess?.();
      return;
    }

    if (outcome === "blocked") {
      request.onblocked?.();
      return;
    }

    request.onerror?.();
  });

  return request;
}

describe("deleteCinenerdleIndexedDbDatabase", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalIndexedDbDescriptor) {
      Object.defineProperty(globalThis, "indexedDB", originalIndexedDbDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }

    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("deletes the whole IndexedDB database and clears the ready marker", async () => {
    const deleteDatabase = vi.fn().mockImplementation(() => createDeleteRequest("success"));
    const { removeItem } = setMockWindow();

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        deleteDatabase,
      },
    });

    const { deleteCinenerdleIndexedDbDatabase } = await import("../indexed_db");

    await expect(deleteCinenerdleIndexedDbDatabase()).resolves.toBeUndefined();

    expect(deleteDatabase).toHaveBeenCalledTimes(1);
    expect(removeItem).toHaveBeenCalledWith(
      "cinenerdle:searchable-connection-entities-ready",
    );
  });

  it("surfaces blocked deletions with a user-actionable message", async () => {
    const deleteDatabase = vi.fn().mockImplementation(() => createDeleteRequest("blocked"));

    setMockWindow();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        deleteDatabase,
      },
    });

    const { deleteCinenerdleIndexedDbDatabase } = await import("../indexed_db");

    await expect(deleteCinenerdleIndexedDbDatabase()).rejects.toThrow(
      "IndexedDB deletion blocked. Close other tabs and try again.",
    );
  });

  it("surfaces delete errors from IndexedDB", async () => {
    const deleteDatabase = vi.fn().mockImplementation(() =>
      createDeleteRequest("error", "Delete failed"),
    );

    setMockWindow();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        deleteDatabase,
      },
    });

    const { deleteCinenerdleIndexedDbDatabase } = await import("../indexed_db");

    await expect(deleteCinenerdleIndexedDbDatabase()).rejects.toThrow("Delete failed");
  });
});

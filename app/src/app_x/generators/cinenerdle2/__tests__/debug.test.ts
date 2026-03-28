import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const indexedDbMock = vi.hoisted(() => ({
  getIndexedDbSnapshot: vi.fn(),
}));

vi.mock("../indexed_db", () => indexedDbMock);

import { copyCinenerdleIndexedDbSnapshotToClipboard } from "../debug";

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

type MockTextarea = {
  value: string;
  style: Record<string, string>;
  setAttribute: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
};

function setMockDocument({ execCommandResult = true } = {}) {
  const textarea: MockTextarea = {
    value: "",
    style: {},
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
  };
  const appendChild = vi.fn();
  const removeChild = vi.fn();
  const execCommand = vi.fn().mockReturnValue(execCommandResult);

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body: {
        appendChild,
        removeChild,
      },
      createElement: vi.fn().mockReturnValue(textarea),
      execCommand,
    },
  });

  return {
    textarea,
    appendChild,
    removeChild,
    execCommand,
  };
}

describe("copyCinenerdleIndexedDbSnapshotToClipboard", () => {
  beforeEach(() => {
    indexedDbMock.getIndexedDbSnapshot.mockReset();
  });

  afterEach(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }

    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, "document");
  });

  it("copies the formatted IndexedDB snapshot to the clipboard and returns record counts", async () => {
    const snapshot = {
      people: [{ id: 1 }, { id: 2 }],
      films: [{ id: "heat (1995)" }],
      searchableConnectionEntities: [{ key: "person:1" }, { key: "movie:heat:1995" }],
    };
    const writeText = vi.fn().mockResolvedValue(undefined);

    indexedDbMock.getIndexedDbSnapshot.mockResolvedValue(snapshot);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });

    await expect(copyCinenerdleIndexedDbSnapshotToClipboard()).resolves.toEqual({
      peopleCount: 2,
      filmCount: 1,
      searchableConnectionEntityCount: 2,
    });
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(snapshot, null, 2));
  });

  it("throws when the Clipboard API is unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });

    await expect(copyCinenerdleIndexedDbSnapshotToClipboard()).rejects.toThrow(
      "Clipboard API is unavailable.",
    );
    expect(indexedDbMock.getIndexedDbSnapshot).not.toHaveBeenCalled();
  });

  it("falls back to DOM copy when the Clipboard API rejects", async () => {
    const snapshot = {
      people: [{ id: 1 }],
      films: [{ id: "heat (1995)" }],
      searchableConnectionEntities: [],
    };
    const writeText = vi.fn().mockRejectedValue(new Error("Document is not focused."));
    const { textarea, appendChild, removeChild, execCommand } = setMockDocument();

    indexedDbMock.getIndexedDbSnapshot.mockResolvedValue(snapshot);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });

    await expect(copyCinenerdleIndexedDbSnapshotToClipboard()).resolves.toEqual({
      peopleCount: 1,
      filmCount: 1,
      searchableConnectionEntityCount: 0,
    });
    expect(textarea.value).toBe(JSON.stringify(snapshot, null, 2));
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(textarea.focus).toHaveBeenCalled();
    expect(textarea.select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(removeChild).toHaveBeenCalledWith(textarea);
  });
});

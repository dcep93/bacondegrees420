import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const indexedDbMock = vi.hoisted(() => ({
  getIndexedDbSnapshot: vi.fn(),
  getSearchableConnectionEntityPersistenceReadyMarkerValue: vi.fn(),
  getSearchableConnectionEntityPersistenceStatus: vi.fn(),
  inflateIndexedDbSnapshot: vi.fn(),
  stringifyIndexedDbSnapshot: vi.fn(),
}));

const bootstrapMock = vi.hoisted(() => ({
  getCinenerdleIndexedDbBootstrapStatus: vi.fn(),
}));

vi.mock("../indexed_db", () => indexedDbMock);
vi.mock("../bootstrap", () => bootstrapMock);

import {
  addCinenerdleDebugLog,
  clearCinenerdleDebugLog,
  copyCinenerdleBootstrapDebugLogToClipboard,
  copyCinenerdleIndexedDbSnapshotToClipboard,
  copyCinenerdlePerfDebugLogToClipboard,
  copyCinenerdleRecoveryDebugLogToClipboard,
  copyCinenerdleSearchablePersistenceDebugLogToClipboard,
  copyCinenerdleTextToClipboard,
  getCinenerdleDebugEntryCount,
  getCinenerdleDebugLogText,
  startCinenerdleClipboardPageOpenLogging,
} from "../debug";

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

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
    indexedDbMock.getSearchableConnectionEntityPersistenceReadyMarkerValue.mockReset();
    indexedDbMock.getSearchableConnectionEntityPersistenceStatus.mockReset();
    indexedDbMock.inflateIndexedDbSnapshot.mockReset();
    indexedDbMock.stringifyIndexedDbSnapshot.mockReset();
    bootstrapMock.getCinenerdleIndexedDbBootstrapStatus.mockReset();
    indexedDbMock.inflateIndexedDbSnapshot.mockImplementation((snapshot: unknown) => snapshot);
    indexedDbMock.stringifyIndexedDbSnapshot.mockImplementation((snapshot: unknown) =>
      JSON.stringify(snapshot, null, 2),
    );
    indexedDbMock.getSearchableConnectionEntityPersistenceReadyMarkerValue.mockReturnValue(null);
    indexedDbMock.getSearchableConnectionEntityPersistenceStatus.mockReturnValue({
      isPending: false,
      phase: "idle",
    });
    bootstrapMock.getCinenerdleIndexedDbBootstrapStatus.mockReturnValue({
      isCoreReady: true,
      isSearchablePersistencePending: false,
      phase: "idle",
      resetRequiredMessage: null,
    });
    clearCinenerdleDebugLog();
  });

  afterEach(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }

    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }

    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, "window");
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
    expect(indexedDbMock.inflateIndexedDbSnapshot).toHaveBeenCalledWith(snapshot);
    expect(indexedDbMock.stringifyIndexedDbSnapshot).toHaveBeenCalledWith(snapshot);
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
    expect(indexedDbMock.inflateIndexedDbSnapshot).toHaveBeenCalledWith(snapshot);
    expect(indexedDbMock.stringifyIndexedDbSnapshot).toHaveBeenCalledWith(snapshot);
    expect(textarea.value).toBe(JSON.stringify(snapshot, null, 2));
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(textarea.focus).toHaveBeenCalled();
    expect(textarea.select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(removeChild).toHaveBeenCalledWith(textarea);
  });

  it("copies snapshots with ambiguous unicode characters escaped in the JSON text", async () => {
    const snapshot = {
      people: [{ id: 1, name: "A\u200BB" }],
      films: [{ id: "movie", title: "Heat\u202E" }],
      searchableConnectionEntities: [],
    };
    const writeText = vi.fn().mockResolvedValue(undefined);

    indexedDbMock.getIndexedDbSnapshot.mockResolvedValue(snapshot);
    indexedDbMock.stringifyIndexedDbSnapshot.mockReturnValue(`{
  "people": [
    {
      "id": 1,
      "name": "A\\u200bB"
    }
  ],
  "films": [
    {
      "id": "movie",
      "title": "Heat\\u202e"
    }
  ],
  "searchableConnectionEntities": []
}`);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });

    await copyCinenerdleIndexedDbSnapshotToClipboard();

    expect(writeText).toHaveBeenCalledWith(`{
  "people": [
    {
      "id": 1,
      "name": "A\\u200bB"
    }
  ],
  "films": [
    {
      "id": "movie",
      "title": "Heat\\u202e"
    }
  ],
  "searchableConnectionEntities": []
}`);
  });
});

describe("addCinenerdleDebugLog", () => {
  beforeEach(() => {
    clearCinenerdleDebugLog();
  });

  it("is defined and records debug entries that can be read back", () => {
    expect(typeof addCinenerdleDebugLog).toBe("function");
    expect(getCinenerdleDebugEntryCount()).toBe(0);

    addCinenerdleDebugLog("unit-test:event", {
      count: 1,
      nested: {
        ok: true,
      },
    });

    expect(getCinenerdleDebugEntryCount()).toBe(1);
    expect(JSON.parse(getCinenerdleDebugLogText())).toEqual([
      expect.objectContaining({
        event: "unit-test:event",
        details: {
          count: 1,
          nested: {
            ok: true,
          },
        },
      }),
    ]);
  });

  it("copies text without recording a debug entry", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });

    await copyCinenerdleTextToClipboard("{\"kind\":\"movie\"}");

    expect(writeText).toHaveBeenCalledWith("{\"kind\":\"movie\"}");
    expect(getCinenerdleDebugEntryCount()).toBe(0);
  });

  it("surfaces clipboard copy failures without recording a debug entry", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Document is not focused."));

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });

    await expect(copyCinenerdleTextToClipboard("{\"kind\":\"movie\"}")).rejects.toThrow(
      "Clipboard copy failed. Focus this tab and try again.",
    );
    expect(getCinenerdleDebugEntryCount()).toBe(0);
  });

  it("accepts clipboard logging options without recording a debug entry", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });

    await copyCinenerdleTextToClipboard(
      "{\"kind\":\"movie\"}",
      {
        event: "clipboard:test-copy",
        details: {
          recordKind: "movie",
          name: "Heat",
        },
        includeCopiedTextInDebugLog: false,
      },
    );

    expect(writeText).toHaveBeenCalledWith("{\"kind\":\"movie\"}");
    expect(getCinenerdleDebugEntryCount()).toBe(0);
  });

  it("appends clipboard heartbeat entries every second while the page is open", async () => {
    vi.useFakeTimers();

    const stopLogging = startCinenerdleClipboardPageOpenLogging({
      clearInterval,
      setInterval,
    });

    expect(getCinenerdleDebugEntryCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(2100);

    expect(JSON.parse(getCinenerdleDebugLogText())).toEqual([
      expect.objectContaining({
        event: "clipboard:page-open-heartbeat",
        details: {
          secondsOpen: 1,
        },
      }),
      expect.objectContaining({
        event: "clipboard:page-open-heartbeat",
        details: {
          secondsOpen: 2,
        },
      }),
    ]);

    stopLogging();
    await vi.advanceTimersByTimeAsync(1500);

    expect(getCinenerdleDebugEntryCount()).toBe(2);
    vi.useRealTimers();
  });

  it("copies only bootstrap debug entries to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });

    addCinenerdleDebugLog("bootstrap:start", { snapshotUrl: "/dump.json" });
    addCinenerdleDebugLog("other:event", { ok: true });
    addCinenerdleDebugLog("bootstrap:complete", { elapsedMs: 123.45 });

    await expect(copyCinenerdleBootstrapDebugLogToClipboard()).resolves.toBe(2);

    expect(JSON.parse(writeText.mock.calls[0]?.[0] ?? "[]")).toEqual([
      expect.objectContaining({
        event: "bootstrap:start",
        details: {
          snapshotUrl: "/dump.json",
        },
      }),
      expect.objectContaining({
        event: "bootstrap:complete",
        details: {
          elapsedMs: 123.45,
        },
      }),
    ]);
    expect(JSON.parse(getCinenerdleDebugLogText())).toEqual([
      expect.objectContaining({
        event: "other:event",
        details: {
          ok: true,
        },
      }),
    ]);
  });

  it("copies only searchable persistence debug entries to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });

    addCinenerdleDebugLog("searchable-persist:start", { recordCount: 10 });
    addCinenerdleDebugLog("bootstrap:start", { snapshotUrl: "/dump.json" });
    addCinenerdleDebugLog("searchable-persist:complete", { transactionElapsedMs: 42 });

    await expect(copyCinenerdleSearchablePersistenceDebugLogToClipboard()).resolves.toBe(2);

    expect(JSON.parse(writeText.mock.calls[0]?.[0] ?? "[]")).toEqual([
      expect.objectContaining({
        event: "searchable-persist:start",
        details: {
          recordCount: 10,
        },
      }),
      expect.objectContaining({
        event: "searchable-persist:complete",
        details: {
          transactionElapsedMs: 42,
        },
      }),
    ]);
    expect(JSON.parse(getCinenerdleDebugLogText())).toEqual([
      expect.objectContaining({
        event: "bootstrap:start",
        details: {
          snapshotUrl: "/dump.json",
        },
      }),
    ]);
  });

  it("copies only perf debug entries to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });

    addCinenerdleDebugLog("perf:controller.buildTreeFromHash", {
      elapsedMs: 98.12,
      status: "ok",
    });
    addCinenerdleDebugLog("bootstrap:start", { snapshotUrl: "/dump.json" });
    addCinenerdleDebugLog("perf:app.connectionAutocomplete", {
      elapsedMs: 54.33,
      status: "ok",
    });

    await expect(copyCinenerdlePerfDebugLogToClipboard()).resolves.toBe(2);

    expect(JSON.parse(writeText.mock.calls[0]?.[0] ?? "[]")).toEqual([
      expect.objectContaining({
        event: "perf:controller.buildTreeFromHash",
        details: {
          elapsedMs: 98.12,
          status: "ok",
        },
      }),
      expect.objectContaining({
        event: "perf:app.connectionAutocomplete",
        details: {
          elapsedMs: 54.33,
          status: "ok",
        },
      }),
    ]);
    expect(JSON.parse(getCinenerdleDebugLogText())).toEqual([
      expect.objectContaining({
        event: "bootstrap:start",
        details: {
          snapshotUrl: "/dump.json",
        },
      }),
    ]);
  });

  it("copies recovery state with bootstrap and reset entries to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "http://localhost:5173/#/heat",
          pathname: "/",
          hash: "#/heat",
        },
      },
    });

    bootstrapMock.getCinenerdleIndexedDbBootstrapStatus.mockReturnValue({
      isCoreReady: false,
      isSearchablePersistencePending: false,
      phase: "reset-required",
      resetRequiredMessage: "Clear DB and refresh.",
    });
    indexedDbMock.getSearchableConnectionEntityPersistenceStatus.mockReturnValue({
      isPending: false,
      phase: "idle",
    });
    indexedDbMock.getSearchableConnectionEntityPersistenceReadyMarkerValue.mockReturnValue("0");

    addCinenerdleDebugLog("bootstrap:start", { hasCachedRecords: true });
    addCinenerdleDebugLog("idb-reset:complete", { mode: "delete-database" });
    addCinenerdleDebugLog("other:event", { ignored: true });

    await expect(copyCinenerdleRecoveryDebugLogToClipboard()).resolves.toBe(2);

    expect(JSON.parse(writeText.mock.calls[0]?.[0] ?? "{}")).toEqual(
      expect.objectContaining({
        bootstrapStatus: {
          isCoreReady: false,
          isSearchablePersistencePending: false,
          phase: "reset-required",
          resetRequiredMessage: "Clear DB and refresh.",
        },
        searchablePersistenceStatus: {
          isPending: false,
          phase: "idle",
        },
        searchablePersistenceReadyMarker: "0",
        location: {
          href: "http://localhost:5173/#/heat",
          pathname: "/",
          hash: "#/heat",
        },
        entries: [
          expect.objectContaining({
            event: "bootstrap:start",
          }),
          expect.objectContaining({
            event: "idb-reset:complete",
          }),
        ],
      }),
    );
    expect(JSON.parse(getCinenerdleDebugLogText())).toEqual([
      expect.objectContaining({
        event: "other:event",
      }),
    ]);
  });
});

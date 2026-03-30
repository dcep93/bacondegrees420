import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const indexedDbMock = vi.hoisted(() => ({
  deleteCinenerdleIndexedDbDatabase: vi.fn(),
  getSearchableConnectionEntityPersistenceStatus: vi.fn(),
  hasCinenerdleIndexedDbRecords: vi.fn(),
  importIndexedDbSnapshot: vi.fn(),
  prepareSearchableConnectionEntitiesForStartup: vi.fn(),
  subscribeSearchableConnectionEntityPersistenceEvents: vi.fn(),
  subscribeSearchableConnectionEntityPersistenceStatus: vi.fn(),
}));

vi.mock("../indexed_db", async () => {
  const actual = await vi.importActual("../indexed_db");
  return {
    ...actual,
    ...indexedDbMock,
  };
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

type BootstrapStatus = {
  isCoreReady: boolean;
  isSearchablePersistencePending: boolean;
  phase: string;
  resetRequiredMessage: string | null;
};

const TEST_INDEXED_DB_SNAPSHOT = {
  format: "cinenerdle-indexed-db-snapshot",
  version: 9,
  people: [],
  films: [],
} as const;

function createBootstrapSnapshotResponse(): Response {
  return new Response(JSON.stringify(TEST_INDEXED_DB_SNAPSHOT), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  });
}

describe("startCinenerdleIndexedDbBootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    indexedDbMock.getSearchableConnectionEntityPersistenceStatus.mockReset();
    indexedDbMock.deleteCinenerdleIndexedDbDatabase.mockReset();
    indexedDbMock.hasCinenerdleIndexedDbRecords.mockReset();
    indexedDbMock.importIndexedDbSnapshot.mockReset();
    indexedDbMock.prepareSearchableConnectionEntitiesForStartup.mockReset();
    indexedDbMock.subscribeSearchableConnectionEntityPersistenceEvents.mockReset();
    indexedDbMock.subscribeSearchableConnectionEntityPersistenceStatus.mockReset();
    indexedDbMock.getSearchableConnectionEntityPersistenceStatus.mockReturnValue({
      isPending: false,
      phase: "idle",
    });
    indexedDbMock.deleteCinenerdleIndexedDbDatabase.mockResolvedValue(undefined);
    indexedDbMock.importIndexedDbSnapshot.mockResolvedValue({
      isSearchablePersistencePending: false,
      searchableConnectionEntityCount: 0,
    });
    indexedDbMock.subscribeSearchableConnectionEntityPersistenceEvents.mockReturnValue(() => { });
    indexedDbMock.subscribeSearchableConnectionEntityPersistenceStatus.mockImplementation((listener) => {
      listener({
        isPending: false,
        phase: "idle",
      });
      return () => { };
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not emit a loading state during the initial indexeddb check", async () => {
    const hasRecordsDeferred = createDeferred<boolean>();
    const bootstrapStatuses: BootstrapStatus[] = [];

    indexedDbMock.hasCinenerdleIndexedDbRecords.mockReturnValue(hasRecordsDeferred.promise);

    const {
      startCinenerdleIndexedDbBootstrap,
      subscribeCinenerdleIndexedDbBootstrapLoading,
    } = await import("../bootstrap");
    const unsubscribe = subscribeCinenerdleIndexedDbBootstrapLoading((status) => {
      bootstrapStatuses.push(status);
    });

    const bootstrapPromise = startCinenerdleIndexedDbBootstrap();
    await Promise.resolve();

    expect(bootstrapStatuses).toEqual([
      {
        isCoreReady: false,
        isSearchablePersistencePending: false,
        phase: "idle",
        resetRequiredMessage: null,
      },
    ]);

    hasRecordsDeferred.resolve(true);
    indexedDbMock.prepareSearchableConnectionEntitiesForStartup.mockResolvedValue({
      isSearchablePersistencePending: false,
      searchableConnectionEntityCount: 0,
    });
    await expect(bootstrapPromise).resolves.toBe(false);
    unsubscribe();
  });

  it("reuses the same in-flight bootstrap work across callers", async () => {
    indexedDbMock.hasCinenerdleIndexedDbRecords.mockResolvedValue(false);
    vi.mocked(globalThis.fetch).mockResolvedValue(createBootstrapSnapshotResponse());

    const { startCinenerdleIndexedDbBootstrap } = await import("../bootstrap");

    const firstPromise = startCinenerdleIndexedDbBootstrap();
    const secondPromise = startCinenerdleIndexedDbBootstrap();
    await Promise.resolve();

    expect(firstPromise).toBe(secondPromise);
    expect(indexedDbMock.hasCinenerdleIndexedDbRecords).toHaveBeenCalledTimes(1);

    await expect(firstPromise).resolves.toBe(false);
    await expect(secondPromise).resolves.toBe(false);
  });

  it("imports dump.json before marking core ready when indexeddb is empty", async () => {
    const bootstrapStatuses: BootstrapStatus[] = [];

    indexedDbMock.hasCinenerdleIndexedDbRecords.mockResolvedValue(false);
    indexedDbMock.importIndexedDbSnapshot.mockResolvedValue({
      isSearchablePersistencePending: true,
      searchableConnectionEntityCount: 42,
    });
    vi.mocked(globalThis.fetch).mockResolvedValue(createBootstrapSnapshotResponse());

    const {
      startCinenerdleIndexedDbBootstrap,
      subscribeCinenerdleIndexedDbBootstrapLoading,
    } = await import("../bootstrap");
    subscribeCinenerdleIndexedDbBootstrapLoading((status) => {
      bootstrapStatuses.push(status);
    });

    await expect(startCinenerdleIndexedDbBootstrap()).resolves.toBe(false);

    expect(indexedDbMock.prepareSearchableConnectionEntitiesForStartup).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}dump.json`);
    expect(indexedDbMock.importIndexedDbSnapshot).toHaveBeenCalledWith(
      TEST_INDEXED_DB_SNAPSHOT,
      expect.objectContaining({
        deferSearchablePersistence: true,
        onProgress: expect.any(Function),
      }),
    );
    expect(bootstrapStatuses).toEqual([
      {
        isCoreReady: false,
        isSearchablePersistencePending: false,
        phase: "idle",
        resetRequiredMessage: null,
      },
      {
        isCoreReady: false,
        isSearchablePersistencePending: false,
        phase: "processing",
        resetRequiredMessage: null,
      },
      {
        isCoreReady: true,
        isSearchablePersistencePending: true,
        phase: "idle",
        resetRequiredMessage: null,
      },
    ]);
  });

  it("unblocks into an empty app when fetching the bootstrap snapshot fails", async () => {
    const bootstrapStatuses: BootstrapStatus[] = [];

    indexedDbMock.hasCinenerdleIndexedDbRecords.mockResolvedValue(false);
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Network unavailable"));

    const {
      startCinenerdleIndexedDbBootstrap,
      subscribeCinenerdleIndexedDbBootstrapLoading,
    } = await import("../bootstrap");
    subscribeCinenerdleIndexedDbBootstrapLoading((status) => {
      bootstrapStatuses.push(status);
    });

    await expect(startCinenerdleIndexedDbBootstrap()).resolves.toBe(false);

    expect(indexedDbMock.importIndexedDbSnapshot).not.toHaveBeenCalled();
    expect(indexedDbMock.deleteCinenerdleIndexedDbDatabase).toHaveBeenCalledTimes(1);
    expect(bootstrapStatuses).toEqual([
      {
        isCoreReady: false,
        isSearchablePersistencePending: false,
        phase: "idle",
        resetRequiredMessage: null,
      },
      {
        isCoreReady: false,
        isSearchablePersistencePending: false,
        phase: "processing",
        resetRequiredMessage: null,
      },
      {
        isCoreReady: true,
        isSearchablePersistencePending: false,
        phase: "idle",
        resetRequiredMessage: null,
      },
    ]);
  });

  it("unblocks into an empty app when importing the bootstrap snapshot fails", async () => {
    const bootstrapStatuses: BootstrapStatus[] = [];

    indexedDbMock.hasCinenerdleIndexedDbRecords.mockResolvedValue(false);
    indexedDbMock.importIndexedDbSnapshot.mockRejectedValue(
      new Error("Unsupported IndexedDB snapshot version: 99"),
    );
    vi.mocked(globalThis.fetch).mockResolvedValue(createBootstrapSnapshotResponse());

    const {
      startCinenerdleIndexedDbBootstrap,
      subscribeCinenerdleIndexedDbBootstrapLoading,
    } = await import("../bootstrap");
    subscribeCinenerdleIndexedDbBootstrapLoading((status) => {
      bootstrapStatuses.push(status);
    });

    await expect(startCinenerdleIndexedDbBootstrap()).resolves.toBe(false);

    expect(indexedDbMock.deleteCinenerdleIndexedDbDatabase).toHaveBeenCalledTimes(1);
    expect(bootstrapStatuses).toEqual([
      {
        isCoreReady: false,
        isSearchablePersistencePending: false,
        phase: "idle",
        resetRequiredMessage: null,
      },
      {
        isCoreReady: false,
        isSearchablePersistencePending: false,
        phase: "processing",
        resetRequiredMessage: null,
      },
      {
        isCoreReady: true,
        isSearchablePersistencePending: false,
        phase: "idle",
        resetRequiredMessage: null,
      },
    ]);
  });

  it("can wire status updates to a parent callback without blocking bootstrap start", async () => {
    const handleLoadingChange = vi.fn();

    indexedDbMock.hasCinenerdleIndexedDbRecords.mockResolvedValue(true);
    indexedDbMock.prepareSearchableConnectionEntitiesForStartup.mockResolvedValue({
      isSearchablePersistencePending: true,
      searchableConnectionEntityCount: 12,
    });

    const { connectCinenerdleIndexedDbBootstrap } = await import("../bootstrap");
    const disconnect = connectCinenerdleIndexedDbBootstrap(handleLoadingChange);

    await Promise.resolve();

    expect(handleLoadingChange).toHaveBeenCalledWith({
      isCoreReady: false,
      isSearchablePersistencePending: false,
      phase: "idle",
      resetRequiredMessage: null,
    });
    expect(indexedDbMock.hasCinenerdleIndexedDbRecords).toHaveBeenCalledTimes(1);

    disconnect();
  });

  it("marks core ready while searchable persistence continues for existing records", async () => {
    const statuses: BootstrapStatus[] = [];

    indexedDbMock.hasCinenerdleIndexedDbRecords.mockResolvedValue(true);
    indexedDbMock.prepareSearchableConnectionEntitiesForStartup.mockResolvedValue({
      isSearchablePersistencePending: true,
      searchableConnectionEntityCount: 21463,
    });

    const {
      startCinenerdleIndexedDbBootstrap,
      subscribeCinenerdleIndexedDbBootstrapLoading,
    } = await import("../bootstrap");
    subscribeCinenerdleIndexedDbBootstrapLoading((status) => {
      statuses.push(status);
    });

    await expect(startCinenerdleIndexedDbBootstrap()).resolves.toBe(false);

    expect(statuses).toContainEqual({
      isCoreReady: false,
      isSearchablePersistencePending: false,
      phase: "processing",
      resetRequiredMessage: null,
    });
    expect(statuses).toContainEqual({
      isCoreReady: true,
      isSearchablePersistencePending: true,
      phase: "idle",
      resetRequiredMessage: null,
    });
  });

  it("auto-resets stale indexeddb data when bootstrap finds a broken cached snapshot", async () => {
    const statuses: BootstrapStatus[] = [];

    indexedDbMock.hasCinenerdleIndexedDbRecords.mockResolvedValue(true);
    indexedDbMock.prepareSearchableConnectionEntitiesForStartup.mockRejectedValue(
      new Error("IndexedDB snapshot is missing person 934 referenced by film Gladiator."),
    );

    const {
      startCinenerdleIndexedDbBootstrap,
      subscribeCinenerdleIndexedDbBootstrapLoading,
    } = await import("../bootstrap");
    subscribeCinenerdleIndexedDbBootstrapLoading((status) => {
      statuses.push(status);
    });

    await expect(startCinenerdleIndexedDbBootstrap()).resolves.toBe(false);

    expect(indexedDbMock.deleteCinenerdleIndexedDbDatabase).toHaveBeenCalledTimes(1);
    expect(statuses).toContainEqual({
      isCoreReady: true,
      isSearchablePersistencePending: false,
      phase: "idle",
      resetRequiredMessage: null,
    });
  });

  it("surfaces a clear-db-and-refresh status when auto-reset cannot delete the stale database", async () => {
    const statuses: BootstrapStatus[] = [];

    indexedDbMock.hasCinenerdleIndexedDbRecords.mockResolvedValue(true);
    indexedDbMock.prepareSearchableConnectionEntitiesForStartup.mockRejectedValue(
      new Error("Unsupported IndexedDB snapshot version: 3"),
    );
    indexedDbMock.deleteCinenerdleIndexedDbDatabase.mockRejectedValue(
      new Error("IndexedDB deletion blocked. Close other tabs and try again."),
    );

    const {
      startCinenerdleIndexedDbBootstrap,
      subscribeCinenerdleIndexedDbBootstrapLoading,
    } = await import("../bootstrap");
    subscribeCinenerdleIndexedDbBootstrapLoading((status) => {
      statuses.push(status);
    });

    await expect(startCinenerdleIndexedDbBootstrap()).resolves.toBe(false);

    expect(statuses).toContainEqual({
      isCoreReady: false,
      isSearchablePersistencePending: false,
      phase: "reset-required",
      resetRequiredMessage:
        "Cached Cinenerdle data is outdated or incompatible. Clear DB and refresh. (IndexedDB deletion blocked. Close other tabs and try again.)",
    });
  });
});

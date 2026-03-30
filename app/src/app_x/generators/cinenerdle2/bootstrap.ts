import {
  deleteCinenerdleIndexedDbDatabase,
  getSearchableConnectionEntityPersistenceStatus,
  hasCinenerdleIndexedDbRecords,
  importIndexedDbSnapshot,
  prepareSearchableConnectionEntitiesForStartup,
  subscribeSearchableConnectionEntityPersistenceEvents,
  subscribeSearchableConnectionEntityPersistenceStatus,
  type IndexedDbSnapshot,
} from "./indexed_db";
import { addCinenerdleDebugLog } from "./debug_log";

export type CinenerdleIndexedDbBootstrapPhase = "idle" | "processing" | "reset-required";
export type CinenerdleIndexedDbBootstrapStatus = {
  phase: CinenerdleIndexedDbBootstrapPhase;
  isCoreReady: boolean;
  isSearchablePersistencePending: boolean;
  resetRequiredMessage: string | null;
};

let cinenerdleIndexedDbBootstrapPromise: Promise<boolean> | null = null;
let cinenerdleIndexedDbBootstrapStatus: CinenerdleIndexedDbBootstrapStatus = {
  phase: "idle",
  isCoreReady: false,
  isSearchablePersistencePending: getSearchableConnectionEntityPersistenceStatus().isPending,
  resetRequiredMessage: null,
};
const cinenerdleIndexedDbBootstrapListeners =
  new Set<(status: CinenerdleIndexedDbBootstrapStatus) => void>();

function getCinenerdleBootstrapSnapshotUrl(): string {
  const baseUrl = import.meta.env.BASE_URL ?? "/";
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}dump.json`;
}

async function importCinenerdleBootstrapSnapshot(): Promise<{
  isSearchablePersistencePending: boolean;
  searchableConnectionEntityCount: number;
}> {
  const snapshotUrl = getCinenerdleBootstrapSnapshotUrl();
  addCinenerdleDebugLog("bootstrap:fetch-snapshot:start", {
    snapshotUrl,
  });

  const response = await fetch(snapshotUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch bootstrap snapshot: ${response.status}`);
  }

  const snapshot = await response.json() as IndexedDbSnapshot;
  addCinenerdleDebugLog("bootstrap:fetch-snapshot:loaded", {
    filmCount: snapshot.films.length,
    peopleCount: snapshot.people.length,
    snapshotUrl,
    snapshotVersion: snapshot.version,
  });

  return importIndexedDbSnapshot(snapshot, {
    deferSearchablePersistence: true,
    onProgress: (event, details) => {
      addCinenerdleDebugLog(`bootstrap:${event}`, details);
    },
  });
}

function isRecoverableCinenerdleBootstrapError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.startsWith("Unsupported IndexedDB snapshot version:") ||
    message.startsWith("IndexedDB snapshot is missing person ") ||
    message === "IndexedDB schema is missing required object stores"
  );
}

export function getCinenerdleIndexedDbBootstrapStatus(): CinenerdleIndexedDbBootstrapStatus {
  return cinenerdleIndexedDbBootstrapStatus;
}

function setCinenerdleIndexedDbBootstrapStatus(
  nextStatus: Partial<CinenerdleIndexedDbBootstrapStatus>,
): void {
  const mergedStatus: CinenerdleIndexedDbBootstrapStatus = {
    ...cinenerdleIndexedDbBootstrapStatus,
    ...nextStatus,
  };

  if (
    cinenerdleIndexedDbBootstrapStatus.phase === mergedStatus.phase &&
    cinenerdleIndexedDbBootstrapStatus.isCoreReady === mergedStatus.isCoreReady &&
    cinenerdleIndexedDbBootstrapStatus.isSearchablePersistencePending ===
      mergedStatus.isSearchablePersistencePending &&
    cinenerdleIndexedDbBootstrapStatus.resetRequiredMessage === mergedStatus.resetRequiredMessage
  ) {
    return;
  }

  cinenerdleIndexedDbBootstrapStatus = mergedStatus;
  cinenerdleIndexedDbBootstrapListeners.forEach((listener) => {
    listener(mergedStatus);
  });
}

export function subscribeCinenerdleIndexedDbBootstrapLoading(
  listener: (status: CinenerdleIndexedDbBootstrapStatus) => void,
): () => void {
  cinenerdleIndexedDbBootstrapListeners.add(listener);
  listener(cinenerdleIndexedDbBootstrapStatus);

  return () => {
    cinenerdleIndexedDbBootstrapListeners.delete(listener);
  };
}

export function connectCinenerdleIndexedDbBootstrap(
  onLoadingChange?: (status: CinenerdleIndexedDbBootstrapStatus) => void,
): () => void {
  const unsubscribe = onLoadingChange
    ? subscribeCinenerdleIndexedDbBootstrapLoading(onLoadingChange)
    : () => { };

  void startCinenerdleIndexedDbBootstrap().catch(() => { });

  return () => {
    unsubscribe();
  };
}

subscribeSearchableConnectionEntityPersistenceStatus((status) => {
  setCinenerdleIndexedDbBootstrapStatus({
    isSearchablePersistencePending: status.isPending,
  });
});

subscribeSearchableConnectionEntityPersistenceEvents((event) => {
  addCinenerdleDebugLog(event.event, event.details);
});

export function startCinenerdleIndexedDbBootstrap(): Promise<boolean> {
  if (cinenerdleIndexedDbBootstrapPromise) {
    return cinenerdleIndexedDbBootstrapPromise;
  }

  cinenerdleIndexedDbBootstrapPromise = (async () => {
    setCinenerdleIndexedDbBootstrapStatus({
      isCoreReady: false,
      phase: "idle",
      resetRequiredMessage: null,
    });

    const hasCachedRecords = await hasCinenerdleIndexedDbRecords();
    addCinenerdleDebugLog("bootstrap:start", {
      hasCachedRecords,
    });

    if (hasCachedRecords) {
      setCinenerdleIndexedDbBootstrapStatus({
        phase: "processing",
      });
      addCinenerdleDebugLog("bootstrap:prepare-searchable:start");
      const searchableStartupResult = await prepareSearchableConnectionEntitiesForStartup();
      setCinenerdleIndexedDbBootstrapStatus({
        isCoreReady: true,
        phase: "idle",
        isSearchablePersistencePending: searchableStartupResult.isSearchablePersistencePending,
        resetRequiredMessage: null,
      });
      addCinenerdleDebugLog("bootstrap:prepare-searchable:complete", searchableStartupResult);
      addCinenerdleDebugLog("bootstrap:complete", {
        hasCachedRecords,
        isCoreReady: true,
        isSearchablePersistencePending: searchableStartupResult.isSearchablePersistencePending,
        mode: "cached-records",
      });
      return false;
    }

    setCinenerdleIndexedDbBootstrapStatus({
      phase: "processing",
    });

    try {
      const snapshotImportResult = await importCinenerdleBootstrapSnapshot();
      setCinenerdleIndexedDbBootstrapStatus({
        isCoreReady: true,
        phase: "idle",
        isSearchablePersistencePending: snapshotImportResult.isSearchablePersistencePending,
        resetRequiredMessage: null,
      });
      addCinenerdleDebugLog("bootstrap:complete", {
        hasCachedRecords,
        isCoreReady: true,
        isSearchablePersistencePending: snapshotImportResult.isSearchablePersistencePending,
        mode: "snapshot-import",
        searchableConnectionEntityCount: snapshotImportResult.searchableConnectionEntityCount,
      });
      return false;
    } catch (error) {
      addCinenerdleDebugLog("bootstrap:import:error", {
        message: error instanceof Error ? error.message : String(error),
      });
      try {
        await deleteCinenerdleIndexedDbDatabase();
        addCinenerdleDebugLog("idb-reset:complete", {
          mode: "delete-database-after-import-error",
        });
      } catch {
        // Best-effort cleanup only. Bootstrap should still unblock into an empty app.
      }

      setCinenerdleIndexedDbBootstrapStatus({
        isCoreReady: true,
        phase: "idle",
        isSearchablePersistencePending: false,
        resetRequiredMessage: null,
      });
      addCinenerdleDebugLog("bootstrap:complete", {
        hasCachedRecords,
        isCoreReady: true,
        isSearchablePersistencePending: false,
        mode: "empty-fallback",
      });
      return false;
    }
  })().catch(async (error) => {
    cinenerdleIndexedDbBootstrapPromise = null;
    if (isRecoverableCinenerdleBootstrapError(error)) {
      addCinenerdleDebugLog("bootstrap:recoverable-error", {
        message: error instanceof Error ? error.message : String(error),
      });
      try {
        await deleteCinenerdleIndexedDbDatabase();
        addCinenerdleDebugLog("idb-reset:complete", {
          mode: "delete-database-after-recoverable-error",
        });
        setCinenerdleIndexedDbBootstrapStatus({
          isCoreReady: true,
          phase: "idle",
          isSearchablePersistencePending: false,
          resetRequiredMessage: null,
        });
        addCinenerdleDebugLog("bootstrap:complete", {
          isCoreReady: true,
          isSearchablePersistencePending: false,
          mode: "recoverable-reset",
        });
        return false;
      } catch (resetError) {
        error = resetError;
      }
    }

    addCinenerdleDebugLog("bootstrap:reset-required", {
      message: error instanceof Error ? error.message : String(error),
    });
    setCinenerdleIndexedDbBootstrapStatus({
      isCoreReady: false,
      phase: "reset-required",
      isSearchablePersistencePending: false,
      resetRequiredMessage:
        error instanceof Error && error.message
          ? `Cached Cinenerdle data is outdated or incompatible. Clear DB and refresh. (${error.message})`
          : "Cached Cinenerdle data is outdated or incompatible. Clear DB and refresh.",
    });
    return false;
  });

  return cinenerdleIndexedDbBootstrapPromise;
}

export const initializeCinenerdleIndexedDbIfEmpty = startCinenerdleIndexedDbBootstrap;

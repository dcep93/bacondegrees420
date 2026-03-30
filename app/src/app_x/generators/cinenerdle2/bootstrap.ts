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
  const response = await fetch(getCinenerdleBootstrapSnapshotUrl());
  if (!response.ok) {
    throw new Error(`Unable to fetch bootstrap snapshot: ${response.status}`);
  }

  const snapshot = await response.json() as IndexedDbSnapshot;
  return importIndexedDbSnapshot(snapshot);
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

subscribeSearchableConnectionEntityPersistenceEvents(() => { });

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

    if (hasCachedRecords) {
      setCinenerdleIndexedDbBootstrapStatus({
        phase: "processing",
      });
      const searchableStartupResult = await prepareSearchableConnectionEntitiesForStartup();
      setCinenerdleIndexedDbBootstrapStatus({
        isCoreReady: true,
        phase: "idle",
        isSearchablePersistencePending: searchableStartupResult.isSearchablePersistencePending,
        resetRequiredMessage: null,
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
      return false;
    } catch {
      try {
        await deleteCinenerdleIndexedDbDatabase();
      } catch {
        // Best-effort cleanup only. Bootstrap should still unblock into an empty app.
      }

      setCinenerdleIndexedDbBootstrapStatus({
        isCoreReady: true,
        phase: "idle",
        isSearchablePersistencePending: false,
        resetRequiredMessage: null,
      });
      return false;
    }
  })().catch(async (error) => {
    cinenerdleIndexedDbBootstrapPromise = null;
    if (isRecoverableCinenerdleBootstrapError(error)) {
      try {
        await deleteCinenerdleIndexedDbDatabase();
        setCinenerdleIndexedDbBootstrapStatus({
          isCoreReady: true,
          phase: "idle",
          isSearchablePersistencePending: false,
          resetRequiredMessage: null,
        });
        return false;
      } catch (resetError) {
        error = resetError;
      }
    }

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

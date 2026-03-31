import type { CinenerdleIndexedDbBootstrapStatus } from "./generators/cinenerdle2/bootstrap";

export const INDEXED_DB_BOOTSTRAP_LOADING_SHELL_DELAY_MS = 2000;

export type IndexedDbBootstrapLoadingShellDelayManager = {
  dispose: () => void;
  sync: (status: CinenerdleIndexedDbBootstrapStatus) => void;
};

export function shouldDelayIndexedDbBootstrapLoadingShell(
  status: CinenerdleIndexedDbBootstrapStatus,
): boolean {
  return !status.isCoreReady && status.phase !== "reset-required";
}

export function shouldShowIndexedDbBootstrapLoadingShell(props: {
  hasLoadingShellDelayElapsed: boolean;
  status: CinenerdleIndexedDbBootstrapStatus;
}): boolean {
  const { hasLoadingShellDelayElapsed, status } = props;

  if (status.phase === "reset-required" && !status.isCoreReady) {
    return true;
  }

  return !status.isCoreReady && hasLoadingShellDelayElapsed;
}

export function createIndexedDbBootstrapLoadingShellDelayManager(props: {
  clearTimeout: typeof globalThis.clearTimeout;
  onDelayElapsed: () => void;
  onDelayReset: () => void;
  setTimeout: typeof globalThis.setTimeout;
}): IndexedDbBootstrapLoadingShellDelayManager {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let isDelayActive = false;

  function clearDelayTimeout() {
    if (timeoutId === null) {
      return;
    }

    props.clearTimeout(timeoutId);
    timeoutId = null;
  }

  return {
    sync(status) {
      if (!shouldDelayIndexedDbBootstrapLoadingShell(status)) {
        isDelayActive = false;
        clearDelayTimeout();
        props.onDelayReset();
        return;
      }

      if (isDelayActive) {
        return;
      }

      isDelayActive = true;
      props.onDelayReset();
      timeoutId = props.setTimeout(() => {
        timeoutId = null;
        props.onDelayElapsed();
      }, INDEXED_DB_BOOTSTRAP_LOADING_SHELL_DELAY_MS);
    },
    dispose() {
      isDelayActive = false;
      clearDelayTimeout();
    },
  };
}

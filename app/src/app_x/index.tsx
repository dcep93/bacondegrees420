import { useEffect, useState } from "react";
import Cinenerdle2 from "./generators/cinenerdle2";
import {
  clearCinenerdleDebugLog,
  copyCinenerdleDebugLogToClipboard,
  logCinenerdleDebug,
} from "./generators/cinenerdle2/debug";
import {
  clearIndexedDb,
  estimateIndexedDbUsageBytes,
} from "./generators/cinenerdle2/indexed_db";
import "./styles/app_shell.css";

function clearHash() {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

export default function AppX() {
  const [hashValue, setHashValue] = useState(() => window.location.hash);
  const [resetVersion, setResetVersion] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    clearCinenerdleDebugLog();
    logCinenerdleDebug("app.init", {
      hash: window.location.hash,
    });

    function handleHashChange() {
      setHashValue(window.location.hash);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  function handleReset() {
    logCinenerdleDebug("app.reset", {
      hashBeforeReset: window.location.hash,
    });
    clearHash();
    setHashValue("");
    setResetVersion((version) => version + 1);
  }

  function handleClearDatabase() {
    void estimateIndexedDbUsageBytes().then((bytes) => {
      const megabytes = bytes / (1024 * 1024);
      const confirmed = window.confirm(
        `Clear the TMDB cache?\n\nAbout ${megabytes.toFixed(2)} MB would be reclaimed.`,
      );

      if (!confirmed) {
        logCinenerdleDebug("app.clearDatabase.cancelled", {
          estimatedBytes: bytes,
        });
        return;
      }

      return clearIndexedDb().then(() => {
        logCinenerdleDebug("app.clearDatabase.confirmed", {
          estimatedBytes: bytes,
        });
        handleReset();
      });
    });
  }

  function handleCopyLogs() {
    void copyCinenerdleDebugLogToClipboard()
      .then(() => {
        setCopyStatus("Logs copied");
        logCinenerdleDebug("app.copyLogs.success");
      })
      .catch((error) => {
        setCopyStatus("Copy failed");
        logCinenerdleDebug("app.copyLogs.error", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }

  return (
    <div className="bacon-app-shell">
      <header className="bacon-title-bar">
        <button
          aria-label="Reset generator"
          className="bacon-title-icon-button"
          onClick={handleReset}
          type="button"
        >
          <img alt="" className="bacon-title-icon" src="/favicon.svg" />
        </button>
        <h1
          className="bacon-title"
          onClick={handleCopyLogs}
          title="Click to copy Cinenerdle debug logs"
        >
          bacondegrees420
        </h1>
        <div className="bacon-title-actions">
          {copyStatus ? <span className="bacon-copy-status">{copyStatus}</span> : null}
          <button
            className="bacon-title-action-button"
            onClick={handleClearDatabase}
            type="button"
          >
            Clear DB
          </button>
        </div>
      </header>

      <main className="bacon-app-content">
        <Cinenerdle2 hashValue={hashValue} resetVersion={resetVersion} />
      </main>
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Cinenerdle2 from "./generators/cinenerdle2";
import {
  buildPathNodesFromSegments,
  createPathNode,
  normalizeHashValue,
  parseHashSegments,
  serializePathNodes,
} from "./generators/cinenerdle2/hash";
import {
  clearCinenerdleDebugLog,
  copyCinenerdleDebugLogToClipboard,
  logCinenerdleDebug,
} from "./generators/cinenerdle2/debug";
import {
  clearIndexedDb,
  estimateIndexedDbUsageBytes,
  getAllFilmRecords,
  getAllPersonRecords,
} from "./generators/cinenerdle2/indexed_db";
import { resolveConnectionQuery } from "./generators/cinenerdle2/tmdb";
import {
  formatMoviePathLabel,
  normalizeName,
  normalizeTitle,
  normalizeWhitespace,
} from "./generators/cinenerdle2/utils";
import "./styles/app_shell.css";

type ConnectionSuggestion = {
  kind: "movie" | "person";
  label: string;
  sortScore: number;
  popularity: number;
};

function getDocumentTitle(hashValue: string): string {
  const rootPathNode = buildPathNodesFromSegments(parseHashSegments(hashValue))[0];

  if (!rootPathNode || rootPathNode.kind === "cinenerdle" || rootPathNode.kind === "break") {
    return "BaconDegrees420";
  }

  if (rootPathNode.kind === "movie") {
    return formatMoviePathLabel(rootPathNode.name, rootPathNode.year);
  }

  return rootPathNode.name || "BaconDegrees420";
}

function getHighestGenerationSelectedLabel(hashValue: string): string {
  const selectedPathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue)).filter(
    (pathNode) => pathNode.kind !== "break",
  );
  const selectedPathNode = selectedPathNodes[selectedPathNodes.length - 1];

  if (!selectedPathNode || selectedPathNode.kind === "cinenerdle") {
    return "cinenerdle";
  }

  if (selectedPathNode.kind === "movie") {
    return formatMoviePathLabel(selectedPathNode.name, selectedPathNode.year);
  }

  return selectedPathNode.name;
}

function getSuggestionScore(query: string, label: string): number {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  const normalizedLabel = normalizeWhitespace(label).toLowerCase();

  if (!normalizedQuery || !normalizedLabel.includes(normalizedQuery)) {
    return -1;
  }

  if (normalizedLabel === normalizedQuery) {
    return 400;
  }

  if (normalizedLabel.startsWith(normalizedQuery)) {
    return 300;
  }

  if (normalizedLabel.split(/\s+/).some((word) => word.startsWith(normalizedQuery))) {
    return 200;
  }

  return 100;
}

function clearHash() {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

type PendingHashWrite = {
  hash: string;
  mode: "selection" | "navigation";
};

export default function AppX() {
  const [hashValue, setHashValue] = useState(() => window.location.hash);
  const [resetVersion, setResetVersion] = useState(0);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const [connectionQuery, setConnectionQuery] = useState("");
  const [isResolvingConnection, setIsResolvingConnection] = useState(false);
  const [connectionSuggestions, setConnectionSuggestions] = useState<ConnectionSuggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const pendingHashWriteRef = useRef<PendingHashWrite | null>(null);
  const autocompleteRequestIdRef = useRef(0);
  const connectionBarRef = useRef<HTMLElement | null>(null);
  const connectionInputWrapRef = useRef<HTMLDivElement | null>(null);
  const connectionDropdownRef = useRef<HTMLDivElement | null>(null);
  const highestGenerationSelectedLabel = getHighestGenerationSelectedLabel(hashValue);

  useEffect(() => {
    clearCinenerdleDebugLog();
    logCinenerdleDebug("app.init", {
      hash: window.location.hash,
    });

    function handleHashChange() {
      const nextHash = window.location.hash;
      const normalizedNextHash = normalizeHashValue(nextHash);
      const pendingHashWrite = pendingHashWriteRef.current;
      const matchedPendingHashWrite =
        pendingHashWrite !== null && pendingHashWrite.hash === normalizedNextHash;

      logCinenerdleDebug("app.hashchange", {
        nextHash,
        normalizedNextHash,
        pendingHash: pendingHashWrite?.hash ?? null,
        pendingMode: pendingHashWrite?.mode ?? null,
        matchedPendingHashWrite,
      });

      setHashValue(nextHash);

      if (!matchedPendingHashWrite || pendingHashWrite.mode !== "selection") {
        setNavigationVersion((version) => version + 1);
        logCinenerdleDebug("app.hashchange.bumpNavigationVersion", {
          reason: matchedPendingHashWrite
            ? `internal-${pendingHashWrite.mode}`
            : "external",
          nextHash: normalizedNextHash,
        });
      } else {
        logCinenerdleDebug("app.hashchange.skipNavigationVersion", {
          reason: "internal-selection",
          nextHash: normalizedNextHash,
        });
      }

      if (matchedPendingHashWrite) {
        pendingHashWriteRef.current = null;
      }
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    document.title = getDocumentTitle(hashValue);
  }, [hashValue]);

  useEffect(() => {
    const query = connectionQuery.trim();
    if (!query) {
      setConnectionSuggestions([]);
      setSelectedSuggestionIndex(-1);
      return;
    }

    const requestId = autocompleteRequestIdRef.current + 1;
    autocompleteRequestIdRef.current = requestId;

    void Promise.all([getAllPersonRecords(), getAllFilmRecords()]).then(
      ([personRecords, filmRecords]) => {
        if (autocompleteRequestIdRef.current !== requestId) {
          return;
        }

        const personSuggestions: ConnectionSuggestion[] = personRecords
          .map((personRecord) => {
            const label = personRecord.name;
            const sortScore = getSuggestionScore(query, label);

            return {
              kind: "person" as const,
              label,
              sortScore,
              popularity: personRecord.rawTmdbPerson?.popularity ?? 0,
            };
          })
          .filter((item) => item.sortScore >= 0);

        const movieSuggestions: ConnectionSuggestion[] = filmRecords
          .map((filmRecord) => {
            const label = formatMoviePathLabel(filmRecord.title, filmRecord.year);
            const titleScore = getSuggestionScore(query, filmRecord.title);
            const labelScore = getSuggestionScore(query, label);
            const sortScore = Math.max(titleScore, labelScore);

            return {
              kind: "movie" as const,
              label,
              sortScore,
              popularity: filmRecord.popularity ?? 0,
            };
          })
          .filter((item) => item.sortScore >= 0);

        const seenLabels = new Set<string>();
        const nextSuggestions = [...personSuggestions, ...movieSuggestions]
          .sort((left, right) => {
            if (right.sortScore !== left.sortScore) {
              return right.sortScore - left.sortScore;
            }

            if (right.popularity !== left.popularity) {
              return right.popularity - left.popularity;
            }

            if (left.kind !== right.kind) {
              return left.kind === "person" ? -1 : 1;
            }

            return left.label.localeCompare(right.label);
          })
          .filter((item) => {
            const dedupeKey =
              item.kind === "person"
                ? `person:${normalizeName(item.label)}`
                : `movie:${normalizeTitle(item.label)}`;
            if (seenLabels.has(dedupeKey)) {
              return false;
            }

            seenLabels.add(dedupeKey);
            return true;
          })
          .slice(0, 12);

        logCinenerdleDebug("app.connectionAutocomplete.results", {
          query,
          personMatchCount: personSuggestions.length,
          movieMatchCount: movieSuggestions.length,
          suggestionCount: nextSuggestions.length,
          preview: nextSuggestions.slice(0, 5).map((suggestion) => ({
            kind: suggestion.kind,
            label: suggestion.label,
            sortScore: suggestion.sortScore,
            popularity: suggestion.popularity,
          })),
        });

        setConnectionSuggestions(nextSuggestions);
        setSelectedSuggestionIndex(nextSuggestions.length > 0 ? 0 : -1);
      },
    );
  }, [connectionQuery]);

  useEffect(() => {
    if (connectionSuggestions.length === 0) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const dropdownElement = connectionDropdownRef.current;
      const inputWrapElement = connectionInputWrapRef.current;
      const connectionBarElement = connectionBarRef.current;

      if (!dropdownElement || !inputWrapElement || !connectionBarElement) {
        logCinenerdleDebug("app.connectionDropdown.layout.missingElement", {
          hasDropdown: Boolean(dropdownElement),
          hasInputWrap: Boolean(inputWrapElement),
          hasConnectionBar: Boolean(connectionBarElement),
          suggestionCount: connectionSuggestions.length,
        });
        return;
      }

      const dropdownRect = dropdownElement.getBoundingClientRect();
      const inputWrapRect = inputWrapElement.getBoundingClientRect();
      const connectionBarRect = connectionBarElement.getBoundingClientRect();
      const dropdownStyle = window.getComputedStyle(dropdownElement);
      const centerX = Math.max(
        dropdownRect.left + Math.min(dropdownRect.width / 2, Math.max(dropdownRect.width - 1, 0)),
        0,
      );
      const centerY = Math.max(
        dropdownRect.top + Math.min(dropdownRect.height / 2, Math.max(dropdownRect.height - 1, 0)),
        0,
      );
      const topElement = document.elementFromPoint(centerX, centerY);

      logCinenerdleDebug("app.connectionDropdown.layout", {
        query: connectionQuery.trim(),
        suggestionCount: connectionSuggestions.length,
        selectedSuggestionIndex,
        dropdownRect: {
          top: dropdownRect.top,
          left: dropdownRect.left,
          width: dropdownRect.width,
          height: dropdownRect.height,
          bottom: dropdownRect.bottom,
        },
        inputWrapRect: {
          top: inputWrapRect.top,
          left: inputWrapRect.left,
          width: inputWrapRect.width,
          height: inputWrapRect.height,
          bottom: inputWrapRect.bottom,
        },
        connectionBarRect: {
          top: connectionBarRect.top,
          left: connectionBarRect.left,
          width: connectionBarRect.width,
          height: connectionBarRect.height,
          bottom: connectionBarRect.bottom,
        },
        dropdownStyle: {
          display: dropdownStyle.display,
          visibility: dropdownStyle.visibility,
          opacity: dropdownStyle.opacity,
          zIndex: dropdownStyle.zIndex,
          overflowY: dropdownStyle.overflowY,
          position: dropdownStyle.position,
        },
        elementAtDropdownCenter: topElement
          ? {
              tagName: topElement.tagName,
              className:
                typeof topElement.className === "string" ? topElement.className : null,
              text:
                topElement.textContent?.trim().slice(0, 120) ?? "",
            }
          : null,
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [connectionQuery, connectionSuggestions, selectedSuggestionIndex]);

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
    logCinenerdleDebug("app.copyLogs.requested", {
      hash: window.location.hash,
      documentTitle: document.title,
    });

    void copyCinenerdleDebugLogToClipboard()
      .then((count) => {
        setCopyStatus(`${count} logs copied`);
        logCinenerdleDebug("app.copyLogs.success", {
          count,
        });
      })
      .catch((error) => {
        setCopyStatus("Copy failed");
        logCinenerdleDebug("app.copyLogs.error", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }

  const handleHashWrite = useCallback(
    (nextHash: string, mode: "selection" | "navigation") => {
      const normalizedHash = normalizeHashValue(nextHash);
      pendingHashWriteRef.current = {
        hash: normalizedHash,
        mode,
      };
      logCinenerdleDebug("app.hashWrite.requested", {
        nextHash,
        normalizedHash,
        mode,
        currentHash: normalizeHashValue(window.location.hash),
      });
    },
    [],
  );

  const navigateToHash = useCallback(
    (nextHash: string, mode: "selection" | "navigation") => {
      const normalizedHash = normalizeHashValue(nextHash);
      if (!normalizedHash) {
        return;
      }

      handleHashWrite(normalizedHash, mode);
      window.location.hash = normalizedHash.replace(/^#/, "");
    },
    [handleHashWrite],
  );

  const handleConnectionSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const query = connectionQuery.trim();
      if (!query || isResolvingConnection) {
        return;
      }

      setIsResolvingConnection(true);
      logCinenerdleDebug("app.connectionSubmit.start", {
        query,
      });

      try {
        const target = await resolveConnectionQuery(query);
        logCinenerdleDebug("app.connectionSubmit.resolved", {
          query,
          target,
        });

        if (!target) {
          logCinenerdleDebug("app.connectionSubmit.noMatch", {
            query,
          });
          return;
        }

        const nextHash = serializePathNodes([
          target.kind === "movie"
            ? createPathNode("movie", target.name, target.year)
            : createPathNode("person", target.name),
        ]);
        navigateToHash(nextHash, "navigation");
        setConnectionQuery("");
      } catch (error) {
        logCinenerdleDebug("app.connectionSubmit.error", {
          query,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsResolvingConnection(false);
      }
    },
    [connectionQuery, isResolvingConnection, navigateToHash],
  );

  const handleConnectionInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (connectionSuggestions.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedSuggestionIndex((currentIndex) =>
          Math.min(currentIndex + 1, connectionSuggestions.length - 1),
        );
        logCinenerdleDebug("app.connectionAutocomplete.arrowDown", {
          currentIndex: selectedSuggestionIndex,
          nextIndex: Math.min(selectedSuggestionIndex + 1, connectionSuggestions.length - 1),
          suggestionCount: connectionSuggestions.length,
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedSuggestionIndex((currentIndex) =>
          Math.max(currentIndex - 1, 0),
        );
        logCinenerdleDebug("app.connectionAutocomplete.arrowUp", {
          currentIndex: selectedSuggestionIndex,
          nextIndex: Math.max(selectedSuggestionIndex - 1, 0),
          suggestionCount: connectionSuggestions.length,
        });
        return;
      }

      if (event.key === "Enter" && selectedSuggestionIndex >= 0) {
        event.preventDefault();
        const selectedLabel = connectionSuggestions[selectedSuggestionIndex]?.label ?? "";
        logCinenerdleDebug("app.connectionAutocomplete.enterSelected", {
          selectedSuggestionIndex,
          selectedLabel,
        });
        window.alert(selectedLabel);
      }
    },
    [connectionSuggestions, selectedSuggestionIndex],
  );

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
          BaconDegrees420
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

      <section className="bacon-connection-bar" ref={connectionBarRef}>
        <form className="bacon-connection-form" onSubmit={handleConnectionSubmit}>
          <div className="bacon-connection-input-wrap" ref={connectionInputWrapRef}>
            <input
              autoCapitalize="words"
              autoCorrect="off"
              className="bacon-connection-input"
              disabled={isResolvingConnection}
              onChange={(event) => setConnectionQuery(event.target.value)}
              onKeyDown={handleConnectionInputKeyDown}
              placeholder="Connect to film or person"
              type="text"
              value={connectionQuery}
            />
            {connectionSuggestions.length > 0 ? (
              <div className="bacon-connection-dropdown" ref={connectionDropdownRef}>
                {connectionSuggestions.map((suggestion, index) => (
                  <button
                    className={[
                      "bacon-connection-option",
                      index === selectedSuggestionIndex
                        ? "bacon-connection-option-selected"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={`${suggestion.kind}:${suggestion.label}`}
                    onMouseEnter={() => setSelectedSuggestionIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => window.alert(suggestion.label)}
                    type="button"
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="bacon-connection-pill">{highestGenerationSelectedLabel}</span>
        </form>
      </section>

      <main className="bacon-app-content">
        <Cinenerdle2
          hashValue={hashValue}
          navigationVersion={navigationVersion}
          onHashWrite={handleHashWrite}
          resetVersion={resetVersion}
        />
      </main>
    </div>
  );
}

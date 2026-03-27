import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
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
  buildConnectionGraph,
  createCinenerdleConnectionEntity,
  createConnectionEntityFromMovieRecord,
  createConnectionEntityFromPersonRecord,
  createFallbackConnectionEntity,
  findConnectionPathBidirectional,
  getConnectionEdgeKey,
  type ConnectionEntity,
  type ConnectionSearchResult,
} from "./generators/cinenerdle2/connection_graph";
import {
  clearIndexedDb,
  estimateIndexedDbUsageBytes,
  getAllFilmRecords,
  getAllPersonRecords,
} from "./generators/cinenerdle2/indexed_db";
import { resolveConnectionQuery } from "./generators/cinenerdle2/tmdb";
import { CINENERDLE_ICON_URL, TMDB_ICON_URL } from "./generators/cinenerdle2/constants";
import {
  formatMoviePathLabel,
  normalizeWhitespace,
} from "./generators/cinenerdle2/utils";
import "./styles/app_shell.css";

type ConnectionSuggestion = ConnectionEntity & {
  sortScore: number;
  popularity: number;
};

type PendingHashWrite = {
  hash: string;
  mode: "selection" | "navigation";
};

type SelectedPathTarget =
  | {
      kind: "cinenerdle";
      name: "cinenerdle";
      year: "";
    }
  | {
      kind: "movie";
      name: string;
      year: string;
    }
  | {
      kind: "person";
      name: string;
      year: "";
    }
  | null;

type ConnectionSearchRow = {
  id: string;
  excludedNodeKeys: string[];
  excludedEdgeKeys: string[];
  childDisallowedNodeKeys: string[];
  childDisallowedEdgeKeys: string[];
  status: ConnectionSearchResult["status"] | "searching";
  path: ConnectionEntity[];
};

type ConnectionSession = {
  id: string;
  left: ConnectionEntity;
  right: ConnectionEntity;
  rows: ConnectionSearchRow[];
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

function getHighestGenerationSelectedTarget(hashValue: string): SelectedPathTarget {
  const pathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue)).filter(
    (pathNode): pathNode is Exclude<(typeof pathNode), { kind: "break" }> =>
      pathNode.kind === "cinenerdle" ||
      pathNode.kind === "movie" ||
      pathNode.kind === "person",
  );
  const selectedPathNode = pathNodes[pathNodes.length - 1];

  if (!selectedPathNode) {
    return {
      kind: "cinenerdle",
      name: "cinenerdle",
      year: "",
    };
  }

  if (selectedPathNode.kind === "cinenerdle") {
    return selectedPathNode;
  }

  if (selectedPathNode.kind === "movie") {
    return {
      kind: "movie",
      name: selectedPathNode.name,
      year: selectedPathNode.year,
    };
  }

  return {
    kind: "person",
    name: selectedPathNode.name,
    year: "",
  };
}

function getHighestGenerationSelectedLabel(hashValue: string): string {
  const selectedPathTarget = getHighestGenerationSelectedTarget(hashValue);

  if (!selectedPathTarget) {
    return "cinenerdle";
  }

  if (selectedPathTarget.kind === "cinenerdle") {
    return "cinenerdle";
  }

  if (selectedPathTarget.kind === "movie") {
    return formatMoviePathLabel(selectedPathTarget.name, selectedPathTarget.year);
  }

  return selectedPathTarget.name;
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

function serializeConnectionEntityHash(entity: ConnectionEntity): string {
  return serializePathNodes([
    entity.kind === "cinenerdle"
      ? createPathNode("cinenerdle", "cinenerdle")
      : entity.kind === "movie"
      ? createPathNode("movie", entity.name, entity.year)
      : createPathNode("person", entity.name),
  ]);
}

function createSearchingConnectionRow(id: string): ConnectionSearchRow {
  return {
    id,
    excludedNodeKeys: [],
    excludedEdgeKeys: [],
    childDisallowedNodeKeys: [],
    childDisallowedEdgeKeys: [],
    status: "searching",
    path: [],
  };
}

export default function AppX() {
  const [hashValue, setHashValue] = useState(() => window.location.hash);
  const [resetVersion, setResetVersion] = useState(0);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const [connectionQuery, setConnectionQuery] = useState("");
  const [isResolvingConnection, setIsResolvingConnection] = useState(false);
  const [connectionSuggestions, setConnectionSuggestions] = useState<ConnectionSuggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [connectionSession, setConnectionSession] = useState<ConnectionSession | null>(null);
  const pendingHashWriteRef = useRef<PendingHashWrite | null>(null);
  const autocompleteRequestIdRef = useRef(0);
  const connectionSessionIdRef = useRef(0);
  const connectionRowIdRef = useRef(0);
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
            const entity = createConnectionEntityFromPersonRecord(personRecord);
            const sortScore = getSuggestionScore(query, entity.label);

            return {
              ...entity,
              sortScore,
              popularity: personRecord.rawTmdbPerson?.popularity ?? 0,
            };
          })
          .filter((item) => item.sortScore >= 0);

        const movieSuggestions: ConnectionSuggestion[] = filmRecords
          .map((filmRecord) => {
            const entity = createConnectionEntityFromMovieRecord(filmRecord);
            const titleScore = getSuggestionScore(query, filmRecord.title);
            const labelScore = getSuggestionScore(query, entity.label);
            const sortScore = Math.max(titleScore, labelScore);

            return {
              ...entity,
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
            if (seenLabels.has(item.key)) {
              return false;
            }

            seenLabels.add(item.key);
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
            connectionCount: suggestion.connectionCount,
            hasCachedTmdbSource: suggestion.hasCachedTmdbSource,
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
              text: topElement.textContent?.trim().slice(0, 120) ?? "",
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
    setConnectionSession(null);
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

  const navigateToConnectionEntity = useCallback(
    (entity: ConnectionEntity) => {
      navigateToHash(serializeConnectionEntityHash(entity), "navigation");
    },
    [navigateToHash],
  );

  const runConnectionRowSearch = useCallback(
    async (params: {
      sessionId: string;
      rowId: string;
      left: ConnectionEntity;
      right: ConnectionEntity;
      excludedNodeKeys: string[];
      excludedEdgeKeys: string[];
    }) => {
      logCinenerdleDebug("app.connectionRows.search.start", {
        sessionId: params.sessionId,
        rowId: params.rowId,
        left: params.left.label,
        right: params.right.label,
        excludedNodeKeys: params.excludedNodeKeys,
        excludedEdgeKeys: params.excludedEdgeKeys,
      });

      const [personRecords, filmRecords] = await Promise.all([
        getAllPersonRecords(),
        getAllFilmRecords(),
      ]);
      const graph = buildConnectionGraph(personRecords, filmRecords);
      const leftEntity =
        graph.entitiesByKey.get(params.left.key) ??
        createFallbackConnectionEntity(params.left);
      const rightEntity =
        graph.entitiesByKey.get(params.right.key) ??
        createFallbackConnectionEntity(params.right);

      logCinenerdleDebug("app.connectionRows.search.graphSnapshot", {
        sessionId: params.sessionId,
        rowId: params.rowId,
        requestedLeftKey: params.left.key,
        requestedRightKey: params.right.key,
        resolvedLeftKey: leftEntity.key,
        resolvedRightKey: rightEntity.key,
        resolvedLeftKind: leftEntity.kind,
        resolvedRightKind: rightEntity.kind,
        personRecordCount: personRecords.length,
        filmRecordCount: filmRecords.length,
        starterFilmCount: filmRecords.filter((filmRecord) => Boolean(filmRecord.rawCinenerdleDailyStarter)).length,
        entityCount: graph.entitiesByKey.size,
        adjacencyCount: graph.adjacencyByKey.size,
      });

      const result = findConnectionPathBidirectional(graph, leftEntity.key, rightEntity.key, {
        excludedNodeKeys: new Set(params.excludedNodeKeys),
        excludedEdgeKeys: new Set(params.excludedEdgeKeys),
        timeoutMs: 5000,
      });

      logCinenerdleDebug("app.connectionRows.search.complete", {
        sessionId: params.sessionId,
        rowId: params.rowId,
        status: result.status,
        elapsedMs: result.elapsedMs,
        path: result.path.map((entity) => entity.label),
      });

      setConnectionSession((currentSession) => {
        if (!currentSession || currentSession.id !== params.sessionId) {
          return currentSession;
        }

        return {
          ...currentSession,
          left: leftEntity,
          right: rightEntity,
          rows: currentSession.rows.map((row) =>
            row.id === params.rowId
              ? {
                  ...row,
                  status: result.status,
                  path: result.path,
                }
              : row,
          ),
        };
      });
    },
    [],
  );

  const openConnectionRowsForEntity = useCallback(
    async (entity: ConnectionEntity) => {
      const selectedTarget = getHighestGenerationSelectedTarget(hashValue);
      const counterpart = selectedTarget
        ? createFallbackConnectionEntity(selectedTarget)
        : createCinenerdleConnectionEntity(1);
      const sessionId = `connection-session-${connectionSessionIdRef.current + 1}`;
      connectionSessionIdRef.current += 1;
      const rowId = `connection-row-${connectionRowIdRef.current + 1}`;
      connectionRowIdRef.current += 1;

      logCinenerdleDebug("app.connectionRows.open", {
        sessionId,
        hashValue,
        selectedTarget,
        left: entity.label,
        leftKind: entity.kind,
        leftKey: entity.key,
        right: counterpart.label,
        rightKind: counterpart.kind,
        rightKey: counterpart.key,
      });

      setConnectionSession({
        id: sessionId,
        left: entity,
        right: counterpart,
        rows: [createSearchingConnectionRow(rowId)],
      });
      setConnectionQuery("");
      setConnectionSuggestions([]);
      setSelectedSuggestionIndex(-1);

      await runConnectionRowSearch({
        sessionId,
        rowId,
        left: entity,
        right: counterpart,
        excludedNodeKeys: [],
        excludedEdgeKeys: [],
      });
    },
    [hashValue, runConnectionRowSearch],
  );

  const spawnAlternativeConnectionRow = useCallback(
    (
      parentRowId: string,
      exclusion:
        | {
            kind: "node";
            nodeKey: string;
          }
        | {
            kind: "edge";
            edgeKey: string;
          },
    ) => {
      let nextSearch:
        | {
            sessionId: string;
            rowId: string;
            left: ConnectionEntity;
            right: ConnectionEntity;
            excludedNodeKeys: string[];
            excludedEdgeKeys: string[];
          }
        | null = null;

      setConnectionSession((currentSession) => {
        if (!currentSession) {
          return currentSession;
        }

        const parentRow = currentSession.rows.find((row) => row.id === parentRowId);
        if (!parentRow || parentRow.status !== "found") {
          return currentSession;
        }

        if (
          exclusion.kind === "node" &&
          parentRow.childDisallowedNodeKeys.includes(exclusion.nodeKey)
        ) {
          return currentSession;
        }

        if (
          exclusion.kind === "edge" &&
          parentRow.childDisallowedEdgeKeys.includes(exclusion.edgeKey)
        ) {
          return currentSession;
        }

        const rowId = `connection-row-${connectionRowIdRef.current + 1}`;
        connectionRowIdRef.current += 1;
        const excludedNodeKeys = Array.from(
          new Set([
            ...parentRow.excludedNodeKeys,
            ...(exclusion.kind === "node" ? [exclusion.nodeKey] : []),
          ]),
        );
        const excludedEdgeKeys = Array.from(
          new Set([
            ...parentRow.excludedEdgeKeys,
            ...(exclusion.kind === "edge" ? [exclusion.edgeKey] : []),
          ]),
        );

        nextSearch = {
          sessionId: currentSession.id,
          rowId,
          left: currentSession.left,
          right: currentSession.right,
          excludedNodeKeys,
          excludedEdgeKeys,
        };

        logCinenerdleDebug("app.connectionRows.spawnAlternative", {
          sessionId: currentSession.id,
          parentRowId,
          rowId,
          exclusion,
        });

        return {
          ...currentSession,
          rows: [
            ...currentSession.rows.map((row) =>
              row.id === parentRowId
                ? {
                    ...row,
                    childDisallowedNodeKeys:
                      exclusion.kind === "node"
                        ? [...row.childDisallowedNodeKeys, exclusion.nodeKey]
                        : row.childDisallowedNodeKeys,
                    childDisallowedEdgeKeys:
                      exclusion.kind === "edge"
                        ? [...row.childDisallowedEdgeKeys, exclusion.edgeKey]
                        : row.childDisallowedEdgeKeys,
                  }
                : row,
            ),
            {
              ...createSearchingConnectionRow(rowId),
              excludedNodeKeys,
              excludedEdgeKeys,
            },
          ],
        };
      });

      if (nextSearch) {
        void runConnectionRowSearch(nextSearch);
      }
    },
    [runConnectionRowSearch],
  );

  const handleConnectionSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const query = connectionQuery.trim();
      const selectedSuggestion =
        selectedSuggestionIndex >= 0 ? connectionSuggestions[selectedSuggestionIndex] ?? null : null;

      if (selectedSuggestion) {
        await openConnectionRowsForEntity(selectedSuggestion);
        return;
      }

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

        await openConnectionRowsForEntity(createFallbackConnectionEntity(target));
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
    [
      connectionQuery,
      connectionSuggestions,
      isResolvingConnection,
      openConnectionRowsForEntity,
      selectedSuggestionIndex,
    ],
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
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedSuggestionIndex((currentIndex) => Math.max(currentIndex - 1, 0));
        return;
      }

      if (event.key === "Enter" && selectedSuggestionIndex >= 0) {
        event.preventDefault();
        const selectedSuggestion = connectionSuggestions[selectedSuggestionIndex] ?? null;
        if (!selectedSuggestion) {
          return;
        }

        void openConnectionRowsForEntity(selectedSuggestion);
      }
    },
    [connectionSuggestions, openConnectionRowsForEntity, selectedSuggestionIndex],
  );

  const handleConnectionSuggestionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, suggestion: ConnectionSuggestion) => {
      event.preventDefault();
      void openConnectionRowsForEntity(suggestion);
    },
    [openConnectionRowsForEntity],
  );

  function renderConnectionEntityCard(
    entity: ConnectionEntity,
    options: {
      dimmed?: boolean;
      onCardClick?: () => void;
      onNameClick?: () => void;
    },
  ) {
    return (
      <article
        className={[
          "bacon-connection-node",
          options.onCardClick ? "bacon-connection-node-clickable" : "",
          options.dimmed ? "bacon-connection-node-dimmed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={options.onCardClick}
      >
        <button
          className="bacon-connection-node-name"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            options.onNameClick?.();
          }}
          type="button"
        >
          {entity.label}
        </button>
        <div className="bacon-connection-node-meta">
          <span className="bacon-connection-node-count">
            {entity.connectionCount} {entity.connectionCount === 1 ? "connection" : "connections"}
          </span>
          <img
            alt={entity.kind === "cinenerdle" ? "Cinenerdle" : "TMDb"}
            className="bacon-connection-node-source-icon"
            src={entity.kind === "cinenerdle" ? CINENERDLE_ICON_URL : TMDB_ICON_URL}
            style={
              entity.kind === "cinenerdle" || entity.hasCachedTmdbSource
                ? undefined
                : {
                    filter: "grayscale(1)",
                    opacity: 0.9,
                  }
            }
            title={entity.kind === "cinenerdle" ? "Cinenerdle" : "TMDb"}
          />
        </div>
      </article>
    );
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
                    key={suggestion.key}
                    onMouseEnter={() => setSelectedSuggestionIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => handleConnectionSuggestionClick(event, suggestion)}
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

        {connectionSession ? (
          <div className="bacon-connection-results">
            <div className="bacon-connection-row">
              {renderConnectionEntityCard(connectionSession.left, {
                onCardClick: () => navigateToConnectionEntity(connectionSession.left),
                onNameClick: () => navigateToConnectionEntity(connectionSession.left),
              })}
              <span className="bacon-connection-arrow bacon-connection-arrow-static">→</span>
              {renderConnectionEntityCard(connectionSession.right, {
                onCardClick: () => navigateToConnectionEntity(connectionSession.right),
                onNameClick: () => navigateToConnectionEntity(connectionSession.right),
              })}
            </div>

            {connectionSession.rows.map((row) => {
              if (row.status === "searching") {
                return (
                  <div className="bacon-connection-row" key={row.id}>
                    <div className="bacon-connection-status-card">
                      Searching cached connections...
                    </div>
                  </div>
                );
              }

              if (row.status !== "found" || row.path.length === 0) {
                return (
                  <div className="bacon-connection-row" key={row.id}>
                    <div className="bacon-connection-status-card">
                      {row.status === "timeout"
                        ? "Timed out after 5 seconds without finding a cached path."
                        : "No cached path found."}
                    </div>
                  </div>
                );
              }

              return (
                <div className="bacon-connection-row" key={row.id}>
                  {row.path.map((entity, index) => {
                    const nextEntity = row.path[index + 1] ?? null;
                    const edgeKey = nextEntity
                      ? getConnectionEdgeKey(entity.key, nextEntity.key)
                      : "";
                    const isMiddleNode = index > 0 && index < row.path.length - 1;
                    const isNodeDimmed = row.childDisallowedNodeKeys.includes(entity.key);
                    const isEdgeDimmed = row.childDisallowedEdgeKeys.includes(edgeKey);

                    return (
                      <Fragment key={`${row.id}:${entity.key}:${index}`}>
                        {renderConnectionEntityCard(entity, {
                          dimmed: isNodeDimmed,
                          onCardClick: isMiddleNode
                            ? () =>
                                spawnAlternativeConnectionRow(row.id, {
                                  kind: "node",
                                  nodeKey: entity.key,
                                })
                            : undefined,
                          onNameClick: () => navigateToConnectionEntity(entity),
                        })}
                        {nextEntity ? (
                          <button
                            className={[
                              "bacon-connection-arrow",
                              "bacon-connection-arrow-button",
                              isEdgeDimmed ? "bacon-connection-arrow-dimmed" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onClick={() =>
                              spawnAlternativeConnectionRow(row.id, {
                                kind: "edge",
                                edgeKey,
                              })
                            }
                            type="button"
                          >
                            →
                          </button>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : null}
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

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  compareRankedConnectionSuggestions,
  compareRankedSearchableConnectionEntityRecords,
  getConnectionSuggestionScore,
} from "./connection_autocomplete";
import { shouldActivateConnectedDropdownSuggestion } from "./connection_matchup_helpers";
import { annotateDirectionalConnectionPathRanks } from "./connection_path_ranks";
import { measureAsync } from "./perf";
import { serializeConnectionEntityHash, serializeConnectionPathHash } from "./connection_hash";
import {
  collectConnectionRowFamilyIds,
  createSearchingConnectionRow,
  matchesConnectionExclusion,
  type ConnectionExclusion,
  type ConnectionSession,
} from "./connection_rows";
import { getHighestGenerationSelectedTarget, getDirectConnectionOrdersForYoungestSelectedCard } from "./selected_path";
import {
  createFallbackConnectionEntity,
  findConnectionPathBidirectional,
  hydrateConnectionEntityFromKey,
  hydrateConnectionEntityFromSearchRecord,
  type ConnectionEntity,
} from "./generators/cinenerdle2/connection_graph";
import {
  getAllSearchableConnectionEntities,
  getFilmRecordByTitleAndYear,
  getFilmRecordsByPersonConnectionKey,
  getPersonRecordById,
  getPersonRecordByName,
  getPersonRecordsByMovieKey,
} from "./generators/cinenerdle2/indexed_db";
import {
  prepareSelectedMovie,
  prepareSelectedPerson,
  resolveConnectionQuery,
} from "./generators/cinenerdle2/tmdb";
import { hasDirectTmdbMovieSource, hasDirectTmdbPersonSource } from "./generators/cinenerdle2/tmdb_provenance";
import type { FilmRecord, PersonRecord } from "./generators/cinenerdle2/types";
import {
  getFilmKey,
  normalizeName,
} from "./generators/cinenerdle2/utils";
import type { YoungestSelectedCard } from "./connection_matchup_preview";

export type ConnectionSuggestion = Omit<ConnectionEntity, "kind"> & {
  kind: "movie" | "person";
  popularity: number;
  isConnectedToYoungestSelection: boolean;
  connectionOrderToYoungestSelection: number | null;
  sortScore: number;
};

export type HighlightedConnectionEntitySelectionRequest = {
  requestKey: string;
  entity: ConnectionEntity;
};

function isPlaceholderPersonLabel(entity: ConnectionEntity): boolean {
  return entity.kind === "person" && /^Person \d+$/.test(entity.label);
}

function mergeHydratedConnectionEntity(
  originalEntity: ConnectionEntity,
  hydratedEntity: ConnectionEntity,
): ConnectionEntity {
  if (
    originalEntity.kind === "person" &&
    hydratedEntity.kind === "person" &&
    originalEntity.key === hydratedEntity.key &&
    originalEntity.label.trim() &&
    isPlaceholderPersonLabel(hydratedEntity)
  ) {
    return {
      ...hydratedEntity,
      name: originalEntity.name,
      label: originalEntity.label,
    };
  }

  return hydratedEntity;
}

async function getPersonRecordForConnectionEntity(
  entity: ConnectionEntity,
): Promise<PersonRecord | null> {
  if (entity.kind !== "person") {
    return null;
  }

  return entity.tmdbId
    ? getPersonRecordById(entity.tmdbId)
    : getPersonRecordByName(normalizeName(entity.name));
}

async function getMovieRecordForConnectionEntity(
  entity: ConnectionEntity,
): Promise<FilmRecord | null> {
  if (entity.kind !== "movie") {
    return null;
  }

  return getFilmRecordByTitleAndYear(entity.name, entity.year);
}

async function hydrateConnectionEntityPresentation(
  entity: ConnectionEntity,
): Promise<ConnectionEntity> {
  if (entity.kind === "cinenerdle") {
    return entity;
  }

  const localRecord = entity.kind === "movie"
    ? await getMovieRecordForConnectionEntity(entity)
    : await getPersonRecordForConnectionEntity(entity);
  const hasPresentationData =
    Boolean(entity.imageUrl) &&
    typeof entity.popularity === "number" &&
    entity.popularity > 0;
  const needsDirectHydration =
    entity.kind === "movie"
      ? !hasDirectTmdbMovieSource(localRecord as FilmRecord | null)
      : !hasDirectTmdbPersonSource(localRecord as PersonRecord | null);

  if (!localRecord || needsDirectHydration) {
    if (entity.kind === "movie") {
      await prepareSelectedMovie(entity.name, entity.year, entity.tmdbId, {
        forceRefresh: false,
      }).catch(() => null);
    } else {
      await prepareSelectedPerson(entity.name, entity.tmdbId, {
        forceRefresh: false,
      }).catch(() => null);
    }
  } else if (hasPresentationData) {
    return entity;
  }

  return hydrateConnectionEntityFromKey(entity.key)
    .then((hydratedEntity) => mergeHydratedConnectionEntity(entity, hydratedEntity))
    .catch(() => entity);
}

async function annotateConnectionPathRanks(path: ConnectionEntity[]): Promise<ConnectionEntity[]> {
  const presentedPath = await Promise.all(path.map((entity) => hydrateConnectionEntityPresentation(entity)));

  return annotateDirectionalConnectionPathRanks(presentedPath, {
    getMovieRecord: getMovieRecordForConnectionEntity,
    getPersonRecord: getPersonRecordForConnectionEntity,
    getConnectedMovieRecordsForPerson: async (entity, personRecord) =>
      entity.kind === "person"
        ? getFilmRecordsByPersonConnectionKey(personRecord?.name ?? entity.name)
        : [],
    getConnectedPersonRecordsForMovie: async (entity, movieRecord) =>
      entity.kind === "movie"
        ? getPersonRecordsByMovieKey(
            movieRecord?.titleYear ?? getFilmKey(entity.name, entity.year),
          )
        : [],
  });
}

export function useConnectionSearchState({
  hashValue,
  isSearchablePersistencePending,
  youngestSelectedCard,
}: {
  hashValue: string;
  isSearchablePersistencePending: boolean;
  youngestSelectedCard: YoungestSelectedCard | null;
}) {
  const [connectionQuery, setConnectionQuery] = useState("");
  const [isResolvingConnection, setIsResolvingConnection] = useState(false);
  const [connectionSuggestions, setConnectionSuggestions] = useState<ConnectionSuggestion[]>([]);
  const [isConnectionDropdownDismissed, setIsConnectionDropdownDismissed] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [youngestSelectedConnectionOrders, setYoungestSelectedConnectionOrders] = useState<
    Record<string, number | null>
  >({});
  const [connectionSession, setConnectionSession] = useState<ConnectionSession | null>(null);
  const [highlightedConnectionEntitySelectionRequest, setHighlightedConnectionEntitySelectionRequest] =
    useState<HighlightedConnectionEntitySelectionRequest | null>(null);
  const connectionSessionRef = useRef<ConnectionSession | null>(null);
  const autocompleteRequestIdRef = useRef(0);
  const connectionSessionIdRef = useRef(0);
  const connectionRowIdRef = useRef(0);
  const highlightedConnectionEntitySelectionRequestIdRef = useRef(0);
  const connectionInputWrapRef = useRef<HTMLDivElement | null>(null);
  const deferredConnectionQuery = useDeferredValue(connectionQuery);
  const youngestSelectedCardKey = youngestSelectedCard?.key ?? "";
  const highlightedConnectionEntity =
    selectedSuggestionIndex >= 0 ? connectionSuggestions[selectedSuggestionIndex] ?? null : null;

  const clearConnectionInputState = useCallback(() => {
    autocompleteRequestIdRef.current += 1;
    setIsConnectionDropdownDismissed(false);
    setConnectionQuery("");
    setConnectionSuggestions([]);
    setSelectedSuggestionIndex(-1);
  }, []);

  useEffect(() => {
    connectionSessionRef.current = connectionSession;
  }, [connectionSession]);

  useEffect(() => {
    connectionSessionRef.current = null;
    setConnectionSession(null);
  }, [hashValue]);

  useEffect(() => {
    if (connectionQuery.length === 0 && isConnectionDropdownDismissed) {
      setIsConnectionDropdownDismissed(false);
    }
  }, [connectionQuery, isConnectionDropdownDismissed]);

  useEffect(() => {
    if (isSearchablePersistencePending) {
      startTransition(() => {
        setConnectionSuggestions([]);
        setSelectedSuggestionIndex(-1);
      });
      return;
    }

    const query = deferredConnectionQuery.trim();
    if (!query || isConnectionDropdownDismissed) {
      startTransition(() => {
        setConnectionSuggestions([]);
        setSelectedSuggestionIndex(-1);
      });
      return;
    }

    const requestId = autocompleteRequestIdRef.current + 1;
    autocompleteRequestIdRef.current = requestId;
    const directConnectionKeys = new Set(Object.keys(youngestSelectedConnectionOrders));

    void measureAsync(
      "app.connectionAutocomplete",
      async () => {
        const searchRecords = await getAllSearchableConnectionEntities();
        if (autocompleteRequestIdRef.current !== requestId) {
          return [];
        }

        const candidateRecords = searchRecords
          .map((record) => ({
            record,
            sortScore: getConnectionSuggestionScore(query, record.nameLower),
            isConnectedToYoungestSelection: directConnectionKeys.has(record.key),
          }))
          .filter((item) => item.sortScore >= 0)
          .sort(compareRankedSearchableConnectionEntityRecords)
          .slice(0, 24);

        const nextSuggestions = Array.from(new Map((await Promise.all(
          candidateRecords.map(async ({ record, sortScore, isConnectedToYoungestSelection }) => {
            const entity = await hydrateConnectionEntityFromSearchRecord(record);
            if (entity.kind === "cinenerdle" || entity.connectionCount <= 0) {
              return null;
            }
            return {
              ...entity,
              popularity: record.popularity ?? 0,
              connectionOrderToYoungestSelection:
                Object.hasOwn(youngestSelectedConnectionOrders, record.key)
                  ? youngestSelectedConnectionOrders[record.key] ?? null
                  : null,
              isConnectedToYoungestSelection,
              sortScore: Math.max(sortScore, getConnectionSuggestionScore(query, entity.label)),
            };
          }),
        ))
          .filter((entity): entity is ConnectionSuggestion => entity !== null)
          .map((entity) => [entity.key, entity] as const))
          .values())
          .sort(compareRankedConnectionSuggestions)
          .slice(0, 12);

        if (autocompleteRequestIdRef.current !== requestId) {
          return nextSuggestions;
        }

        startTransition(() => {
          setConnectionSuggestions(nextSuggestions);
          setSelectedSuggestionIndex(nextSuggestions.length > 0 ? 0 : -1);
        });

        return nextSuggestions;
      },
      {
        always: true,
        details: {
          directConnectionKeyCount: directConnectionKeys.size,
          query,
          requestId,
          youngestSelectedCardKey,
        },
        summarizeResult: (suggestions) => ({
          suggestionCount: suggestions.length,
        }),
      },
    );
  }, [
    deferredConnectionQuery,
    isConnectionDropdownDismissed,
    isSearchablePersistencePending,
    youngestSelectedCardKey,
    youngestSelectedConnectionOrders,
  ]);

  useEffect(() => {
    clearConnectionInputState();
  }, [clearConnectionInputState, youngestSelectedCardKey]);

  useEffect(() => {
    if (isSearchablePersistencePending) {
      clearConnectionInputState();
    }
  }, [clearConnectionInputState, isSearchablePersistencePending]);

  useEffect(() => {
    function handleDocumentClick(event: globalThis.MouseEvent) {
      const inputWrapElement = connectionInputWrapRef.current;
      const target = event.target;

      if (inputWrapElement && target instanceof Node && inputWrapElement.contains(target)) {
        return;
      }

      clearConnectionInputState();
    }

    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [clearConnectionInputState]);

  useEffect(() => {
    let cancelled = false;

    void getDirectConnectionOrdersForYoungestSelectedCard(youngestSelectedCard)
      .then((nextOrders) => {
        if (!cancelled) {
          setYoungestSelectedConnectionOrders(nextOrders);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setYoungestSelectedConnectionOrders({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [youngestSelectedCard]);

  const runConnectionRowSearch = useCallback(async (params: {
    excludedEdgeKeys: string[];
    excludedNodeKeys: string[];
    left: ConnectionEntity;
    right: ConnectionEntity;
    rowId: string;
    sessionId: string;
  }) => {
    const [leftEntity, rightEntity] = await Promise.all([
      hydrateConnectionEntityFromKey(params.left.key)
        .then((entity) => mergeHydratedConnectionEntity(params.left, entity))
        .then((entity) => hydrateConnectionEntityPresentation(entity))
        .catch(() => createFallbackConnectionEntity(params.left)),
      hydrateConnectionEntityFromKey(params.right.key)
        .then((entity) => mergeHydratedConnectionEntity(params.right, entity))
        .then((entity) => hydrateConnectionEntityPresentation(entity))
        .catch(() => createFallbackConnectionEntity(params.right)),
    ]);

    const result = await measureAsync(
      "app.runConnectionRowSearch",
      () =>
        findConnectionPathBidirectional(leftEntity, rightEntity, {
          excludedNodeKeys: new Set(params.excludedNodeKeys),
          excludedEdgeKeys: new Set(params.excludedEdgeKeys),
          timeoutMs: 5000,
        }),
      {
        always: true,
        details: {
          excludedEdgeKeyCount: params.excludedEdgeKeys.length,
          excludedNodeKeyCount: params.excludedNodeKeys.length,
          leftKey: leftEntity.key,
          rightKey: rightEntity.key,
          rowId: params.rowId,
          sessionId: params.sessionId,
        },
        summarizeResult: (searchResult) => ({
          pathLength: searchResult.path.length,
          status: searchResult.status,
        }),
      },
    );

    const rankedPath = await annotateConnectionPathRanks(result.path);

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
                path: rankedPath,
              }
            : row,
        ),
      };
    });
  }, []);

  const openConnectionRowsForEntity = useCallback(async (entity: ConnectionEntity) => {
    const counterpart = createFallbackConnectionEntity(getHighestGenerationSelectedTarget(hashValue));
    const sessionId = `connection-session-${connectionSessionIdRef.current + 1}`;
    connectionSessionIdRef.current += 1;
    const rowId = `connection-row-${connectionRowIdRef.current + 1}`;
    connectionRowIdRef.current += 1;

    setConnectionSession({
      id: sessionId,
      left: entity,
      right: counterpart,
      rows: [createSearchingConnectionRow(rowId)],
    });
    clearConnectionInputState();

    await runConnectionRowSearch({
      excludedEdgeKeys: [],
      excludedNodeKeys: [],
      left: entity,
      right: counterpart,
      rowId,
      sessionId,
    });
  }, [clearConnectionInputState, hashValue, runConnectionRowSearch]);

  const spawnAlternativeConnectionRow = useCallback((
    parentRowId: string,
    exclusion: ConnectionExclusion,
  ) => {
    const currentSession = connectionSessionRef.current;
    if (!currentSession) {
      return;
    }

    const parentRow = currentSession.rows.find((row) => row.id === parentRowId);
    if (!parentRow || parentRow.status !== "found") {
      return;
    }

    const isAlreadyDisallowed = exclusion.kind === "node"
      ? parentRow.childDisallowedNodeKeys.includes(exclusion.nodeKey)
      : parentRow.childDisallowedEdgeKeys.includes(exclusion.edgeKey);

    if (isAlreadyDisallowed) {
      const toggledRow = currentSession.rows.find((row) =>
        row.parentRowId === parentRowId &&
        matchesConnectionExclusion(row.sourceExclusion, exclusion),
      );
      const rowsToRemove = toggledRow
        ? collectConnectionRowFamilyIds(currentSession.rows, toggledRow.id)
        : new Set<string>();
      const nextSession: ConnectionSession = {
        ...currentSession,
        rows: currentSession.rows
          .filter((row) => !rowsToRemove.has(row.id))
          .map((row) =>
            row.id === parentRowId
              ? {
                  ...row,
                  childDisallowedNodeKeys:
                    exclusion.kind === "node"
                      ? row.childDisallowedNodeKeys.filter((nodeKey) => nodeKey !== exclusion.nodeKey)
                      : row.childDisallowedNodeKeys,
                  childDisallowedEdgeKeys:
                    exclusion.kind === "edge"
                      ? row.childDisallowedEdgeKeys.filter((edgeKey) => edgeKey !== exclusion.edgeKey)
                      : row.childDisallowedEdgeKeys,
                }
              : row,
          ),
      };

      connectionSessionRef.current = nextSession;
      setConnectionSession(nextSession);
      return;
    }

    const rowId = `connection-row-${connectionRowIdRef.current + 1}`;
    connectionRowIdRef.current += 1;
    const excludedNodeKeys = Array.from(new Set([
      ...parentRow.excludedNodeKeys,
      ...(exclusion.kind === "node" ? [exclusion.nodeKey] : []),
    ]));
    const excludedEdgeKeys = Array.from(new Set([
      ...parentRow.excludedEdgeKeys,
      ...(exclusion.kind === "edge" ? [exclusion.edgeKey] : []),
    ]));

    const nextSearch = {
      excludedEdgeKeys,
      excludedNodeKeys,
      left: currentSession.left,
      right: currentSession.right,
      rowId,
      sessionId: currentSession.id,
    };

    const nextSession: ConnectionSession = {
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
          ...createSearchingConnectionRow(rowId, {
            parentRowId,
            sourceExclusion: exclusion,
          }),
          excludedNodeKeys,
          excludedEdgeKeys,
        },
      ],
    };

    connectionSessionRef.current = nextSession;
    setConnectionSession(nextSession);
    void runConnectionRowSearch(nextSearch);
  }, [runConnectionRowSearch]);

  const handleConnectionSuggestionSelection = useCallback(async (suggestion: ConnectionSuggestion) => {
    if (shouldActivateConnectedDropdownSuggestion(suggestion)) {
      highlightedConnectionEntitySelectionRequestIdRef.current += 1;
      setHighlightedConnectionEntitySelectionRequest({
        requestKey: `connection-dropdown-select-${highlightedConnectionEntitySelectionRequestIdRef.current}`,
        entity: suggestion,
      });
      clearConnectionInputState();
      return;
    }

    await openConnectionRowsForEntity(suggestion);
  }, [clearConnectionInputState, openConnectionRowsForEntity]);

  const handleConnectionSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSearchablePersistencePending) {
      return;
    }

    const query = connectionQuery.trim();
    const selectedSuggestion =
      selectedSuggestionIndex >= 0 ? connectionSuggestions[selectedSuggestionIndex] ?? null : null;

    if (selectedSuggestion) {
      await handleConnectionSuggestionSelection(selectedSuggestion);
      return;
    }

    if (!query || isResolvingConnection) {
      return;
    }

    setIsResolvingConnection(true);

    try {
      const target = await resolveConnectionQuery(query);
      if (!target) {
        return;
      }

      await openConnectionRowsForEntity(createFallbackConnectionEntity(target));
      setConnectionQuery("");
    } catch (error) {
      void error;
    } finally {
      setIsResolvingConnection(false);
    }
  }, [
    connectionQuery,
    connectionSuggestions,
    handleConnectionSuggestionSelection,
    isResolvingConnection,
    isSearchablePersistencePending,
    openConnectionRowsForEntity,
    selectedSuggestionIndex,
  ]);

  const handleConnectionInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (isSearchablePersistencePending) {
      return;
    }

    if (event.key === "Escape" && connectionSuggestions.length > 0) {
      event.preventDefault();
      setIsConnectionDropdownDismissed(true);
      setConnectionSuggestions([]);
      setSelectedSuggestionIndex(-1);
      return;
    }

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
      if (selectedSuggestion) {
        void handleConnectionSuggestionSelection(selectedSuggestion);
      }
    }
  }, [
    connectionSuggestions,
    handleConnectionSuggestionSelection,
    isSearchablePersistencePending,
    selectedSuggestionIndex,
  ]);

  const handleHighlightedConnectionEntitySelectionHandled = useCallback(
    (requestKey: string, didSelect: boolean) => {
      setHighlightedConnectionEntitySelectionRequest((currentRequest) => {
        if (!currentRequest || currentRequest.requestKey !== requestKey) {
          return currentRequest;
        }

        if (!didSelect) {
          void openConnectionRowsForEntity(currentRequest.entity);
        }

        return null;
      });
    },
    [openConnectionRowsForEntity],
  );

  const handleConnectionSuggestionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, suggestion: ConnectionSuggestion) => {
      event.preventDefault();
      void handleConnectionSuggestionSelection(suggestion);
    },
    [handleConnectionSuggestionSelection],
  );

  return {
    clearConnectionInputState,
    connectionInputWrapRef,
    connectionQuery,
    connectionSession,
    connectionSuggestions,
    handleConnectionInputKeyDown,
    handleConnectionSubmit,
    handleConnectionSuggestionClick,
    handleHighlightedConnectionEntitySelectionHandled,
    highlightedConnectionEntity,
    highlightedConnectionEntitySelectionRequest,
    isConnectionInputDisabled: isResolvingConnection || isSearchablePersistencePending,
    selectedSuggestionIndex,
    serializeConnectionEntityHash,
    serializeConnectionPathHash,
    setConnectionQuery,
    setSelectedSuggestionIndex,
    spawnAlternativeConnectionRow,
  };
}

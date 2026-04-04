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
import { shouldSelectConnectedDropdownSuggestionAsYoungest } from "./connection_matchup_helpers";
import { annotateDirectionalConnectionPathRanks } from "./connection_path_ranks";
import { measureAsync } from "./perf";
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
import { isExcludedFilmRecord } from "./generators/cinenerdle2/exclusion";
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

type ConnectionRowSearchParams = {
  excludedEdgeKeys: string[];
  excludedNodeKeys: string[];
  left: ConnectionEntity;
  right: ConnectionEntity;
  rowId: string;
  sessionId: string;
};

type SelectableConnectionEntity = ConnectionEntity & {
  kind: "movie" | "person";
};

function getConnectionOrderToYoungestSelection(
  youngestSelectedConnectionOrders: Record<string, number | null>,
  key: string,
): number | null {
  return Object.hasOwn(youngestSelectedConnectionOrders, key)
    ? youngestSelectedConnectionOrders[key] ?? null
    : null;
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
    .catch(() => entity);
}

async function hydrateConnectionEntityForRowSearch(
  entity: ConnectionEntity,
): Promise<ConnectionEntity> {
  return hydrateConnectionEntityFromKey(entity.key)
    .then((hydratedEntity) => hydrateConnectionEntityPresentation(hydratedEntity))
    .catch(() => createFallbackConnectionEntity(entity));
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

async function buildConnectionSuggestions(params: {
  query: string;
  isStale: () => boolean;
  youngestSelectedConnectionOrders: Record<string, number | null>;
}): Promise<ConnectionSuggestion[]> {
  const { query, isStale, youngestSelectedConnectionOrders } = params;
  const directConnectionKeys = new Set(Object.keys(youngestSelectedConnectionOrders));
  const searchRecords = await getAllSearchableConnectionEntities();

  if (isStale()) {
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

  const suggestions = Array.from(
    new Map(
      (await Promise.all(
        candidateRecords.map(async ({ record, sortScore, isConnectedToYoungestSelection }) => {
          const entity = await hydrateConnectionEntityFromSearchRecord(record);
          if (entity.kind === "cinenerdle" || entity.connectionCount <= 0) {
            return null;
          }
          if (entity.kind === "movie") {
            const filmRecord = await getFilmRecordByTitleAndYear(entity.name, entity.year);
            if (isExcludedFilmRecord(filmRecord)) {
              return null;
            }
          }
          const suggestionEntity = entity as SelectableConnectionEntity;

          return [
            suggestionEntity.key,
            {
              ...suggestionEntity,
              popularity: record.popularity ?? 0,
              connectionOrderToYoungestSelection: getConnectionOrderToYoungestSelection(
                youngestSelectedConnectionOrders,
                record.key,
              ),
              isConnectedToYoungestSelection,
              sortScore: Math.max(sortScore, getConnectionSuggestionScore(query, suggestionEntity.label)),
            } satisfies ConnectionSuggestion,
          ] as const;
        }),
      )).filter((entity): entity is readonly [string, ConnectionSuggestion] => entity !== null),
    ).values(),
  )
    .sort(compareRankedConnectionSuggestions)
    .slice(0, 12);

  return suggestions;
}

type ConnectionSuggestionSelectionHandler = (
  suggestion: ConnectionSuggestion,
) => Promise<void> | void;

export async function selectConnectionSuggestion(params: {
  clearConnectionInputState: () => void;
  onSelectConnectedSuggestionAsYoungest: (suggestion: ConnectionSuggestion) => void;
  openConnectionRowsForEntity: (entity: ConnectionEntity) => Promise<void>;
  suggestion: ConnectionSuggestion;
}): Promise<void> {
  const {
    clearConnectionInputState,
    onSelectConnectedSuggestionAsYoungest,
    openConnectionRowsForEntity,
    suggestion,
  } = params;
  const selectsYoungest = shouldSelectConnectedDropdownSuggestionAsYoungest(suggestion);

  if (selectsYoungest) {
    clearConnectionInputState();
    onSelectConnectedSuggestionAsYoungest(suggestion);
    return;
  }

  await openConnectionRowsForEntity(createFallbackConnectionEntity(suggestion));
}

export async function selectHighlightedConnectionSuggestion(params: {
  connectionSuggestions: ConnectionSuggestion[];
  onSelectSuggestion: ConnectionSuggestionSelectionHandler;
  selectedSuggestionIndex: number;
}): Promise<boolean> {
  const selectedSuggestion = params.selectedSuggestionIndex >= 0
    ? params.connectionSuggestions[params.selectedSuggestionIndex] ?? null
    : null;

  if (!selectedSuggestion) {
    return false;
  }

  await params.onSelectSuggestion(selectedSuggestion);
  return true;
}

export async function clickConnectionSuggestion(params: {
  event: Pick<MouseEvent<HTMLButtonElement>, "preventDefault">;
  onSelectSuggestion: ConnectionSuggestionSelectionHandler;
  suggestion: ConnectionSuggestion;
}): Promise<void> {
  params.event.preventDefault();
  await params.onSelectSuggestion(params.suggestion);
}

function createInitialConnectionSession(params: {
  entity: ConnectionEntity;
  counterpart: ConnectionEntity;
  rowId: string;
  sessionId: string;
}): ConnectionSession {
  return {
    id: params.sessionId,
    left: params.entity,
    right: params.counterpart,
    rows: [createSearchingConnectionRow(params.rowId)],
  };
}

function updateConnectionSessionRowResult(
  currentSession: ConnectionSession | null,
  params: ConnectionRowSearchParams,
  resolvedEntities: {
    left: ConnectionEntity;
    right: ConnectionEntity;
  },
  rankedPath: ConnectionEntity[],
  status: ConnectionSession["rows"][number]["status"],
): ConnectionSession | null {
  if (!currentSession || currentSession.id !== params.sessionId) {
    return currentSession;
  }

  return {
    ...currentSession,
    left: resolvedEntities.left,
    right: resolvedEntities.right,
    rows: currentSession.rows.map((row) =>
      row.id === params.rowId
        ? {
            ...row,
            status,
            path: rankedPath,
          }
        : row,
    ),
  };
}

function updateParentRowExclusions(
  row: ConnectionSession["rows"][number],
  exclusion: ConnectionExclusion,
  mode: "add" | "remove",
): ConnectionSession["rows"][number] {
  if (exclusion.kind === "node") {
    return {
      ...row,
      childDisallowedNodeKeys:
        mode === "add"
          ? [...row.childDisallowedNodeKeys, exclusion.nodeKey]
          : row.childDisallowedNodeKeys.filter((nodeKey) => nodeKey !== exclusion.nodeKey),
    };
  }

  return {
    ...row,
    childDisallowedEdgeKeys:
      mode === "add"
        ? [...row.childDisallowedEdgeKeys, exclusion.edgeKey]
        : row.childDisallowedEdgeKeys.filter((edgeKey) => edgeKey !== exclusion.edgeKey),
  };
}

function removeAlternativeConnectionRowFamily(
  currentSession: ConnectionSession,
  parentRowId: string,
  exclusion: ConnectionExclusion,
): ConnectionSession {
  const toggledRow = currentSession.rows.find((row) =>
    row.parentRowId === parentRowId &&
    matchesConnectionExclusion(row.sourceExclusion, exclusion),
  );
  const rowsToRemove = toggledRow
    ? collectConnectionRowFamilyIds(currentSession.rows, toggledRow.id)
    : new Set<string>();

  return {
    ...currentSession,
    rows: currentSession.rows
      .filter((row) => !rowsToRemove.has(row.id))
      .map((row) => row.id === parentRowId ? updateParentRowExclusions(row, exclusion, "remove") : row),
  };
}

function buildAlternativeConnectionSearchPlan(params: {
  currentSession: ConnectionSession;
  exclusion: ConnectionExclusion;
  parentRowId: string;
  rowId: string;
}): {
  nextSearch: ConnectionRowSearchParams;
  nextSession: ConnectionSession;
} {
  const { currentSession, exclusion, parentRowId, rowId } = params;
  const parentRow = currentSession.rows.find((row) => row.id === parentRowId);

  if (!parentRow) {
    throw new Error(`Missing parent connection row: ${parentRowId}`);
  }

  const excludedNodeKeys = Array.from(new Set([
    ...parentRow.excludedNodeKeys,
    ...(exclusion.kind === "node" ? [exclusion.nodeKey] : []),
  ]));
  const excludedEdgeKeys = Array.from(new Set([
    ...parentRow.excludedEdgeKeys,
    ...(exclusion.kind === "edge" ? [exclusion.edgeKey] : []),
  ]));

  return {
    nextSearch: {
      excludedEdgeKeys,
      excludedNodeKeys,
      left: currentSession.left,
      right: currentSession.right,
      rowId,
      sessionId: currentSession.id,
    },
    nextSession: {
      ...currentSession,
      rows: [
        ...currentSession.rows.map((row) =>
          row.id === parentRowId ? updateParentRowExclusions(row, exclusion, "add") : row,
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
    },
  };
}

export function useConnectionSearchState({
  hashValue,
  isSearchablePersistencePending,
  onConnectedSuggestionHighlight,
  onSelectConnectedSuggestionAsYoungest,
  youngestSelectedCard,
}: {
  hashValue: string;
  isSearchablePersistencePending: boolean;
  onConnectedSuggestionHighlight?: (suggestion: ConnectionSuggestion | null) => void;
  onSelectConnectedSuggestionAsYoungest: (suggestion: ConnectionSuggestion) => void;
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
  const connectionSessionRef = useRef<ConnectionSession | null>(null);
  const autocompleteRequestIdRef = useRef(0);
  const connectionSessionIdRef = useRef(0);
  const connectionRowIdRef = useRef(0);
  const connectionInputWrapRef = useRef<HTMLDivElement | null>(null);
  const deferredConnectionQuery = useDeferredValue(connectionQuery);
  const youngestSelectedCardKey = youngestSelectedCard?.key ?? "";

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

    void measureAsync(
      "app.connectionAutocomplete",
      async () => {
        const nextSuggestions = await buildConnectionSuggestions({
          query,
          isStale: () => autocompleteRequestIdRef.current !== requestId,
          youngestSelectedConnectionOrders,
        });
        if (autocompleteRequestIdRef.current === requestId) {
          startTransition(() => {
            setConnectionSuggestions(nextSuggestions);
            setSelectedSuggestionIndex(nextSuggestions.length > 0 ? 0 : -1);
          });
        }

        return nextSuggestions;
      },
      {
        always: true,
        details: {
          directConnectionKeyCount: Object.keys(youngestSelectedConnectionOrders).length,
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
    const selectedSuggestion =
      selectedSuggestionIndex >= 0 ? connectionSuggestions[selectedSuggestionIndex] ?? null : null;
    const highlightedSuggestion = shouldSelectConnectedDropdownSuggestionAsYoungest(selectedSuggestion)
      ? selectedSuggestion
      : null;

    onConnectedSuggestionHighlight?.(
      highlightedSuggestion,
    );
  }, [
    connectionSuggestions,
    onConnectedSuggestionHighlight,
    selectedSuggestionIndex,
  ]);

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

  const runConnectionRowSearch = useCallback(async (params: ConnectionRowSearchParams) => {
    const [leftEntity, rightEntity] = await Promise.all([
      hydrateConnectionEntityForRowSearch(params.left),
      hydrateConnectionEntityForRowSearch(params.right),
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
      return updateConnectionSessionRowResult(
        currentSession,
        params,
        {
          left: leftEntity,
          right: rightEntity,
        },
        rankedPath,
        result.status,
      );
    });
  }, []);

  const openConnectionRowsForEntity = useCallback(async (entity: ConnectionEntity) => {
    const counterpart = createFallbackConnectionEntity(getHighestGenerationSelectedTarget(hashValue));
    const sessionId = `connection-session-${connectionSessionIdRef.current + 1}`;
    connectionSessionIdRef.current += 1;
    const rowId = `connection-row-${connectionRowIdRef.current + 1}`;
    connectionRowIdRef.current += 1;

    setConnectionSession(createInitialConnectionSession({
      entity,
      counterpart,
      rowId,
      sessionId,
    }));
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
      const nextSession = removeAlternativeConnectionRowFamily(
        currentSession,
        parentRowId,
        exclusion,
      );

      connectionSessionRef.current = nextSession;
      setConnectionSession(nextSession);
      return;
    }

    const rowId = `connection-row-${connectionRowIdRef.current + 1}`;
    connectionRowIdRef.current += 1;
    const { nextSearch, nextSession } = buildAlternativeConnectionSearchPlan({
      currentSession,
      exclusion,
      parentRowId,
      rowId,
    });

    connectionSessionRef.current = nextSession;
    setConnectionSession(nextSession);
    void runConnectionRowSearch(nextSearch);
  }, [runConnectionRowSearch]);

  const handleConnectionSuggestionSelection = useCallback(async (suggestion: ConnectionSuggestion) => {
    await selectConnectionSuggestion({
      clearConnectionInputState,
      onSelectConnectedSuggestionAsYoungest,
      openConnectionRowsForEntity,
      suggestion,
    });
  }, [
    clearConnectionInputState,
    onSelectConnectedSuggestionAsYoungest,
    openConnectionRowsForEntity,
  ]);

  const handleConnectionSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSearchablePersistencePending) {
      return;
    }

    const query = connectionQuery.trim();
    if (await selectHighlightedConnectionSuggestion({
      connectionSuggestions,
      onSelectSuggestion: handleConnectionSuggestionSelection,
      selectedSuggestionIndex,
    })) {
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
    } catch {
      // Ignore resolution failures and leave the current connection search state intact.
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
      void selectHighlightedConnectionSuggestion({
        connectionSuggestions,
        onSelectSuggestion: handleConnectionSuggestionSelection,
        selectedSuggestionIndex,
      });
    }
  }, [
    connectionSuggestions,
    handleConnectionSuggestionSelection,
    isSearchablePersistencePending,
    selectedSuggestionIndex,
  ]);

  const handleConnectionSuggestionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, suggestion: ConnectionSuggestion) => {
      void clickConnectionSuggestion({
        event,
        onSelectSuggestion: handleConnectionSuggestionSelection,
        suggestion,
      });
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
    isConnectionInputDisabled: isResolvingConnection || isSearchablePersistencePending,
    selectedSuggestionIndex,
    setConnectionQuery,
    setSelectedSuggestionIndex,
    spawnAlternativeConnectionRow,
  };
}

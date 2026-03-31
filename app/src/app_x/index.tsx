import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { formatClearDbBadgeText } from "./clear_db_badge";
import {
  shouldResolveConnectionMatchupPreview,
} from "./connection_matchup_helpers";
import {
  resolveConnectionMatchupPreview,
  type ConnectionMatchupPreview as ConnectionMatchupPreviewData,
  type YoungestSelectedCard,
} from "./connection_matchup_preview";
import {
  useAppLocationState,
} from "./app_location";
import { useBookmarksState } from "./bookmarks_state";
import {
  serializeConnectionEntityHash,
  serializeConnectionPathHash,
} from "./connection_hash";
import {
  useConnectionSearchState,
} from "./connection_search_state";
import {
  connectCinenerdleIndexedDbBootstrap,
  type CinenerdleIndexedDbBootstrapStatus,
} from "./generators/cinenerdle2/bootstrap";
import {
  copyCinenerdleBootstrapDebugLogToClipboard,
  copyCinenerdleDebugLogToClipboard,
  copyCinenerdleIndexedDbSnapshotToClipboard,
  copyCinenerdlePerfDebugLogToClipboard,
  copyCinenerdleRecoveryDebugLogToClipboard,
  copyCinenerdleSearchablePersistenceDebugLogToClipboard,
} from "./generators/cinenerdle2/debug";
import {
  CINENERDLE_DEBUG_LOG_UPDATED_EVENT,
  getCinenerdleFetchDebugEntryCount,
} from "./generators/cinenerdle2/debug_log";
import {
  startIdleFetch,
  type IdleFetchHandle,
} from "./generators/cinenerdle2/idle_fetch";
import {
  CINENERDLE_INDEXED_DB_FETCH_COUNT_UPDATED_EVENT,
  CINENERDLE_RECORDS_UPDATED_EVENT,
  clearIndexedDb,
  estimateIndexedDbUsageBytes,
  getCinenerdleIndexedDbFetchCount,
} from "./generators/cinenerdle2/indexed_db";
import type { ConnectionEntity } from "./generators/cinenerdle2/connection_graph";
import Cinenerdle2 from "./generators/cinenerdle2";
import { getSelectedPathTooltipEntries } from "./index_helpers";
import {
  createIndexedDbBootstrapLoadingShellDelayManager,
  shouldShowIndexedDbBootstrapLoadingShell,
  type IndexedDbBootstrapLoadingShellDelayManager,
} from "./indexed_db_bootstrap_loading_shell";
import { formatIndexedDbClearConfirmationMessage } from "./indexed_db_clear_confirmation";
import {
  getDocumentTitle,
  getHighestGenerationSelectedLabel,
} from "./selected_path";
import "./styles/app_shell.css";
import { getWindowKeyDownAction } from "./window_keydown";
import BaconTitleBar from "./components/bacon_title_bar";
import BookmarksJsonlEditorModal from "./components/bookmarks_jsonl_editor";
import BookmarksPage from "./components/bookmarks_page";
import ConnectionBar from "./components/connection_bar";
import ConnectionMatchupPreview from "./components/connection_matchup_preview";
import ConnectionResults from "./components/connection_results";
import IndexedDbBootstrapLoadingIndicator from "./components/indexed_db_bootstrap_loading_indicator";

declare global {
  interface Window {
    copyCinenerdleBootstrapDebugLog?: () => Promise<number>;
    copyCinenerdleDebugLog?: () => Promise<number>;
    copyCinenerdlePerfDebugLog?: () => Promise<number>;
    copyCinenerdleRecoveryDebugLog?: () => Promise<number>;
    copyCinenerdleSearchablePersistenceDebugLog?: () => Promise<number>;
    copyCinenerdleSnapshot?: typeof copyCinenerdleIndexedDbSnapshotToClipboard;
    idleFetch: () => IdleFetchHandle;
  }
}

export default function AppX() {
  const {
    handleHashWrite,
    hashValue,
    isBookmarksView,
    loadBookmarkCardHash,
    loadBookmarkHash,
    navigationVersion,
    openBookmarkCardAsRootInNewTab,
    openHashInNewTab,
    resetLocation,
    toggleBookmarks,
    navigateToHash,
  } = useAppLocationState();
  const [resetVersion, setResetVersion] = useState(0);
  const [youngestSelectedCard, setYoungestSelectedCard] = useState<YoungestSelectedCard | null>(null);
  const [connectionMatchupPreview, setConnectionMatchupPreview] =
    useState<ConnectionMatchupPreviewData | null>(null);
  const [connectionMatchupPreviewRefreshVersion, setConnectionMatchupPreviewRefreshVersion] =
    useState(0);
  const [cinenerdleIndexedDbBootstrapStatus, setCinenerdleIndexedDbBootstrapStatus] =
    useState<CinenerdleIndexedDbBootstrapStatus>({
      isCoreReady: false,
      isSearchablePersistencePending: false,
      phase: "idle",
      resetRequiredMessage: null,
    });
  const [hasIndexedDbBootstrapLoadingShellDelayElapsed, setHasIndexedDbBootstrapLoadingShellDelayElapsed] =
    useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [copyStatusPlacement, setCopyStatusPlacement] = useState<"toast" | "title">("toast");
  const [clearDbFetchCount, setClearDbFetchCount] = useState(() => getCinenerdleFetchDebugEntryCount());
  const [clearDbTotalFetchCount, setClearDbTotalFetchCount] =
    useState(() => getCinenerdleFetchDebugEntryCount());
  const [, setIsHighlightedConnectionEntityInYoungestGeneration] = useState(false);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const clearDbButtonRef = useRef<HTMLButtonElement | null>(null);
  const toastStatusRef = useRef<HTMLSpanElement | null>(null);
  const indexedDbBootstrapLoadingShellDelayManagerRef =
    useRef<IndexedDbBootstrapLoadingShellDelayManager | null>(null);
  const isCinenerdleIndexedDbBootstrapLoading = !cinenerdleIndexedDbBootstrapStatus.isCoreReady;
  const isSearchablePersistencePending =
    cinenerdleIndexedDbBootstrapStatus.isSearchablePersistencePending;
  const clearDbBadgeText = formatClearDbBadgeText(clearDbFetchCount, clearDbTotalFetchCount);
  const selectedPathTooltipEntries = getSelectedPathTooltipEntries(hashValue);
  const highestGenerationSelectedLabel = getHighestGenerationSelectedLabel(hashValue);

  function sayToast(message: string) {
    setCopyStatusPlacement("toast");
    setCopyStatus(message);
  }

  const {
    bookmarks,
    bookmarksJsonlDraft,
    bookmarksJsonlTextareaRef,
    displayedBookmarkRows,
    handleApplyBookmarksJsonl,
    handleCloseBookmarksJsonlEditor,
    handleMoveBookmark,
    handleOpenBookmarksJsonlEditor,
    handleRemoveBookmark,
    handleResetBookmarksJsonlDraft,
    handleSaveBookmark,
    isBookmarksJsonlDraftDirty,
    isBookmarksJsonlEditorOpen,
    isSavingBookmark,
    setBookmarksJsonlDraft,
  } = useBookmarksState({
    hashValue,
    isCinenerdleIndexedDbBootstrapLoading,
    onToast: sayToast,
  });
  const {
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
    isConnectionInputDisabled,
    selectedSuggestionIndex,
    setConnectionQuery,
    setSelectedSuggestionIndex,
    spawnAlternativeConnectionRow,
  } = useConnectionSearchState({
    hashValue,
    isSearchablePersistencePending,
    youngestSelectedCard,
  });
  const shouldShowIndexedDbBootstrapLoadingShellIndicator = shouldShowIndexedDbBootstrapLoadingShell({
    hasLoadingShellDelayElapsed: hasIndexedDbBootstrapLoadingShellDelayElapsed,
    status: cinenerdleIndexedDbBootstrapStatus,
  });

  const navigateToConnectionEntity = useCallback(
    (entity: ConnectionEntity) => {
      navigateToHash(serializeConnectionEntityHash(entity), "navigation");
    },
    [navigateToHash],
  );

  const openConnectionEntityInNewTab = useCallback(
    (entity: ConnectionEntity) => {
      openHashInNewTab(serializeConnectionEntityHash(entity));
    },
    [openHashInNewTab],
  );

  const navigateToConnectionPath = useCallback(
    (path: ConnectionEntity[]) => {
      navigateToHash(serializeConnectionPathHash(path), "navigation");
    },
    [navigateToHash],
  );

  const openConnectionPathInNewTab = useCallback(
    (path: ConnectionEntity[]) => {
      openHashInNewTab(serializeConnectionPathHash(path));
    },
    [openHashInNewTab],
  );

  useEffect(() => {
    window.idleFetch = () => startIdleFetch();

    return () => {
      Reflect.deleteProperty(window, "idleFetch");
    };
  }, []);

  useEffect(() => {
    return connectCinenerdleIndexedDbBootstrap(setCinenerdleIndexedDbBootstrapStatus);
  }, []);

  useEffect(() => {
    const delayManager = createIndexedDbBootstrapLoadingShellDelayManager({
      clearTimeout: window.clearTimeout.bind(window),
      onDelayElapsed: () => {
        setHasIndexedDbBootstrapLoadingShellDelayElapsed(true);
      },
      onDelayReset: () => {
        setHasIndexedDbBootstrapLoadingShellDelayElapsed(false);
      },
      setTimeout: window.setTimeout.bind(window),
    });

    indexedDbBootstrapLoadingShellDelayManagerRef.current = delayManager;

    return () => {
      delayManager.dispose();
      indexedDbBootstrapLoadingShellDelayManagerRef.current = null;
    };
  }, []);

  useEffect(() => {
    indexedDbBootstrapLoadingShellDelayManagerRef.current?.sync(
      cinenerdleIndexedDbBootstrapStatus,
    );
  }, [cinenerdleIndexedDbBootstrapStatus]);

  useEffect(() => {
    let isActive = true;

    function syncClearDbFetchCount() {
      setClearDbFetchCount(getCinenerdleFetchDebugEntryCount());
    }

    function syncClearDbTotalFetchCount() {
      void getCinenerdleIndexedDbFetchCount()
        .then((count) => {
          if (isActive) {
            setClearDbTotalFetchCount(count);
          }
        })
        .catch(() => { });
    }

    syncClearDbFetchCount();
    syncClearDbTotalFetchCount();
    window.addEventListener(CINENERDLE_DEBUG_LOG_UPDATED_EVENT, syncClearDbFetchCount);
    window.addEventListener(
      CINENERDLE_INDEXED_DB_FETCH_COUNT_UPDATED_EVENT,
      syncClearDbTotalFetchCount,
    );
    return () => {
      isActive = false;
      window.removeEventListener(CINENERDLE_DEBUG_LOG_UPDATED_EVENT, syncClearDbFetchCount);
      window.removeEventListener(
        CINENERDLE_INDEXED_DB_FETCH_COUNT_UPDATED_EVENT,
        syncClearDbTotalFetchCount,
      );
    };
  }, []);

  useEffect(() => {
    window.copyCinenerdleRecoveryDebugLog = () => copyCinenerdleRecoveryDebugLogToClipboard();

    if (!import.meta.env.DEV) {
      return () => {
        Reflect.deleteProperty(window, "copyCinenerdleRecoveryDebugLog");
      };
    }

    window.copyCinenerdleBootstrapDebugLog = () => copyCinenerdleBootstrapDebugLogToClipboard();
    window.copyCinenerdleDebugLog = () => copyCinenerdleDebugLogToClipboard();
    window.copyCinenerdlePerfDebugLog = () => copyCinenerdlePerfDebugLogToClipboard();
    window.copyCinenerdleSearchablePersistenceDebugLog =
      () => copyCinenerdleSearchablePersistenceDebugLogToClipboard();
    window.copyCinenerdleSnapshot = () => copyCinenerdleIndexedDbSnapshotToClipboard();

    return () => {
      Reflect.deleteProperty(window, "copyCinenerdleBootstrapDebugLog");
      Reflect.deleteProperty(window, "copyCinenerdleDebugLog");
      Reflect.deleteProperty(window, "copyCinenerdlePerfDebugLog");
      Reflect.deleteProperty(window, "copyCinenerdleRecoveryDebugLog");
      Reflect.deleteProperty(window, "copyCinenerdleSearchablePersistenceDebugLog");
      Reflect.deleteProperty(window, "copyCinenerdleSnapshot");
    };
  }, []);

  useEffect(() => {
    if (!copyStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyStatus("");
      setCopyStatusPlacement("toast");
    }, 2000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyStatus]);

  useEffect(() => {
    document.title = isBookmarksView ? "Bookmarks | BaconDegrees420" : getDocumentTitle(hashValue);
  }, [hashValue, isBookmarksView]);

  useEffect(() => {
    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      const action = getWindowKeyDownAction({
        event,
        isBookmarksJsonlEditorOpen,
      });

      if (action === "close-bookmarks-jsonl-editor") {
        event.preventDefault();
        handleCloseBookmarksJsonlEditor();
        return;
      }

      if (action === "toggle-bookmarks") {
        event.preventDefault();
        toggleBookmarks();
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [handleCloseBookmarksJsonlEditor, isBookmarksJsonlEditorOpen, toggleBookmarks]);

  useEffect(() => {
    let cancelled = false;

    void (shouldResolveConnectionMatchupPreview({
      isBookmarksView,
      isCinenerdleIndexedDbBootstrapLoading,
      youngestSelectedCard,
    })
      ? resolveConnectionMatchupPreview(youngestSelectedCard)
      : Promise.resolve<ConnectionMatchupPreviewData | null>(null))
      .then((nextPreview) => {
        if (!cancelled) {
          setConnectionMatchupPreview(nextPreview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConnectionMatchupPreview(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    connectionMatchupPreviewRefreshVersion,
    isBookmarksView,
    isCinenerdleIndexedDbBootstrapLoading,
    youngestSelectedCard,
  ]);

  useEffect(() => {
    function handleRecordsUpdated() {
      setConnectionMatchupPreviewRefreshVersion((version) => version + 1);
    }

    window.addEventListener(CINENERDLE_RECORDS_UPDATED_EVENT, handleRecordsUpdated);
    return () => {
      window.removeEventListener(CINENERDLE_RECORDS_UPDATED_EVENT, handleRecordsUpdated);
    };
  }, []);

  function handleReset() {
    resetLocation();
    setResetVersion((version) => version + 1);
  }

  function handleClearDatabase() {
    void estimateIndexedDbUsageBytes().then((bytes) => {
      const confirmed = window.confirm(
        formatIndexedDbClearConfirmationMessage(bytes),
      );

      if (!confirmed) {
        return copyCinenerdleIndexedDbSnapshotToClipboard()
          .then(({ peopleCount, filmCount, searchableConnectionEntityCount }) => {
            sayToast(
              `DB copied (${peopleCount} people, ${filmCount} films, ${searchableConnectionEntityCount} search)`,
            );
          })
          .catch((error: unknown) => {
            sayToast(
              error instanceof Error && error.message
                ? error.message
                : "DB copy failed",
            );
          });
      }

      return clearIndexedDb()
        .then(() => {
          if (cinenerdleIndexedDbBootstrapStatus.resetRequiredMessage) {
            window.location.reload();
            return;
          }

          handleReset();
        })
        .catch((error: unknown) => {
          sayToast(
            error instanceof Error && error.message
              ? error.message
              : "Clear DB failed",
          );
        });
    });
  }

  function handleTitleDebugCopy(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!import.meta.env.DEV) {
      return;
    }

    void copyCinenerdleDebugLogToClipboard()
      .then((entryCount) => {
        setCopyStatusPlacement("title");
        setCopyStatus(`${entryCount} logs splice copied`);
      })
      .catch((error: unknown) => {
        setCopyStatusPlacement("title");
        setCopyStatus(
          error instanceof Error && error.message
            ? error.message
            : "Debug copy failed",
        );
      });
  }

  return (
    <div className="bacon-app-shell">
      {isBookmarksJsonlEditorOpen ? (
        <div
          className="bacon-modal-backdrop"
          onClick={handleCloseBookmarksJsonlEditor}
          role="presentation"
        >
          <BookmarksJsonlEditorModal
            bookmarksJsonlDraft={bookmarksJsonlDraft}
            isBookmarksJsonlDraftDirty={isBookmarksJsonlDraftDirty}
            onApply={handleApplyBookmarksJsonl}
            onChange={setBookmarksJsonlDraft}
            onClose={handleCloseBookmarksJsonlEditor}
            onReset={handleResetBookmarksJsonlDraft}
            textareaRef={bookmarksJsonlTextareaRef}
          />
        </div>
      ) : null}

      <BaconTitleBar
        clearDbBadgeText={clearDbBadgeText}
        clearDbButtonRef={clearDbButtonRef}
        copyStatus={copyStatus}
        copyStatusPlacement={copyStatusPlacement}
        isBookmarksView={isBookmarksView}
        isSavingBookmark={isSavingBookmark}
        matchupPreview={<ConnectionMatchupPreview preview={connectionMatchupPreview} />}
        onClearDatabase={handleClearDatabase}
        onOpenBookmarksJsonlEditor={handleOpenBookmarksJsonlEditor}
        onReset={handleReset}
        onSaveBookmark={handleSaveBookmark}
        onTitleDebugCopy={import.meta.env.DEV ? handleTitleDebugCopy : undefined}
        onToggleBookmarks={toggleBookmarks}
        titleRef={titleRef}
        toastStatusRef={toastStatusRef}
      />

      {shouldShowIndexedDbBootstrapLoadingShellIndicator ? (
        <IndexedDbBootstrapLoadingIndicator
          phase={cinenerdleIndexedDbBootstrapStatus.phase}
          resetRequiredMessage={cinenerdleIndexedDbBootstrapStatus.resetRequiredMessage}
        />
      ) : null}

      {!isBookmarksView && !isCinenerdleIndexedDbBootstrapLoading ? (
        <section className="bacon-connection-bar">
          <ConnectionBar
            connectionInputWrapRef={connectionInputWrapRef}
            connectionQuery={connectionQuery}
            connectionSuggestions={connectionSuggestions}
            highestGenerationSelectedLabel={highestGenerationSelectedLabel}
            isConnectionInputDisabled={isConnectionInputDisabled}
            isSearchablePersistencePending={isSearchablePersistencePending}
            onConnectionQueryChange={setConnectionQuery}
            onInputKeyDown={handleConnectionInputKeyDown}
            onSubmit={handleConnectionSubmit}
            onSuggestionClick={handleConnectionSuggestionClick}
            onSuggestionHover={setSelectedSuggestionIndex}
            selectedPathTooltipEntries={selectedPathTooltipEntries}
            selectedSuggestionIndex={selectedSuggestionIndex}
          />
          <ConnectionResults
            connectionSession={connectionSession}
            navigateToConnectionEntity={navigateToConnectionEntity}
            navigateToConnectionPath={navigateToConnectionPath}
            openConnectionEntityInNewTab={openConnectionEntityInNewTab}
            openConnectionPathInNewTab={openConnectionPathInNewTab}
            spawnAlternativeConnectionRow={spawnAlternativeConnectionRow}
          />
        </section>
      ) : null}

      {!isCinenerdleIndexedDbBootstrapLoading ? (
        <main className="bacon-app-content">
          {isBookmarksView ? (
            <BookmarksPage
              bookmarkRows={displayedBookmarkRows}
              bookmarks={bookmarks}
              onLoadBookmark={loadBookmarkHash}
              onLoadBookmarkCard={loadBookmarkCardHash}
              onMoveBookmark={handleMoveBookmark}
              onOpenBookmarkCardAsRootInNewTab={openBookmarkCardAsRootInNewTab}
              onRemoveBookmark={handleRemoveBookmark}
            />
          ) : (
            <Cinenerdle2
              hashValue={hashValue}
              highlightedConnectionEntity={highlightedConnectionEntity}
              highlightedConnectionEntitySelectionRequest={highlightedConnectionEntitySelectionRequest}
              navigationVersion={navigationVersion}
              onHighlightedConnectionEntitySelectionHandled={handleHighlightedConnectionEntitySelectionHandled}
              onHighlightedConnectionEntityYoungestGenerationMatchChange={setIsHighlightedConnectionEntityInYoungestGeneration}
              onYoungestSelectedCardChange={setYoungestSelectedCard}
              onHashWrite={handleHashWrite}
              resetVersion={resetVersion}
            />
          )}
        </main>
      ) : null}
    </div>
  );
}

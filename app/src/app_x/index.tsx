import {
  Fragment,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  loadBookmarks,
  moveBookmarkEntry,
  parseBookmarksJsonl,
  removeBookmarkEntry,
  saveBookmarks,
  serializeBookmarksAsJsonl,
  upsertBookmarkEntry,
  type AppViewMode,
  type BookmarkEntry,
} from "./bookmarks";
import { formatClearDbBadgeText } from "./clear_db_badge";
import ConnectionEntityCard from "./components/connection_entity_card";
import FancyTooltip from "./components/fancy_tooltip";
import {
  compareRankedConnectionSuggestions,
  compareRankedSearchableConnectionEntityRecords,
  getConnectionSuggestionScore,
} from "./connection_autocomplete";
import {
  shouldActivateConnectedDropdownSuggestion,
  shouldResolveConnectionMatchupPreview,
} from "./connection_matchup_helpers";
import {
  resolveConnectionMatchupPreview,
  type ConnectionMatchupPreview,
  type ConnectionMatchupPreviewEntity,
  type YoungestSelectedCard,
} from "./connection_matchup_preview";
import { annotateDirectionalConnectionPathRanks } from "./connection_path_ranks";
import Cinenerdle2, {
  CinenerdleBreakBar,
  CinenerdleEntityCard,
  type RenderableCinenerdleEntityCard,
} from "./generators/cinenerdle2";
import {
  connectCinenerdleIndexedDbBootstrap,
  type CinenerdleIndexedDbBootstrapPhase,
  type CinenerdleIndexedDbBootstrapStatus,
} from "./generators/cinenerdle2/bootstrap";
import {
  createCinenerdleOnlyPersonCard,
  createCinenerdleRootCard,
  createMovieRootCard,
  createPersonRootCard,
} from "./generators/cinenerdle2/cards";
import {
  createCinenerdleConnectionEntity,
  createFallbackConnectionEntity,
  findConnectionPathBidirectional,
  getConnectionEdgeKey,
  getMovieConnectionEntityKey,
  getPersonConnectionEntityKey,
  hydrateConnectionEntityFromKey,
  hydrateConnectionEntityFromSearchRecord,
  type ConnectionEntity,
  type ConnectionSearchResult,
} from "./generators/cinenerdle2/connection_graph";
import {
  ESCAPE_LABEL,
  TMDB_ICON_URL,
} from "./generators/cinenerdle2/constants";
import {
  hydrateHashPathItems,
} from "./generators/cinenerdle2/controller";
import {
  addCinenerdleDebugLog,
  copyCinenerdleBootstrapDebugLogToClipboard,
  copyCinenerdleDebugLogToClipboard,
  copyCinenerdleIndexedDbSnapshotToClipboard,
  copyCinenerdlePerfDebugLogToClipboard,
  copyCinenerdleRecoveryDebugLogToClipboard,
  copyCinenerdleSearchablePersistenceDebugLogToClipboard,
  copyCinenerdleTextToClipboard,
} from "./generators/cinenerdle2/debug";
import {
  CINENERDLE_DEBUG_LOG_UPDATED_EVENT,
  getCinenerdleFetchDebugEntryCount,
} from "./generators/cinenerdle2/debug_log";
import {
  buildPathNodesFromSegments,
  createPathNode,
  normalizeHashValue,
  parseHashSegments,
  serializePathNodes,
} from "./generators/cinenerdle2/hash";
import {
  startIdleFetch,
  type IdleFetchHandle,
} from "./generators/cinenerdle2/idle_fetch";
import {
  CINENERDLE_INDEXED_DB_FETCH_COUNT_UPDATED_EVENT,
  CINENERDLE_RECORDS_UPDATED_EVENT,
  batchCinenerdleRecordsUpdatedEvents,
  clearIndexedDb,
  estimateIndexedDbUsageBytes,
  getAllSearchableConnectionEntities,
  getCinenerdleIndexedDbFetchCount,
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
import {
  hasDirectTmdbMovieSource,
  hasDirectTmdbPersonSource,
} from "./generators/cinenerdle2/tmdb_provenance";
import type {
  FilmRecord,
  PersonRecord,
} from "./generators/cinenerdle2/types";
import {
  formatMoviePathLabel,
  getAssociatedMoviesFromPersonCredits,
  getAssociatedPeopleFromMovieCredits,
  getFilmKey,
  getValidTmdbEntityId,
  normalizeName,
  normalizeTitle,
  normalizeWhitespace,
  parseMoviePathLabel,
} from "./generators/cinenerdle2/utils";
import { createCardViewModel } from "./generators/cinenerdle2/view_model";
import type {
  CinenerdleCard,
  CinenerdlePathNode,
} from "./generators/cinenerdle2/view_types";
import {
  didRequestNewTabNavigation,
  getBookmarkPreviewCardHash,
  getBookmarkPreviewCardRootHash,
  getSelectedPathTooltipEntries,
} from "./index_helpers";
import {
  createIndexedDbBootstrapLoadingShellDelayManager,
  shouldShowIndexedDbBootstrapLoadingShell,
  type IndexedDbBootstrapLoadingShellDelayManager,
} from "./indexed_db_bootstrap_loading_shell";
import { formatIndexedDbClearConfirmationMessage } from "./indexed_db_clear_confirmation";
import { measureAsync } from "./perf";
import "./styles/app_shell.css";
import { getWindowKeyDownAction } from "./window_keydown";

type ConnectionSuggestion = Omit<ConnectionEntity, "kind"> & {
  kind: "person" | "movie";
  popularity: number;
  isConnectedToYoungestSelection: boolean;
  connectionOrderToYoungestSelection: number | null;
  sortScore: number;
};

type PendingHashWrite = {
  hash: string;
  mode: "selection" | "navigation";
};

type HighlightedConnectionEntitySelectionRequest = {
  requestKey: string;
  entity: ConnectionEntity;
};

type ConnectionExclusion =
  | {
    kind: "node";
    nodeKey: string;
  }
  | {
    kind: "edge";
    edgeKey: string;
  };

type BookmarkRowCard =
  | {
    kind: "break";
    key: string;
    label: string;
  }
  | {
    kind: "card";
    key: string;
    card: RenderableCinenerdleEntityCard;
  };

type BookmarkRowData = {
  hash: string;
  cards: BookmarkRowCard[];
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
    tmdbId: number | null;
  }
  | null;

const CONNECTION_MATCHUP_TOOLTIP_KEY = "matchup";
const CONNECTION_MATCHUP_SPOILER_EXPLANATION =
  "-/-> best-connected";

function getIndexedDbBootstrapLoadingLabel(
  phase: CinenerdleIndexedDbBootstrapPhase,
): string {
  if (phase === "reset-required") {
    return "Clear DB and refresh";
  }

  if (phase === "processing") {
    return "Processing data";
  }

  return "Preparing data";
}

export function IndexedDbBootstrapLoadingIndicator(props: {
  phase?: CinenerdleIndexedDbBootstrapPhase;
  resetRequiredMessage?: string | null;
}) {
  const phase = props.phase ?? "processing";
  const resetRequiredMessage = props.resetRequiredMessage ?? null;

  return (
    <div className="bacon-indexeddb-bootstrap-loading-shell">
      <div
        aria-busy="true"
        aria-label={getIndexedDbBootstrapLoadingLabel(phase)}
        className="bacon-indexeddb-bootstrap-loading"
        role="status"
      >
        <span aria-hidden="true" className="bacon-connection-matchup-spinner" />
        <span className="bacon-indexeddb-bootstrap-loading-label">
          {getIndexedDbBootstrapLoadingLabel(phase)}
        </span>
      </div>
      {phase === "reset-required" && resetRequiredMessage ? (
        <p className="bacon-indexeddb-bootstrap-loading-reset-message">
          {resetRequiredMessage}
        </p>
      ) : null}
    </div>
  );
}

export function BookmarksJsonlEditButton(props: {
  onClick: () => void;
}) {
  return (
    <button
      aria-label="Edit as text"
      className="bacon-title-action-button"
      onClick={props.onClick}
      type="button"
    >
      <span>Edit as text</span>
    </button>
  );
}

/* eslint-disable-next-line react-refresh/only-export-components */
export function isBookmarksJsonlDraftChanged(
  serializedBookmarksJsonl: string,
  bookmarksJsonlDraft: string,
): boolean {
  return bookmarksJsonlDraft !== serializedBookmarksJsonl;
}

/* eslint-disable-next-line react-refresh/only-export-components */
export function resetBookmarksJsonlDraft(serializedBookmarksJsonl: string): string {
  return serializedBookmarksJsonl;
}

export function BookmarksJsonlEditorModal({
  bookmarksJsonlDraft,
  isBookmarksJsonlDraftDirty,
  onApply,
  onChange,
  onClose,
  onReset,
  textareaRef,
}: {
  bookmarksJsonlDraft: string;
  isBookmarksJsonlDraftDirty: boolean;
  onApply: () => void;
  onChange: (nextDraft: string) => void;
  onClose: () => void;
  onReset: () => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <div
      aria-label="Edit as text"
      aria-modal="true"
      className="bacon-modal bacon-bookmarks-jsonl-modal"
      onClick={(event) => event.stopPropagation()}
      role="dialog"
    >
      <button
        aria-label="Close JSONL editor"
        className="bacon-title-action-icon-button bacon-bookmarks-jsonl-modal-close"
        onClick={onClose}
        type="button"
      >
        ✕
      </button>
      <textarea
        className="bacon-bookmarks-jsonl-textarea"
        id="bacon-bookmarks-jsonl-textarea"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        ref={textareaRef}
        spellCheck={false}
        value={bookmarksJsonlDraft}
      />
      <div className="bacon-bookmarks-jsonl-modal-actions">
        <button
          className="bacon-title-action-button"
          disabled={!isBookmarksJsonlDraftDirty}
          onClick={onReset}
          type="button"
        >
          Reset
        </button>
        <button
          className="bacon-title-action-button"
          disabled={!isBookmarksJsonlDraftDirty}
          onClick={onApply}
          type="button"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export function BaconTitleBar({
  bookmarkOverlayMessage,
  clearDbBadgeText,
  copyStatus,
  copyStatusPlacement,
  isBookmarksView,
  isConnectionMatchupShellOverflowVisible,
  isSavingBookmark,
  onBookmarkSaveTooltipHide,
  onBookmarkSaveTooltipShow,
  onBookmarkToggleTooltipHide,
  onBookmarkToggleTooltipShow,
  onClearDatabase,
  onOpenBookmarksJsonlEditor,
  onReset,
  onSaveBookmark,
  onToggleBookmarks,
  onTitleDebugCopy,
  renderConnectionMatchupPreview,
  clearDbButtonRef,
  titleRef,
  toastStatusRef,
}: {
  bookmarkOverlayMessage?: string | null;
  clearDbBadgeText: string;
  copyStatus: string;
  copyStatusPlacement: "toast" | "title";
  isBookmarksView: boolean;
  isConnectionMatchupShellOverflowVisible: boolean;
  isSavingBookmark: boolean;
  onBookmarkSaveTooltipHide: () => void;
  onBookmarkSaveTooltipShow: () => void;
  onBookmarkToggleTooltipHide: () => void;
  onBookmarkToggleTooltipShow: () => void;
  onClearDatabase: () => void;
  onOpenBookmarksJsonlEditor: () => void;
  onReset: () => void;
  onSaveBookmark: () => void;
  onToggleBookmarks: () => void;
  onTitleDebugCopy?: (event: MouseEvent<HTMLElement>) => void;
  renderConnectionMatchupPreview: () => ReactNode;
  clearDbButtonRef?: Ref<HTMLButtonElement>;
  titleRef?: Ref<HTMLHeadingElement>;
  toastStatusRef?: Ref<HTMLSpanElement>;
}) {
  const titleCopyStatus =
    copyStatus && copyStatusPlacement === "title" ? copyStatus : "";
  const toastOverlayMessage =
    copyStatus && copyStatusPlacement === "toast" ? copyStatus : "";
  const overlayBookmarkMessage = toastOverlayMessage ? "" : bookmarkOverlayMessage ?? "";
  const matchupPreview = renderConnectionMatchupPreview();

  return (
    <header className="bacon-title-bar">
      <div className="bacon-title-brand">
        <button
          aria-label="Reset generator"
          className="bacon-title-icon-button"
          onClick={onReset}
          type="button"
        >
          <span aria-hidden="true" className="bacon-title-icon">
            B
          </span>
        </button>
        <div className="bacon-title-wrap">
          <h1
            className="bacon-title"
            onClick={onTitleDebugCopy}
            ref={titleRef}
          >
            BaconDegrees420
          </h1>
          {titleCopyStatus ? (
            <span className="bacon-copy-status bacon-copy-status-title">
              {titleCopyStatus}
            </span>
          ) : null}
        </div>
      </div>
      <div
        className={[
          "bacon-title-actions",
          isConnectionMatchupShellOverflowVisible ? "bacon-title-actions-overflow-visible" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {matchupPreview ? (
          <div className="bacon-title-action-slot bacon-title-action-slot-matchup">
            {matchupPreview}
          </div>
        ) : null}
        {!isBookmarksView ? (
          <div className="bacon-title-action-slot bacon-title-action-slot-square">
            <button
              aria-label="Save bookmark"
              className="bacon-title-action-icon-button"
              disabled={isSavingBookmark}
              onBlur={onBookmarkSaveTooltipHide}
              onFocus={onBookmarkSaveTooltipShow}
              onMouseEnter={onBookmarkSaveTooltipShow}
              onMouseLeave={onBookmarkSaveTooltipHide}
              onClick={onSaveBookmark}
              type="button"
            >
              💾
            </button>
          </div>
        ) : null}
        {isBookmarksView ? (
          <div className="bacon-title-action-slot bacon-title-action-slot-text">
            <BookmarksJsonlEditButton onClick={onOpenBookmarksJsonlEditor} />
          </div>
        ) : null}
        <div className="bacon-title-action-slot bacon-title-action-slot-square">
          <button
            aria-label={isBookmarksView ? "Close bookmarks" : "Open bookmarks"}
            className="bacon-title-action-icon-button"
            onBlur={onBookmarkToggleTooltipHide}
            onFocus={onBookmarkToggleTooltipShow}
            onMouseDown={(event) => {
              event.currentTarget.focus();
            }}
            onMouseEnter={onBookmarkToggleTooltipShow}
            onMouseLeave={onBookmarkToggleTooltipHide}
            onClick={(event) => {
              onBookmarkToggleTooltipHide();
              event.currentTarget.blur();
              onToggleBookmarks();
            }}
            type="button"
          >
            {isBookmarksView ? "🎬" : "📚"}
          </button>
        </div>
        <div className="bacon-title-action-slot bacon-title-action-slot-text">
          <div className="bacon-title-overlay-anchor">
            {toastOverlayMessage ? (
              <span
                className="bacon-copy-status bacon-copy-status-overlay bacon-copy-status-overlay-toast"
                ref={toastStatusRef}
              >
                {toastOverlayMessage}
              </span>
            ) : null}
            {overlayBookmarkMessage ? (
              <span
                className="bacon-copy-status bacon-copy-status-overlay bacon-copy-status-overlay-tooltip"
                role="tooltip"
              >
                {overlayBookmarkMessage}
              </span>
            ) : null}
            <button
              aria-label={`Clear database (${clearDbBadgeText})`}
              className="bacon-title-action-button bacon-clear-db-button"
              onClick={onClearDatabase}
              ref={clearDbButtonRef}
              type="button"
            >
              {`Clear DB (${clearDbBadgeText})`}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function formatBoundingClientRect(rect: DOMRect) {
  const round = (value: number) => Math.round(value * 100) / 100;

  return {
    bottom: round(rect.bottom),
    height: round(rect.height),
    left: round(rect.left),
    right: round(rect.right),
    top: round(rect.top),
    width: round(rect.width),
    x: round(rect.x),
    y: round(rect.y),
  };
}

function isBookmarkToastMessage(message: string): boolean {
  return /^Bookmarks? /.test(message);
}

type ConnectionSearchRow = {
  id: string;
  excludedNodeKeys: string[];
  excludedEdgeKeys: string[];
  childDisallowedNodeKeys: string[];
  childDisallowedEdgeKeys: string[];
  parentRowId: string | null;
  sourceExclusion: ConnectionExclusion | null;
  status: ConnectionSearchResult["status"] | "searching";
  path: ConnectionEntity[];
};

type ConnectionSession = {
  id: string;
  left: ConnectionEntity;
  right: ConnectionEntity;
  rows: ConnectionSearchRow[];
};

type AppLocationState = {
  viewMode: AppViewMode;
  pathname: string;
  basePathname: string;
  hash: string;
};

const BOOKMARKS_PATH_SUFFIX = "/bookmarks";

declare global {
  interface Window {
    idleFetch: () => IdleFetchHandle;
    copyCinenerdleBootstrapDebugLog?: () => Promise<number>;
    copyCinenerdleDebugLog?: () => Promise<number>;
    copyCinenerdlePerfDebugLog?: () => Promise<number>;
    copyCinenerdleRecoveryDebugLog?: () => Promise<number>;
    copyCinenerdleSearchablePersistenceDebugLog?: () => Promise<number>;
    copyCinenerdleSnapshot?: typeof copyCinenerdleIndexedDbSnapshotToClipboard;
  }
}

function normalizePathname(pathname: string): string {
  const trimmedPathname = pathname.trim() || "/";
  const withLeadingSlash = trimmedPathname.startsWith("/") ? trimmedPathname : `/${trimmedPathname}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, "");
  return withoutTrailingSlash || "/";
}

function getBookmarksPathname(basePathname: string): string {
  const normalizedBasePathname = normalizePathname(basePathname);
  return normalizedBasePathname === "/"
    ? BOOKMARKS_PATH_SUFFIX
    : `${normalizedBasePathname}${BOOKMARKS_PATH_SUFFIX}`;
}

function getBasePathname(pathname: string): string {
  const normalizedPathname = normalizePathname(pathname);

  if (normalizedPathname === BOOKMARKS_PATH_SUFFIX) {
    return "/";
  }

  if (normalizedPathname.endsWith(BOOKMARKS_PATH_SUFFIX)) {
    return normalizePathname(
      normalizedPathname.slice(0, normalizedPathname.length - BOOKMARKS_PATH_SUFFIX.length),
    );
  }

  return normalizedPathname;
}

function readAppLocationState(): AppLocationState {
  const pathname = normalizePathname(window.location.pathname);
  const basePathname = getBasePathname(pathname);
  const viewMode: AppViewMode = pathname === getBookmarksPathname(basePathname)
    ? "bookmarks"
    : "generator";
  const normalizedHash = normalizeHashValue(window.location.hash);

  return {
    viewMode,
    pathname,
    basePathname,
    hash: normalizedHash,
  };
}

function buildLocationHref(pathname: string, hashValue: string) {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedHash = normalizeHashValue(hashValue);
  return `${normalizedPathname}${window.location.search}${normalizedHash}`;
}

function formatBookmarkLabel(hashValue: string): string {
  return getSelectedPathTooltipEntries(hashValue).join(" -> ");
}

function formatBookmarkIndexTooltip(bookmark: BookmarkEntry): string {
  return getSelectedPathTooltipEntries(bookmark.hash).join("\n");
}

function createUncachedBookmarkMovieCard(
  name: string,
  year: string,
): Extract<CinenerdleCard, { kind: "movie" }> {
  return {
    key: `movie:${normalizeTitle(name)}:${year}`,
    kind: "movie",
    name,
    year,
    popularity: 0,
    popularitySource: "Movie details are not cached yet, so popularity is unavailable.",
    imageUrl: null,
    subtitle: "Movie",
    subtitleDetail: "Not cached yet",
    connectionCount: null,
    sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
    status: null,
    voteAverage: null,
    voteCount: null,
    record: null,
  };
}

async function resolveBookmarkPathCard(
  pathNode: Extract<CinenerdlePathNode, { kind: "cinenerdle" | "movie" | "person" }>,
): Promise<Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>> {
  if (pathNode.kind === "cinenerdle") {
    return createCinenerdleRootCard(null) as Extract<
      CinenerdleCard,
      { kind: "cinenerdle" | "movie" | "person" }
    >;
  }

  if (pathNode.kind === "person") {
    const personRecord = pathNode.tmdbId
      ? await getPersonRecordById(pathNode.tmdbId)
      : await getPersonRecordByName(normalizeName(pathNode.name));

    return (
      personRecord
        ? createPersonRootCard(personRecord, pathNode.name)
        : createCinenerdleOnlyPersonCard(pathNode.name, "database only")
    ) as Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>;
  }

  const movieRecord = await getFilmRecordByTitleAndYear(pathNode.name, pathNode.year);

  return (
    movieRecord
      ? createMovieRootCard(movieRecord, pathNode.name)
      : createUncachedBookmarkMovieCard(pathNode.name, pathNode.year)
  ) as Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>;
}

function createRenderableBookmarkCard(
  card: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>,
): RenderableCinenerdleEntityCard {
  const viewModel = createCardViewModel(card, {
    isSelected: false,
  });

  if (viewModel.kind === "break" || viewModel.kind === "dbinfo") {
    throw new Error("Bookmark rows cannot render non-entity cards");
  }

  if (viewModel.kind === "movie") {
    return {
      ...viewModel,
      onExplicitTmdbRowClick: null,
      onTmdbRowClick: null,
      tmdbTooltipText: null,
    };
  }

  return {
    ...viewModel,
    onExplicitTmdbRowClick: null,
    onTmdbRowClick: null,
    tmdbTooltipText: null,
  };
}

async function buildBookmarkRowData(hashValue: string): Promise<BookmarkRowData> {
  const bookmarkPathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue)).filter(
    (pathNode): pathNode is Extract<
      CinenerdlePathNode,
      { kind: "cinenerdle" | "movie" | "person" | "break" }
    > =>
      pathNode.kind === "cinenerdle" ||
      pathNode.kind === "movie" ||
      pathNode.kind === "person" ||
      pathNode.kind === "break",
  );

  const cards = (await Promise.all(
    bookmarkPathNodes.map(async (pathNode, index) => {
      if (pathNode.kind === "break") {
        return {
          kind: "break" as const,
          key: `${hashValue}:break:${index}`,
          label: ESCAPE_LABEL,
        };
      }

      const card = await resolveBookmarkPathCard(pathNode);
      return {
        kind: "card" as const,
        key: `${hashValue}:${index}:${card.key}`,
        card: createRenderableBookmarkCard(card),
      };
    }),
  )).filter((card): card is BookmarkRowCard => Boolean(card));

  return {
    hash: hashValue,
    cards,
  };
}

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
    tmdbId: selectedPathNode.tmdbId,
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

async function resolveYoungestSelectedPersonRecord(
  card: Extract<YoungestSelectedCard, { kind: "person" }>,
) {
  const tmdbId = getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id ?? null);
  if (tmdbId) {
    const personRecord = await getPersonRecordById(tmdbId);
    if (personRecord) {
      return personRecord;
    }
  }

  return getPersonRecordByName(card.name);
}

async function getDirectConnectionOrdersForYoungestSelectedCard(
  card: YoungestSelectedCard | null,
): Promise<Record<string, number | null>> {
  return measureAsync(
    "app.getDirectConnectionOrdersForYoungestSelectedCard",
    async () => {
      if (!card || card.kind === "cinenerdle") {
        return {};
      }

      const directConnectionOrders = new Map<string, number | null>();
      const setDirectConnectionOrder = (key: string) => {
        if (!directConnectionOrders.has(key)) {
          directConnectionOrders.set(key, directConnectionOrders.size + 1);
        }
      };

      if (card.kind === "movie") {
        const movieRecord = await getFilmRecordByTitleAndYear(card.name, card.year);
        if (!movieRecord) {
          return {};
        }

        const tmdbCredits = getAssociatedPeopleFromMovieCredits(movieRecord);

        if (tmdbCredits.length > 0) {
          tmdbCredits.forEach((credit) => {
            const personName = credit.name ?? "";
            const personTmdbId = getValidTmdbEntityId(credit.id);
            if (personTmdbId || normalizeName(personName)) {
              setDirectConnectionOrder(getPersonConnectionEntityKey(personName, personTmdbId));
            }
          });
        } else {
          movieRecord.personConnectionKeys.forEach((personName) => {
            if (normalizeName(personName)) {
              setDirectConnectionOrder(getPersonConnectionEntityKey(personName));
            }
          });
        }

        return Object.fromEntries(directConnectionOrders);
      }

      const personRecord = await resolveYoungestSelectedPersonRecord(card);
      if (!personRecord) {
        return {};
      }

      const movieCredits = getAssociatedMoviesFromPersonCredits(personRecord);

      if (movieCredits.length > 0) {
        movieCredits.forEach((credit) => {
          const movieName = credit.title ?? credit.original_title ?? "";
          if (movieName) {
            setDirectConnectionOrder(
              getMovieConnectionEntityKey(movieName, credit.release_date?.slice(0, 4) ?? ""),
            );
          }
        });
      } else {
        personRecord.movieConnectionKeys.forEach((movieKey) => {
          const parsedMovie = parseMoviePathLabel(movieKey);
          if (parsedMovie.name) {
            setDirectConnectionOrder(
              getMovieConnectionEntityKey(parsedMovie.name, parsedMovie.year),
            );
          }
        });
      }

      return Object.fromEntries(directConnectionOrders);
    },
    {
      always: true,
      details: {
        cardKey: card?.key ?? "",
        cardKind: card?.kind ?? "none",
      },
      summarizeResult: (ordersByKey) => ({
        keyCount: Object.keys(ordersByKey).length,
      }),
    },
  );
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatHeatMetricValue(label: "Popularity" | "Votes" | "Rating", value: number) {
  if (label === "Popularity" || label === "Rating") {
    return Number(value.toFixed(2));
  }

  return value;
}

function createHeatChipStyle(value: number, maxValue: number): CSSProperties {
  const normalizedValue = clampNumber(value / maxValue, 0, 1);
  const hue = 210 - normalizedValue * 210;
  const backgroundLightness = 20 + normalizedValue * 12;
  const borderLightness = 34 + normalizedValue * 18;

  return {
    backgroundColor: `hsl(${hue} 55% ${backgroundLightness}%)`,
    border: `1px solid hsl(${hue} 70% ${borderLightness}%)`,
    color: "#eff6ff",
  };
}

function getTooltipPopularity(entry: string): number | null {
  const match = entry.match(/^Popularity:\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const popularity = Number(match[1]);
  return Number.isFinite(popularity) ? popularity : null;
}

function getPreviewFallbackText(name: string): string {
  const words = normalizeWhitespace(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (words.length === 0) {
    return "?";
  }

  return words.map((word) => word[0]?.toUpperCase() ?? "").join("");
}

function getTooltipEntries(tooltipText: string): string[] {
  return tooltipText
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function renderTooltipEntry(entry: string, key: string) {
  const popularity = getTooltipPopularity(entry);

  return (
    <span
      className="bacon-connection-pill-tooltip-entry"
      key={key}
    >
      {typeof popularity === "number" ? (
        <span
          className="cinenerdle-card-chip"
          style={createHeatChipStyle(popularity, 100)}
        >
          {`Popularity ${formatHeatMetricValue("Popularity", popularity)}`}
        </span>
      ) : (
        entry
      )}
    </span>
  );
}

function renderTooltipEntries(
  tooltipEntries: string[],
  keyPrefix: string,
) {
  const titleEntry = tooltipEntries[0] ?? "";
  const inlinePopularity = tooltipEntries.length > 1
    ? getTooltipPopularity(tooltipEntries[1] ?? "")
    : null;
  const remainingEntries = inlinePopularity === null
    ? tooltipEntries.slice(1)
    : tooltipEntries.slice(2);

  if (!titleEntry) {
    return remainingEntries.map((entry, index) =>
      renderTooltipEntry(entry, `${keyPrefix}:${index}:${entry}`));
  }

  return [
    <span
      className="bacon-connection-pill-tooltip-entry"
      key={`${keyPrefix}:title`}
    >
      <span className="bacon-connection-pill-tooltip-entry-group">
        <span>{titleEntry}</span>
        {typeof inlinePopularity === "number" ? (
          <span className="bacon-connection-pill-tooltip-entry-group-secondary">
            <span
              className="cinenerdle-card-chip"
              style={createHeatChipStyle(inlinePopularity, 100)}
            >
              {`Popularity ${formatHeatMetricValue("Popularity", inlinePopularity)}`}
            </span>
          </span>
        ) : null}
      </span>
    </span>,
    ...remainingEntries.map((entry, index) =>
      renderTooltipEntry(entry, `${keyPrefix}:${index}:${entry}`)),
  ];
}

function createPathNodeFromConnectionEntity(entity: ConnectionEntity) {
  if (entity.kind === "cinenerdle") {
    return createPathNode("cinenerdle", "cinenerdle");
  }

  if (entity.kind === "movie") {
    return createPathNode("movie", entity.name, entity.year);
  }

  return createPathNode("person", entity.name, "", entity.tmdbId);
}

function serializeConnectionEntityHash(entity: ConnectionEntity): string {
  return serializePathNodes([createPathNodeFromConnectionEntity(entity)]);
}

function serializeConnectionPathHash(path: ConnectionEntity[]): string {
  return serializePathNodes(path.map((entity) => createPathNodeFromConnectionEntity(entity)));
}

function createSearchingConnectionRow(
  id: string,
  options?: {
    parentRowId?: string | null;
    sourceExclusion?: ConnectionExclusion | null;
  },
): ConnectionSearchRow {
  return {
    id,
    excludedNodeKeys: [],
    excludedEdgeKeys: [],
    childDisallowedNodeKeys: [],
    childDisallowedEdgeKeys: [],
    parentRowId: options?.parentRowId ?? null,
    sourceExclusion: options?.sourceExclusion ?? null,
    status: "searching",
    path: [],
  };
}

function matchesConnectionExclusion(
  left: ConnectionExclusion | null,
  right: ConnectionExclusion | null,
): boolean {
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "node" && right.kind === "node") {
    return left.nodeKey === right.nodeKey;
  }

  if (left.kind === "edge" && right.kind === "edge") {
    return left.edgeKey === right.edgeKey;
  }

  return false;
}

function collectConnectionRowFamilyIds(
  rows: ConnectionSearchRow[],
  rootRowId: string,
): Set<string> {
  const familyIds = new Set<string>([rootRowId]);
  let foundNewDescendant = true;

  while (foundNewDescendant) {
    foundNewDescendant = false;

    rows.forEach((row) => {
      if (!row.parentRowId || familyIds.has(row.id) || !familyIds.has(row.parentRowId)) {
        return;
      }

      familyIds.add(row.id);
      foundNewDescendant = true;
    });
  }

  return familyIds;
}
export default function AppX() {
  const initialLocationState = readAppLocationState();
  const [appLocation, setAppLocation] = useState(initialLocationState);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [bookmarkRows, setBookmarkRows] = useState<BookmarkRowData[]>([]);
  const [hashValue, setHashValue] = useState(() => initialLocationState.hash);
  const [resetVersion, setResetVersion] = useState(0);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [youngestSelectedCard, setYoungestSelectedCard] = useState<YoungestSelectedCard | null>(null);
  const [connectionMatchupPreview, setConnectionMatchupPreview] =
    useState<ConnectionMatchupPreview | null>(null);
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
  const [isSavingBookmark, setIsSavingBookmark] = useState(false);
  const [bookmarkOverlayMessage, setBookmarkOverlayMessage] = useState<string | null>(null);
  const [isBookmarksJsonlEditorOpen, setIsBookmarksJsonlEditorOpen] = useState(false);
  const [bookmarksJsonlDraft, setBookmarksJsonlDraft] = useState("");
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
  const [, setIsHighlightedConnectionEntityInYoungestGeneration] =
    useState(false);
  const [isSelectedPathTooltipVisible, setIsSelectedPathTooltipVisible] = useState(false);
  const [visibleConnectionMatchupTooltipKey, setVisibleConnectionMatchupTooltipKey] =
    useState<string | null>(null);
  const [isConnectionMatchupShellOverflowVisible, setIsConnectionMatchupShellOverflowVisible] =
    useState(false);
  const connectionSessionRef = useRef<ConnectionSession | null>(null);
  const pendingHashWriteRef = useRef<PendingHashWrite | null>(null);
  const bookmarksRef = useRef<BookmarkEntry[]>([]);
  const bookmarksPersistenceRequestIdRef = useRef(0);
  const serializedBookmarksJsonlRef = useRef("");
  const lastSyncedHashRef = useRef(normalizeHashValue(initialLocationState.hash));
  const bookmarksReturnHashRef = useRef(normalizeHashValue(initialLocationState.hash));
  const bookmarksPageRenderCountRef = useRef(0);
  const autocompleteRequestIdRef = useRef(0);
  const connectionSessionIdRef = useRef(0);
  const connectionRowIdRef = useRef(0);
  const connectionBarRef = useRef<HTMLElement | null>(null);
  const connectionMatchupShellRef = useRef<HTMLDivElement | null>(null);
  const connectionInputWrapRef = useRef<HTMLDivElement | null>(null);
  const connectionDropdownRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const clearDbButtonRef = useRef<HTMLButtonElement | null>(null);
  const toastStatusRef = useRef<HTMLSpanElement | null>(null);
  const bookmarksJsonlTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightedConnectionEntitySelectionRequestIdRef = useRef(0);
  const indexedDbBootstrapLoadingShellDelayManagerRef =
    useRef<IndexedDbBootstrapLoadingShellDelayManager | null>(null);
  const deferredConnectionQuery = useDeferredValue(connectionQuery);
  const isBookmarksView = appLocation.viewMode === "bookmarks";
  const isCinenerdleIndexedDbBootstrapLoading = !cinenerdleIndexedDbBootstrapStatus.isCoreReady;
  const isSearchablePersistencePending =
    cinenerdleIndexedDbBootstrapStatus.isSearchablePersistencePending;
  const clearDbBadgeText = formatClearDbBadgeText(clearDbFetchCount, clearDbTotalFetchCount);
  const isConnectionInputDisabled = isResolvingConnection || isSearchablePersistencePending;
  const isAppBodyBlockedByIndexedDbBootstrap = isCinenerdleIndexedDbBootstrapLoading;
  const serializedBookmarksJsonl = serializeBookmarksAsJsonl(bookmarks);
  const isBookmarksJsonlDraftDirty = isBookmarksJsonlDraftChanged(
    serializedBookmarksJsonl,
    bookmarksJsonlDraft,
  );
  const displayedBookmarkRows =
    bookmarkRows.length === bookmarks.length
      ? bookmarkRows
      : bookmarks.map((bookmark) => ({
        hash: bookmark.hash,
        cards: [],
      }));
  const shouldShowIndexedDbBootstrapLoadingShellIndicator = shouldShowIndexedDbBootstrapLoadingShell({
    hasLoadingShellDelayElapsed: hasIndexedDbBootstrapLoadingShellDelayElapsed,
    status: cinenerdleIndexedDbBootstrapStatus,
  });
  const highestGenerationSelectedLabel = getHighestGenerationSelectedLabel(hashValue);
  const selectedPathTooltipEntries = getSelectedPathTooltipEntries(hashValue);
  const highlightedConnectionEntity =
    selectedSuggestionIndex >= 0 ? connectionSuggestions[selectedSuggestionIndex] ?? null : null;
  const youngestSelectedCardKey = youngestSelectedCard?.key ?? "";

  useEffect(() => {
    window.idleFetch = () => startIdleFetch();

    return () => {
      Reflect.deleteProperty(window, "idleFetch");
    };
  }, []);

  useEffect(() => {
    const matchupShellElement = connectionMatchupShellRef.current;
    const matchupShellParentElement = matchupShellElement?.parentElement ?? null;

    if (!matchupShellElement || !matchupShellParentElement) {
      setIsConnectionMatchupShellOverflowVisible(false);
      return;
    }

    const syncConnectionMatchupShellOverflowVisibility = () => {
      const matchupShellHeight = matchupShellElement.getBoundingClientRect().height;
      const matchupShellParentHeight = matchupShellParentElement.getBoundingClientRect().height;

      setIsConnectionMatchupShellOverflowVisible(matchupShellHeight > matchupShellParentHeight + 0.5);
    };

    syncConnectionMatchupShellOverflowVisibility();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      syncConnectionMatchupShellOverflowVisibility();
    });

    resizeObserver.observe(matchupShellElement);
    resizeObserver.observe(matchupShellParentElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [connectionMatchupPreview]);

  useEffect(() => {
    return connectCinenerdleIndexedDbBootstrap(setCinenerdleIndexedDbBootstrapStatus);
  }, []);

  useEffect(() => {
    const requestId = bookmarksPersistenceRequestIdRef.current;
    let isActive = true;

    void loadBookmarks()
      .then((loadedBookmarks) => {
        if (!isActive || bookmarksPersistenceRequestIdRef.current !== requestId) {
          return;
        }

        bookmarksRef.current = loadedBookmarks;
        setBookmarks(loadedBookmarks);
      })
      .catch(() => { });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    bookmarksRef.current = bookmarks;
  }, [bookmarks]);

  useEffect(() => {
    function handleCinenerdleRecordsUpdated() {
      void Promise.all(bookmarksRef.current.map((bookmark) => buildBookmarkRowData(bookmark.hash)))
        .then((nextBookmarkRows) => {
          setBookmarkRows(nextBookmarkRows);
        })
        .catch(() => { });
      setConnectionMatchupPreviewRefreshVersion((version) => version + 1);
    }

    window.addEventListener(
      CINENERDLE_RECORDS_UPDATED_EVENT,
      handleCinenerdleRecordsUpdated,
    );
    return () => {
      window.removeEventListener(
        CINENERDLE_RECORDS_UPDATED_EVENT,
        handleCinenerdleRecordsUpdated,
      );
    };
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
          if (!isActive) {
            return;
          }

          setClearDbTotalFetchCount(count);
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
    if (!import.meta.env.DEV) {
      return;
    }

    const titleElement = titleRef.current;
    if (!titleElement) {
      return;
    }

    titleElement.style.cursor = "pointer";

    return () => {
      titleElement.style.removeProperty("cursor");
    };
  }, []);

  useEffect(() => {
    connectionSessionRef.current = connectionSession;
  }, [connectionSession]);

  useEffect(() => {
    if (window.location.hash === hashValue) {
      return;
    }

    window.history.replaceState(
      null,
      "",
      buildLocationHref(appLocation.pathname, hashValue),
    );
  }, [appLocation.pathname, hashValue]);

  useEffect(() => {
    function syncHashState(nextHash: string) {
      const normalizedNextHash = normalizeHashValue(nextHash);
      const pendingHashWrite = pendingHashWriteRef.current;
      const matchedPendingHashWrite =
        pendingHashWrite !== null && pendingHashWrite.hash === normalizedNextHash;
      const isDuplicateHashSync = lastSyncedHashRef.current === normalizedNextHash;

      if (isDuplicateHashSync) {
        if (matchedPendingHashWrite) {
          pendingHashWriteRef.current = null;
        }

        return;
      }

      lastSyncedHashRef.current = normalizedNextHash;

      setHashValue(normalizedNextHash);

      if (!matchedPendingHashWrite || pendingHashWrite.mode !== "selection") {
        setNavigationVersion((version) => version + 1);
      }

      if (matchedPendingHashWrite) {
        pendingHashWriteRef.current = null;
      }
    }

    function handleHashChange() {
      setAppLocation(readAppLocationState());
      syncHashState(window.location.hash);
    }

    function handlePopState() {
      const nextLocation = readAppLocationState();
      setAppLocation(nextLocation);
      syncHashState(nextLocation.hash);
    }

    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("popstate", handlePopState);
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
    if (copyStatusPlacement === "toast" && copyStatus) {
      setBookmarkOverlayMessage(null);
    }
  }, [copyStatus, copyStatusPlacement]);

  useEffect(() => {
    if (
      copyStatusPlacement !== "toast" ||
      !copyStatus ||
      !isBookmarkToastMessage(copyStatus)
    ) {
      return;
    }

    let isCancelled = false;
    const frameId = window.requestAnimationFrame(() => {
      if (isCancelled) {
        return;
      }

      const toastElement = toastStatusRef.current;
      const clearDbButtonElement = clearDbButtonRef.current;
      if (!toastElement || !clearDbButtonElement) {
        return;
      }

      const payload = {
        clearDb: formatBoundingClientRect(clearDbButtonElement.getBoundingClientRect()),
        toast: formatBoundingClientRect(toastElement.getBoundingClientRect()),
        toastMessage: copyStatus,
      };

      void copyCinenerdleTextToClipboard(JSON.stringify(payload, null, 2)).catch(() => { });
    });

    return () => {
      isCancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [copyStatus, copyStatusPlacement]);

  function sayToast(message: string) {
    setCopyStatusPlacement("toast");
    setCopyStatus(message);
  }

  function showSaveBookmarkOverlay() {
    setBookmarkOverlayMessage(isSavingBookmark ? "Saving bookmark..." : "Save bookmark");
  }

  function hideBookmarkOverlay() {
    setBookmarkOverlayMessage(null);
  }

  function showToggleBookmarksOverlay() {
    setBookmarkOverlayMessage(isBookmarksView ? "Close bookmarks" : "Open bookmarks");
  }

  useEffect(() => {
    const previousSerializedBookmarksJsonl = serializedBookmarksJsonlRef.current;
    serializedBookmarksJsonlRef.current = serializedBookmarksJsonl;
    setBookmarksJsonlDraft((currentDraft) =>
      currentDraft === previousSerializedBookmarksJsonl
        ? serializedBookmarksJsonl
        : currentDraft
    );
  }, [serializedBookmarksJsonl]);

  useEffect(() => {
    if (!isBookmarksJsonlEditorOpen) {
      return;
    }

    bookmarksJsonlTextareaRef.current?.focus();
  }, [isBookmarksJsonlEditorOpen]);

  useEffect(() => {
    connectionSessionRef.current = null;
    setConnectionSession(null);
  }, [hashValue]);

  useEffect(() => {
    document.title = isBookmarksView ? "Bookmarks | BaconDegrees420" : getDocumentTitle(hashValue);
  }, [hashValue, isBookmarksView]);

  useEffect(() => {
    if (!isBookmarksView) {
      bookmarksPageRenderCountRef.current = 0;
      return;
    }

    bookmarksPageRenderCountRef.current += 1;

    addCinenerdleDebugLog("app:bookmarks-page:render", {
      hashValue,
      isBookmarksJsonlEditorOpen,
      bookmarkCount: bookmarks.length,
      bookmarkRowCardCount: bookmarkRows.reduce(
        (count, bookmarkRow) => count + bookmarkRow.cards.length,
        0,
      ),
      pathname: appLocation.pathname,
      renderCount: bookmarksPageRenderCountRef.current,
    });
  }, [
    appLocation.pathname,
    bookmarkRows,
    bookmarks,
    hashValue,
    isBookmarksJsonlEditorOpen,
    isBookmarksView,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (bookmarks.length === 0) {
      setBookmarkRows([]);
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(bookmarks.map((bookmark) => buildBookmarkRowData(bookmark.hash)))
      .then((nextBookmarkRows) => {
        if (cancelled) {
          return;
        }

        setBookmarkRows(nextBookmarkRows);
      })
      .catch(() => {
        if (!cancelled) {
          setBookmarkRows([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookmarks]);

  useEffect(() => {
    let cancelled = false;

    if (isCinenerdleIndexedDbBootstrapLoading || bookmarks.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void batchCinenerdleRecordsUpdatedEvents(async () => {
      for (const bookmark of bookmarks) {
        if (cancelled) {
          return;
        }

        await hydrateHashPathItems(bookmark.hash, {
          forceRefreshSelectedPath: false,
        });
      }
    }).catch(() => { });

    return () => {
      cancelled = true;
    };
  }, [bookmarks, isCinenerdleIndexedDbBootstrapLoading]);

  const persistBookmarks = useCallback(async (nextBookmarks: BookmarkEntry[]) => {
    const requestId = bookmarksPersistenceRequestIdRef.current + 1;
    bookmarksPersistenceRequestIdRef.current = requestId;
    bookmarksRef.current = nextBookmarks;
    setBookmarks(nextBookmarks);

    try {
      const persistedBookmarks = await saveBookmarks(nextBookmarks);
      if (bookmarksPersistenceRequestIdRef.current === requestId) {
        bookmarksRef.current = persistedBookmarks;
        setBookmarks(persistedBookmarks);
      }

      return persistedBookmarks;
    } catch (error: unknown) {
      if (bookmarksPersistenceRequestIdRef.current === requestId) {
        sayToast(
          error instanceof Error && error.message
            ? error.message
            : "Bookmark save failed",
        );
      }

      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!shouldResolveConnectionMatchupPreview({
      isBookmarksView,
      isCinenerdleIndexedDbBootstrapLoading,
      youngestSelectedCard,
    })) {
      setConnectionMatchupPreview(null);
      return () => {
        cancelled = true;
      };
    }

    void resolveConnectionMatchupPreview(youngestSelectedCard)
      .then((nextPreview) => {
        if (cancelled) {
          return;
        }

        setConnectionMatchupPreview(nextPreview);
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
    if (connectionQuery.length !== 0 || !isConnectionDropdownDismissed) {
      return;
    }

    setIsConnectionDropdownDismissed(false);
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
    if (!query) {
      startTransition(() => {
        setConnectionSuggestions([]);
        setSelectedSuggestionIndex(-1);
      });
      return;
    }

    if (isConnectionDropdownDismissed) {
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
              sortScore: Math.max(
                sortScore,
                getConnectionSuggestionScore(query, entity.label),
              ),
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

  function handleReset() {
    bookmarksReturnHashRef.current = "";
    window.history.replaceState(
      null,
      "",
      buildLocationHref(appLocation.basePathname, ""),
    );
    syncLocationFromWindow({
      nextHashOverride: "",
      incrementNavigationVersion: true,
    });
    setConnectionSession(null);
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

  const syncLocationFromWindow = useCallback((options?: {
    nextHashOverride?: string;
    preserveHashValue?: boolean;
    incrementNavigationVersion?: boolean;
  }) => {
    const nextLocation = readAppLocationState();
    setAppLocation(nextLocation);

    if (options?.preserveHashValue) {
      return;
    }

    const nextHash = options?.nextHashOverride ?? nextLocation.hash;
    const normalizedNextHash = normalizeHashValue(nextHash);
    lastSyncedHashRef.current = normalizedNextHash;
    setHashValue(normalizedNextHash);

    if (options?.incrementNavigationVersion) {
      setNavigationVersion((version) => version + 1);
    }

    pendingHashWriteRef.current = null;
  }, []);

  const handleToggleBookmarks = useCallback(() => {
    if (isBookmarksView) {
      const restoreHash = bookmarksReturnHashRef.current;
      window.history.replaceState(
        null,
        "",
        buildLocationHref(appLocation.basePathname, restoreHash),
      );
      syncLocationFromWindow({
        nextHashOverride: restoreHash,
        incrementNavigationVersion: true,
      });
      return;
    }

    bookmarksReturnHashRef.current = normalizeHashValue(hashValue);
    window.history.pushState(
      null,
      "",
      buildLocationHref(getBookmarksPathname(appLocation.basePathname), ""),
    );
    syncLocationFromWindow({
      preserveHashValue: true,
    });
  }, [appLocation.basePathname, hashValue, isBookmarksView, syncLocationFromWindow]);

  useEffect(() => {
    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      const action = getWindowKeyDownAction({
        event,
        isBookmarksJsonlEditorOpen,
      });

      if (action === "close-bookmarks-jsonl-editor") {
        event.preventDefault();
        setIsBookmarksJsonlEditorOpen(false);
        return;
      }

      if (action === "toggle-bookmarks") {
        event.preventDefault();
        handleToggleBookmarks();
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [handleToggleBookmarks, isBookmarksJsonlEditorOpen]);

  function handleRemoveBookmark(bookmarkHash: string) {
    void persistBookmarks(removeBookmarkEntry(bookmarksRef.current, bookmarkHash));
  }

  function handleMoveBookmark(bookmarkHash: string, direction: "up" | "down") {
    void persistBookmarks(moveBookmarkEntry(bookmarksRef.current, bookmarkHash, direction));
  }

  function handleLoadBookmark(bookmarkHash: string) {
    const normalizedBookmarkHash = normalizeHashValue(bookmarkHash);
    bookmarksReturnHashRef.current = normalizedBookmarkHash;
    window.history.replaceState(
      null,
      "",
      buildLocationHref(appLocation.basePathname, normalizedBookmarkHash),
    );
    syncLocationFromWindow({
      nextHashOverride: normalizedBookmarkHash,
      incrementNavigationVersion: true,
    });
  }

  function handleLoadBookmarkCard(bookmarkHash: string, previewCardIndex: number) {
    const previewCardHash = getBookmarkPreviewCardHash(bookmarkHash, previewCardIndex);
    bookmarksReturnHashRef.current = previewCardHash;
    window.history.replaceState(
      null,
      "",
      buildLocationHref(appLocation.basePathname, previewCardHash),
    );
    syncLocationFromWindow({
      nextHashOverride: previewCardHash,
      incrementNavigationVersion: true,
    });
  }

  function handleOpenBookmarkCardAsRootInNewTab(
    bookmarkHash: string,
    previewCardIndex: number,
  ) {
    const previewCardRootHash = getBookmarkPreviewCardRootHash(bookmarkHash, previewCardIndex);
    window.open(
      buildLocationHref(appLocation.basePathname, previewCardRootHash),
      "_blank",
      "noopener,noreferrer",
    );
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

  function handleOpenBookmarksJsonlEditor() {
    setIsBookmarksJsonlEditorOpen(true);
  }

  function handleCloseBookmarksJsonlEditor() {
    setIsBookmarksJsonlEditorOpen(false);
  }

  function handleResetBookmarksJsonlDraft() {
    setBookmarksJsonlDraft(resetBookmarksJsonlDraft(serializedBookmarksJsonl));
  }

  async function handleApplyBookmarksJsonl() {
    try {
      const persistedBookmarks = await persistBookmarks(parseBookmarksJsonl(bookmarksJsonlDraft));
      if (!persistedBookmarks) {
        return;
      }

      setBookmarksJsonlDraft(serializeBookmarksAsJsonl(persistedBookmarks));
      setIsBookmarksJsonlEditorOpen(false);
      sayToast("Bookmarks updated");
    } catch (error: unknown) {
      sayToast(
        error instanceof Error && error.message
          ? error.message
          : "Bookmark JSONL failed",
      );
    }
  }

  function handleSaveBookmark() {
    const normalizedHash = normalizeHashValue(hashValue);
    const existingBookmark = bookmarksRef.current.find((bookmark) => bookmark.hash === normalizedHash);

    if (!normalizedHash) {
      sayToast("Bookmark failed");
      return;
    }

    setIsSavingBookmark(true);
    setBookmarkOverlayMessage("Saving bookmark...");

    void persistBookmarks(upsertBookmarkEntry(bookmarksRef.current, {
      hash: normalizedHash,
    }))
      .then((persistedBookmarks) => {
        if (!persistedBookmarks) {
          return;
        }

        sayToast(existingBookmark ? "Bookmark updated" : "Bookmark saved");
      })
      .finally(() => {
        setIsSavingBookmark(false);
      });
  }

  const handleHashWrite = useCallback(
    (nextHash: string, mode: "selection" | "navigation") => {
      const normalizedHash = normalizeHashValue(nextHash);
      pendingHashWriteRef.current = {
        hash: normalizedHash,
        mode,
      };
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

  const openHashInNewTab = useCallback(
    (nextHash: string) => {
      const normalizedHash = normalizeHashValue(nextHash);
      if (!normalizedHash) {
        return;
      }

      window.open(
        buildLocationHref(appLocation.basePathname, normalizedHash),
        "_blank",
        "noopener,noreferrer",
      );
    },
    [appLocation.basePathname],
  );

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

  const clearConnectionInputState = useCallback(() => {
    autocompleteRequestIdRef.current += 1;
    setIsConnectionDropdownDismissed(false);
    setConnectionQuery("");
    setConnectionSuggestions([]);
    setSelectedSuggestionIndex(-1);
  }, []);

  useEffect(() => {
    clearConnectionInputState();
  }, [clearConnectionInputState, youngestSelectedCardKey]);

  useEffect(() => {
    if (!isSearchablePersistencePending) {
      return;
    }

    clearConnectionInputState();
  }, [clearConnectionInputState, isSearchablePersistencePending]);

  useEffect(() => {
    function handleDocumentClick(event: globalThis.MouseEvent) {
      const inputWrapElement = connectionInputWrapRef.current;
      const target = event.target;

      if (
        inputWrapElement &&
        target instanceof Node &&
        inputWrapElement.contains(target)
      ) {
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

  const hasFoundConnectionRow =
    connectionSession?.rows.some((row) => row.status === "found" && row.path.length > 0) ?? false;

  const runConnectionRowSearch = useCallback(
    async (params: {
      sessionId: string;
      rowId: string;
      left: ConnectionEntity;
      right: ConnectionEntity;
      excludedNodeKeys: string[];
      excludedEdgeKeys: string[];
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

      setConnectionSession({
        id: sessionId,
        left: entity,
        right: counterpart,
        rows: [createSearchingConnectionRow(rowId)],
      });
      clearConnectionInputState();

      await runConnectionRowSearch({
        sessionId,
        rowId,
        left: entity,
        right: counterpart,
        excludedNodeKeys: [],
        excludedEdgeKeys: [],
      });
    },
    [clearConnectionInputState, hashValue, runConnectionRowSearch],
  );

  const spawnAlternativeConnectionRow = useCallback(
    (
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

      const isAlreadyDisallowed =
        exclusion.kind === "node"
          ? parentRow.childDisallowedNodeKeys.includes(exclusion.nodeKey)
          : parentRow.childDisallowedEdgeKeys.includes(exclusion.edgeKey);
      if (isAlreadyDisallowed) {
        const toggledRow = currentSession.rows.find(
          (row) =>
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
                      ? row.childDisallowedNodeKeys.filter(
                        (nodeKey) => nodeKey !== exclusion.nodeKey,
                      )
                      : row.childDisallowedNodeKeys,
                  childDisallowedEdgeKeys:
                    exclusion.kind === "edge"
                      ? row.childDisallowedEdgeKeys.filter(
                        (edgeKey) => edgeKey !== exclusion.edgeKey,
                      )
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

      const nextSearch = {
        sessionId: currentSession.id,
        rowId,
        left: currentSession.left,
        right: currentSession.right,
        excludedNodeKeys,
        excludedEdgeKeys,
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
    },
    [runConnectionRowSearch],
  );

  const handleConnectionSuggestionSelection = useCallback(
    async (suggestion: ConnectionSuggestion) => {
      if (shouldActivateConnectedDropdownSuggestion(suggestion)) {
        highlightedConnectionEntitySelectionRequestIdRef.current += 1;
        setHighlightedConnectionEntitySelectionRequest({
          requestKey:
            `connection-dropdown-select-${highlightedConnectionEntitySelectionRequestIdRef.current}`,
          entity: suggestion,
        });
        clearConnectionInputState();
        return;
      }

      await openConnectionRowsForEntity(suggestion);
    },
    [clearConnectionInputState, openConnectionRowsForEntity],
  );

  const handleConnectionSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
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
    },
    [
      connectionQuery,
      connectionSuggestions,
      handleConnectionSuggestionSelection,
      isSearchablePersistencePending,
      isResolvingConnection,
      openConnectionRowsForEntity,
      selectedSuggestionIndex,
    ],
  );

  const handleConnectionInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
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
        if (!selectedSuggestion) {
          return;
        }

        void handleConnectionSuggestionSelection(selectedSuggestion);
      }
    },
    [
      connectionSuggestions,
      handleConnectionSuggestionSelection,
      isSearchablePersistencePending,
      selectedSuggestionIndex,
    ],
  );

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

  function renderConnectionMatchupTile(entity: ConnectionMatchupPreviewEntity) {
    return (
      <span
        className={[
          "bacon-connection-matchup-tile-wrap",
          entity.imageUrl ? "bacon-connection-matchup-tile-wrap-image" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span
          aria-label={entity.name}
          className={[
            "bacon-connection-matchup-tile",
            entity.imageUrl ? "bacon-connection-matchup-tile-image" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {entity.imageUrl ? (
            <img
              alt=""
              className="bacon-connection-matchup-image"
              loading="lazy"
              src={entity.imageUrl}
            />
          ) : (
            <span className="bacon-connection-matchup-fallback">
              {getPreviewFallbackText(entity.name)}
            </span>
          )}
        </span>
      </span>
    );
  }

  function renderConnectionMatchupPlaceholderTile(label: string) {
    return (
      <span className="bacon-connection-matchup-tile-wrap bacon-connection-matchup-tile-wrap-placeholder">
        <span
          aria-label={label}
          className="bacon-connection-matchup-tile bacon-connection-matchup-tile-placeholder"
        >
          <span className="bacon-connection-matchup-fallback">
            ?
          </span>
        </span>
      </span>
    );
  }

  function renderConnectionMatchupPreview() {
    if (!connectionMatchupPreview) {
      return null;
    }

    const isMatchupTooltipVisible =
      visibleConnectionMatchupTooltipKey === CONNECTION_MATCHUP_TOOLTIP_KEY;
    const counterpartTooltipEntries = getTooltipEntries(
      connectionMatchupPreview.counterpart.tooltipText,
    );
    const matchupRightLabel = connectionMatchupPreview.kind === "versus"
      ? connectionMatchupPreview.spoiler.name
      : connectionMatchupPreview.placeholderLabel;
    const matchupExplanation = connectionMatchupPreview.kind === "versus"
      ? connectionMatchupPreview.spoilerExplanation ?? CONNECTION_MATCHUP_SPOILER_EXPLANATION
      : connectionMatchupPreview.placeholderExplanation;

    return (
      <div
        className={[
          "bacon-connection-matchup-shell",
          isConnectionMatchupShellOverflowVisible
            ? "bacon-connection-matchup-shell-overflow-visible"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        ref={connectionMatchupShellRef}
      >
        <div
          aria-label={`Suggested matchup: ${connectionMatchupPreview.counterpart.name} vs ${matchupRightLabel}`}
          className="bacon-connection-matchup"
          onBlur={() => setVisibleConnectionMatchupTooltipKey((currentKey) =>
            currentKey === CONNECTION_MATCHUP_TOOLTIP_KEY ? null : currentKey)}
          onFocus={() => setVisibleConnectionMatchupTooltipKey(CONNECTION_MATCHUP_TOOLTIP_KEY)}
          onMouseEnter={() => setVisibleConnectionMatchupTooltipKey(CONNECTION_MATCHUP_TOOLTIP_KEY)}
          onMouseLeave={() => setVisibleConnectionMatchupTooltipKey((currentKey) =>
            currentKey === CONNECTION_MATCHUP_TOOLTIP_KEY ? null : currentKey)}
          tabIndex={0}
        >
          <span className="bacon-connection-matchup-content">
            {renderConnectionMatchupTile(connectionMatchupPreview.counterpart)}
            <span aria-hidden="true" className="bacon-connection-matchup-vs">vs</span>
            {connectionMatchupPreview.kind === "versus"
              ? renderConnectionMatchupTile(connectionMatchupPreview.spoiler)
              : renderConnectionMatchupPlaceholderTile(connectionMatchupPreview.placeholderLabel)}
          </span>
          {isMatchupTooltipVisible ? (
            <span
              className="bacon-connection-pill-tooltip bacon-connection-matchup-tooltip"
              role="tooltip"
            >
              <span className="bacon-connection-pill-tooltip-entry">
                {matchupRightLabel}
              </span>
              <span className="bacon-connection-pill-tooltip-entry">
                {matchupExplanation}
              </span>
              {renderTooltipEntries(
                counterpartTooltipEntries,
                connectionMatchupPreview.counterpart.key,
              )}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  function renderBookmarksPage() {
    return (
      <section className="bacon-bookmarks-page">
        {bookmarks.length === 0 ? (
          <div className="bacon-bookmarks-empty-state">
            <p className="bacon-bookmarks-empty-title">No bookmarks yet.</p>
            <p className="bacon-bookmarks-empty-copy">
              Save the current path with `💾` and it will show up here as a row of cards.
            </p>
          </div>
        ) : (
          displayedBookmarkRows.map((bookmarkRow, bookmarkIndex) => (
            <article className="bacon-bookmark-row-shell" key={bookmarkRow.hash}>
              <div className="bacon-bookmark-row-layout">
                <div className="bacon-bookmark-row-actions bacon-bookmark-row-actions-left">
                  <button
                    className="bacon-title-action-icon-button"
                    aria-label={`Move ${formatBookmarkLabel(bookmarkRow.hash)} up`}
                    disabled={bookmarkIndex === 0}
                    onClick={() => handleMoveBookmark(bookmarkRow.hash, "up")}
                    type="button"
                  >
                    ⬆️
                  </button>
                  <FancyTooltip
                    content={formatBookmarkIndexTooltip({ hash: bookmarkRow.hash })}
                    placement="right-center"
                    tooltipClassName="bacon-bookmark-index-tooltip"
                  >
                    <span
                      className="bacon-bookmark-index-bubble"
                      role="note"
                      tabIndex={0}
                    >
                      {bookmarkIndex + 1}
                    </span>
                  </FancyTooltip>
                  <button
                    aria-label={`Move ${formatBookmarkLabel(bookmarkRow.hash)} down`}
                    className="bacon-title-action-icon-button"
                    disabled={bookmarkIndex === displayedBookmarkRows.length - 1}
                    onClick={() => handleMoveBookmark(bookmarkRow.hash, "down")}
                    type="button"
                  >
                    ⬇️
                  </button>
                  <FancyTooltip content="Load bookmark" placement="right-center">
                    <button
                      aria-label={`Load ${formatBookmarkLabel(bookmarkRow.hash)}`}
                      className="bacon-title-action-icon-button"
                      onClick={() => handleLoadBookmark(bookmarkRow.hash)}
                      type="button"
                    >
                      📥
                    </button>
                  </FancyTooltip>
                  <FancyTooltip content="Remove bookmark" placement="right-center">
                    <button
                      aria-label={`Remove ${formatBookmarkLabel(bookmarkRow.hash)}`}
                      className="bacon-title-action-icon-button bacon-title-action-icon-button-danger"
                      onClick={() => handleRemoveBookmark(bookmarkRow.hash)}
                      type="button"
                    >
                      🗑️
                    </button>
                  </FancyTooltip>
                </div>
                <div className="bacon-bookmark-row-body">
                  <div className="bacon-bookmark-card-row">
                    {bookmarkRow.cards.map((card, cardIndex) => {
                      if (card.kind === "break") {
                        return (
                          <div
                            className="generator-card-button generator-card-button-row-break"
                            key={card.key}
                          >
                            <CinenerdleBreakBar label={card.label} />
                          </div>
                        );
                      }

                      return (
                        <button
                          className="generator-card-button"
                          key={card.key}
                          onClick={() => handleLoadBookmarkCard(bookmarkRow.hash, cardIndex)}
                          type="button"
                        >
                          <CinenerdleEntityCard
                            card={card.card}
                            onTitleClick={(event) => {
                              if (didRequestNewTabNavigation(event)) {
                                handleOpenBookmarkCardAsRootInNewTab(bookmarkRow.hash, cardIndex);
                                return;
                              }

                              handleLoadBookmarkCard(bookmarkRow.hash, cardIndex);
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </article>
          ))
        )}
      </section>
    );
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
        bookmarkOverlayMessage={bookmarkOverlayMessage}
        clearDbBadgeText={clearDbBadgeText}
        clearDbButtonRef={clearDbButtonRef}
        copyStatus={copyStatus}
        copyStatusPlacement={copyStatusPlacement}
        isBookmarksView={isBookmarksView}
        isConnectionMatchupShellOverflowVisible={isConnectionMatchupShellOverflowVisible}
        isSavingBookmark={isSavingBookmark}
        onBookmarkSaveTooltipHide={hideBookmarkOverlay}
        onBookmarkSaveTooltipShow={showSaveBookmarkOverlay}
        onBookmarkToggleTooltipHide={hideBookmarkOverlay}
        onBookmarkToggleTooltipShow={showToggleBookmarksOverlay}
        onClearDatabase={handleClearDatabase}
        onOpenBookmarksJsonlEditor={handleOpenBookmarksJsonlEditor}
        onReset={handleReset}
        onSaveBookmark={handleSaveBookmark}
        onTitleDebugCopy={import.meta.env.DEV ? handleTitleDebugCopy : undefined}
        onToggleBookmarks={handleToggleBookmarks}
        renderConnectionMatchupPreview={renderConnectionMatchupPreview}
        titleRef={titleRef}
        toastStatusRef={toastStatusRef}
      />

      {shouldShowIndexedDbBootstrapLoadingShellIndicator ? (
        <IndexedDbBootstrapLoadingIndicator
          phase={cinenerdleIndexedDbBootstrapStatus.phase}
          resetRequiredMessage={cinenerdleIndexedDbBootstrapStatus.resetRequiredMessage}
        />
      ) : null}

      {!isBookmarksView && !isAppBodyBlockedByIndexedDbBootstrap ? (
        <section className="bacon-connection-bar" ref={connectionBarRef}>
          <form className="bacon-connection-form" onSubmit={handleConnectionSubmit}>
            <div className="bacon-connection-input-wrap" ref={connectionInputWrapRef}>
              <input
                autoCapitalize="words"
                autoCorrect="off"
                className="bacon-connection-input"
                disabled={isConnectionInputDisabled}
                onChange={(event) => setConnectionQuery(event.target.value)}
                onKeyDown={handleConnectionInputKeyDown}
                placeholder={isSearchablePersistencePending
                  ? "Building connections..."
                  : "Connect to film or person"}
                type="text"
                value={connectionQuery}
              />
              {connectionSuggestions.length > 0 ? (
                <div className="bacon-connection-dropdown" ref={connectionDropdownRef}>
                  {connectionSuggestions.map((suggestion, index) => (
                    <button
                      className={[
                        "bacon-connection-option",
                        suggestion.isConnectedToYoungestSelection
                          ? "bacon-connection-option-connected"
                          : "",
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
                      <span className="bacon-connection-option-label">{suggestion.label}</span>
                      {typeof suggestion.connectionOrderToYoungestSelection === "number" ? (
                        <span className="bacon-connection-option-badge">
                          {`#${suggestion.connectionOrderToYoungestSelection}`}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <span
              className="bacon-connection-pill-wrap"
              onBlur={() => setIsSelectedPathTooltipVisible(false)}
              onFocus={() => setIsSelectedPathTooltipVisible(true)}
              onMouseEnter={() => setIsSelectedPathTooltipVisible(true)}
              onMouseLeave={() => setIsSelectedPathTooltipVisible(false)}
            >
              <span
                className="bacon-connection-pill"
                tabIndex={0}
              >
                {highestGenerationSelectedLabel}
              </span>
              {isSelectedPathTooltipVisible ? (
                <span className="bacon-connection-pill-tooltip" role="tooltip">
                  {selectedPathTooltipEntries.map((entry, index) =>
                    renderTooltipEntry(entry, `${index}:${entry}`))}
                </span>
              ) : null}
            </span>
          </form>

          {connectionSession ? (
            <div className="bacon-connection-results">
              {!hasFoundConnectionRow ? (
                <div className="bacon-connection-row">
                  <ConnectionEntityCard
                    entity={connectionSession.left}
                    onCardClick={() => navigateToConnectionEntity(connectionSession.left)}
                    onNameClick={(event) => {
                      if (didRequestNewTabNavigation(event)) {
                        openConnectionEntityInNewTab(connectionSession.left);
                        return;
                      }

                      navigateToConnectionEntity(connectionSession.left);
                    }}
                  />
                  <span className="bacon-connection-arrow bacon-connection-arrow-static">
                    <span className="bacon-connection-arrow-break" aria-hidden="true">
                      <span className="bacon-connection-arrow-break-line" />
                      <span className="bacon-connection-arrow-break-slash">/</span>
                      <span className="bacon-connection-arrow-break-head">→</span>
                    </span>
                  </span>
                  <ConnectionEntityCard
                    entity={connectionSession.right}
                    onCardClick={() => navigateToConnectionEntity(connectionSession.right)}
                    onNameClick={(event) => {
                      if (didRequestNewTabNavigation(event)) {
                        openConnectionEntityInNewTab(connectionSession.right);
                        return;
                      }

                      navigateToConnectionEntity(connectionSession.right);
                    }}
                  />
                </div>
              ) : null}

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
                      const isLeftmostNode = index === 0;
                      const isMiddleNode = index > 0 && index < row.path.length - 1;
                      const isNodeDimmed = row.childDisallowedNodeKeys.includes(entity.key);
                      const isEdgeDimmed = row.childDisallowedEdgeKeys.includes(edgeKey);

                      return (
                        <Fragment key={`${row.id}:${entity.key}:${index}`}>
                          <ConnectionEntityCard
                            dimmed={isNodeDimmed}
                            entity={entity}
                            onCardClick={isMiddleNode
                              ? () =>
                                spawnAlternativeConnectionRow(row.id, {
                                  kind: "node",
                                  nodeKey: entity.key,
                                })
                              : undefined}
                            onNameClick={isLeftmostNode
                              ? (event) => {
                                if (didRequestNewTabNavigation(event)) {
                                  openConnectionPathInNewTab([...row.path].reverse());
                                  return;
                                }

                                navigateToConnectionPath([...row.path].reverse());
                              }
                              : (event) => {
                                if (didRequestNewTabNavigation(event)) {
                                  openConnectionEntityInNewTab(entity);
                                  return;
                                }

                                navigateToConnectionEntity(entity);
                              }}
                          />
                          {nextEntity ? (
                            <button
                              className={[
                                "bacon-connection-arrow",
                                "bacon-connection-arrow-button",
                                isEdgeDimmed
                                  ? "bacon-connection-arrow-disconnected"
                                  : "bacon-connection-arrow-connected",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              aria-pressed={isEdgeDimmed}
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
      ) : null}

      {!isAppBodyBlockedByIndexedDbBootstrap ? (
        <main className="bacon-app-content">
          {isBookmarksView ? (
            renderBookmarksPage()
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

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
} from "react";
import {
  type AppViewMode,
  createBookmarkId,
  loadBookmarks,
  moveBookmarkEntry,
  removeBookmarkEntry,
  type BookmarkEntry,
  toggleBookmarkPreviewCardSelection,
  upsertBookmarkEntry,
} from "./bookmarks";
import { BookmarkPreviewCardView } from "./components/bookmark_preview_card";
import Cinenerdle2 from "./generators/cinenerdle2";
import { buildBookmarkPreviewCardsFromHash } from "./generators/cinenerdle2/controller";
import {
  copyCinenerdleDebugLogToClipboard,
  copyCinenerdleIndexedDbSnapshotToClipboard,
} from "./generators/cinenerdle2/debug";
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
import { CINENERDLE_ICON_URL, TMDB_ICON_URL } from "./generators/cinenerdle2/constants";
import {
  buildPathNodesFromSegments,
  createPathNode,
  normalizeHashValue,
  parseHashSegments,
  serializePathNodes,
} from "./generators/cinenerdle2/hash";
import {
  getAllFilmRecords,
  getAllPersonRecords,
  clearIndexedDb,
  estimateIndexedDbUsageBytes,
  getFilmRecordByTitleAndYear,
  getAllSearchableConnectionEntities,
  getFilmRecordsByPersonConnectionKey,
  getPersonRecordById,
  getPersonRecordByName,
  getPersonRecordsByMovieKey,
} from "./generators/cinenerdle2/indexed_db";
import { resolveConnectionQuery } from "./generators/cinenerdle2/tmdb";
import {
  formatMoviePathLabel,
  getAssociatedPeopleFromMovieCredits,
  getFilmKey,
  getMovieKeyFromCredit,
  getMoviePosterUrl,
  getPersonProfileImageUrl,
  getSnapshotConnectionLabels,
  getTmdbMovieCredits,
  getValidTmdbEntityId,
  normalizeName,
  normalizeWhitespace,
} from "./generators/cinenerdle2/utils";
import type { FilmRecord, PersonRecord } from "./generators/cinenerdle2/types";
import type { CinenerdleCard } from "./generators/cinenerdle2/view_types";
import "./styles/app_shell.css";

type ConnectionSuggestion = ConnectionEntity & {
  popularity: number;
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

type YoungestSelectedCard = Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>;

type ConnectionMatchupPreviewEntity = {
  key: string;
  kind: "movie" | "person";
  name: string;
  imageUrl: string | null;
  popularity: number;
  tooltipText: string;
};

type ConnectionMatchupPreview = {
  counterpart: ConnectionMatchupPreviewEntity;
  spoiler: ConnectionMatchupPreviewEntity;
};

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

  return {
    viewMode,
    pathname,
    basePathname,
    hash: window.location.hash,
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

function formatBookmarkSavedAt(savedAt: string): string {
  const date = new Date(savedAt);

  if (Number.isNaN(date.valueOf())) {
    return "";
  }

  return date.toLocaleString();
}

function formatBookmarkIndexTooltip(bookmark: BookmarkEntry): string {
  const savedAt = formatBookmarkSavedAt(bookmark.savedAt);
  const lines = [
    savedAt ? `Saved ${savedAt}` : "Saved bookmark",
    ...bookmark.previewCards.map((card) => card.name),
  ];

  return lines.join("\n");
}

function getBookmarkPreviewCardHash(bookmarkHash: string, previewCardIndex: number): string {
  const normalizedHash = normalizeHashValue(bookmarkHash);
  const pathNodes = buildPathNodesFromSegments(parseHashSegments(normalizedHash)).filter(
    (pathNode): pathNode is Exclude<(typeof pathNode), { kind: "break" }> => pathNode.kind !== "break",
  );

  if (previewCardIndex < 0 || previewCardIndex >= pathNodes.length) {
    return normalizedHash;
  }

  return serializePathNodes(pathNodes.slice(0, previewCardIndex + 1));
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
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

function getSelectedPathTooltipEntries(hashValue: string): string[] {
  const pathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue)).filter(
    (pathNode): pathNode is Exclude<(typeof pathNode), { kind: "break" }> =>
      pathNode.kind === "cinenerdle" ||
      pathNode.kind === "movie" ||
      pathNode.kind === "person",
  );

  if (pathNodes.length === 0) {
    return ["cinenerdle"];
  }

  return pathNodes
    .map((pathNode) =>
      pathNode.kind === "movie"
        ? formatMoviePathLabel(pathNode.name, pathNode.year)
        : pathNode.name,
    );
}

function stripSearchDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getDirectSuggestionScore(normalizedQuery: string, normalizedLabel: string): number {
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

function getSuggestionScore(query: string, label: string): number {
  const normalizedQuery = normalizeWhitespace(query).toLocaleLowerCase();
  const normalizedLabel = normalizeWhitespace(label).toLocaleLowerCase();
  const directScore = getDirectSuggestionScore(normalizedQuery, normalizedLabel);

  if (directScore >= 0) {
    return directScore;
  }

  const foldedQuery = stripSearchDiacritics(normalizedQuery);
  if (foldedQuery !== normalizedQuery) {
    return -1;
  }

  return getDirectSuggestionScore(
    foldedQuery,
    stripSearchDiacritics(normalizedLabel),
  );
}

function getCardPersonTmdbId(
  card: Extract<YoungestSelectedCard, { kind: "person" }>,
): number | null {
  const recordTmdbId = getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id);
  if (recordTmdbId) {
    return recordTmdbId;
  }

  const keyMatch = card.key.match(/^person:(\d+)$/);
  return keyMatch ? getValidTmdbEntityId(keyMatch[1]) : null;
}

async function resolveSelectedMovieRecord(
  card: Extract<YoungestSelectedCard, { kind: "movie" }>,
): Promise<FilmRecord | null> {
  return getFilmRecordByTitleAndYear(card.name, card.year);
}

async function resolveSelectedPersonRecord(
  card: Extract<YoungestSelectedCard, { kind: "person" }>,
): Promise<PersonRecord | null> {
  const tmdbId = getCardPersonTmdbId(card);
  if (tmdbId) {
    const personRecord = await getPersonRecordById(tmdbId);
    if (personRecord) {
      return personRecord;
    }
  }

  return getPersonRecordByName(card.name);
}

function getMovieRecordKey(movieRecord: FilmRecord): string {
  return getMovieConnectionEntityKey(movieRecord.title, movieRecord.year);
}

function getPersonRecordKey(personRecord: PersonRecord): string {
  return getPersonConnectionEntityKey(personRecord.name, personRecord.tmdbId ?? personRecord.id);
}

function getMoviePopularity(movieRecord: FilmRecord): number {
  return movieRecord.popularity ?? 0;
}

function getPersonPopularity(personRecord: PersonRecord): number {
  return personRecord.rawTmdbPerson?.popularity ?? 0;
}

function getMovieConnectedPersonLabels(movieRecord: FilmRecord): Map<string, string> {
  const labelsByName = new Map<string, string>();

  movieRecord.personConnectionKeys.forEach((personName) => {
    const normalizedPersonName = normalizeName(personName);
    const trimmedPersonName = normalizeWhitespace(personName);
    if (normalizedPersonName && trimmedPersonName && !labelsByName.has(normalizedPersonName)) {
      labelsByName.set(normalizedPersonName, trimmedPersonName);
    }
  });

  getSnapshotConnectionLabels(movieRecord).forEach((personName) => {
    const normalizedPersonName = normalizeName(personName);
    const trimmedPersonName = normalizeWhitespace(personName);
    if (normalizedPersonName && trimmedPersonName) {
      labelsByName.set(normalizedPersonName, trimmedPersonName);
    }
  });

  getAssociatedPeopleFromMovieCredits(movieRecord).forEach((credit) => {
    const normalizedPersonName = normalizeName(credit.name ?? "");
    const trimmedPersonName = normalizeWhitespace(credit.name ?? "");
    if (normalizedPersonName && trimmedPersonName) {
      labelsByName.set(normalizedPersonName, trimmedPersonName);
    }
  });

  return labelsByName;
}

function getPersonConnectedMovieLabels(personRecord: PersonRecord): Map<string, string> {
  const labelsByMovieKey = new Map<string, string>();

  personRecord.movieConnectionKeys.forEach((movieKey) => {
    const normalizedMovieKey = normalizeWhitespace(movieKey).toLowerCase();
    const trimmedMovieKey = normalizeWhitespace(movieKey);
    if (normalizedMovieKey && trimmedMovieKey && !labelsByMovieKey.has(normalizedMovieKey)) {
      labelsByMovieKey.set(normalizedMovieKey, trimmedMovieKey);
    }
  });

  getTmdbMovieCredits(personRecord).forEach((credit) => {
    const movieKey = getMovieKeyFromCredit(credit);
    const movieTitle = normalizeWhitespace(formatMoviePathLabel(
      credit.title ?? credit.original_title ?? "",
      credit.release_date?.slice(0, 4) ?? "",
    ));

    if (movieKey && movieTitle) {
      labelsByMovieKey.set(movieKey, movieTitle);
    }
  });

  return labelsByMovieKey;
}

function isMovieConnectedToPerson(movieRecord: FilmRecord, personRecord: PersonRecord): boolean {
  const personTmdbId = getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id);
  const normalizedPersonName = normalizeName(personRecord.name);

  if (
    normalizedPersonName &&
    movieRecord.personConnectionKeys.some((personName) => normalizeName(personName) === normalizedPersonName)
  ) {
    return true;
  }

  return getAssociatedPeopleFromMovieCredits(movieRecord).some((credit) => {
    const creditTmdbId = getValidTmdbEntityId(credit.id);
    if (personTmdbId && creditTmdbId) {
      return personTmdbId === creditTmdbId;
    }

    return normalizeName(credit.name ?? "") === normalizedPersonName;
  });
}

function isPersonConnectedToMovie(personRecord: PersonRecord, movieRecord: FilmRecord): boolean {
  const targetMovieKey = getFilmKey(movieRecord.title, movieRecord.year);

  if (personRecord.movieConnectionKeys.some((movieKey) => normalizeWhitespace(movieKey).toLowerCase() === targetMovieKey)) {
    return true;
  }

  return getTmdbMovieCredits(personRecord).some((credit) => getMovieKeyFromCredit(credit) === targetMovieKey);
}

function compareMovieCandidates(
  left: { count: number; movieRecord: FilmRecord },
  right: { count: number; movieRecord: FilmRecord },
): number {
  if (right.count !== left.count) {
    return right.count - left.count;
  }

  const popularityDifference = getMoviePopularity(right.movieRecord) - getMoviePopularity(left.movieRecord);
  if (popularityDifference !== 0) {
    return popularityDifference;
  }

  return getMovieRecordKey(left.movieRecord).localeCompare(getMovieRecordKey(right.movieRecord));
}

function comparePersonCandidates(
  left: { count: number; personRecord: PersonRecord },
  right: { count: number; personRecord: PersonRecord },
): number {
  if (right.count !== left.count) {
    return right.count - left.count;
  }

  const popularityDifference = getPersonPopularity(right.personRecord) - getPersonPopularity(left.personRecord);
  if (popularityDifference !== 0) {
    return popularityDifference;
  }

  return getPersonRecordKey(left.personRecord).localeCompare(getPersonRecordKey(right.personRecord));
}

function comparePreviewEntities(
  left: ConnectionMatchupPreviewEntity,
  right: ConnectionMatchupPreviewEntity,
): number {
  if (right.popularity !== left.popularity) {
    return right.popularity - left.popularity;
  }

  return left.key.localeCompare(right.key);
}

function formatPreviewPopularity(popularity: number): string {
  return Number(popularity.toFixed(2)).toString();
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

function buildCounterpartTooltipText(
  entityName: string,
  popularity: number,
  sharedConnectionLabels: string[],
): string {
  return [
    entityName,
    `Popularity: ${formatPreviewPopularity(popularity)}`,
    ...sharedConnectionLabels,
  ].join("\n");
}

function createPreviewEntityFromMovieRecord(
  movieRecord: FilmRecord,
  sharedConnectionLabels: string[] = [],
): ConnectionMatchupPreviewEntity {
  const movieName = formatMoviePathLabel(movieRecord.title, movieRecord.year);

  return {
    key: getMovieRecordKey(movieRecord),
    kind: "movie",
    name: movieName,
    imageUrl: getMoviePosterUrl(movieRecord),
    popularity: getMoviePopularity(movieRecord),
    tooltipText: sharedConnectionLabels.length > 0
      ? buildCounterpartTooltipText(
        movieName,
        getMoviePopularity(movieRecord),
        sharedConnectionLabels,
      )
      : movieName,
  };
}

function createPreviewEntityFromPersonRecord(
  personRecord: PersonRecord,
  sharedConnectionLabels: string[] = [],
): ConnectionMatchupPreviewEntity {
  return {
    key: getPersonRecordKey(personRecord),
    kind: "person",
    name: personRecord.name,
    imageUrl: getPersonProfileImageUrl(personRecord),
    popularity: getPersonPopularity(personRecord),
    tooltipText: sharedConnectionLabels.length > 0
      ? buildCounterpartTooltipText(
        personRecord.name,
        getPersonPopularity(personRecord),
        sharedConnectionLabels,
      )
      : personRecord.name,
  };
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

async function findMovieCounterpart(
  movieRecord: FilmRecord,
): Promise<{ movieRecord: FilmRecord; sharedConnectionLabels: string[] } | null> {
  const movieKey = getMovieRecordKey(movieRecord);
  const candidates = new Map<
    string,
    { count: number; movieRecord: FilmRecord; sharedConnectionLabels: Set<string> }
  >();
  const connectedPeople = Array.from(getMovieConnectedPersonLabels(movieRecord).entries());

  await Promise.all(
    connectedPeople.map(async ([personName, personLabel]) => {
      const matchingMovies = await getFilmRecordsByPersonConnectionKey(personName);
      const countedMovieKeys = new Set<string>();

      matchingMovies.forEach((candidateMovie) => {
        const candidateMovieKey = getMovieRecordKey(candidateMovie);
        if (candidateMovieKey === movieKey || countedMovieKeys.has(candidateMovieKey)) {
          return;
        }

        countedMovieKeys.add(candidateMovieKey);
        const currentCandidate = candidates.get(candidateMovieKey);
        if (currentCandidate) {
          currentCandidate.count += 1;
          currentCandidate.sharedConnectionLabels.add(personLabel);
          if (getMoviePopularity(candidateMovie) > getMoviePopularity(currentCandidate.movieRecord)) {
            currentCandidate.movieRecord = candidateMovie;
          }
          return;
        }

        candidates.set(candidateMovieKey, {
          count: 1,
          movieRecord: candidateMovie,
          sharedConnectionLabels: new Set([personLabel]),
        });
      });
    }),
  );

  const bestCandidate = [...candidates.values()]
    .sort((left, right) =>
      compareMovieCandidates(
        {
          count: left.count,
          movieRecord: left.movieRecord,
        },
        {
          count: right.count,
          movieRecord: right.movieRecord,
        },
      ),
    )[0];

  if (!bestCandidate) {
    return null;
  }

  return {
    movieRecord: bestCandidate.movieRecord,
    sharedConnectionLabels: [...bestCandidate.sharedConnectionLabels].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

async function findPersonCounterpart(
  personRecord: PersonRecord,
): Promise<{ personRecord: PersonRecord; sharedConnectionLabels: string[] } | null> {
  const personKey = getPersonRecordKey(personRecord);
  const candidates = new Map<
    string,
    { count: number; personRecord: PersonRecord; sharedConnectionLabels: Set<string> }
  >();
  const connectedMovieKeys = Array.from(getPersonConnectedMovieLabels(personRecord).entries());

  await Promise.all(
    connectedMovieKeys.map(async ([movieKey, movieLabel]) => {
      const matchingPeople = await getPersonRecordsByMovieKey(movieKey);
      const countedPersonKeys = new Set<string>();

      matchingPeople.forEach((candidatePerson) => {
        const candidatePersonKey = getPersonRecordKey(candidatePerson);
        if (candidatePersonKey === personKey || countedPersonKeys.has(candidatePersonKey)) {
          return;
        }

        countedPersonKeys.add(candidatePersonKey);
        const currentCandidate = candidates.get(candidatePersonKey);
        if (currentCandidate) {
          currentCandidate.count += 1;
          currentCandidate.sharedConnectionLabels.add(movieLabel);
          if (getPersonPopularity(candidatePerson) > getPersonPopularity(currentCandidate.personRecord)) {
            currentCandidate.personRecord = candidatePerson;
          }
          return;
        }

        candidates.set(candidatePersonKey, {
          count: 1,
          personRecord: candidatePerson,
          sharedConnectionLabels: new Set([movieLabel]),
        });
      });
    }),
  );

  const bestCandidate = [...candidates.values()]
    .sort((left, right) =>
      comparePersonCandidates(
        {
          count: left.count,
          personRecord: left.personRecord,
        },
        {
          count: right.count,
          personRecord: right.personRecord,
        },
      ),
    )[0];

  if (!bestCandidate) {
    return null;
  }

  return {
    personRecord: bestCandidate.personRecord,
    sharedConnectionLabels: [...bestCandidate.sharedConnectionLabels].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

async function findMostPopularSelectedMovieSpoiler(
  selectedMovieRecord: FilmRecord,
  counterpartMovieRecord: FilmRecord,
): Promise<PersonRecord | null> {
  const allPeople = await getAllPersonRecords();
  const sortedPeople = [...allPeople].sort((left, right) =>
    comparePreviewEntities(
      createPreviewEntityFromPersonRecord(left),
      createPreviewEntityFromPersonRecord(right),
    ));

  return (
    sortedPeople.find(
      (personRecord) =>
        isMovieConnectedToPerson(selectedMovieRecord, personRecord) &&
        !isMovieConnectedToPerson(counterpartMovieRecord, personRecord),
    ) ?? null
  );
}

async function findMostPopularSelectedPersonSpoiler(
  selectedPersonRecord: PersonRecord,
  counterpartPersonRecord: PersonRecord,
): Promise<FilmRecord | null> {
  const allFilms = await getAllFilmRecords();
  const sortedFilms = [...allFilms].sort((left, right) =>
    comparePreviewEntities(
      createPreviewEntityFromMovieRecord(left),
      createPreviewEntityFromMovieRecord(right),
    ));

  return (
    sortedFilms.find(
      (movieRecord) =>
        isPersonConnectedToMovie(selectedPersonRecord, movieRecord) &&
        !isPersonConnectedToMovie(counterpartPersonRecord, movieRecord),
    ) ?? null
  );
}

export async function resolveConnectionMatchupPreview(
  youngestSelectedCard: YoungestSelectedCard | null,
): Promise<ConnectionMatchupPreview | null> {
  if (!youngestSelectedCard || youngestSelectedCard.kind === "cinenerdle") {
    return null;
  }

  if (youngestSelectedCard.kind === "movie") {
    const selectedMovieRecord = await resolveSelectedMovieRecord(youngestSelectedCard);
    if (!selectedMovieRecord) {
      return null;
    }

    const counterpartMovie = await findMovieCounterpart(selectedMovieRecord);
    if (!counterpartMovie) {
      return null;
    }

    const spoilerPerson = await findMostPopularSelectedMovieSpoiler(
      selectedMovieRecord,
      counterpartMovie.movieRecord,
    );
    if (!spoilerPerson) {
      return null;
    }

    return {
      counterpart: createPreviewEntityFromMovieRecord(
        counterpartMovie.movieRecord,
        counterpartMovie.sharedConnectionLabels,
      ),
      spoiler: createPreviewEntityFromPersonRecord(spoilerPerson),
    };
  }

  const selectedPersonRecord = await resolveSelectedPersonRecord(youngestSelectedCard);
  if (!selectedPersonRecord) {
    return null;
  }

  const counterpartPerson = await findPersonCounterpart(selectedPersonRecord);
  if (!counterpartPerson) {
    return null;
  }

  const spoilerMovie = await findMostPopularSelectedPersonSpoiler(
    selectedPersonRecord,
    counterpartPerson.personRecord,
  );
  if (!spoilerMovie) {
    return null;
  }

  return {
    counterpart: createPreviewEntityFromPersonRecord(
      counterpartPerson.personRecord,
      counterpartPerson.sharedConnectionLabels,
    ),
    spoiler: createPreviewEntityFromMovieRecord(spoilerMovie),
  };
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
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(() => loadBookmarks());
  const [hashValue, setHashValue] = useState(() => initialLocationState.hash);
  const [resetVersion, setResetVersion] = useState(0);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [youngestSelectedCard, setYoungestSelectedCard] = useState<YoungestSelectedCard | null>(null);
  const [connectionMatchupPreview, setConnectionMatchupPreview] =
    useState<ConnectionMatchupPreview | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [isSavingBookmark, setIsSavingBookmark] = useState(false);
  const [connectionQuery, setConnectionQuery] = useState("");
  const [isResolvingConnection, setIsResolvingConnection] = useState(false);
  const [connectionSuggestions, setConnectionSuggestions] = useState<ConnectionSuggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [connectionSession, setConnectionSession] = useState<ConnectionSession | null>(null);
  const [highlightedConnectionEntitySelectionRequest, setHighlightedConnectionEntitySelectionRequest] =
    useState<HighlightedConnectionEntitySelectionRequest | null>(null);
  const [isHighlightedConnectionEntityInYoungestGeneration, setIsHighlightedConnectionEntityInYoungestGeneration] =
    useState(false);
  const [isSelectedPathTooltipVisible, setIsSelectedPathTooltipVisible] = useState(false);
  const [visibleConnectionMatchupTooltipKey, setVisibleConnectionMatchupTooltipKey] =
    useState<string | null>(null);
  const connectionSessionRef = useRef<ConnectionSession | null>(null);
  const pendingHashWriteRef = useRef<PendingHashWrite | null>(null);
  const bookmarksReturnHashRef = useRef(normalizeHashValue(initialLocationState.hash));
  const autocompleteRequestIdRef = useRef(0);
  const connectionSessionIdRef = useRef(0);
  const connectionRowIdRef = useRef(0);
  const highlightedConnectionEntitySelectionRequestIdRef = useRef(0);
  const connectionBarRef = useRef<HTMLElement | null>(null);
  const connectionInputWrapRef = useRef<HTMLDivElement | null>(null);
  const connectionDropdownRef = useRef<HTMLDivElement | null>(null);
  const deferredConnectionQuery = useDeferredValue(connectionQuery);
  const isBookmarksView = appLocation.viewMode === "bookmarks";
  const highestGenerationSelectedLabel = getHighestGenerationSelectedLabel(hashValue);
  const selectedPathTooltipEntries = getSelectedPathTooltipEntries(hashValue);
  const highlightedConnectionEntity =
    selectedSuggestionIndex >= 0 ? connectionSuggestions[selectedSuggestionIndex] ?? null : null;

  useEffect(() => {
    connectionSessionRef.current = connectionSession;
  }, [connectionSession]);

  useEffect(() => {
    function syncHashState(nextHash: string) {
      const normalizedNextHash = normalizeHashValue(nextHash);
      const pendingHashWrite = pendingHashWriteRef.current;
      const matchedPendingHashWrite =
        pendingHashWrite !== null && pendingHashWrite.hash === normalizedNextHash;

      setHashValue(nextHash);

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
    }, 2000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyStatus]);

  useEffect(() => {
    connectionSessionRef.current = null;
    setConnectionSession(null);
  }, [hashValue]);

  useEffect(() => {
    document.title = isBookmarksView ? "Bookmarks | BaconDegrees420" : getDocumentTitle(hashValue);
  }, [hashValue, isBookmarksView]);

  useEffect(() => {
    let cancelled = false;

    if (isBookmarksView || !youngestSelectedCard || youngestSelectedCard.kind === "cinenerdle") {
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
  }, [isBookmarksView, youngestSelectedCard]);

  useEffect(() => {
    const query = deferredConnectionQuery.trim();
    if (!query) {
      startTransition(() => {
        setConnectionSuggestions([]);
        setSelectedSuggestionIndex(-1);
      });
      return;
    }

    const requestId = autocompleteRequestIdRef.current + 1;
    autocompleteRequestIdRef.current = requestId;

    void getAllSearchableConnectionEntities().then(async (searchRecords) => {
      if (autocompleteRequestIdRef.current !== requestId) {
        return;
      }

      const candidateRecords = searchRecords
        .map((record) => ({
          record,
          sortScore: getSuggestionScore(query, record.nameLower),
        }))
        .filter((item) => item.sortScore >= 0)
        .sort((left, right) => {
          if (right.sortScore !== left.sortScore) {
            return right.sortScore - left.sortScore;
          }

          const popularityDifference =
            (right.record.popularity ?? 0) - (left.record.popularity ?? 0);
          if (popularityDifference !== 0) {
            return popularityDifference;
          }

          if (left.record.type !== right.record.type) {
            return left.record.type === "person" ? -1 : 1;
          }

          return left.record.nameLower.localeCompare(right.record.nameLower);
        })
        .slice(0, 24);

      const nextSuggestions = Array.from(new Map((await Promise.all(
        candidateRecords.map(async ({ record, sortScore }) => {
          const entity = await hydrateConnectionEntityFromSearchRecord(record);
          return {
            ...entity,
            popularity: record.popularity ?? 0,
            sortScore: Math.max(
              sortScore,
              getSuggestionScore(query, entity.label),
            ),
          };
        }),
      ))
        .map((entity) => [entity.key, entity] as const))
        .values())
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
        .slice(0, 12);

      if (autocompleteRequestIdRef.current !== requestId) {
        return;
      }

      startTransition(() => {
        setConnectionSuggestions(nextSuggestions);
        setSelectedSuggestionIndex(nextSuggestions.length > 0 ? 0 : -1);
      });
    });
  }, [deferredConnectionQuery]);

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
      const megabytes = bytes / (1024 * 1024);
      const confirmed = window.confirm(
        `Clear the TMDB cache?\n\nAbout ${megabytes.toFixed(2)} MB would be reclaimed.`,
      );

      if (!confirmed) {
        if (!import.meta.env.DEV) {
          return;
        }

        return copyCinenerdleIndexedDbSnapshotToClipboard()
          .then(({ peopleCount, filmCount, searchableConnectionEntityCount }) => {
            setCopyStatus(
              `DB copied (${peopleCount} people, ${filmCount} films, ${searchableConnectionEntityCount} search)`,
            );
          })
          .catch((error: unknown) => {
            setCopyStatus(
              error instanceof Error && error.message
                ? error.message
                : "DB copy failed",
            );
          });
      }

      return clearIndexedDb().then(() => {
        handleReset();
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
        setCopyStatus(`Debug log copied (${entryCount})`);
      })
      .catch((error: unknown) => {
        setCopyStatus(
          error instanceof Error && error.message
            ? error.message
            : "Debug copy failed",
        );
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
    setHashValue(nextHash);

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
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      if (event.key === "Escape" || event.key === "b" || event.key === "B") {
        event.preventDefault();
        handleToggleBookmarks();
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [handleToggleBookmarks, isBookmarksView]);

  function handleRemoveBookmark(bookmarkId: string) {
    setBookmarks((currentBookmarks) => removeBookmarkEntry(currentBookmarks, bookmarkId));
  }

  function handleMoveBookmark(bookmarkId: string, direction: "up" | "down") {
    setBookmarks((currentBookmarks) => moveBookmarkEntry(currentBookmarks, bookmarkId, direction));
  }

  function handleLoadBookmark(bookmark: BookmarkEntry) {
    const normalizedBookmarkHash = normalizeHashValue(bookmark.hash);
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

  function handleLoadBookmarkPreviewCard(bookmark: BookmarkEntry, previewCardIndex: number) {
    const previewCardHash = getBookmarkPreviewCardHash(bookmark.hash, previewCardIndex);
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

  function handleToggleBookmarkPreviewCard(bookmarkId: string, previewCardIndex: number) {
    setBookmarks((currentBookmarks) =>
      toggleBookmarkPreviewCardSelection(currentBookmarks, bookmarkId, previewCardIndex)
    );
  }

  function handleSaveBookmark() {
    const normalizedHash = normalizeHashValue(hashValue);
    setIsSavingBookmark(true);

    void buildBookmarkPreviewCardsFromHash(normalizedHash)
      .then((previewCards) => {
        const existingBookmark = bookmarks.find((bookmark) => bookmark.hash === normalizedHash);
        const nextBookmark: BookmarkEntry = {
          id: existingBookmark?.id ?? createBookmarkId(),
          hash: normalizedHash,
          savedAt: new Date().toISOString(),
          label: formatBookmarkLabel(normalizedHash),
          previewCards,
          selectedPreviewCardIndices: existingBookmark?.selectedPreviewCardIndices ?? [],
        };

        setBookmarks((currentBookmarks) => upsertBookmarkEntry(currentBookmarks, nextBookmark));
        setCopyStatus(existingBookmark ? "Bookmark updated" : "Bookmark saved");
      })
      .catch(() => {
        setCopyStatus("Bookmark failed");
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

  const navigateToConnectionEntity = useCallback(
    (entity: ConnectionEntity) => {
      navigateToHash(serializeConnectionEntityHash(entity), "navigation");
    },
    [navigateToHash],
  );

  const navigateToConnectionPath = useCallback(
    (path: ConnectionEntity[]) => {
      navigateToHash(serializeConnectionPathHash(path), "navigation");
    },
    [navigateToHash],
  );

  const clearConnectionInputState = useCallback(() => {
    setConnectionQuery("");
    setConnectionSuggestions([]);
    setSelectedSuggestionIndex(-1);
  }, []);

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
          .catch(() => createFallbackConnectionEntity(params.left)),
        hydrateConnectionEntityFromKey(params.right.key)
          .then((entity) => mergeHydratedConnectionEntity(params.right, entity))
          .catch(() => createFallbackConnectionEntity(params.right)),
      ]);

      const result = await findConnectionPathBidirectional(leftEntity, rightEntity, {
        excludedNodeKeys: new Set(params.excludedNodeKeys),
        excludedEdgeKeys: new Set(params.excludedEdgeKeys),
        timeoutMs: 5000,
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

      if (
        exclusion.kind === "node" &&
        parentRow.childDisallowedNodeKeys.includes(exclusion.nodeKey)
      ) {
        return;
      }

      if (exclusion.kind === "edge") {
        const isAlreadyDisallowed = parentRow.childDisallowedEdgeKeys.includes(exclusion.edgeKey);
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
                    childDisallowedEdgeKeys: row.childDisallowedEdgeKeys.filter(
                      (edgeKey) => edgeKey !== exclusion.edgeKey,
                    ),
                  }
                  : row,
              ),
          };

          connectionSessionRef.current = nextSession;
          setConnectionSession(nextSession);
          return;
        }
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

        if (isHighlightedConnectionEntityInYoungestGeneration) {
          highlightedConnectionEntitySelectionRequestIdRef.current += 1;
          setHighlightedConnectionEntitySelectionRequest({
            requestKey: `highlighted-connection-entity:${highlightedConnectionEntitySelectionRequestIdRef.current}`,
            entity: selectedSuggestion,
          });
          clearConnectionInputState();
          return;
        }

        void openConnectionRowsForEntity(selectedSuggestion);
      }
    },
    [
      connectionSuggestions,
      clearConnectionInputState,
      isHighlightedConnectionEntityInYoungestGeneration,
      openConnectionRowsForEntity,
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
      void openConnectionRowsForEntity(suggestion);
    },
    [openConnectionRowsForEntity],
  );

  function renderConnectionMatchupTile(entity: ConnectionMatchupPreviewEntity) {
    const tooltipEntries = getTooltipEntries(entity.tooltipText);
    const isTooltipVisible = visibleConnectionMatchupTooltipKey === entity.key;

    return (
      <span
        className="bacon-connection-matchup-tile-wrap"
        onBlur={() => setVisibleConnectionMatchupTooltipKey((currentKey) =>
          currentKey === entity.key ? null : currentKey)}
        onFocus={() => setVisibleConnectionMatchupTooltipKey(entity.key)}
        onMouseEnter={() => setVisibleConnectionMatchupTooltipKey(entity.key)}
        onMouseLeave={() => setVisibleConnectionMatchupTooltipKey((currentKey) =>
          currentKey === entity.key ? null : currentKey)}
      >
        <span
          aria-label={entity.name}
          className="bacon-connection-matchup-tile"
          tabIndex={0}
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
        {isTooltipVisible ? (
          <span
            className="bacon-connection-pill-tooltip bacon-connection-matchup-tooltip"
            role="tooltip"
          >
            {renderTooltipEntries(tooltipEntries, entity.key)}
          </span>
        ) : null}
      </span>
    );
  }

  function renderConnectionMatchupPreview() {
    if (!connectionMatchupPreview) {
      return null;
    }

    return (
      <div
        aria-label={`Suggested matchup: ${connectionMatchupPreview.counterpart.name} vs ${connectionMatchupPreview.spoiler.name}`}
        className="bacon-connection-matchup"
      >
        {renderConnectionMatchupTile(connectionMatchupPreview.counterpart)}
        <span aria-hidden="true" className="bacon-connection-matchup-vs">
          vs
        </span>
        {renderConnectionMatchupTile(connectionMatchupPreview.spoiler)}
      </div>
    );
  }

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
            {entity.connectionCount}
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

  function renderBookmarksPage() {
    if (bookmarks.length === 0) {
      return (
        <section className="bacon-bookmarks-page">
          <div className="bacon-bookmarks-empty-state">
            <p className="bacon-bookmarks-empty-title">No bookmarks yet.</p>
            <p className="bacon-bookmarks-empty-copy">
              Save the current path with `💾` and it will show up here as a row of cards.
            </p>
          </div>
        </section>
      );
    }

    return (
      <section className="bacon-bookmarks-page">
        {bookmarks.map((bookmark, bookmarkIndex) => (
          <article className="bacon-bookmark-row-shell" key={bookmark.id}>
            <div className="bacon-bookmark-row-layout">
              <div className="bacon-bookmark-row-actions bacon-bookmark-row-actions-left">
                <button
                  aria-label={`Move ${bookmark.label} up`}
                  className="bacon-title-action-icon-button"
                  disabled={bookmarkIndex === 0}
                  onClick={() => handleMoveBookmark(bookmark.id, "up")}
                  title="Move bookmark up"
                  type="button"
                >
                  ⬆️
                </button>
                <span
                  className="bacon-bookmark-index-bubble"
                  role="note"
                  tabIndex={0}
                  title={formatBookmarkIndexTooltip(bookmark)}
                >
                  {bookmarkIndex + 1}
                </span>
                <button
                  aria-label={`Move ${bookmark.label} down`}
                  className="bacon-title-action-icon-button"
                  disabled={bookmarkIndex === bookmarks.length - 1}
                  onClick={() => handleMoveBookmark(bookmark.id, "down")}
                  title="Move bookmark down"
                  type="button"
                >
                  ⬇️
                </button>
                <button
                  aria-label={`Load ${bookmark.label}`}
                  className="bacon-title-action-icon-button"
                  onClick={() => handleLoadBookmark(bookmark)}
                  title="Load bookmark"
                  type="button"
                >
                  📥
                </button>
                <button
                  aria-label={`Remove ${bookmark.label}`}
                  className="bacon-title-action-icon-button bacon-title-action-icon-button-danger"
                  onClick={() => handleRemoveBookmark(bookmark.id)}
                  title="Remove bookmark"
                  type="button"
                >
                  🗑️
                </button>
              </div>
              <div className="bacon-bookmark-row-body">
                <div className="bacon-bookmark-card-row">
                  {bookmark.previewCards.map((card, cardIndex) => (
                    <BookmarkPreviewCardView
                      card={card}
                      isSelected={bookmark.selectedPreviewCardIndices.includes(cardIndex)}
                      key={card.key}
                      onNameClick={() => handleLoadBookmarkPreviewCard(bookmark, cardIndex)}
                      onToggleSelected={() => handleToggleBookmarkPreviewCard(bookmark.id, cardIndex)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </article>
        ))}
      </section>
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
          onClick={handleTitleDebugCopy}
          title={import.meta.env.DEV ? "Copy debug log" : undefined}
        >
          BaconDegrees420
        </h1>
        {copyStatus ? <span className="bacon-copy-status">{copyStatus}</span> : null}
        <div className="bacon-title-actions">
          {renderConnectionMatchupPreview()}
          <button
            aria-label="Save bookmark"
            className="bacon-title-action-icon-button"
            disabled={isSavingBookmark}
            onClick={handleSaveBookmark}
            title={isSavingBookmark ? "Saving bookmark..." : "Save bookmark"}
            type="button"
          >
            💾
          </button>
          <button
            aria-label={isBookmarksView ? "Close bookmarks" : "Open bookmarks"}
            className="bacon-title-action-icon-button"
            onClick={handleToggleBookmarks}
            title={isBookmarksView ? "Close bookmarks" : "Open bookmarks"}
            type="button"
          >
            {isBookmarksView ? "🎬" : "📚"}
          </button>
          <button
            aria-label="Clear database"
            className="bacon-title-action-button"
            onClick={handleClearDatabase}
            title="Clear TMDB cache"
            type="button"
          >
            Clear DB
          </button>
        </div>
      </header>

      {!isBookmarksView ? (
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
                  {renderConnectionEntityCard(connectionSession.left, {
                    onCardClick: () => navigateToConnectionEntity(connectionSession.left),
                    onNameClick: () => navigateToConnectionEntity(connectionSession.left),
                  })}
                  <span className="bacon-connection-arrow bacon-connection-arrow-static">
                    <span className="bacon-connection-arrow-break" aria-hidden="true">
                      <span className="bacon-connection-arrow-break-line" />
                      <span className="bacon-connection-arrow-break-slash">/</span>
                      <span className="bacon-connection-arrow-break-head">→</span>
                    </span>
                  </span>
                  {renderConnectionEntityCard(connectionSession.right, {
                    onCardClick: () => navigateToConnectionEntity(connectionSession.right),
                    onNameClick: () => navigateToConnectionEntity(connectionSession.right),
                  })}
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
                          {renderConnectionEntityCard(entity, {
                            dimmed: isNodeDimmed,
                            onCardClick: isMiddleNode
                              ? () =>
                                spawnAlternativeConnectionRow(row.id, {
                                  kind: "node",
                                  nodeKey: entity.key,
                                })
                              : undefined,
                            onNameClick: isLeftmostNode
                              ? () => navigateToConnectionPath([...row.path].reverse())
                              : () => navigateToConnectionEntity(entity),
                          })}
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
                              title={
                                isEdgeDimmed
                                  ? "Reconnect this edge"
                                  : "Disconnect this edge"
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
    </div>
  );
}

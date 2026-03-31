import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AbstractGenerator,
  type AbstractGeneratorActivationRequest,
  type AbstractGeneratorFocusRequest,
  type AbstractGeneratorTreeRefreshRequest,
} from "../../components/abstract_generator";
import "../../styles/cinenerdle2.css";
import type { GeneratorNode } from "../../types/generator";
import type { ConnectionEntity } from "./connection_graph";
import {
  refreshTreeForFetchedCard,
  useCinenerdleController,
  type FetchedCardRefreshRequest,
} from "./controller";
import {
  normalizeHashValue,
} from "./hash";
import {
  applyHash,
  areYoungestSelectedCardsEqual,
  getCardTmdbEntityId,
  getYoungestSelectedCard,
  getYoungestSelectedCardParent,
  getYoungestSelectedGenerationIndex,
  getPersonTmdbIdFromCard,
  matchesHighlightedConnectionEntity,
} from "./navigation";
import {
  CINENERDLE_RECORDS_UPDATED_EVENT,
  getIndexedDbSnapshot,
  type IndexedDbSnapshot,
  type IndexedDbSnapshotConnection,
  type IndexedDbSnapshotFilm,
  type IndexedDbSnapshotPerson,
} from "./indexed_db";
import { primeTmdbApiKeyOnInit, setTmdbLogGeneration } from "./tmdb";
import { normalizeName, normalizeTitle } from "./utils";
import type { CinenerdleCard } from "./view_types";
export {
  CinenerdleBreakBar,
  CinenerdleEntityCard,
  type RenderableCinenerdleEntityCard
} from "./entity_card";

type SelectedPathCard = Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>;

function findSnapshotPerson(
  snapshot: IndexedDbSnapshot,
  card: Extract<SelectedPathCard, { kind: "person" }>,
): IndexedDbSnapshotPerson | null {
  const tmdbId = getPersonTmdbIdFromCard(card);
  if (tmdbId !== null) {
    return snapshot.people.find((person) => person.tmdbId === tmdbId) ?? null;
  }

  const normalizedCardName = normalizeName(card.name);
  if (!normalizedCardName) {
    return null;
  }

  return snapshot.people.find((person) => normalizeName(person.name) === normalizedCardName) ?? null;
}

function findSnapshotFilm(
  snapshot: IndexedDbSnapshot,
  card: Extract<SelectedPathCard, { kind: "movie" }>,
): IndexedDbSnapshotFilm | null {
  const tmdbId = getCardTmdbEntityId(card);
  if (tmdbId !== null) {
    return snapshot.films.find((film) => film.tmdbId === tmdbId) ?? null;
  }

  const normalizedCardTitle = normalizeTitle(card.name);
  const cardYear = card.year.trim();

  return snapshot.films.find((film) =>
    normalizeTitle(film.title) === normalizedCardTitle && film.year.trim() === cardYear) ?? null;
}

function findSnapshotConnectionToParent(
  snapshot: IndexedDbSnapshot,
  youngestSelectedCard: Exclude<SelectedPathCard, { kind: "cinenerdle" }>,
  parentSelectedCard: SelectedPathCard | null,
): IndexedDbSnapshotConnection | null {
  if (!parentSelectedCard || parentSelectedCard.kind === "cinenerdle") {
    return null;
  }

  if (youngestSelectedCard.kind === "person" && parentSelectedCard.kind === "movie") {
    const parentFilm = findSnapshotFilm(snapshot, parentSelectedCard);
    const childPersonTmdbId =
      findSnapshotPerson(snapshot, youngestSelectedCard)?.tmdbId ??
      getPersonTmdbIdFromCard(youngestSelectedCard);

    if (childPersonTmdbId === null) {
      return null;
    }

    return parentFilm?.people.find((connection) => connection.personTmdbId === childPersonTmdbId) ?? null;
  }

  if (youngestSelectedCard.kind === "movie" && parentSelectedCard.kind === "person") {
    const selectedFilm = findSnapshotFilm(snapshot, youngestSelectedCard);
    const parentPersonTmdbId =
      findSnapshotPerson(snapshot, parentSelectedCard)?.tmdbId ??
      getPersonTmdbIdFromCard(parentSelectedCard);

    if (parentPersonTmdbId === null) {
      return null;
    }

    return selectedFilm?.people.find((connection) => connection.personTmdbId === parentPersonTmdbId) ?? null;
  }

  return null;
}

async function logYoungestSelectedCardDatabaseEntry(
  youngestSelectedCard: SelectedPathCard | null,
  parentSelectedCard: SelectedPathCard | null,
): Promise<void> {
  if (!import.meta.env.DEV || !youngestSelectedCard || youngestSelectedCard.kind === "cinenerdle") {
    return;
  }

  try {
    const snapshot = await getIndexedDbSnapshot();
    const item = youngestSelectedCard.kind === "person"
      ? findSnapshotPerson(snapshot, youngestSelectedCard)
      : findSnapshotFilm(snapshot, youngestSelectedCard);
    const connection = findSnapshotConnectionToParent(
      snapshot,
      youngestSelectedCard,
      parentSelectedCard,
    );

    console.log({
      item,
      connection,
    });
  } catch (error: unknown) {
    console.log({
      event: "app:youngest-selected:db-entry:error",
      message: error instanceof Error ? error.message : String(error),
      parentKey: parentSelectedCard?.key ?? null,
      selectedKey: youngestSelectedCard.key,
    });
  }
}

type Cinenerdle2Props = {
  hashValue: string;
  highlightedConnectionEntity?: ConnectionEntity | null;
  highlightedConnectionEntitySelectionRequest?: {
    requestKey: string;
    entity: ConnectionEntity;
  } | null;
  navigationVersion: number;
  onHighlightedConnectionEntitySelectionHandled?: (
    requestKey: string,
    didSelect: boolean,
  ) => void;
  onHighlightedConnectionEntityYoungestGenerationMatchChange?: (didMatch: boolean) => void;
  onYoungestSelectedCardChange?: (
    card: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null,
  ) => void;
  onHashWrite: (nextHash: string, mode: "selection" | "navigation") => void;
  resetVersion: number;
};

const Cinenerdle2 = memo(function Cinenerdle2({
  hashValue,
  highlightedConnectionEntity = null,
  highlightedConnectionEntitySelectionRequest = null,
  navigationVersion,
  onHighlightedConnectionEntitySelectionHandled,
  onHighlightedConnectionEntityYoungestGenerationMatchChange,
  onYoungestSelectedCardChange,
  onHashWrite,
  resetVersion,
}: Cinenerdle2Props) {
  const normalizedHash = normalizeHashValue(hashValue);
  const hashRef = useRef(normalizedHash);
  const lastYoungestSelectedCardRef = useRef<
    Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null
  >(null);
  const [recordsRefreshVersion, setRecordsRefreshVersion] = useState(0);
  const [cardDataRefreshRequest, setCardDataRefreshRequest] = useState<FetchedCardRefreshRequest | null>(null);

  useLayoutEffect(() => {
    hashRef.current = normalizedHash;
  }, [normalizedHash]);

  useEffect(() => {
    primeTmdbApiKeyOnInit();
  }, []);

  useEffect(() => {
    function handleRecordsUpdated() {
      setRecordsRefreshVersion((version) => version + 1);
    }

    window.addEventListener(CINENERDLE_RECORDS_UPDATED_EVENT, handleRecordsUpdated);
    return () => {
      window.removeEventListener(CINENERDLE_RECORDS_UPDATED_EVENT, handleRecordsUpdated);
    };
  }, []);

  const readHash = useCallback(() => hashRef.current, [hashRef]);
  const writeHash = useCallback(
    (nextHash: string, mode: "selection" | "navigation" = "navigation") => {
      const normalizedNextHash = normalizeHashValue(nextHash);
      const currentHash = normalizeHashValue(window.location.hash);

      if (normalizedNextHash === currentHash) {
        return;
      }

      onHashWrite(normalizedNextHash, mode);
      applyHash(normalizedNextHash);
    },
    [onHashWrite],
  );

  const controller = useCinenerdleController({
    onCardDataRefreshRequested: setCardDataRefreshRequest,
    recordsRefreshVersion,
    readHash,
    writeHash,
  });
  const treeRefreshRequest = useMemo<AbstractGeneratorTreeRefreshRequest<CinenerdleCard> | null>(() => {
    if (!cardDataRefreshRequest) {
      return null;
    }

    return {
      requestKey: cardDataRefreshRequest.requestKey,
      run: (tree) => refreshTreeForFetchedCard(tree, cardDataRefreshRequest),
    };
  }, [cardDataRefreshRequest]);
  const focusRequest = useMemo<AbstractGeneratorFocusRequest<CinenerdleCard> | null>(() => {
    if (!highlightedConnectionEntity) {
      return null;
    }

    return {
      requestKey: highlightedConnectionEntity.key,
      targetGeneration: "youngest",
      matchesNode: (node: GeneratorNode<CinenerdleCard>) =>
        matchesHighlightedConnectionEntity(node.data, highlightedConnectionEntity),
    };
  }, [highlightedConnectionEntity]);
  const activationRequest = useMemo<AbstractGeneratorActivationRequest<CinenerdleCard> | null>(() => {
    if (!highlightedConnectionEntitySelectionRequest) {
      return null;
    }

    return {
      requestKey: highlightedConnectionEntitySelectionRequest.requestKey,
      targetGeneration: "youngest",
      matchesNode: (node: GeneratorNode<CinenerdleCard>) =>
        matchesHighlightedConnectionEntity(node.data, highlightedConnectionEntitySelectionRequest.entity),
    };
  }, [highlightedConnectionEntitySelectionRequest]);
  const getRowPresentation = useCallback((row: GeneratorNode<CinenerdleCard>[]) => {
    const isBreakRow = row.length === 1 && row[0]?.data.kind === "break";

    if (!isBreakRow) {
      return {};
    }

    return {
      hideBubble: true,
      className: "generator-row-break",
      trackClassName: "generator-row-track-break",
      cardButtonClassName: "generator-card-button-row-break",
    };
  }, []);
  const generatorResetKey = `${resetVersion}:${navigationVersion}`;

  return (
    <AbstractGenerator
      activationRequest={activationRequest}
      createInitialState={controller.createInitialState}
      focusRequest={focusRequest}
      getRowPresentation={getRowPresentation}
      key={generatorResetKey}
      onActivationHandled={onHighlightedConnectionEntitySelectionHandled}
      onFocusRequestMatchChange={onHighlightedConnectionEntityYoungestGenerationMatchChange}
      onTreeChange={(tree) => {
        const youngestSelectedGenerationIndex = getYoungestSelectedGenerationIndex(tree);
        const nextYoungestSelectedCard = getYoungestSelectedCard(tree);
        const nextYoungestSelectedCardParent = getYoungestSelectedCardParent(tree);
        setTmdbLogGeneration(youngestSelectedGenerationIndex);
        if (areYoungestSelectedCardsEqual(
          lastYoungestSelectedCardRef.current,
          nextYoungestSelectedCard,
        )) {
          return;
        }

        lastYoungestSelectedCardRef.current = nextYoungestSelectedCard;
        void logYoungestSelectedCardDatabaseEntry(
          nextYoungestSelectedCard,
          nextYoungestSelectedCardParent,
        );
        onYoungestSelectedCardChange?.(nextYoungestSelectedCard);
      }}
      optimisticSelection
      reduce={controller.reduce}
      renderCard={controller.renderCard}
      runEffect={controller.runEffect}
      treeRefreshRequest={treeRefreshRequest}
    />
  );
});

export default Cinenerdle2;

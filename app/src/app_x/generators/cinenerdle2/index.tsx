import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AbstractGenerator,
  type AbstractGeneratorTreeRefreshRequest,
} from "../../components/abstract_generator";
import "../../styles/cinenerdle2.css";
import type { GeneratorNode } from "../../types/generator";
import {
  buildTreeFromHash,
  useCinenerdleController,
} from "./controller";
import {
  CINENERDLE_ENTITY_REFRESH_REQUESTED_EVENT,
  type EntityRefreshRequest,
} from "./entity_refresh";
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
  navigationVersion: number;
  onYoungestSelectedCardChange?: (
    card: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null,
  ) => void;
  onHashWrite: (nextHash: string, mode: "selection" | "navigation") => void;
  resetVersion: number;
};

const Cinenerdle2 = memo(function Cinenerdle2({
  hashValue,
  navigationVersion,
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
  const [activeEntityRefreshRequest, setActiveEntityRefreshRequest] = useState<EntityRefreshRequest | null>(null);
  const pendingEntityRefreshRequestsRef = useRef<EntityRefreshRequest[]>([]);

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

  useEffect(() => {
    function advanceEntityRefreshQueue() {
      setActiveEntityRefreshRequest((currentRequest) => {
        if (currentRequest) {
          return currentRequest;
        }

        return pendingEntityRefreshRequestsRef.current.shift() ?? null;
      });
    }

    function handleEntityRefreshRequested(event: Event) {
      const refreshEvent = event as CustomEvent<EntityRefreshRequest>;
      const request = refreshEvent.detail;
      if (!request) {
        return;
      }

      pendingEntityRefreshRequestsRef.current = [
        ...pendingEntityRefreshRequestsRef.current.filter((pendingRequest) =>
          pendingRequest.requestKey !== request.requestKey,
        ),
        request,
      ];
      advanceEntityRefreshQueue();
    }

    window.addEventListener(
      CINENERDLE_ENTITY_REFRESH_REQUESTED_EVENT,
      handleEntityRefreshRequested as EventListener,
    );

    return () => {
      window.removeEventListener(
        CINENERDLE_ENTITY_REFRESH_REQUESTED_EVENT,
        handleEntityRefreshRequested as EventListener,
      );
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
    recordsRefreshVersion,
    readHash,
    writeHash,
  });
  const treeRefreshRequest = useMemo<AbstractGeneratorTreeRefreshRequest<CinenerdleCard> | null>(() => {
    if (!activeEntityRefreshRequest) {
      return null;
    }

    return {
      requestKey: activeEntityRefreshRequest.requestKey,
      run: async () => {
        try {
          return await buildTreeFromHash(readHash(), {
            bypassInFlightCache: true,
          });
        } finally {
          setActiveEntityRefreshRequest(pendingEntityRefreshRequestsRef.current.shift() ?? null);
        }
      },
    };
  }, [activeEntityRefreshRequest, readHash]);
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
  const shouldAutoScrollMountedGeneration = useCallback((info: {
    generationIndex: number;
    tree: GeneratorNode<CinenerdleCard>[][];
  }) => {
    if (info.generationIndex !== 1) {
      return false;
    }

    const rootNode = info.tree[0]?.find((node) => node.selected) ?? null;
    return rootNode?.data.kind === "cinenerdle";
  }, []);
  const generatorResetKey = `${resetVersion}:${navigationVersion}`;

  return (
    <AbstractGenerator
      createInitialState={controller.createInitialState}
      getRowPresentation={getRowPresentation}
      key={generatorResetKey}
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
      reduce={controller.reduce}
      renderCard={controller.renderCard}
      runEffect={controller.runEffect}
      shouldAutoScrollMountedGeneration={shouldAutoScrollMountedGeneration}
      treeRefreshRequest={treeRefreshRequest}
    />
  );
});

export default Cinenerdle2;

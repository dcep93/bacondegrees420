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
  getYoungestSelectedCard,
  getYoungestSelectedGenerationIndex,
} from "./navigation";
import {
  CINENERDLE_RECORDS_UPDATED_EVENT,
} from "./indexed_db";
import { primeTmdbApiKeyOnInit, setTmdbLogGeneration } from "./tmdb";
import type { CinenerdleCard } from "./view_types";
export {
  CinenerdleBreakBar,
  CinenerdleEntityCard,
  type RenderableCinenerdleEntityCard
} from "./entity_card";

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
        setTmdbLogGeneration(youngestSelectedGenerationIndex);
        if (areYoungestSelectedCardsEqual(
          lastYoungestSelectedCardRef.current,
          nextYoungestSelectedCard,
        )) {
          return;
        }

        lastYoungestSelectedCardRef.current = nextYoungestSelectedCard;
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

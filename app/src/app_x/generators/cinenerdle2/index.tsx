import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AbstractGenerator,
  type AbstractGeneratorHandle,
  type AbstractGeneratorTreeRefreshRequest,
} from "../../components/abstract_generator";
import "../../styles/cinenerdle2.css";
import type { GeneratorNode } from "../../types/generator";
import {
  buildTreeFromHash,
  markInitialViewportSettled,
  resetInitialViewportSettled,
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
  connectedSuggestionSelectionRequest?: {
    nextHash: string;
    requestKey: string;
    suggestionKey: string;
  } | null;
  hashValue: string;
  highlightedConnectedSuggestionKey?: string | null;
  navigationVersion: number;
  onYoungestSelectedCardChange?: (
    card: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null,
  ) => void;
  onHashWrite: (nextHash: string, mode: "selection" | "navigation") => void;
  resetVersion: number;
};

function scrollPageToBottom() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const scrollTop = Math.max(
    document.body?.scrollHeight ?? 0,
    document.documentElement?.scrollHeight ?? 0,
  );

  window.scrollTo({
    top: scrollTop,
    behavior: "auto",
  });
}

const Cinenerdle2 = memo(function Cinenerdle2({
  connectedSuggestionSelectionRequest = null,
  hashValue,
  highlightedConnectedSuggestionKey = null,
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
  const generatorHandleRef = useRef<AbstractGeneratorHandle | null>(null);
  const lastHandledConnectedSuggestionSelectionRequestKeyRef = useRef<string | null>(null);
  const lastGeneratorResetKeyRef = useRef<string | null>(null);
  const initialTreeShellRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<GeneratorNode<CinenerdleCard>[][]>([]);
  const pendingInitialTreeBottomSnapRef = useRef(true);
  const initialTreeBottomSnapRequestIdRef = useRef(0);
  const initialTreeVisibilityTimeoutRef = useRef<number | null>(null);
  const [isInitialTreeVisible, setIsInitialTreeVisible] = useState(false);
  const [recordsRefreshVersion, setRecordsRefreshVersion] = useState(0);
  const [activeEntityRefreshRequest, setActiveEntityRefreshRequest] = useState<EntityRefreshRequest | null>(null);
  const pendingEntityRefreshRequestsRef = useRef<EntityRefreshRequest[]>([]);
  const recordsRefreshScheduledRef = useRef(false);
  const activeEntityRefreshRequestRef = useRef<EntityRefreshRequest | null>(null);

  useLayoutEffect(() => {
    hashRef.current = normalizedHash;
  }, [normalizedHash]);

  useLayoutEffect(() => {
    activeEntityRefreshRequestRef.current = activeEntityRefreshRequest;
  }, [activeEntityRefreshRequest]);

  useEffect(() => {
    primeTmdbApiKeyOnInit();
  }, []);

  const setInitialTreeShellVisibility = useCallback((visible: boolean) => {
    const shellElement = initialTreeShellRef.current;
    if (!shellElement) {
      return;
    }

    shellElement.style.opacity = visible ? "1" : "0";
  }, []);

  useEffect(() => {
    function handleRecordsUpdated() {
      if (recordsRefreshScheduledRef.current) {
        return;
      }

      recordsRefreshScheduledRef.current = true;
      queueMicrotask(() => {
        recordsRefreshScheduledRef.current = false;

        if (
          activeEntityRefreshRequestRef.current ||
          pendingEntityRefreshRequestsRef.current.length > 0
        ) {
          return;
        }

        setRecordsRefreshVersion((version) => version + 1);
      });
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

      // Background prefetch should warm caches without forcing a full tree rebuild.
      if (request.reason === "prefetch") {
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

  if (lastGeneratorResetKeyRef.current !== generatorResetKey) {
    lastGeneratorResetKeyRef.current = generatorResetKey;
    resetInitialViewportSettled();
    pendingInitialTreeBottomSnapRef.current = true;
    initialTreeBottomSnapRequestIdRef.current += 1;
  }

  useEffect(() => {
    setIsInitialTreeVisible(false);
    setInitialTreeShellVisibility(false);
    if (
      typeof window !== "undefined" &&
      typeof window.clearTimeout === "function" &&
      initialTreeVisibilityTimeoutRef.current !== null
    ) {
      window.clearTimeout(initialTreeVisibilityTimeoutRef.current);
    }

    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      initialTreeVisibilityTimeoutRef.current = window.setTimeout(() => {
        initialTreeVisibilityTimeoutRef.current = null;
        setInitialTreeShellVisibility(true);
        setIsInitialTreeVisible(true);
      }, 2500);
    }

    return () => {
      if (
        typeof window !== "undefined" &&
        typeof window.clearTimeout === "function" &&
        initialTreeVisibilityTimeoutRef.current !== null
      ) {
        window.clearTimeout(initialTreeVisibilityTimeoutRef.current);
        initialTreeVisibilityTimeoutRef.current = null;
      }
    };
  }, [generatorResetKey, setInitialTreeShellVisibility]);

  useEffect(() => {
    if (!highlightedConnectedSuggestionKey) {
      return;
    }

    const latestGenerationIndex = treeRef.current.length - 1;
    if (latestGenerationIndex < 0) {
      return;
    }

    const latestGeneration = treeRef.current[latestGenerationIndex] ?? [];
    const highlightedCardIndex = latestGeneration.findIndex(
      (node) => node.data.key === highlightedConnectedSuggestionKey,
    );

    if (highlightedCardIndex < 0) {
      return;
    }

    generatorHandleRef.current?.scrollToCard(latestGenerationIndex, highlightedCardIndex, {
      behavior: "smooth",
    });
  }, [highlightedConnectedSuggestionKey]);

  useEffect(() => {
    if (
      !connectedSuggestionSelectionRequest ||
      connectedSuggestionSelectionRequest.requestKey ===
      lastHandledConnectedSuggestionSelectionRequestKeyRef.current
    ) {
      return;
    }

    lastHandledConnectedSuggestionSelectionRequestKeyRef.current =
      connectedSuggestionSelectionRequest.requestKey;

    const latestGenerationIndex = treeRef.current.length - 1;
    if (latestGenerationIndex < 0) {
      writeHash(connectedSuggestionSelectionRequest.nextHash, "selection");
      return;
    }

    const latestGeneration = treeRef.current[latestGenerationIndex] ?? [];
    const selectedCardIndex = latestGeneration.findIndex(
      (node) => node.data.key === connectedSuggestionSelectionRequest.suggestionKey,
    );

    const generatorHandle = generatorHandleRef.current;
    if (selectedCardIndex >= 0 && generatorHandle) {
      generatorHandle.selectCard(latestGenerationIndex, selectedCardIndex);
      return;
    }

    writeHash(connectedSuggestionSelectionRequest.nextHash, "selection");
  }, [connectedSuggestionSelectionRequest, writeHash]);

  return (
    <div
      className={[
        "cinenerdle-initial-tree-shell",
        isInitialTreeVisible ? "cinenerdle-initial-tree-shell-visible" : "",
      ].filter(Boolean).join(" ")}
      ref={initialTreeShellRef}
    >
      <AbstractGenerator
        createInitialState={controller.createInitialState}
        generatorHandleRef={generatorHandleRef}
        getRowPresentation={getRowPresentation}
        key={generatorResetKey}
        onInitialTreePainted={(tree) => {
          if (!pendingInitialTreeBottomSnapRef.current || tree.length === 0) {
            return;
          }

          pendingInitialTreeBottomSnapRef.current = false;
          const requestId = initialTreeBottomSnapRequestIdRef.current;
          markInitialViewportSettled();
          if (initialTreeBottomSnapRequestIdRef.current === requestId) {
            scrollPageToBottom();
          }
          setInitialTreeShellVisibility(true);
          if (
            typeof window !== "undefined" &&
            typeof window.requestAnimationFrame === "function"
          ) {
            window.requestAnimationFrame(() => {
              setIsInitialTreeVisible(true);
            });
          } else {
            setIsInitialTreeVisible(true);
          }
        }}
        onTreeChange={(tree) => {
          treeRef.current = tree;
          if (!pendingInitialTreeBottomSnapRef.current && tree.length > 0 && !isInitialTreeVisible) {
            setInitialTreeShellVisibility(true);
            setIsInitialTreeVisible(true);
          }
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
    </div>
  );
});

export default Cinenerdle2;

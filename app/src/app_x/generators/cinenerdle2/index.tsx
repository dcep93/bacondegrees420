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
  type CinenerdleTreeMeta,
  markInitialViewportSettled,
  resetInitialViewportSettled,
  useCinenerdleController,
} from "./controller";
import { enrichCinenerdleTreeWithItemAttrs } from "./card_item_attrs";
import {
  CINENERDLE_ENTITY_REFRESH_REQUESTED_EVENT,
  type EntityRefreshRequest,
} from "./entity_refresh";
import {
  findConnectedSuggestionCardIndex,
  type ConnectedSuggestionMatchTarget,
} from "./connected_suggestion_match";
import {
  getConnectionPathAppendRevealGenerationIndex,
  revealConnectionPathAppendTarget,
} from "./connection_path_append_reveal";
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
import {
  addItemAttrToSnapshot,
  createEmptyItemAttrs,
  getCinenerdleItemAttrTargetFromCard,
  removeItemAttrFromSnapshot,
  type CinenerdleItemAttrs,
  writeCinenerdleItemAttrs,
} from "./item_attrs";
import { primeTmdbApiKeyOnInit, setTmdbLogGeneration } from "./tmdb";
import type { CinenerdleCard } from "./view_types";
export {
  CinenerdleBreakBar,
  CinenerdleEntityCard,
  type RenderableCinenerdleEntityCard
} from "./entity_card";

type Cinenerdle2Props = {
  connectionPathAppendRequest?: {
    nextHash: string;
    requestKey: string;
    targetEntityKey: string;
  } | null;
  connectedSuggestionSelectionRequest?: {
    nextHash: string;
    requestKey: string;
    suggestion: ConnectedSuggestionMatchTarget;
  } | null;
  hashValue: string;
  highlightedConnectedSuggestion?: ConnectedSuggestionMatchTarget | null;
  navigationVersion: number;
  onYoungestSelectedCardChange?: (
    card: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null,
  ) => void;
  onHashWrite: (nextHash: string, mode: "selection" | "navigation") => void;
  resetVersion: number;
};

type ItemAttrTreeRefreshRequest = {
  kind: "item-attrs";
  nextItemAttrsSnapshot: CinenerdleItemAttrs;
  requestKey: string;
};

type ConnectionPathAppendTreeRefreshRequest = {
  kind: "connection-path-append";
  nextHash: string;
  requestKey: string;
  targetEntityKey: string;
};

type TreeRefreshRequestState =
  | EntityRefreshRequest
  | ItemAttrTreeRefreshRequest
  | ConnectionPathAppendTreeRefreshRequest;

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
  connectionPathAppendRequest = null,
  connectedSuggestionSelectionRequest = null,
  hashValue,
  highlightedConnectedSuggestion = null,
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
  const lastHandledConnectionPathAppendRequestKeyRef = useRef<string | null>(null);
  const lastHandledConnectedSuggestionSelectionRequestKeyRef = useRef<string | null>(null);
  const lastGeneratorResetKeyRef = useRef<string | null>(null);
  const initialTreeShellRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<GeneratorNode<CinenerdleCard>[][]>([]);
  const itemAttrsSnapshotRef = useRef<CinenerdleItemAttrs>(createEmptyItemAttrs());
  const pendingInitialTreeBottomSnapRef = useRef(true);
  const initialTreeBottomSnapRequestIdRef = useRef(0);
  const initialTreeVisibilityTimeoutRef = useRef<number | null>(null);
  const [isInitialTreeVisible, setIsInitialTreeVisible] = useState(false);
  const [recordsRefreshVersion, setRecordsRefreshVersion] = useState(0);
  const [activeTreeRefreshRequest, setActiveTreeRefreshRequest] = useState<TreeRefreshRequestState | null>(null);
  const pendingTreeRefreshRequestsRef = useRef<TreeRefreshRequestState[]>([]);
  const recordsRefreshScheduledRef = useRef(false);
  const activeTreeRefreshRequestRef = useRef<TreeRefreshRequestState | null>(null);
  const itemAttrTreeRefreshRequestSequenceRef = useRef(0);
  const pendingConnectionPathAppendRevealRef = useRef<{
    requestKey: string;
    targetEntityKey: string;
  } | null>(null);

  useLayoutEffect(() => {
    hashRef.current = normalizedHash;
  }, [normalizedHash]);

  useLayoutEffect(() => {
    activeTreeRefreshRequestRef.current = activeTreeRefreshRequest;
  }, [activeTreeRefreshRequest]);

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
          activeTreeRefreshRequestRef.current ||
          pendingTreeRefreshRequestsRef.current.length > 0
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
    function advanceTreeRefreshQueue() {
      setActiveTreeRefreshRequest((currentRequest) => {
        if (currentRequest) {
          return currentRequest;
        }

        return pendingTreeRefreshRequestsRef.current.shift() ?? null;
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

      pendingTreeRefreshRequestsRef.current = [
        ...pendingTreeRefreshRequestsRef.current.filter((pendingRequest) =>
          pendingRequest.requestKey !== request.requestKey,
        ),
        request,
      ];
      advanceTreeRefreshQueue();
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

  const requestItemAttrTreeRefresh = useCallback((nextItemAttrsSnapshot: CinenerdleItemAttrs) => {
    itemAttrTreeRefreshRequestSequenceRef.current += 1;
    pendingTreeRefreshRequestsRef.current = [
      ...pendingTreeRefreshRequestsRef.current.filter((request) => request.kind !== "item-attrs"),
      {
        kind: "item-attrs",
        nextItemAttrsSnapshot,
        requestKey: `item-attrs:${itemAttrTreeRefreshRequestSequenceRef.current}`,
      },
    ];

    setActiveTreeRefreshRequest((currentRequest) =>
      currentRequest ?? pendingTreeRefreshRequestsRef.current.shift() ?? null);
  }, []);

  const handleItemAttrMutationRequested = useCallback((request: {
    action: "add" | "remove";
    card: Extract<CinenerdleCard, { kind: "movie" | "person" }>;
    itemAttr: string;
  }) => {
    const itemAttrTarget = getCinenerdleItemAttrTargetFromCard(request.card);
    if (!itemAttrTarget) {
      return;
    }

    const mutationResult = request.action === "add"
      ? addItemAttrToSnapshot(itemAttrsSnapshotRef.current, itemAttrTarget, request.itemAttr)
      : removeItemAttrFromSnapshot(itemAttrsSnapshotRef.current, itemAttrTarget, request.itemAttr);

    if (mutationResult.nextItemAttrsSnapshot === itemAttrsSnapshotRef.current) {
      return;
    }

    itemAttrsSnapshotRef.current = writeCinenerdleItemAttrs(
      mutationResult.nextItemAttrsSnapshot,
      mutationResult.changedTargets,
    );
    requestItemAttrTreeRefresh(itemAttrsSnapshotRef.current);
  }, [requestItemAttrTreeRefresh]);

  const controller = useCinenerdleController({
    onItemAttrMutationRequested: handleItemAttrMutationRequested,
    onItemAttrsSnapshotChange: (nextItemAttrsSnapshot) => {
      itemAttrsSnapshotRef.current = nextItemAttrsSnapshot;
    },
    recordsRefreshVersion,
    readHash,
    writeHash,
  });
  const treeRefreshRequest = useMemo<AbstractGeneratorTreeRefreshRequest<CinenerdleCard, CinenerdleTreeMeta> | null>(() => {
    if (!activeTreeRefreshRequest) {
      return null;
    }

    return {
      requestKey: activeTreeRefreshRequest.requestKey,
      run: async (state) => {
        try {
          if (activeTreeRefreshRequest.kind === "item-attrs") {
            itemAttrsSnapshotRef.current = activeTreeRefreshRequest.nextItemAttrsSnapshot;
            return {
              meta: {
                itemAttrsSnapshot: activeTreeRefreshRequest.nextItemAttrsSnapshot,
              },
              tree: enrichCinenerdleTreeWithItemAttrs(
                state.tree ?? [],
                activeTreeRefreshRequest.nextItemAttrsSnapshot,
              ),
            };
          }

          if (activeTreeRefreshRequest.kind === "connection-path-append") {
            const itemAttrsSnapshot = state.meta.itemAttrsSnapshot ?? itemAttrsSnapshotRef.current;
            itemAttrsSnapshotRef.current = itemAttrsSnapshot;
            const nextTree = await buildTreeFromHash(activeTreeRefreshRequest.nextHash, {
              bypassInFlightCache: true,
              hydrateYoungestSelection: true,
              itemAttrsSnapshot,
            });
            pendingConnectionPathAppendRevealRef.current = {
              requestKey: activeTreeRefreshRequest.requestKey,
              targetEntityKey: activeTreeRefreshRequest.targetEntityKey,
            };
            writeHash(activeTreeRefreshRequest.nextHash, "selection");
            return {
              meta: {
                itemAttrsSnapshot,
              },
              tree: nextTree,
            };
          }

          const itemAttrsSnapshot = state.meta.itemAttrsSnapshot ?? itemAttrsSnapshotRef.current;
          itemAttrsSnapshotRef.current = itemAttrsSnapshot;
          return {
            meta: {
              itemAttrsSnapshot,
            },
            tree: await buildTreeFromHash(readHash(), {
              bypassInFlightCache: true,
              itemAttrsSnapshot,
            }),
          };
        } finally {
          setActiveTreeRefreshRequest(pendingTreeRefreshRequestsRef.current.shift() ?? null);
        }
      },
    };
  }, [activeTreeRefreshRequest, readHash, writeHash]);
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
    if (!highlightedConnectedSuggestion) {
      return;
    }

    const latestGenerationIndex = treeRef.current.length - 1;
    if (latestGenerationIndex < 0) {
      return;
    }

    const latestGeneration = treeRef.current[latestGenerationIndex] ?? [];
    const highlightedCardIndex = findConnectedSuggestionCardIndex(
      latestGeneration,
      highlightedConnectedSuggestion,
    );

    if (highlightedCardIndex < 0) {
      return;
    }

    generatorHandleRef.current?.scrollToCard(latestGenerationIndex, highlightedCardIndex, {
      behavior: "smooth",
    });
  }, [highlightedConnectedSuggestion]);

  useEffect(() => {
    if (
      !connectionPathAppendRequest ||
      connectionPathAppendRequest.requestKey ===
      lastHandledConnectionPathAppendRequestKeyRef.current
    ) {
      return;
    }

    lastHandledConnectionPathAppendRequestKeyRef.current =
      connectionPathAppendRequest.requestKey;
    pendingTreeRefreshRequestsRef.current = [
      ...pendingTreeRefreshRequestsRef.current.filter((request) =>
        request.requestKey !== connectionPathAppendRequest.requestKey),
      {
        kind: "connection-path-append",
        nextHash: connectionPathAppendRequest.nextHash,
        requestKey: connectionPathAppendRequest.requestKey,
        targetEntityKey: connectionPathAppendRequest.targetEntityKey,
      },
    ];
    setActiveTreeRefreshRequest((currentRequest) =>
      currentRequest ?? pendingTreeRefreshRequestsRef.current.shift() ?? null);
  }, [connectionPathAppendRequest]);

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
      writeHash(connectedSuggestionSelectionRequest.nextHash, "navigation");
      return;
    }

    const latestGeneration = treeRef.current[latestGenerationIndex] ?? [];
    const selectedCardIndex = findConnectedSuggestionCardIndex(
      latestGeneration,
      connectedSuggestionSelectionRequest.suggestion,
    );

    const generatorHandle = generatorHandleRef.current;
    if (selectedCardIndex >= 0 && generatorHandle) {
      generatorHandle.selectCard(latestGenerationIndex, selectedCardIndex);
      return;
    }

    writeHash(connectedSuggestionSelectionRequest.nextHash, "navigation");
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
          const pendingConnectionPathAppendReveal = pendingConnectionPathAppendRevealRef.current;
          if (pendingConnectionPathAppendReveal) {
            const revealGenerationIndex = getConnectionPathAppendRevealGenerationIndex(
              tree,
              pendingConnectionPathAppendReveal.targetEntityKey,
            );

            if (revealGenerationIndex !== null) {
              pendingConnectionPathAppendRevealRef.current = null;
              void revealConnectionPathAppendTarget(
                generatorHandleRef.current,
                revealGenerationIndex,
              ).catch(() => { });
            }
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

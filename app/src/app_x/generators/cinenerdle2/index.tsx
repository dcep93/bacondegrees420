import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AbstractGenerator,
  type AbstractGeneratorActivationRequest,
  type AbstractGeneratorFocusRequest,
} from "../../components/abstract_generator";
import type { GeneratorNode, GeneratorTree } from "../../types/generator";
import type { ConnectionEntity } from "./connection_graph";
import { useCinenerdleController } from "./controller";
export {
  CinenerdleBreakBar,
  CinenerdleEntityCard,
  type RenderableCinenerdleEntityCard,
} from "./entity_card";
import { buildPathNodesFromSegments, normalizeHashValue, parseHashSegments } from "./hash";
import { primeTmdbApiKeyOnInit } from "./tmdb";
import { CINENERDLE_RECORDS_UPDATED_EVENT } from "./indexed_db";
import { getValidTmdbEntityId, normalizeName, normalizeTitle } from "./utils";
import type { CinenerdleCard } from "./view_types";
import "../../styles/cinenerdle2.css";

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

function getCardTmdbEntityId(card: CinenerdleCard): number | null {
  if (card.kind === "movie" || card.kind === "person") {
    return getValidTmdbEntityId(card.record?.tmdbId ?? card.record?.id);
  }

  return null;
}

function matchesHighlightedConnectionEntity(
  card: CinenerdleCard,
  entity: ConnectionEntity,
): boolean {
  if (entity.kind === "cinenerdle") {
    return card.kind === "cinenerdle";
  }

  if (entity.kind === "movie") {
    if (card.kind !== "movie") {
      return false;
    }

    if (
      normalizeTitle(card.name) === normalizeTitle(entity.name) &&
      card.year.trim() === entity.year.trim()
    ) {
      return true;
    }

    const entityTmdbId = getValidTmdbEntityId(entity.tmdbId);
    const cardTmdbId = getCardTmdbEntityId(card);
    return entityTmdbId !== null && cardTmdbId !== null && entityTmdbId === cardTmdbId;
  }

  if (card.kind !== "person") {
    return false;
  }

  const entityTmdbId = getValidTmdbEntityId(entity.tmdbId);
  const cardTmdbId = getCardTmdbEntityId(card);
  if (entityTmdbId !== null && cardTmdbId !== null) {
    return entityTmdbId === cardTmdbId;
  }

  return normalizeName(card.name) === normalizeName(entity.name);
}

function applyHash(nextHash: string) {
  const normalizedHash = normalizeHashValue(nextHash);

  if (!normalizedHash) {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    window.dispatchEvent(new Event("hashchange"));
    return;
  }

  window.location.hash = normalizedHash.replace(/^#/, "");
}

function hasLoadedPath(hashValue: string): boolean {
  return buildPathNodesFromSegments(parseHashSegments(hashValue)).length > 1;
}

function snapScrollToPageBottom() {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const scrollingElement = document.scrollingElement ?? document.documentElement;
      const maxScrollTop = Math.max(0, scrollingElement.scrollHeight - window.innerHeight);

      window.scrollTo({
        top: maxScrollTop,
        behavior: "auto",
      });
    });
  });
}

function getYoungestSelectedCard(
  tree: GeneratorTree<CinenerdleCard>,
): Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null {
  for (let rowIndex = tree.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const selectedCard = tree[rowIndex]?.find((node) => node.selected)?.data ?? null;
    if (
      selectedCard?.kind === "cinenerdle" ||
      selectedCard?.kind === "movie" ||
      selectedCard?.kind === "person"
    ) {
      return selectedCard;
    }
  }

  return null;
}

function areYoungestSelectedCardsEqual(
  left: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null,
  right: Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right || left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "cinenerdle" && right.kind === "cinenerdle") {
    return true;
  }

  if (left.key === right.key) {
    return true;
  }

  if (left.kind === "movie" && right.kind === "movie") {
    const leftTmdbId = getCardTmdbEntityId(left);
    const rightTmdbId = getCardTmdbEntityId(right);

    if (leftTmdbId !== null && rightTmdbId !== null) {
      return leftTmdbId === rightTmdbId;
    }

    return (
      normalizeTitle(left.name) === normalizeTitle(right.name) &&
      left.year.trim() === right.year.trim()
    );
  }

  const leftTmdbId = getCardTmdbEntityId(left);
  const rightTmdbId = getCardTmdbEntityId(right);
  if (leftTmdbId !== null && rightTmdbId !== null) {
    return leftTmdbId === rightTmdbId;
  }

  return normalizeName(left.name) === normalizeName(right.name);
}

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
  const shouldSnapToBottomAfterLoadRef = useRef(hasLoadedPath(normalizedHash));
  const pendingDataRefreshFrameRef = useRef<number | null>(null);
  const lastYoungestSelectedCardRef = useRef<
    Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }> | null
  >(null);
  const [dataRefreshVersion, setDataRefreshVersion] = useState(0);

  useLayoutEffect(() => {
    hashRef.current = normalizedHash;
  }, [normalizedHash]);

  useEffect(() => {
    primeTmdbApiKeyOnInit();
  }, []);

  useEffect(() => {
    function handleRecordsUpdated() {
      if (pendingDataRefreshFrameRef.current !== null) {
        return;
      }

      pendingDataRefreshFrameRef.current = window.requestAnimationFrame(() => {
        pendingDataRefreshFrameRef.current = null;
        setDataRefreshVersion((version) => version + 1);
      });
    }

    window.addEventListener(CINENERDLE_RECORDS_UPDATED_EVENT, handleRecordsUpdated);
    return () => {
      if (pendingDataRefreshFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingDataRefreshFrameRef.current);
        pendingDataRefreshFrameRef.current = null;
      }

      window.removeEventListener(CINENERDLE_RECORDS_UPDATED_EVENT, handleRecordsUpdated);
    };
  }, []);

  useEffect(() => {
    shouldSnapToBottomAfterLoadRef.current = hasLoadedPath(normalizedHash);
  }, [navigationVersion, normalizedHash]);

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
    readHash,
    writeHash,
  });
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
  const generatorResetKey = `${resetVersion}:${navigationVersion}:${dataRefreshVersion}`;

  return (
    <AbstractGenerator
      activationRequest={activationRequest}
      afterCardSelected={controller.afterCardSelected}
      focusRequest={focusRequest}
      getRowPresentation={getRowPresentation}
      initTree={controller.initTree}
      onActivationHandled={onHighlightedConnectionEntitySelectionHandled}
      onFocusRequestMatchChange={onHighlightedConnectionEntityYoungestGenerationMatchChange}
      onTreeChange={(tree) => {
        if (shouldSnapToBottomAfterLoadRef.current && tree.length > 0) {
          shouldSnapToBottomAfterLoadRef.current = false;
          snapScrollToPageBottom();
        }

        const nextYoungestSelectedCard = getYoungestSelectedCard(tree);
        if (areYoungestSelectedCardsEqual(
          lastYoungestSelectedCardRef.current,
          nextYoungestSelectedCard,
        )) {
          return;
        }

        lastYoungestSelectedCardRef.current = nextYoungestSelectedCard;
        onYoungestSelectedCardChange?.(nextYoungestSelectedCard);
      }}
      optimisticSelection
      renderCard={controller.renderCard}
      resetKey={generatorResetKey}
    />
  );
});

export default Cinenerdle2;

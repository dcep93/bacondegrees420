import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  AbstractGenerator,
  type AbstractGeneratorActivationRequest,
  type AbstractGeneratorFocusRequest,
} from "../../components/abstract_generator";
import type { GeneratorNode } from "../../types/generator";
import type { ConnectionEntity } from "./connection_graph";
import { useCinenerdleController } from "./controller";
import { normalizeHashValue } from "./hash";
import { primeTmdbApiKeyOnInit } from "./tmdb";
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

const Cinenerdle2 = memo(function Cinenerdle2({
  hashValue,
  highlightedConnectionEntity = null,
  highlightedConnectionEntitySelectionRequest = null,
  navigationVersion,
  onHighlightedConnectionEntitySelectionHandled,
  onHighlightedConnectionEntityYoungestGenerationMatchChange,
  onHashWrite,
  resetVersion,
}: Cinenerdle2Props) {
  const normalizedHash = normalizeHashValue(hashValue);
  const hashRef = useRef(normalizedHash);

  useLayoutEffect(() => {
    hashRef.current = normalizedHash;
  }, [normalizedHash]);

  useEffect(() => {
    primeTmdbApiKeyOnInit();
  }, []);

  const readHash = useCallback(() => hashRef.current, []);
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

  return (
    <AbstractGenerator
      activationRequest={activationRequest}
      afterCardSelected={controller.afterCardSelected}
      focusRequest={focusRequest}
      initTree={controller.initTree}
      onActivationHandled={onHighlightedConnectionEntitySelectionHandled}
      onFocusRequestMatchChange={onHighlightedConnectionEntityYoungestGenerationMatchChange}
      optimisticSelection={false}
      renderCard={controller.renderCard}
      resetKey={`${resetVersion}:${navigationVersion}:${normalizedHash}`}
    />
  );
});

export default Cinenerdle2;

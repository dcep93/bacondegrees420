import type { MouseEvent } from "react";
import {
  CINENERDLE_ICON_URL,
  TMDB_ICON_URL,
} from "../generators/cinenerdle2/constants";
import {
  CinenerdleEntityCard,
  type RenderableCinenerdleEntityCard,
} from "../generators/cinenerdle2/entity_card";
import type { ConnectionEntity } from "../generators/cinenerdle2/connection_graph";
import { joinClassNames } from "./ui_utils";

function createRenderableConnectionCard(
  entity: ConnectionEntity,
): RenderableCinenerdleEntityCard {
  const creditLines =
    entity.associationCreditLines && entity.associationCreditLines.length > 0
      ? entity.associationCreditLines
      : undefined;
  const sharedCardProps = {
    key: entity.key,
    name: entity.name,
    imageUrl: entity.kind === "cinenerdle" ? CINENERDLE_ICON_URL : entity.imageUrl ?? null,
    popularity: entity.popularity ?? 0,
    popularitySource: null,
    connectionCount: entity.connectionCount,
    connectionRank: entity.connectionRank ?? null,
    connectionOrder: null,
    connectionParentLabel: entity.connectionParentLabel ?? null,
    creditLines,
    sources: entity.kind === "cinenerdle"
      ? [{ iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle" }]
      : entity.hasCachedTmdbSource
        ? [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }]
        : [],
    status: null,
    hasCachedTmdbSource: entity.kind === "cinenerdle" ? false : entity.hasCachedTmdbSource,
    isExcluded: false,
    isSelected: false,
    isLocked: false,
    isAncestorSelected: false,
    itemAttrs: [],
    connectedItemAttrs: [],
    inheritedItemAttrs: [],
    itemAttrCounts: {
      activeCount: 0,
      passiveCount: 0,
    },
    onExplicitTmdbRowClick: null,
    onTmdbRowClick: null,
    tmdbTooltipText: null,
  } satisfies Omit<RenderableCinenerdleEntityCard, "kind" | "subtitle" | "subtitleDetail">;

  if (entity.kind === "movie") {
    return {
      ...sharedCardProps,
      kind: "movie",
      subtitle: entity.associationSubtitle ?? (entity.year || "Movie"),
      subtitleDetail: entity.associationSubtitleDetail ?? "",
      voteAverage: null,
      voteCount: null,
    };
  }

  if (entity.kind === "person") {
    return {
      ...sharedCardProps,
      kind: "person",
      subtitle: entity.associationSubtitle ?? "Person",
      subtitleDetail: entity.associationSubtitleDetail ?? "",
    };
  }

  return {
    ...sharedCardProps,
    kind: "cinenerdle",
    subtitle: "Daily starters",
    subtitleDetail: "",
  };
}

export default function ConnectionEntityCard({
  entity,
  dimmed,
  onCardClick,
  onNameClick,
}: {
  entity: ConnectionEntity;
  dimmed?: boolean;
  onCardClick?: () => void;
  onNameClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <CinenerdleEntityCard
      card={createRenderableConnectionCard(entity)}
      className={joinClassNames(
        onCardClick && "bacon-connection-node-clickable",
        dimmed && "bacon-connection-node-dimmed",
      )}
      onCardClick={onCardClick}
      onTitleClick={onNameClick
        ? (event) => {
          onNameClick(event as MouseEvent<HTMLButtonElement>);
        }
        : undefined}
      titleElement="button"
    />
  );
}

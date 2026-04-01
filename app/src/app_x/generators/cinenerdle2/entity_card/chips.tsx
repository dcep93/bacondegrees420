import {
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import Tooltip from "../../../components/tooltip";
import { joinClassNames } from "../../../components/ui_utils";
import { triggerTmdbRowClick } from "../entity_card_helpers";
import {
  createHeatChipStyle,
  formatConnectionBadgeTooltipText,
  formatHeatMetricValue,
} from "./helpers";
import { ConnectionCountBadge } from "./connection_count_badge";
import type { RenderableCinenerdleEntityCard } from "./types";

function renderHeatChip(
  label: "Popularity" | "Votes" | "Rating",
  value: number | null | undefined,
  maxValue: number,
  className = "cinenerdle-card-chip",
  style?: CSSProperties,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return (
    <span
      className={className}
      style={{
        ...createHeatChipStyle(value, maxValue),
        ...style,
      }}
    >
      {`${label} ${formatHeatMetricValue(label, value)}`}
    </span>
  );
}

function renderStatusChip(card: RenderableCinenerdleEntityCard) {
  if (!card.status?.text) {
    return null;
  }

  return (
    <span
      className={`cinenerdle-card-chip cinenerdle-card-status cinenerdle-card-status-${card.status.tone}`}
    >
      {card.status.text}
    </span>
  );
}

function isTmdbSourceLabel(label: string) {
  return label.trim().toLowerCase() === "tmdb";
}

function getTmdbSourceIconUrl(card: RenderableCinenerdleEntityCard) {
  return (
    card.sources.find((source) => isTmdbSourceLabel(source.label))?.iconUrl ?? null
  );
}

function isTmdbRowActivationKey(
  event: KeyboardEvent<HTMLElement>,
): boolean {
  return event.key === "Enter" || event.key === " ";
}

function PopularityChip({
  card,
  isRefreshing,
  onRefresh,
}: {
  card: RenderableCinenerdleEntityCard;
  isRefreshing: boolean;
  onRefresh: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void;
}) {
  const tooltipText = isRefreshing
    ? "Refreshing..."
    : card.tmdbTooltipText ?? card.popularitySource;

  const chip = renderHeatChip("Popularity", card.popularity, 100);
  if (!chip) {
    return null;
  }

  if (!tooltipText && !card.onTmdbRowClick) {
    return chip;
  }

  return (
    <Tooltip
      anchorProps={{
        "aria-label": [
          `Popularity ${formatHeatMetricValue("Popularity", card.popularity)}.`,
          tooltipText ?? "",
        ].filter(Boolean).join(" "),
        onClick: (event) => {
          onRefresh(event as MouseEvent<HTMLElement>);
        },
        onKeyDown: (event) => {
          if (isTmdbRowActivationKey(event as KeyboardEvent<HTMLElement>)) {
            onRefresh(event as KeyboardEvent<HTMLElement>);
          }
        },
        tabIndex: 0,
      }}
      content={tooltipText ?? "Refresh"}
      placement="right"
      variant="cinenerdle-inline"
    >
      {chip}
    </Tooltip>
  );
}

function renderConnectionBadge(card: RenderableCinenerdleEntityCard) {
  if (typeof card.connectionCount !== "number") {
    return null;
  }
  const tmdbSourceIconUrl = getTmdbSourceIconUrl(card);

  const tooltipText = formatConnectionBadgeTooltipText({
    connectionCount: card.connectionCount,
    connectionParentLabel: card.connectionParentLabel,
    connectionRank: card.connectionRank,
    name: card.name,
  });

  const badge = (
    <ConnectionCountBadge
      connectionCount={card.connectionCount}
      connectionRank={card.connectionRank}
      iconAlt="TMDb"
      iconStyle={card.isExcluded
        ? {
            filter: "grayscale(1)",
            opacity: 0.9,
          }
        : undefined}
      iconUrl={tmdbSourceIconUrl}
    />
  );
  if (!tooltipText) {
    return badge;
  }

  return (
    <Tooltip
      anchorProps={{
        "aria-label": tooltipText,
        tabIndex: 0,
      }}
      content={tooltipText}
      placement="left"
      variant="cinenerdle-inline"
    >
      {badge}
    </Tooltip>
  );
}

export function FooterChips({
  card,
}: {
  card: RenderableCinenerdleEntityCard;
}) {
  const [refreshState, setRefreshState] = useState<{
    cardKey: string | null;
    isRefreshing: boolean;
  }>({
    cardKey: null,
    isRefreshing: false,
  });
  const isRefreshing =
    refreshState.isRefreshing &&
    refreshState.cardKey === card.key;

  const handleRefresh = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    card.onExplicitTmdbRowClick?.();

    void triggerTmdbRowClick(event, {
      isRefreshing,
      onTmdbRowClick: card.onTmdbRowClick,
      setIsRefreshing: (nextIsRefreshing) => {
        setRefreshState(
          nextIsRefreshing
            ? {
                cardKey: card.key,
                isRefreshing: true,
              }
            : {
                cardKey: null,
                isRefreshing: false,
              },
        );
      },
    });
  };
  const connectionBadge = card.hasCachedTmdbSource
    ? renderConnectionBadge(card)
    : null;
  const statusChip = renderStatusChip(card);
  const voteCountChip =
    card.kind === "movie"
      ? renderHeatChip("Votes", card.voteCount, 20000)
      : null;
  const ratingChip =
    card.kind === "movie"
      ? renderHeatChip(
          "Rating",
          card.voteAverage,
          10,
          "cinenerdle-card-chip",
          typeof card.voteCount === "number" && Number.isFinite(card.voteCount)
            ? { marginLeft: "auto" }
            : undefined,
        )
      : null;
  const shouldRenderBottomRow =
    card.kind === "movie" || Boolean(statusChip);

  return (
    <footer className="cinenerdle-card-footer">
      <div
        className={joinClassNames(
          "cinenerdle-card-footer-top",
          card.onTmdbRowClick && "cinenerdle-card-footer-top-refreshable",
        )}
        onClick={card.onTmdbRowClick
          ? (event) => {
              handleRefresh(event);
            }
          : undefined}
      >
        {connectionBadge ? connectionBadge : (
          <div className="cinenerdle-card-footer-spacer" />
        )}
        {card.kind === "cinenerdle" ? null : (
          <PopularityChip
            card={card}
            isRefreshing={isRefreshing}
            onRefresh={handleRefresh}
          />
        )}
      </div>
      {shouldRenderBottomRow ? (
        <div className="cinenerdle-card-footer-bottom">
          {voteCountChip}
          {ratingChip}
          {statusChip}
        </div>
      ) : null}
    </footer>
  );
}

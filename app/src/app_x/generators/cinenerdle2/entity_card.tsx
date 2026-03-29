import type { AriaRole, CSSProperties, KeyboardEvent, MouseEvent } from "react";
import type { CardSource, CardStatus } from "./view_types";

type BaseRenderableCinenerdleEntityCard = {
  kind: "cinenerdle" | "person" | "movie";
  name: string;
  imageUrl: string | null;
  subtitle: string;
  subtitleDetail: string;
  popularity: number;
  popularitySource: string | null;
  connectionCount: number | null;
  connectionRank: number | null;
  connectionOrder: number | null;
  connectionParentLabel: string | null;
  sources: CardSource[];
  status: CardStatus | null;
  hasCachedTmdbSource: boolean;
  isSelected: boolean;
  isLocked?: boolean;
  isAncestorSelected?: boolean;
};

type RenderableMovieCard = BaseRenderableCinenerdleEntityCard & {
  kind: "movie";
  voteAverage: number | null;
  voteCount: number | null;
};

type RenderableNonMovieCard = BaseRenderableCinenerdleEntityCard & {
  kind: "cinenerdle" | "person";
};

export type RenderableCinenerdleEntityCard = RenderableMovieCard | RenderableNonMovieCard;

export function CinenerdleBreakBar({
  className,
  label = "ESCAPE",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      aria-label={label}
      className={[
        "cinenerdle-break-bar",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="separator"
    >
      <span className="cinenerdle-break-bar-label">{label}</span>
    </div>
  );
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

function renderPopularityChip(card: RenderableCinenerdleEntityCard) {
  const chip = renderHeatChip("Popularity", card.popularity, 100);
  if (!chip) {
    return null;
  }

  if (!card.popularitySource) {
    return chip;
  }

  return (
    <span
      aria-label={`Popularity ${formatHeatMetricValue("Popularity", card.popularity)}. ${card.popularitySource}`}
      className="cinenerdle-card-chip-tooltip-anchor"
      tabIndex={0}
    >
      {chip}
      <span className="cinenerdle-card-inline-tooltip" role="tooltip">
        {card.popularitySource}
      </span>
    </span>
  );
}

function getConnectionBadgeText(card: RenderableCinenerdleEntityCard) {
  if (typeof card.connectionCount !== "number") {
    return null;
  }

  if (
    typeof card.connectionRank === "number" &&
    typeof card.connectionOrder === "number"
  ) {
    return `${card.connectionRank} - ${card.connectionOrder} / ${card.connectionCount}`;
  }

  if (typeof card.connectionRank === "number") {
    return `${card.connectionRank} / ${card.connectionCount}`;
  }

  return String(card.connectionCount);
}

function renderConnectionBadge(card: RenderableCinenerdleEntityCard) {
  const badgeText = getConnectionBadgeText(card);
  if (!badgeText) {
    return null;
  }

  const tooltipText =
    typeof card.connectionCount === "number" &&
    typeof card.connectionRank === "number" &&
    typeof card.connectionOrder === "number" &&
    card.connectionParentLabel
      ? `${card.name} has ${card.connectionCount} connections\nordered ${card.connectionOrder} for ${card.connectionParentLabel}\nrank ${card.connectionRank} by popularity`
      : null;

  const badge = <span className="cinenerdle-card-count">{badgeText}</span>;
  if (!tooltipText) {
    return badge;
  }

  return (
    <span
      aria-label={tooltipText}
      className="cinenerdle-card-chip-tooltip-anchor"
      tabIndex={0}
    >
      {badge}
      <span className="cinenerdle-card-inline-tooltip" role="tooltip">
        {tooltipText}
      </span>
    </span>
  );
}

function renderFooter(card: RenderableCinenerdleEntityCard) {
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
      <div className="cinenerdle-card-footer-top">
        {connectionBadge ? (
          <div className="cinenerdle-card-footer-left">
            {connectionBadge}
          </div>
        ) : (
          <div className="cinenerdle-card-footer-spacer" />
        )}
        {card.kind === "cinenerdle" ? null : renderPopularityChip(card)}
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

export function CinenerdleEntityCard({
  card,
  ariaPressed,
  className,
  onCardClick,
  onCardKeyDown,
  onTitleClick,
  role,
  tabIndex,
  titleElement = "p",
}: {
  card: RenderableCinenerdleEntityCard;
  ariaPressed?: boolean;
  className?: string;
  onCardClick?: (event: MouseEvent<HTMLElement>) => void;
  onCardKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onTitleClick?: (event: MouseEvent<HTMLElement>) => void;
  role?: AriaRole;
  tabIndex?: number;
  titleElement?: "button" | "p";
}) {
  return (
    <article
      aria-pressed={ariaPressed}
      className={[
        "cinenerdle-card",
        card.isSelected ? "cinenerdle-card-selected" : "",
        card.isLocked ? "cinenerdle-card-locked" : "",
        card.isAncestorSelected ? "cinenerdle-card-ancestor-selected" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onCardClick}
      onKeyDown={onCardKeyDown}
      role={role}
      tabIndex={tabIndex}
    >
      <div className="cinenerdle-card-image-shell">
        {card.imageUrl ? (
          <img
            alt={card.name}
            className="cinenerdle-card-image"
            loading="lazy"
            src={card.imageUrl}
          />
        ) : (
          <div className="cinenerdle-card-image cinenerdle-card-image-fallback">
            {card.name}
          </div>
        )}
      </div>

      <div className="cinenerdle-card-copy">
        {onTitleClick && titleElement === "button" ? (
          <button
            className="cinenerdle-card-title"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onTitleClick(event);
            }}
            type="button"
          >
            {card.name}
          </button>
        ) : (
          <p
            className="cinenerdle-card-title"
            onClick={onTitleClick
              ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                onTitleClick(event);
              }
              : undefined}
          >
            {card.name}
          </p>
        )}
        <div className="cinenerdle-card-copy-spacer" />
        <div className="cinenerdle-card-secondary">
          <p className="cinenerdle-card-subtitle">{card.subtitle}</p>
          {card.subtitleDetail ? (
            <p className="cinenerdle-card-detail">{card.subtitleDetail}</p>
          ) : null}
        </div>
        {renderFooter(card)}
      </div>
    </article>
  );
}

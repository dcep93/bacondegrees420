import type { CSSProperties, KeyboardEvent } from "react";
import type { BookmarkPreviewCard } from "./bookmark_preview";

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatHeatMetricValue(label: "Popularity" | "Votes" | "Rating", value: number) {
  if (label === "Popularity" || label === "Rating") {
    return Number(value.toFixed(2));
  }

  return value;
}

function createHeatChipStyle(value: number, maxValue: number) {
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

function renderStatusChip(card: BookmarkPreviewCard) {
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

function renderFooter(card: BookmarkPreviewCard) {
  const hasTopLeftContent =
    typeof card.connectionCount === "number" || card.sources.length > 0;
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
  const shouldRenderBottomRow = card.kind === "movie" || Boolean(statusChip);

  return (
    <footer className="cinenerdle-card-footer">
      <div className="cinenerdle-card-footer-top">
        {hasTopLeftContent ? (
          <div className="cinenerdle-card-footer-left">
            {typeof card.connectionCount === "number" ? (
              <span className="cinenerdle-card-count">{card.connectionCount}</span>
            ) : null}
            {card.sources.length > 0 ? (
              <div className="cinenerdle-card-sources">
                {card.sources.map((source) => (
                  <img
                    alt={source.label}
                    aria-label={source.label}
                    className="cinenerdle-card-source-icon"
                    key={`${source.iconUrl}:${source.label}`}
                    src={source.iconUrl}
                    style={
                      card.hasCachedTmdbSource
                        ? undefined
                        : {
                          filter: "grayscale(1)",
                          opacity: 0.9,
                        }
                    }
                    title={source.label}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="cinenerdle-card-footer-spacer" />
        )}
        {card.kind === "cinenerdle"
          ? null
          : renderHeatChip("Popularity", card.popularity, 100)}
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

export function BookmarkPreviewCardView({
  card,
  isSelected = false,
  onNameClick,
  onToggleSelected,
}: {
  card: BookmarkPreviewCard;
  isSelected?: boolean;
  onNameClick?: () => void;
  onToggleSelected?: () => void;
}) {
  const isToggleable = typeof onToggleSelected === "function";

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!isToggleable) {
      return;
    }

    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onToggleSelected();
  }

  return (
    <article
      aria-pressed={isToggleable ? isSelected : undefined}
      className={[
        "cinenerdle-card",
        "bacon-bookmark-card",
        isSelected ? "cinenerdle-card-selected" : "",
      ].filter(Boolean).join(" ")}
      onClick={isToggleable ? onToggleSelected : undefined}
      onKeyDown={isToggleable ? handleKeyDown : undefined}
      role={isToggleable ? "button" : undefined}
      tabIndex={isToggleable ? 0 : undefined}
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
        {onNameClick ? (
          <button
            className="cinenerdle-card-title"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onNameClick();
            }}
            type="button"
          >
            {card.name}
          </button>
        ) : (
          <p className="cinenerdle-card-title">{card.name}</p>
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

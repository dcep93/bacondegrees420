import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { triggerPopularityChipRefresh } from "../entity_card_helpers";
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

type PointerPosition = {
  clientX: number;
  clientY: number;
};

function isPointerWithinElement(
  element: HTMLElement | null,
  pointerPosition: PointerPosition | null,
): boolean {
  if (
    typeof document === "undefined" ||
    !element ||
    !pointerPosition
  ) {
    return false;
  }

  const hoveredElement = document.elementFromPoint(
    pointerPosition.clientX,
    pointerPosition.clientY,
  );

  return Boolean(hoveredElement && element.contains(hoveredElement));
}

function InlineTooltipAnchor({
  ariaLabel,
  children,
  onClick,
  onKeyDown,
  tooltipAlignment = "right",
  tooltipText,
}: {
  ariaLabel: string;
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  tooltipAlignment?: "left" | "right";
  tooltipText: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [dismissedByClick, setDismissedByClick] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const lastInteractionRef = useRef<"keyboard" | "pointer">("keyboard");
  const lastPointerPositionRef = useRef<PointerPosition | null>(null);

  const clearTooltipState = useCallback(() => {
    setIsHovered(false);
    setIsFocused(false);
    setDismissedByClick(false);
  }, []);

  const syncHoveredState = useCallback(() => {
    if (!isHovered) {
      return;
    }

    if (isPointerWithinElement(anchorRef.current, lastPointerPositionRef.current)) {
      return;
    }

    setIsHovered(false);
    if (!isFocused) {
      setDismissedByClick(false);
    }
  }, [isFocused, isHovered]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      syncHoveredState();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [syncHoveredState]);

  useEffect(() => {
    if (!isHovered && !isFocused) {
      return undefined;
    }

    const handleDocumentClick = (event: Event) => {
      const anchor = anchorRef.current;
      const target = event.target;

      if (anchor && target instanceof Node && anchor.contains(target)) {
        setDismissedByClick(true);
        return;
      }

      clearTooltipState();
    };

    const handleViewportChange = () => {
      syncHoveredState();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearTooltipState();
        return;
      }

      syncHoveredState();
    };

    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", clearTooltipState);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", clearTooltipState);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [clearTooltipState, isFocused, isHovered, syncHoveredState]);

  const isTooltipVisible = (isHovered || isFocused) && !dismissedByClick;

  return (
    <span
      aria-label={ariaLabel}
      ref={anchorRef}
      className="cinenerdle-card-chip-tooltip-anchor"
      data-tooltip-visible={isTooltipVisible ? "true" : "false"}
      onBlur={() => {
        setIsFocused(false);
        setDismissedByClick(false);
      }}
      onFocus={() => {
        setIsFocused(lastInteractionRef.current !== "pointer");
        setDismissedByClick(false);
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerDown={() => {
        lastInteractionRef.current = "pointer";
        setIsFocused(false);
      }}
      onPointerEnter={(event) => {
        lastPointerPositionRef.current = {
          clientX: event.clientX,
          clientY: event.clientY,
        };
        setIsHovered(true);
        setDismissedByClick(false);
      }}
      onPointerMove={(event) => {
        lastPointerPositionRef.current = {
          clientX: event.clientX,
          clientY: event.clientY,
        };
      }}
      onPointerLeave={() => {
        setIsHovered(false);
        if (!isFocused) {
          setDismissedByClick(false);
        }
      }}
      onKeyUp={() => {
        lastInteractionRef.current = "keyboard";
      }}
      onKeyDownCapture={() => {
        lastInteractionRef.current = "keyboard";
      }}
      tabIndex={0}
    >
      {children}
      <span
        className={[
          "cinenerdle-card-inline-tooltip",
          `cinenerdle-card-inline-tooltip-${tooltipAlignment}`,
        ].join(" ")}
        role="tooltip"
      >
        {tooltipText}
      </span>
    </span>
  );
}

function isPopularityRefreshActivationKey(
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
  onRefresh: (
    source: "footer-top" | "popularity-chip",
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  ) => void;
}) {
  const tooltipText = isRefreshing
    ? "Refreshing..."
    : card.popularityTooltipText ?? card.popularitySource;

  const chip = renderHeatChip("Popularity", card.popularity, 100);
  if (!chip) {
    return null;
  }

  if (!tooltipText && !card.onPopularityClick) {
    return chip;
  }

  return (
    <InlineTooltipAnchor
      ariaLabel={[
        `Popularity ${formatHeatMetricValue("Popularity", card.popularity)}.`,
        tooltipText ?? "",
      ].filter(Boolean).join(" ")}
      onClick={(event) => {
        onRefresh("popularity-chip", event);
      }}
      onKeyDown={(event) => {
        if (!isPopularityRefreshActivationKey(event)) {
          return;
        }

        onRefresh("popularity-chip", event);
      }}
      tooltipText={tooltipText ?? ""}
    >
      {chip}
    </InlineTooltipAnchor>
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
      iconUrl={tmdbSourceIconUrl}
    />
  );
  if (!tooltipText) {
    return badge;
  }

  return (
    <InlineTooltipAnchor
      ariaLabel={tooltipText}
      tooltipAlignment="left"
      tooltipText={tooltipText}
    >
      {badge}
    </InlineTooltipAnchor>
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

  const handleRefresh = (
    source: "footer-top" | "popularity-chip",
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  ) => {
    if (source === "footer-top") {
      card.onExplicitFooterTopRefreshClick?.();
    }

    void triggerPopularityChipRefresh(event, {
      isRefreshing,
      onPopularityClick: card.onPopularityClick,
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
        className={[
          "cinenerdle-card-footer-top",
          card.onPopularityClick ? "cinenerdle-card-footer-top-refreshable" : "",
        ].filter(Boolean).join(" ")}
        onClick={card.onPopularityClick
          ? (event) => {
              handleRefresh("footer-top", event);
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

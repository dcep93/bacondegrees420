import type { ReactNode } from "react";
import { formatConnectionBadgeTooltipText } from "./helpers";
import type { RenderableCinenerdleEntityCard } from "./types";

export type CinenerdleFooterTooltip = {
  ariaLabel: string;
  content: ReactNode;
};

function getTooltipLines(text: string | null | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderFooterTooltipLines(lines: string[]) {
  if (lines.length === 0) {
    return null;
  }

  return (
    <span className="cinenerdle-card-footer-tooltip-section">
      <span className="cinenerdle-card-footer-tooltip-section-body">
        {lines.map((line, index) => (
          <span className="cinenerdle-card-footer-tooltip-line" key={`${index}:${line}`}>
            {line}
          </span>
        ))}
      </span>
    </span>
  );
}

export function getCinenerdleFooterTooltipContent(
  card: RenderableCinenerdleEntityCard,
  {
    includeActionHint = true,
    isRefreshing = false,
  }: {
    includeActionHint?: boolean;
    isRefreshing?: boolean;
  } = {},
): CinenerdleFooterTooltip | null {
  const connectionLines = card.hasCachedTmdbSource
    ? getTooltipLines(formatConnectionBadgeTooltipText({
        connectionCount: card.connectionCount,
        connectionParentLabel: card.connectionParentLabel,
        connectionRank: card.connectionRank,
        name: card.name,
      }))
    : [];
  const tmdbLines = card.kind === "cinenerdle"
    ? []
    : getTooltipLines(
        isRefreshing
          ? "Refreshing..."
          : card.tmdbTooltipText ?? card.popularitySource,
      );
  const visibleTmdbLines = tmdbLines.filter((line) =>
    line !== "Click to refetch." &&
    (includeActionHint || line !== "Click to fetch."),
  );
  const actionHint = includeActionHint
    ? isRefreshing
      ? "Refreshing TMDb data..."
      : "Click anywhere in the footer to refetch."
    : null;
  const hasVisibleContent = connectionLines.length > 0 || visibleTmdbLines.length > 0;

  if (!hasVisibleContent) {
    return null;
  }

  const ariaLabel = [
    "TMDb footer details",
    ...connectionLines,
    ...visibleTmdbLines,
    actionHint,
  ].filter(Boolean).join("\n");

  return {
    ariaLabel,
    content: (
      <span className="cinenerdle-card-footer-tooltip-panel">
        {renderFooterTooltipLines([
          ...connectionLines,
          ...visibleTmdbLines,
        ])}
      </span>
    ),
  };
}

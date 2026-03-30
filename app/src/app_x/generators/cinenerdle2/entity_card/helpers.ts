import type { CSSProperties } from "react";
import type { RenderableCinenerdleEntityCard } from "./types";

type ConnectionBadgeLike = Pick<RenderableCinenerdleEntityCard, "connectionCount" | "connectionRank">;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatHeatMetricValue(
  label: "Popularity" | "Votes" | "Rating",
  value: number,
) {
  if (label === "Popularity") {
    return value.toFixed(2);
  }

  if (label === "Rating") {
    return Number(value.toFixed(2));
  }

  return value;
}

export function createHeatChipStyle(value: number, maxValue: number): CSSProperties {
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

export function getConnectionBadgeText(card: ConnectionBadgeLike) {
  if (typeof card.connectionCount !== "number") {
    return null;
  }

  if (typeof card.connectionRank === "number") {
    return `#${card.connectionRank} / ${card.connectionCount}`;
  }

  return String(card.connectionCount);
}

export function formatConnectionBadgeTooltipText({
  connectionCount,
  connectionParentLabel,
  connectionRank,
  name,
}: {
  connectionCount: number | null | undefined;
  connectionParentLabel?: string | null;
  connectionRank: number | null | undefined;
  name: string;
}) {
  if (typeof connectionCount !== "number") {
    return null;
  }

  const tooltipLines = [
    `${name} has ${connectionCount} connections`,
    typeof connectionRank === "number" && connectionParentLabel
      ? `${connectionParentLabel} is the #${connectionRank} connection`
      : null,
  ].filter((line): line is string => Boolean(line));

  return tooltipLines.length > 0 ? tooltipLines.join("\n") : null;
}

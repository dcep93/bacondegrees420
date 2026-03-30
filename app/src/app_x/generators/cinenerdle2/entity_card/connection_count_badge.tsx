import type { CSSProperties } from "react";
import { getConnectionBadgeText } from "./helpers";

export function ConnectionCountBadge({
  connectionCount,
  connectionRank,
  iconAlt,
  iconClassName,
  iconStyle,
  iconUrl,
}: {
  connectionCount: number | null | undefined;
  connectionRank: number | null | undefined;
  iconAlt?: string;
  iconClassName?: string;
  iconStyle?: CSSProperties;
  iconUrl?: string | null;
}) {
  const badgeText = getConnectionBadgeText({
    connectionCount: connectionCount ?? null,
    connectionRank: connectionRank ?? null,
  });
  if (!badgeText) {
    return null;
  }

  return (
    <div className="cinenerdle-card-footer-left">
      <span className="cinenerdle-card-count">
        <span>{badgeText}</span>
        {iconUrl ? (
          <img
            alt={iconAlt ?? ""}
            className={iconClassName ?? "cinenerdle-card-count-icon"}
            src={iconUrl}
            style={iconStyle}
          />
        ) : null}
      </span>
    </div>
  );
}

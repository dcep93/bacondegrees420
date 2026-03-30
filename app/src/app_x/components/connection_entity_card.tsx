import type { MouseEvent } from "react";
import {
  CINENERDLE_ICON_URL,
  TMDB_ICON_URL,
} from "../generators/cinenerdle2/constants";
import {
  createHeatChipStyle,
  formatConnectionBadgeTooltipText,
  formatHeatMetricValue,
} from "../generators/cinenerdle2/entity_card/helpers";
import { ConnectionCountBadge } from "../generators/cinenerdle2/entity_card/connection_count_badge";
import type { ConnectionEntity } from "../generators/cinenerdle2/connection_graph";
import FancyTooltip from "./fancy_tooltip";

function getConnectionEntitySourceLabel(entity: ConnectionEntity) {
  return entity.kind === "cinenerdle" ? "Cinenerdle" : "TMDb";
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
  onNameClick?: () => void;
}) {
  const hasImage = Boolean(entity.imageUrl);
  const sourceLabel = getConnectionEntitySourceLabel(entity);
  const tooltipText = formatConnectionBadgeTooltipText({
    connectionCount: entity.connectionCount,
    connectionParentLabel: entity.connectionParentLabel,
    connectionRank: entity.connectionRank,
    name: entity.name,
  });
  const popularity = typeof entity.popularity === "number" ? entity.popularity : null;

  return (
    <article
      className={[
        "bacon-connection-node",
        entity.kind === "cinenerdle" ? "bacon-connection-node-cinenerdle" : "",
        hasImage ? "bacon-connection-node-has-image" : "",
        onCardClick ? "bacon-connection-node-clickable" : "",
        dimmed ? "bacon-connection-node-dimmed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onCardClick}
    >
      {hasImage ? (
        <div className="bacon-connection-node-thumbnail-shell">
          <img
            alt=""
            aria-hidden="true"
            className="bacon-connection-node-thumbnail"
            loading="lazy"
            src={entity.imageUrl ?? undefined}
          />
        </div>
      ) : null}
      <div className="bacon-connection-node-body">
        <button
          className="bacon-connection-node-name"
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            onNameClick?.();
          }}
          type="button"
        >
          {entity.label}
        </button>
        <FancyTooltip
          anchorClassName="bacon-connection-node-meta-tooltip-anchor"
          anchorProps={{ tabIndex: 0 }}
          content={tooltipText}
          placement="top-center"
          variant="inline"
          wrapperTag="div"
        >
          <div className="bacon-connection-node-meta">
            <div className="bacon-connection-node-meta-primary">
              <ConnectionCountBadge
                connectionCount={entity.connectionCount}
                connectionRank={entity.connectionRank}
                iconAlt={sourceLabel}
                iconClassName="bacon-connection-node-source-icon"
                iconStyle={
                  entity.kind === "cinenerdle" || entity.hasCachedTmdbSource
                    ? undefined
                    : {
                      filter: "grayscale(1)",
                      opacity: 0.9,
                    }
                }
                iconUrl={entity.kind === "cinenerdle" ? CINENERDLE_ICON_URL : TMDB_ICON_URL}
              />
            </div>
            {popularity !== null ? (
              <span
                className="bacon-connection-node-popularity"
                style={createHeatChipStyle(popularity, 100)}
              >
                {`Popularity ${formatHeatMetricValue("Popularity", popularity)}`}
              </span>
            ) : null}
          </div>
        </FancyTooltip>
      </div>
    </article>
  );
}

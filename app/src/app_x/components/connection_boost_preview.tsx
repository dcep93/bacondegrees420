import Tooltip from "./tooltip";
import { createHeatChipStyle, formatHeatMetricValue } from "../generators/cinenerdle2/entity_card/helpers";
import type { ConnectionBoostPreview, ConnectionBoostPreviewEntity } from "../connection_boost_preview";
import { getPreviewFallbackText } from "../selected_path";
import { joinClassNames } from "./ui_utils";

function getTooltipPopularity(entry: string): number | null {
  const match = entry.match(/^Popularity:\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const popularity = Number(match[1]);
  return Number.isFinite(popularity) ? popularity : null;
}

function renderTooltipEntry(entry: string, key: string) {
  const popularity = getTooltipPopularity(entry);

  return (
    <span className="bacon-connection-pill-tooltip-entry" key={key}>
      {typeof popularity === "number" ? (
        <span
          className="cinenerdle-card-chip"
          style={createHeatChipStyle(popularity, 100)}
        >
          {`Popularity ${formatHeatMetricValue("Popularity", popularity)}`}
        </span>
      ) : (
        entry
      )}
    </span>
  );
}

function renderTooltipEntries(tooltipEntries: string[], keyPrefix: string) {
  const titleEntry = tooltipEntries[0] ?? "";
  const inlinePopularity = tooltipEntries.length > 1
    ? getTooltipPopularity(tooltipEntries[1] ?? "")
    : null;
  const remainingEntries = inlinePopularity === null
    ? tooltipEntries.slice(1)
    : tooltipEntries.slice(2);

  if (!titleEntry) {
    return remainingEntries.map((entry, index) =>
      renderTooltipEntry(entry, `${keyPrefix}:${index}:${entry}`));
  }

  return [
    <span className="bacon-connection-pill-tooltip-entry" key={`${keyPrefix}:title`}>
      <span className="bacon-connection-pill-tooltip-entry-group">
        <span>{titleEntry}</span>
        {typeof inlinePopularity === "number" ? (
          <span className="bacon-connection-pill-tooltip-entry-group-secondary">
            <span
              className="cinenerdle-card-chip"
              style={createHeatChipStyle(inlinePopularity, 100)}
            >
              {`Popularity ${formatHeatMetricValue("Popularity", inlinePopularity)}`}
            </span>
          </span>
        ) : null}
      </span>
    </span>,
    ...remainingEntries.map((entry, index) =>
      renderTooltipEntry(entry, `${keyPrefix}:${index}:${entry}`)),
  ];
}

function renderBoostTile(entity: ConnectionBoostPreviewEntity) {
  return (
    <span
      className={joinClassNames(
        "bacon-connection-matchup-tile-wrap",
        entity.imageUrl && "bacon-connection-matchup-tile-wrap-image",
      )}
    >
      <span
        aria-label={entity.name}
        className={joinClassNames(
          "bacon-connection-matchup-tile",
          entity.imageUrl && "bacon-connection-matchup-tile-image",
        )}
      >
        {entity.imageUrl ? (
          <img
            alt=""
            className="bacon-connection-matchup-image"
            loading="lazy"
            src={entity.imageUrl}
          />
        ) : (
          <span className="bacon-connection-matchup-fallback">
            {getPreviewFallbackText(entity.name)}
          </span>
        )}
      </span>
    </span>
  );
}

export default function ConnectionBoostPreview({
  preview,
}: {
  preview: ConnectionBoostPreview | null;
}) {
  if (!preview) {
    return null;
  }

  const distanceTwoTooltipEntries = preview.distanceTwo.tooltipText
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const sharedConnectionTooltipEntries = preview.sharedConnection.tooltipText
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return (
    <div className="bacon-connection-matchup-shell">
      <Tooltip
        anchorClassName="bacon-connection-matchup"
        anchorProps={{
          "aria-label": `Suggested boost: ${preview.distanceTwo.name} + ${preview.sharedConnection.name}`,
          tabIndex: 0,
        }}
        content={[
          <span className="bacon-connection-pill-tooltip-entry" key="label">
            {`Boost: ${preview.distanceTwo.name} + ${preview.sharedConnection.name}`}
          </span>,
          <span className="bacon-connection-pill-tooltip-entry" key="distance-two-label">
            Most popular distance-2 item
          </span>,
          ...renderTooltipEntries(distanceTwoTooltipEntries, preview.distanceTwo.key),
          <span className="bacon-connection-pill-tooltip-entry" key="shared-label">
            Most popular shared connection
          </span>,
          ...renderTooltipEntries(
            sharedConnectionTooltipEntries,
            preview.sharedConnection.key,
          ),
        ]}
        placement="bottom-center"
        tooltipClassName="bacon-connection-matchup-tooltip"
        wrapperTag="div"
      >
        <span className="bacon-connection-matchup-content">
          {renderBoostTile(preview.distanceTwo)}
          <span aria-hidden="true" className="bacon-connection-matchup-vs">+</span>
          {renderBoostTile(preview.sharedConnection)}
        </span>
      </Tooltip>
    </div>
  );
}

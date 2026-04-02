import type { ConnectionMatchupPreview, ConnectionMatchupPreviewEntity } from "../connection_matchup_preview";
import { createHeatChipStyle, formatHeatMetricValue } from "../generators/cinenerdle2/entity_card/helpers";
import { getPreviewFallbackText } from "../selected_path";
import Tooltip from "./tooltip";
import { joinClassNames } from "./ui_utils";

const CONNECTION_MATCHUP_SPOILER_EXPLANATION = "-/-> oft-connected";

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

function renderEntityLabelWithPopularity(
  entity: ConnectionMatchupPreviewEntity,
  key: string,
) {
  return (
    <span className="bacon-connection-pill-tooltip-entry" key={key}>
      <span className="bacon-connection-pill-tooltip-entry-group">
        <span>{entity.name}</span>
        <span className="bacon-connection-pill-tooltip-entry-group-secondary">
          <span
            className="cinenerdle-card-chip"
            style={createHeatChipStyle(entity.popularity, 100)}
          >
            {`Popularity ${formatHeatMetricValue("Popularity", entity.popularity)}`}
          </span>
        </span>
      </span>
    </span>
  );
}

function renderMatchupTile(entity: ConnectionMatchupPreviewEntity) {
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

function renderPlaceholderTile(label: string) {
  return (
    <span className="bacon-connection-matchup-tile-wrap bacon-connection-matchup-tile-wrap-placeholder">
      <span
        aria-label={label}
        className="bacon-connection-matchup-tile bacon-connection-matchup-tile-placeholder"
      >
        <span className="bacon-connection-matchup-fallback">?</span>
      </span>
    </span>
  );
}

export default function ConnectionMatchupPreview({
  preview,
}: {
  preview: ConnectionMatchupPreview | null;
}) {
  if (!preview) {
    return null;
  }

  const counterpartTooltipEntries = preview.counterpart.tooltipText
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const matchupRightLabel = preview.kind === "versus"
    ? preview.spoiler.name
    : preview.placeholderLabel;
  const matchupExplanation = preview.kind === "versus"
    ? preview.spoilerExplanation ?? CONNECTION_MATCHUP_SPOILER_EXPLANATION
    : preview.placeholderExplanation;

  return (
    <div className="bacon-connection-matchup-shell">
      <Tooltip
        anchorClassName="bacon-connection-matchup"
        anchorProps={{
          "aria-label": `Suggested matchup: ${preview.counterpart.name} vs ${matchupRightLabel}`,
          tabIndex: 0,
        }}
        content={[
          preview.kind === "versus"
            ? renderEntityLabelWithPopularity(preview.spoiler, "label")
            : (
              <span className="bacon-connection-pill-tooltip-entry" key="label">
                {matchupRightLabel}
              </span>
            ),
          <span className="bacon-connection-pill-tooltip-entry" key="explanation">
            {matchupExplanation}
          </span>,
          ...renderTooltipEntries(counterpartTooltipEntries, preview.counterpart.key),
        ]}
        debugLogLabel="matchup-preview"
        placement="bottom-center"
        tooltipClassName="bacon-connection-matchup-tooltip"
        wrapperTag="div"
      >
        <span className="bacon-connection-matchup-content">
          {renderMatchupTile(preview.counterpart)}
          <span aria-hidden="true" className="bacon-connection-matchup-vs">vs</span>
          {preview.kind === "versus"
            ? renderMatchupTile(preview.spoiler)
            : renderPlaceholderTile(preview.placeholderLabel)}
        </span>
      </Tooltip>
    </div>
  );
}

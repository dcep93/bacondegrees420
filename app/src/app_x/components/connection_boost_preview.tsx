import Tooltip from "./tooltip";
import { createHeatChipStyle, formatHeatMetricValue } from "../generators/cinenerdle2/entity_card/helpers";
import type { ConnectionBoostPreview, ConnectionBoostPreviewEntity } from "../connection_boost_preview";
import { getPreviewFallbackText } from "../selected_path";
import { joinClassNames } from "./ui_utils";

function renderEntityLabelWithPopularity(
  entity: ConnectionBoostPreviewEntity,
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

  return (
    <div className="bacon-connection-matchup-shell">
      <Tooltip
        anchorClassName="bacon-connection-matchup"
        anchorProps={{
          "aria-label": `Suggested boost: ${preview.distanceTwo.name} + ${preview.sharedConnection.name}`,
          tabIndex: 0,
        }}
        content={[
          renderEntityLabelWithPopularity(preview.sharedConnection, "shared-connection"),
          <span className="bacon-connection-pill-tooltip-entry" key="connection-label">
            {"--> connects to"}
          </span>,
          renderEntityLabelWithPopularity(preview.distanceTwo, "distance-two"),
        ]}
        debugLogLabel="boost-preview"
        placement="top-center"
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

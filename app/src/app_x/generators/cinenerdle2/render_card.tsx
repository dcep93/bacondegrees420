import type { MouseEvent } from "react";
import { CinenerdleBreakBar, CinenerdleEntityCard } from "./entity_card";
import type { CinenerdleCardViewModel } from "./view_types";

export function renderDbInfoCard(
  viewModel: Extract<CinenerdleCardViewModel, { kind: "dbinfo" }>,
) {
  return (
    <article className="cinenerdle-card cinenerdle-db-card">
      <div className="cinenerdle-card-image-shell cinenerdle-db-card-image-shell">
        <div className="cinenerdle-db-card-kicker">
          {viewModel.recordKind === "movie" ? "Movie DB" : "Person DB"}
        </div>
      </div>

      <div className="cinenerdle-card-copy cinenerdle-db-card-copy">
        <p className="cinenerdle-card-title cinenerdle-db-card-title">{viewModel.name}</p>
        <div className="cinenerdle-card-secondary cinenerdle-db-card-secondary">
          <p className="cinenerdle-card-subtitle">{viewModel.subtitle}</p>
          {viewModel.subtitleDetail ? (
            <p className="cinenerdle-card-detail">{viewModel.subtitleDetail}</p>
          ) : null}
        </div>
        <div className="cinenerdle-db-card-summary">
          {viewModel.summaryItems.map((item) => (
            <div className="cinenerdle-db-card-summary-item" key={item.label}>
              <span className="cinenerdle-db-card-summary-label">{item.label}</span>
              <span className="cinenerdle-db-card-summary-value">{item.value}</span>
            </div>
          ))}
        </div>
        <p className="cinenerdle-db-card-hint">Clipboard copy is available from the title debug action.</p>
      </div>
    </article>
  );
}

export function renderBreakCard(label: string) {
  return <CinenerdleBreakBar label={label} />;
}

export function renderLoggedCinenerdleCard({
  imageFetchPriority,
  imageLoading,
  onAddItemAttr,
  onCardClick,
  onRemoveItemAttr,
  onTitleClick,
  viewModel,
}: {
  imageFetchPriority?: "auto" | "high";
  imageLoading?: "eager" | "lazy";
  onAddItemAttr?: ((nextChar: string) => void) | null;
  onCardClick?: (event: MouseEvent<HTMLElement>) => void;
  onRemoveItemAttr?: ((itemAttr: string) => void) | null;
  onTitleClick: (event: MouseEvent<HTMLElement>) => void;
  viewModel: Extract<CinenerdleCardViewModel, { kind: "cinenerdle" | "movie" | "person" }>;
}) {
  return (
    <CinenerdleEntityCard
      card={viewModel}
      imageFetchPriority={imageFetchPriority}
      imageLoading={imageLoading}
      onAddItemAttr={onAddItemAttr}
      onCardClick={onCardClick}
      onRemoveItemAttr={onRemoveItemAttr}
      onTitleClick={onTitleClick}
    />
  );
}

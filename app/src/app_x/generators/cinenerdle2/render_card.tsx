import type { MouseEvent } from "react";
import { copyCinenerdleTextToClipboard } from "./debug";
import { CinenerdleBreakBar, CinenerdleEntityCard } from "./entity_card";
import type { CinenerdleCard, CinenerdleCardViewModel } from "./view_types";
import type { GeneratorCardRowOrderMetadata } from "../../types/generator";

export function renderDbInfoCard(
  viewModel: Extract<CinenerdleCardViewModel, { kind: "dbinfo" }>,
) {
  function handleCopy(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!import.meta.env.DEV) {
      return;
    }

    void copyCinenerdleTextToClipboard(
      viewModel.body,
      {
        event: "clipboard:cinenerdle-dbinfo-copy",
        details: {
          name: viewModel.name,
          recordKind: viewModel.recordKind,
          subtitle: viewModel.subtitle,
        },
      },
    ).catch(() => { });
  }

  return (
    <article className="cinenerdle-card cinenerdle-db-card" onClick={handleCopy}>
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
        <p className="cinenerdle-db-card-hint">Click card to copy JSON summary</p>
      </div>
    </article>
  );
}

export function renderBreakCard(label: string) {
  return <CinenerdleBreakBar label={label} />;
}

export function renderLoggedCinenerdleCard({
  connectedItemAttrSources,
  loadChildConnectedItemAttrSources,
  onItemAttrCountsChange,
  onCardClick,
  onTitleClick,
  viewModel,
}: {
  connectedItemAttrSources?: Array<Extract<CinenerdleCard, { kind: "movie" | "person" }>>;
  loadChildConnectedItemAttrSources?: (() => Promise<Array<Extract<CinenerdleCard, { kind: "movie" | "person" }>>>) | null;
  onItemAttrCountsChange?: ((counts: GeneratorCardRowOrderMetadata | null) => void) | null;
  onCardClick?: (event: MouseEvent<HTMLElement>) => void;
  onTitleClick: (event: MouseEvent<HTMLElement>) => void;
  viewModel: Extract<CinenerdleCardViewModel, { kind: "cinenerdle" | "movie" | "person" }>;
}) {
  return (
    <CinenerdleEntityCard
      card={viewModel}
      connectedItemAttrSources={connectedItemAttrSources}
      loadChildConnectedItemAttrSources={loadChildConnectedItemAttrSources}
      onItemAttrCountsChange={onItemAttrCountsChange}
      onCardClick={onCardClick}
      onTitleClick={onTitleClick}
    />
  );
}

import type { MouseEvent } from "react";
import { CinenerdleEntityCard } from "./entity_card";
import type { CinenerdleCardViewModel } from "./view_types";

export function LoggedCinenerdleEntityCard({
  onCardClick,
  onTitleClick,
  viewModel,
}: {
  onCardClick?: (event: MouseEvent<HTMLElement>) => void;
  onTitleClick: (event: MouseEvent<HTMLElement>) => void;
  viewModel: Extract<CinenerdleCardViewModel, { kind: "cinenerdle" | "movie" | "person" }>;
}) {
  return (
    <CinenerdleEntityCard
      card={viewModel}
      onCardClick={onCardClick}
      onTitleClick={onTitleClick}
    />
  );
}

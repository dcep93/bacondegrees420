import type { YoungestSelectedCard } from "./connection_matchup_preview";

export function shouldResolveConnectionMatchupPreview(params: {
  isBookmarksView: boolean;
  isCinenerdleIndexedDbBootstrapLoading: boolean;
  youngestSelectedCard: YoungestSelectedCard | null;
}): boolean {
  return !(
    params.isBookmarksView ||
    params.isCinenerdleIndexedDbBootstrapLoading ||
    !params.youngestSelectedCard ||
    params.youngestSelectedCard.kind === "cinenerdle"
  );
}

export function shouldSelectConnectedDropdownSuggestionAsYoungest(
  suggestion: { isConnectedToYoungestSelection: boolean } | null,
): boolean {
  return Boolean(suggestion?.isConnectedToYoungestSelection);
}

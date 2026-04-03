import { ESCAPE_LABEL } from "./generators/cinenerdle2/constants";
import {
  buildPathNodesFromSegments,
  normalizeHashValue,
  parseHashSegments,
  serializePathNodes,
} from "./generators/cinenerdle2/hash";
import { formatMoviePathLabel } from "./generators/cinenerdle2/utils";

export function didRequestNewTabNavigation(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.metaKey || event.ctrlKey;
}

export function getNextChromeStickyState({
  currentScrollY,
  previousScrollY,
  wasSticky,
}: {
  currentScrollY: number;
  previousScrollY: number;
  wasSticky: boolean;
}): boolean {
  if (currentScrollY <= 0) {
    return false;
  }

  if (currentScrollY > previousScrollY) {
    return true;
  }

  if (currentScrollY < previousScrollY) {
    return false;
  }

  return wasSticky;
}

export function didClickGeneratorCard(target: EventTarget | null): boolean {
  if (!target || typeof (target as { closest?: unknown }).closest !== "function") {
    return false;
  }

  return Boolean(
    (target as { closest: (selector: string) => unknown }).closest(".generator-card-button"),
  );
}

export function getBookmarkPreviewCardHash(bookmarkHash: string, previewCardIndex: number): string {
  const normalizedHash = normalizeHashValue(bookmarkHash);
  const pathNodes = buildPathNodesFromSegments(parseHashSegments(normalizedHash));

  if (previewCardIndex < 0 || previewCardIndex >= pathNodes.length) {
    return normalizedHash;
  }

  return serializePathNodes(pathNodes.slice(0, previewCardIndex + 1));
}

export function getBookmarkPreviewCardRootHash(bookmarkHash: string, previewCardIndex: number): string {
  const normalizedHash = normalizeHashValue(bookmarkHash);
  const pathNodes = buildPathNodesFromSegments(parseHashSegments(normalizedHash));
  const previewPathNode = pathNodes[previewCardIndex];

  if (!previewPathNode) {
    return normalizedHash;
  }

  return serializePathNodes([previewPathNode]);
}

export function getSelectedPathTooltipEntries(hashValue: string): string[] {
  const pathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue)).filter(
    (pathNode) =>
      pathNode.kind === "cinenerdle" ||
      pathNode.kind === "movie" ||
      pathNode.kind === "person" ||
      pathNode.kind === "break",
  );

  if (pathNodes.length === 0) {
    return ["cinenerdle"];
  }

  return pathNodes.map((pathNode) =>
    pathNode.kind === "break"
      ? ESCAPE_LABEL
      : pathNode.kind === "movie"
      ? formatMoviePathLabel(pathNode.name, pathNode.year)
      : pathNode.name,
  );
}

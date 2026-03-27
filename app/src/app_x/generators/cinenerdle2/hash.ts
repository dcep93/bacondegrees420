import type { CinenerdlePathNode } from "./view_types";
import { formatMoviePathLabel, normalizeTitle, parseMoviePathLabel } from "./utils";

export function createPathNode(
  kind: "cinenerdle",
  name: string,
  year?: string,
): Extract<CinenerdlePathNode, { kind: "cinenerdle" }>;
export function createPathNode(
  kind: "person",
  name: string,
  year?: string,
): Extract<CinenerdlePathNode, { kind: "person" }>;
export function createPathNode(
  kind: "movie",
  name: string,
  year?: string,
): Extract<CinenerdlePathNode, { kind: "movie" }>;
export function createPathNode(
  kind: "break",
  name?: string,
  year?: string,
): Extract<CinenerdlePathNode, { kind: "break" }>;
export function createPathNode(
  kind: CinenerdlePathNode["kind"],
  name = "",
  year = "",
): CinenerdlePathNode {
  if (kind === "cinenerdle") {
    return { kind, name: "cinenerdle", year: "" };
  }

  if (kind === "person") {
    return { kind, name, year: "" };
  }

  if (kind === "movie") {
    return { kind, name, year };
  }

  return { kind: "break", name: "", year: "" };
}

export function getNextEntityKind(
  kind: Extract<CinenerdlePathNode["kind"], "cinenerdle" | "movie" | "person">,
): "movie" | "person" {
  return kind === "movie" ? "person" : "movie";
}

export function parseHashSegments(hashValue: string): string[] {
  const hashContent = hashValue.replace(/^#/, "").trim();

  if (!hashContent) {
    return [];
  }

  return hashContent
    .split("|")
    .map((segment) => segment.trim())
    .map((segment) =>
      segment ? decodeURIComponent(segment.replaceAll("+", "%20")) : "",
    );
}

function serializeHashSegment(segment: string): string {
  return encodeURIComponent(segment.trim().replace(/\s+/g, " ")).replace(
    /%20/g,
    "+",
  );
}

export function serializePathNodes(pathNodes: CinenerdlePathNode[]): string {
  const [rootNode, ...remainingNodes] = pathNodes;

  if (!rootNode || rootNode.kind === "break") {
    return "";
  }

  const segments =
    rootNode.kind === "cinenerdle"
      ? ["cinenerdle"]
      : rootNode.kind === "movie"
        ? ["film", formatMoviePathLabel(rootNode.name, rootNode.year)]
        : ["person", rootNode.name];

  remainingNodes.forEach((pathNode) => {
    if (pathNode.kind === "break") {
      segments.push("");
      return;
    }

    if (pathNode.kind === "movie") {
      segments.push(formatMoviePathLabel(pathNode.name, pathNode.year));
      return;
    }

    segments.push(pathNode.name);
  });

  return `#${segments.map(serializeHashSegment).join("|")}`;
}

export function normalizeHashValue(hashValue: string): string {
  return serializePathNodes(buildPathNodesFromSegments(parseHashSegments(hashValue)));
}

export function buildPathNodesFromSegments(segments: string[]): CinenerdlePathNode[] {
  if (segments.length === 0) {
    return [];
  }

  const [firstSegment, ...remainingSegments] = segments;
  const normalizedFirstSegment = normalizeTitle(firstSegment);

  if (normalizedFirstSegment === "cinenerdle") {
    const pathNodes: CinenerdlePathNode[] = [createPathNode("cinenerdle", "cinenerdle")];
    let nextKind = "movie" as "movie" | "person";

    remainingSegments.forEach((segment) => {
      if (!segment) {
        pathNodes.push(createPathNode("break", ""));
        nextKind = getNextEntityKind(nextKind);
        return;
      }

      if (nextKind === "movie") {
        const movie = parseMoviePathLabel(segment);
        pathNodes.push(createPathNode("movie", movie.name, movie.year));
        nextKind = "person";
        return;
      }

      pathNodes.push(createPathNode("person", segment));
      nextKind = "movie";
    });

    return pathNodes;
  }

  if (
    (normalizedFirstSegment !== "film" &&
      normalizedFirstSegment !== "movie" &&
      normalizedFirstSegment !== "person") ||
    remainingSegments.length === 0
  ) {
    return [];
  }

  const [rootValue, ...continuationSegments] = remainingSegments;
  const rootNode =
    normalizedFirstSegment === "person"
      ? createPathNode("person", rootValue)
      : createPathNode(
          "movie",
          parseMoviePathLabel(rootValue).name,
          parseMoviePathLabel(rootValue).year,
        );
  const pathNodes: CinenerdlePathNode[] = [rootNode];

  let nextKind = getNextEntityKind(rootNode.kind);
  continuationSegments.forEach((segment) => {
    if (!segment) {
      pathNodes.push(createPathNode("break", ""));
      nextKind = getNextEntityKind(nextKind);
      return;
    }

    if (nextKind === "movie") {
      const movie = parseMoviePathLabel(segment);
      pathNodes.push(createPathNode("movie", movie.name, movie.year));
      nextKind = "person";
      return;
    }

    pathNodes.push(createPathNode("person", segment));
    nextKind = "movie";
  });

  return pathNodes;
}

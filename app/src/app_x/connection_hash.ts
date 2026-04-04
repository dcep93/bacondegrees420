import {
  buildPathNodesFromSegments,
  createPathNode,
  parseHashSegments,
  serializePathNodes,
} from "./generators/cinenerdle2/hash";
import type { ConnectionEntity } from "./generators/cinenerdle2/connection_graph";
import type { CinenerdlePathNode } from "./generators/cinenerdle2/view_types";

export function createPathNodeFromConnectionEntity(entity: ConnectionEntity) {
  if (entity.kind === "cinenerdle") {
    return createPathNode("cinenerdle", "cinenerdle");
  }

  if (entity.kind === "movie") {
    return createPathNode("movie", entity.name, entity.year);
  }

  return createPathNode("person", entity.name, "", entity.tmdbId);
}

export function serializeConnectionEntityHash(entity: ConnectionEntity): string {
  return serializePathNodes([createPathNodeFromConnectionEntity(entity)]);
}

export function serializeConnectionPathHash(path: ConnectionEntity[]): string {
  return serializePathNodes(path.map(createPathNodeFromConnectionEntity));
}

export function appendConnectionEntityToHash(
  hashValue: string,
  entity: ConnectionEntity,
): string {
  const currentPathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue));

  return serializePathNodes([
    ...currentPathNodes,
    createPathNodeFromConnectionEntity(entity),
  ]);
}

function getSerializedPathNodeSignature(pathNode: CinenerdlePathNode): string {
  return serializePathNodes([pathNode]);
}

function trimOverlappingPathNodes(
  currentPathNodes: CinenerdlePathNode[],
  appendedPathNodes: CinenerdlePathNode[],
): CinenerdlePathNode[] {
  const maxOverlapLength = Math.min(currentPathNodes.length, appendedPathNodes.length);

  for (let overlapLength = maxOverlapLength; overlapLength > 0; overlapLength -= 1) {
    const currentSuffix = currentPathNodes.slice(-overlapLength);
    const appendedPrefix = appendedPathNodes.slice(0, overlapLength);
    const isOverlapMatch = currentSuffix.every((currentPathNode, index) =>
      getSerializedPathNodeSignature(currentPathNode) ===
      getSerializedPathNodeSignature(appendedPrefix[index]),
    );

    if (isOverlapMatch) {
      return appendedPathNodes.slice(overlapLength);
    }
  }

  return appendedPathNodes;
}

export function appendConnectionPathToHash(
  hashValue: string,
  path: ConnectionEntity[],
  targetEntityKey: string,
): string {
  const currentPathNodes = buildPathNodesFromSegments(parseHashSegments(hashValue));
  const targetEntityIndex = path.findIndex((entity) => entity.key === targetEntityKey);

  if (targetEntityIndex < 0) {
    return serializePathNodes(currentPathNodes);
  }

  const appendedPathNodes = path
    .slice(targetEntityIndex)
    .reverse()
    .map(createPathNodeFromConnectionEntity);

  return serializePathNodes([
    ...currentPathNodes,
    ...trimOverlappingPathNodes(currentPathNodes, appendedPathNodes),
  ]);
}

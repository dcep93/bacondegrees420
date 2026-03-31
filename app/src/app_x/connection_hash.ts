import { createPathNode, serializePathNodes } from "./generators/cinenerdle2/hash";
import type { ConnectionEntity } from "./generators/cinenerdle2/connection_graph";

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

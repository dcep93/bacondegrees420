import type { ConnectionEntity, ConnectionSearchResult } from "./generators/cinenerdle2/connection_graph";

export type ConnectionExclusion =
  | {
      kind: "edge";
      edgeKey: string;
    }
  | {
      kind: "node";
      nodeKey: string;
    };

export type ConnectionSearchRow = {
  id: string;
  excludedNodeKeys: string[];
  excludedEdgeKeys: string[];
  childDisallowedNodeKeys: string[];
  childDisallowedEdgeKeys: string[];
  parentRowId: string | null;
  sourceExclusion: ConnectionExclusion | null;
  status: ConnectionSearchResult["status"] | "searching";
  path: ConnectionEntity[];
};

export type ConnectionSession = {
  id: string;
  left: ConnectionEntity;
  right: ConnectionEntity;
  rows: ConnectionSearchRow[];
};

export function createSearchingConnectionRow(
  id: string,
  options?: {
    parentRowId?: string | null;
    sourceExclusion?: ConnectionExclusion | null;
  },
): ConnectionSearchRow {
  return {
    id,
    excludedNodeKeys: [],
    excludedEdgeKeys: [],
    childDisallowedNodeKeys: [],
    childDisallowedEdgeKeys: [],
    parentRowId: options?.parentRowId ?? null,
    sourceExclusion: options?.sourceExclusion ?? null,
    status: "searching",
    path: [],
  };
}

export function matchesConnectionExclusion(
  left: ConnectionExclusion | null,
  right: ConnectionExclusion | null,
): boolean {
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "node") {
    return right.kind === "node" && left.nodeKey === right.nodeKey;
  }

  return right.kind === "edge" && left.edgeKey === right.edgeKey;
}

export function collectConnectionRowFamilyIds(
  rows: ConnectionSearchRow[],
  rootRowId: string,
): Set<string> {
  const familyIds = new Set<string>([rootRowId]);
  let foundNewDescendant = true;

  while (foundNewDescendant) {
    foundNewDescendant = false;

    rows.forEach((row) => {
      if (!row.parentRowId || familyIds.has(row.id) || !familyIds.has(row.parentRowId)) {
        return;
      }

      familyIds.add(row.id);
      foundNewDescendant = true;
    });
  }

  return familyIds;
}

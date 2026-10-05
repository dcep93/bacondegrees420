import { Fragment, useEffect, useRef } from "react";
import ConnectionEntityCard from "./connection_entity_card";
import { didRequestNewTabNavigation } from "../index_helpers";
import { getConnectionEdgeKey, type ConnectionEntity } from "../generators/cinenerdle2/connection_graph";
import type { ConnectionExclusion, ConnectionSession } from "../connection_rows";
import { joinClassNames } from "./ui_utils";

export default function ConnectionResults({
  appendConnectionPathToTree,
  connectionSession,
  connectionSessions,
  isPuzzleMode = false,
  navigateToConnectionEntity,
  openConnectionEntityInNewTab,
  spawnAlternativeConnectionRow,
}: {
  appendConnectionPathToTree: (path: ConnectionEntity[], targetEntity: ConnectionEntity) => void;
  connectionSession: ConnectionSession | null;
  connectionSessions?: ConnectionSession[];
  isPuzzleMode?: boolean;
  navigateToConnectionEntity: (entity: ConnectionEntity) => void;
  openConnectionEntityInNewTab: (entity: ConnectionEntity, options?: { omitPuzzle?: boolean }) => void;
  spawnAlternativeConnectionRow: (parentRowId: string, exclusion: ConnectionExclusion) => void;
}) {
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const renderedConnectionSessions =
    connectionSessions ?? (connectionSession ? [connectionSession] : []);
  const connectionSessionId = renderedConnectionSessions.at(-1)?.id ?? null;

  useEffect(() => {
    if (!connectionSessionId) {
      return;
    }

    const resultsElement = resultsRef.current;

    if (!resultsElement) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      resultsElement.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [connectionSessionId]);

  if (renderedConnectionSessions.length === 0) {
    return null;
  }

  function handleConnectionEntityNavigation(entity: ConnectionEntity) {
    navigateToConnectionEntity(entity);
  }

  function handleConnectionEntityNewTabNavigation(entity: ConnectionEntity) {
    openConnectionEntityInNewTab(entity, {
      omitPuzzle: isPuzzleMode,
    });
  }

  function handleConnectionPathAppend(path: ConnectionEntity[], entity: ConnectionEntity) {
    appendConnectionPathToTree(path, entity);
  }

  return (
    <div className="bacon-connection-results" ref={resultsRef}>
      {renderedConnectionSessions.map((session) => {
        const hasFoundConnectionRow =
          session.rows.some((row) => row.status === "found" && row.path.length > 0);

        return (
          <Fragment key={session.id}>
            {!hasFoundConnectionRow ? (
              <div className={getConnectionRowClassName(isPuzzleMode, getPuzzleConnectionRowType(session.left, []))}>
                <ConnectionEntityCard
                  isPuzzleMode={isPuzzleMode}
                  entity={session.left}
                  onCardClick={isPuzzleMode ? undefined : () => handleConnectionEntityNavigation(session.left)}
                  onNameClick={isPuzzleMode ? undefined : (event) => {
                    if (didRequestNewTabNavigation(event)) {
                      handleConnectionEntityNewTabNavigation(session.left);
                      return;
                    }

                    handleConnectionEntityNavigation(session.left);
                  }}
                />
                <span className="bacon-connection-arrow bacon-connection-arrow-static">
                  <span className="bacon-connection-arrow-break" aria-hidden="true">
                    <span className="bacon-connection-arrow-break-line" />
                    <span className="bacon-connection-arrow-break-slash">/</span>
                    <span className="bacon-connection-arrow-break-head">→</span>
                  </span>
                </span>
                <ConnectionEntityCard
                  isPuzzleMode={isPuzzleMode}
                  entity={session.right}
                  onCardClick={isPuzzleMode ? undefined : () => handleConnectionEntityNavigation(session.right)}
                  onNameClick={isPuzzleMode ? undefined : (event) => {
                    if (didRequestNewTabNavigation(event)) {
                      handleConnectionEntityNewTabNavigation(session.right);
                      return;
                    }

                    handleConnectionEntityNavigation(session.right);
                  }}
                />
              </div>
            ) : null}

            {session.rows.map((row) => {
              if (row.status === "searching") {
                return (
                  <div className={getConnectionRowClassName(isPuzzleMode, getPuzzleConnectionRowType(session.left, []))} key={row.id}>
                    <div className="bacon-connection-status-card">
                      Searching cached connections...
                    </div>
                  </div>
                );
              }

              if (row.status !== "found" || row.path.length === 0) {
                return (
                  <div className={getConnectionRowClassName(isPuzzleMode, getPuzzleConnectionRowType(session.left, []))} key={row.id}>
                    <div className="bacon-connection-status-card">
                      {row.status === "timeout"
                        ? "Timed out after 5 seconds without finding a cached path."
                        : "No cached path found."}
                    </div>
                  </div>
                );
              }

              const puzzleRowType = getPuzzleConnectionRowType(session.left, row.path);

              return (
                <div className={getConnectionRowClassName(isPuzzleMode, puzzleRowType)} key={row.id}>
                  {row.path.map((entity, index) => {
                    const nextEntity = row.path[index + 1] ?? null;
                    const edgeKey = nextEntity ? getConnectionEdgeKey(entity.key, nextEntity.key) : "";
                    const isMiddleNode = index > 0 && index < row.path.length - 1;
                    const isNodeDimmed = row.childDisallowedNodeKeys.includes(entity.key);
                    const isEdgeDimmed = row.childDisallowedEdgeKeys.includes(edgeKey);

                    return (
                      <Fragment key={`${row.id}:${entity.key}:${index}`}>
                        <ConnectionEntityCard
                          isPuzzleMode={isPuzzleMode}
                          dimmed={isNodeDimmed}
                          entity={entity}
                          onCardClick={!isPuzzleMode && isMiddleNode
                            ? () =>
                                spawnAlternativeConnectionRow(row.id, {
                                  kind: "node",
                                  nodeKey: entity.key,
                                })
                            : undefined}
                          onNameClick={isPuzzleMode ? undefined : (event) => {
                            if (didRequestNewTabNavigation(event)) {
                              handleConnectionEntityNewTabNavigation(entity);
                              return;
                            }

                            handleConnectionPathAppend(row.path, entity);
                          }}
                          previousEntity={row.path[index - 1] ?? null}
                        />
                        {nextEntity ? (
                          <button
                            aria-label={`Exclude connection between ${entity.name} and ${nextEntity.name}`}
                            aria-pressed={isEdgeDimmed}
                            className={joinClassNames(
                              "bacon-connection-arrow",
                              "bacon-connection-arrow-button",
                              isEdgeDimmed
                                ? "bacon-connection-arrow-disconnected"
                                : "bacon-connection-arrow-connected",
                            )}
                            onClick={() =>
                              spawnAlternativeConnectionRow(row.id, {
                                kind: "edge",
                                edgeKey,
                              })}
                            type="button"
                          >
                            →
                          </button>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}

type PuzzleConnectionRowType = "green" | "red" | "gold";

const FAST_BREAK_KEY = "movie:fast break:1979";
const FAST_BREAK_NAME = "fast break";
const LAURENCE_FISHBURNE_NAME = "laurence fishburne";

function normalizeConnectionName(name: string): string {
  return name.trim().toLowerCase();
}

function isFastBreakEntity(entity: ConnectionEntity): boolean {
  return entity.kind === "movie" &&
    (entity.key === FAST_BREAK_KEY ||
      (normalizeConnectionName(entity.name) === FAST_BREAK_NAME && entity.year === "1979"));
}

function isLaurenceFishburneEntity(entity: ConnectionEntity): boolean {
  return entity.kind === "person" &&
    normalizeConnectionName(entity.name) === LAURENCE_FISHBURNE_NAME;
}

function getPuzzleConnectionRowType(submittedEntity: ConnectionEntity, path: ConnectionEntity[]): PuzzleConnectionRowType {
  if (submittedEntity.kind === "movie" && (
    submittedEntity.tmdbId === 603 ||
    (normalizeConnectionName(submittedEntity.name) === "the matrix" && submittedEntity.year === "1999")
  )) {
    return "green";
  }

  const finalEntity = path[path.length - 1] ?? null;
  const penultimateEntity = path[path.length - 2] ?? null;

  return finalEntity &&
    penultimateEntity &&
    isFastBreakEntity(finalEntity) &&
    isLaurenceFishburneEntity(penultimateEntity)
    ? "gold"
    : "red";
}

function getConnectionRowClassName(
  isPuzzleMode: boolean,
  puzzleRowType: PuzzleConnectionRowType,
): string {
  return joinClassNames(
    "bacon-connection-row",
    "bacon-bookmark-card-row",
    isPuzzleMode && "bacon-connection-row-puzzle",
    isPuzzleMode && `bacon-connection-row-puzzle-${puzzleRowType}`,
  );
}

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
  isSlideshowMode = false,
  navigateToConnectionEntity,
  openConnectionEntityInNewTab,
  spawnAlternativeConnectionRow,
}: {
  appendConnectionPathToTree: (path: ConnectionEntity[], targetEntity: ConnectionEntity) => void;
  connectionSession: ConnectionSession | null;
  connectionSessions?: ConnectionSession[];
  isSlideshowMode?: boolean;
  navigateToConnectionEntity: (entity: ConnectionEntity) => void;
  openConnectionEntityInNewTab: (entity: ConnectionEntity) => void;
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

  return (
    <div className="bacon-connection-results" ref={resultsRef}>
      {renderedConnectionSessions.map((session) => {
        const hasFoundConnectionRow =
          session.rows.some((row) => row.status === "found" && row.path.length > 0);

        return (
          <Fragment key={session.id}>
            {!hasFoundConnectionRow ? (
              <div className={getConnectionRowClassName(isSlideshowMode, "b")}>
                <ConnectionEntityCard
                  entity={session.left}
                  onCardClick={() => navigateToConnectionEntity(session.left)}
                  onNameClick={(event) => {
                    if (didRequestNewTabNavigation(event)) {
                      openConnectionEntityInNewTab(session.left);
                      return;
                    }

                    navigateToConnectionEntity(session.left);
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
                  entity={session.right}
                  onCardClick={() => navigateToConnectionEntity(session.right)}
                  onNameClick={(event) => {
                    if (didRequestNewTabNavigation(event)) {
                      openConnectionEntityInNewTab(session.right);
                      return;
                    }

                    navigateToConnectionEntity(session.right);
                  }}
                />
              </div>
            ) : null}

            {session.rows.map((row) => {
              if (row.status === "searching") {
                return (
                  <div className={getConnectionRowClassName(isSlideshowMode, "b")} key={row.id}>
                    <div className="bacon-connection-status-card">
                      Searching cached connections...
                    </div>
                  </div>
                );
              }

              if (row.status !== "found" || row.path.length === 0) {
                return (
                  <div className={getConnectionRowClassName(isSlideshowMode, "b")} key={row.id}>
                    <div className="bacon-connection-status-card">
                      {row.status === "timeout"
                        ? "Timed out after 5 seconds without finding a cached path."
                        : "No cached path found."}
                    </div>
                  </div>
                );
              }

              const slideshowRowType = getSlideshowConnectionRowType(row.path);

              return (
                <div className={getConnectionRowClassName(isSlideshowMode, slideshowRowType)} key={row.id}>
                  {row.path.map((entity, index) => {
                    const nextEntity = row.path[index + 1] ?? null;
                    const edgeKey = nextEntity ? getConnectionEdgeKey(entity.key, nextEntity.key) : "";
                    const isLeftmostNode = index === 0;
                    const isMiddleNode = index > 0 && index < row.path.length - 1;
                    const isNodeDimmed = row.childDisallowedNodeKeys.includes(entity.key);
                    const isEdgeDimmed = row.childDisallowedEdgeKeys.includes(edgeKey);

                    return (
                      <Fragment key={`${row.id}:${entity.key}:${index}`}>
                        <ConnectionEntityCard
                          dimmed={isNodeDimmed}
                          entity={entity}
                          onCardClick={isMiddleNode
                            ? () =>
                                spawnAlternativeConnectionRow(row.id, {
                                  kind: "node",
                                  nodeKey: entity.key,
                                })
                            : undefined}
                          onNameClick={isLeftmostNode
                            ? (event) => {
                                if (didRequestNewTabNavigation(event)) {
                                  openConnectionEntityInNewTab(entity);
                                  return;
                                }

                                appendConnectionPathToTree(row.path, entity);
                              }
                            : (event) => {
                                if (didRequestNewTabNavigation(event)) {
                                  openConnectionEntityInNewTab(entity);
                                  return;
                                }

                                appendConnectionPathToTree(row.path, entity);
                              }}
                          previousEntity={row.path[index - 1] ?? null}
                        />
                        {nextEntity ? (
                          <button
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

type SlideshowConnectionRowType = "a" | "b";

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

function getSlideshowConnectionRowType(path: ConnectionEntity[]): SlideshowConnectionRowType {
  const finalEntity = path[path.length - 1] ?? null;
  const penultimateEntity = path[path.length - 2] ?? null;

  return finalEntity &&
    penultimateEntity &&
    isFastBreakEntity(finalEntity) &&
    isLaurenceFishburneEntity(penultimateEntity)
    ? "a"
    : "b";
}

function getConnectionRowClassName(
  isSlideshowMode: boolean,
  slideshowRowType: SlideshowConnectionRowType,
): string {
  return joinClassNames(
    "bacon-connection-row",
    "bacon-bookmark-card-row",
    isSlideshowMode && "bacon-connection-row-slideshow",
    isSlideshowMode && `bacon-connection-row-slideshow-type-${slideshowRowType}`,
  );
}

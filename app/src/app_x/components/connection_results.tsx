import { Fragment, useEffect, useRef } from "react";
import ConnectionEntityCard from "./connection_entity_card";
import { didRequestNewTabNavigation } from "../index_helpers";
import { getConnectionEdgeKey, type ConnectionEntity } from "../generators/cinenerdle2/connection_graph";
import type { ConnectionExclusion, ConnectionSession } from "../connection_rows";
import { joinClassNames } from "./ui_utils";

export default function ConnectionResults({
  appendConnectionPathToTree,
  connectionSession,
  navigateToConnectionEntity,
  openConnectionEntityInNewTab,
  spawnAlternativeConnectionRow,
}: {
  appendConnectionPathToTree: (path: ConnectionEntity[], targetEntity: ConnectionEntity) => void;
  connectionSession: ConnectionSession | null;
  navigateToConnectionEntity: (entity: ConnectionEntity) => void;
  openConnectionEntityInNewTab: (entity: ConnectionEntity) => void;
  spawnAlternativeConnectionRow: (parentRowId: string, exclusion: ConnectionExclusion) => void;
}) {
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const connectionSessionId = connectionSession?.id ?? null;

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

  if (!connectionSession) {
    return null;
  }

  const hasFoundConnectionRow =
    connectionSession.rows.some((row) => row.status === "found" && row.path.length > 0);

  return (
    <div className="bacon-connection-results" ref={resultsRef}>
      {!hasFoundConnectionRow ? (
        <div className="bacon-connection-row bacon-bookmark-card-row">
          <ConnectionEntityCard
            entity={connectionSession.left}
            onCardClick={() => navigateToConnectionEntity(connectionSession.left)}
            onNameClick={(event) => {
              if (didRequestNewTabNavigation(event)) {
                openConnectionEntityInNewTab(connectionSession.left);
                return;
              }

              navigateToConnectionEntity(connectionSession.left);
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
            entity={connectionSession.right}
            onCardClick={() => navigateToConnectionEntity(connectionSession.right)}
            onNameClick={(event) => {
              if (didRequestNewTabNavigation(event)) {
                openConnectionEntityInNewTab(connectionSession.right);
                return;
              }

              navigateToConnectionEntity(connectionSession.right);
            }}
          />
        </div>
      ) : null}

      {connectionSession.rows.map((row) => {
        if (row.status === "searching") {
          return (
            <div className="bacon-connection-row" key={row.id}>
              <div className="bacon-connection-status-card">
                Searching cached connections...
              </div>
            </div>
          );
        }

        if (row.status !== "found" || row.path.length === 0) {
          return (
            <div className="bacon-connection-row" key={row.id}>
              <div className="bacon-connection-status-card">
                {row.status === "timeout"
                  ? "Timed out after 5 seconds without finding a cached path."
                  : "No cached path found."}
              </div>
            </div>
          );
        }

        return (
          <div className="bacon-connection-row bacon-bookmark-card-row" key={row.id}>
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
    </div>
  );
}

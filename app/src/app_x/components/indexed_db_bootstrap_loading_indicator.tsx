import type { CinenerdleIndexedDbBootstrapPhase } from "../generators/cinenerdle2/bootstrap";

function getIndexedDbBootstrapLoadingLabel(
  phase: CinenerdleIndexedDbBootstrapPhase,
): string {
  if (phase === "reset-required") {
    return "Clear DB and refresh";
  }

  if (phase === "processing") {
    return "Processing data";
  }

  return "Preparing data";
}

export default function IndexedDbBootstrapLoadingIndicator({
  phase = "processing",
  resetRequiredMessage = null,
}: {
  phase?: CinenerdleIndexedDbBootstrapPhase;
  resetRequiredMessage?: string | null;
}) {
  return (
    <div className="bacon-indexeddb-bootstrap-loading-shell">
      <div
        aria-busy="true"
        aria-label={getIndexedDbBootstrapLoadingLabel(phase)}
        className="bacon-indexeddb-bootstrap-loading"
        role="status"
      >
        <span aria-hidden="true" className="bacon-connection-matchup-spinner" />
        <span className="bacon-indexeddb-bootstrap-loading-label">
          {getIndexedDbBootstrapLoadingLabel(phase)}
        </span>
      </div>
      {phase === "reset-required" && resetRequiredMessage ? (
        <p className="bacon-indexeddb-bootstrap-loading-reset-message">
          {resetRequiredMessage}
        </p>
      ) : null}
    </div>
  );
}

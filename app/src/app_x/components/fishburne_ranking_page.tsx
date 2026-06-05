import { useEffect, useState } from "react";
import {
  getFishburneRankedMovies,
  LAURENCE_FISHBURNE_NAME,
  type FishburneRankedMovie,
} from "../fishburne_rankings";

type FishburneRankingLoadState =
  | {
      kind: "loading";
      completed: number;
      total: number | null;
    }
  | {
      kind: "error";
      message: string;
    }
  | {
      kind: "loaded";
      rows: FishburneRankedMovie[];
    };

function formatPopularity(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : "N/A";
}

function formatMovieLabel(row: FishburneRankedMovie): string {
  return row.movie.year ? `${row.movie.title} (${row.movie.year})` : row.movie.title;
}

function formatConnectionRole(row: FishburneRankedMovie): string {
  if (!row.topConnection) {
    return row.status === "missingMovieRecord"
      ? "Movie credits unavailable"
      : "No app connection";
  }

  const creditTypeLabel = row.topConnection.creditType === "crew" ? "Crew" : "Cast";
  return row.topConnection.roleLabel
    ? `${creditTypeLabel}: ${row.topConnection.roleLabel}`
    : creditTypeLabel;
}

export function FishburneRankingPageContent({
  state,
}: {
  state: FishburneRankingLoadState;
}) {
  if (state.kind === "loading") {
    const progressLabel = state.total === null
      ? "Finding movies"
      : `Hydrating ${state.completed} of ${state.total}`;

    return (
      <section className="bacon-fishburne-page">
        <div
          aria-busy="true"
          className="bacon-fishburne-status"
          role="status"
        >
          {progressLabel}
        </div>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="bacon-fishburne-page">
        <div className="bacon-fishburne-status bacon-fishburne-status-error" role="alert">
          {state.message}
        </div>
      </section>
    );
  }

  return (
    <section className="bacon-fishburne-page">
      <div className="bacon-fishburne-heading">
        <h2>{`${LAURENCE_FISHBURNE_NAME} low-heat connections`}</h2>
        <p>
          Movies ranked by the lowest popularity of each movie&apos;s most popular
          non-Laurence app connection.
        </p>
      </div>

      {state.rows.length === 0 ? (
        <div className="bacon-fishburne-status">No movies found.</div>
      ) : (
        <div className="bacon-fishburne-table-wrap">
          <table className="bacon-fishburne-table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Movie</th>
                <th scope="col">Movie pop</th>
                <th scope="col">Top connection</th>
                <th scope="col">Role</th>
                <th scope="col">Connection pop</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row, index) => (
                <tr key={`${row.movie.tmdbId}:${row.movie.title}:${row.movie.year}`}>
                  <td>{index + 1}</td>
                  <td>
                    <span className="bacon-fishburne-movie-title">
                      {formatMovieLabel(row)}
                    </span>
                  </td>
                  <td>{formatPopularity(row.movie.popularity)}</td>
                  <td>{row.topConnection?.name ?? "N/A"}</td>
                  <td>{formatConnectionRole(row)}</td>
                  <td>{formatPopularity(row.topConnection?.popularity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function FishburneRankingPage() {
  const [state, setState] = useState<FishburneRankingLoadState>({
    kind: "loading",
    completed: 0,
    total: null,
  });

  useEffect(() => {
    let cancelled = false;

    void getFishburneRankedMovies({
      onProgress: (progress) => {
        if (!cancelled) {
          setState({
            kind: "loading",
            completed: progress.completed,
            total: progress.total,
          });
        }
      },
    })
      .then((rows) => {
        if (!cancelled) {
          setState({
            kind: "loaded",
            rows,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: error instanceof Error && error.message
              ? error.message
              : "Fishburne ranking failed.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return <FishburneRankingPageContent state={state} />;
}

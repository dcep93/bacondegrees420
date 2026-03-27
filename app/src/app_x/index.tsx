import { useMemo } from "react";
import { AbstractGenerator } from "./components/abstract_generator";
import { createNumberGenerator } from "./generators/number_generator";
import "./styles/app_shell.css";

function parseGen0(search: string): number {
  const value = new URLSearchParams(search).get("gen0");

  if (value === null) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resetPage() {
  window.location.href = `${window.location.pathname}${window.location.hash}`;
}

export default function AppX() {
  const seed = useMemo(() => parseGen0(window.location.search), []);
  const generator = useMemo(() => createNumberGenerator(seed), [seed]);

  return (
    <div className="bacon-app-shell">
      <header className="bacon-title-bar">
        <button
          aria-label="Reset generator"
          className="bacon-title-icon-button"
          onClick={resetPage}
          type="button"
        >
          <img alt="" className="bacon-title-icon" src="/favicon.svg" />
        </button>
        <h1 className="bacon-title">bacondegrees420</h1>
      </header>

      <main className="bacon-app-content">
        <AbstractGenerator
          afterCardSelected={generator.afterCardSelected}
          initTree={generator.initTree}
          renderCard={generator.renderCard}
        />
      </main>
    </div>
  );
}

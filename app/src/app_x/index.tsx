import { useEffect, useState } from "react";
import Cinenerdle2 from "./generators/cinenerdle2";
import "./styles/app_shell.css";

function clearHash() {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

export default function AppX() {
  const [hashValue, setHashValue] = useState(() => window.location.hash);
  const [resetVersion, setResetVersion] = useState(0);

  useEffect(() => {
    function handleHashChange() {
      setHashValue(window.location.hash);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  function handleReset() {
    clearHash();
    setHashValue("");
    setResetVersion((version) => version + 1);
  }

  return (
    <div className="bacon-app-shell">
      <header className="bacon-title-bar">
        <button
          aria-label="Reset generator"
          className="bacon-title-icon-button"
          onClick={handleReset}
          type="button"
        >
          <img alt="" className="bacon-title-icon" src="/favicon.svg" />
        </button>
        <h1 className="bacon-title">bacondegrees420</h1>
      </header>

      <main className="bacon-app-content">
        <Cinenerdle2 hashValue={hashValue} resetVersion={resetVersion} />
      </main>
    </div>
  );
}

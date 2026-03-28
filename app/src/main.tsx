import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

if (window.location.pathname === "/iframe") {
  window.addEventListener("message", (event) => {
    if (event.origin !== "https://www.cinenerdle2.app") {
      return;
    }

    if (event.data?.type !== "bacondegrees420:rawhtml") {
      return;
    }

    const rawHtml =
      typeof event.data.rawHtml === "string"
        ? event.data.rawHtml
        : "";
    window.alert(String(rawHtml.length));
  });
} else {
  void import("./app_x/index.tsx").then(({ default: AppX }) => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppX />
      </StrictMode>,
    );
  });
}

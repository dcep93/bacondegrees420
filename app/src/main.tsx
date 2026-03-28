import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

if (window.location.pathname !== "/iframe") {
  void import("./app_x/index.tsx").then(({ default: AppX }) => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppX />
      </StrictMode>,
    );
  });
}

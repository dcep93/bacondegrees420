import { createRoot } from "react-dom/client";
import AppX from "./app_x/index.tsx";
import { logPerf, markPerf } from "./app_x/perf";
import "./index.css";

markPerf("app-bootstrap");
logPerf("main.render dispatched", {
  hash: window.location.hash,
  pathname: window.location.pathname,
});

createRoot(document.getElementById("root")!).render(
  <AppX />,
);

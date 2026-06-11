import { createRoot } from "react-dom/client";
import AppX from "./app_x/index.tsx";
import YSlideshow from "./app_y/y_slideshow.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  window.location.pathname === "/slideshow" ? <YSlideshow /> : <AppX />,
);

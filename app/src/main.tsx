import { createRoot } from "react-dom/client";
import AppX from "./app_x/index.tsx";
import YSlideshow from "./app_y/y_slideshow.tsx";
import "./index.css";

const App = window.location.pathname === "/y" ? YSlideshow : AppX;

createRoot(document.getElementById("root")!).render(
  <App />,
);

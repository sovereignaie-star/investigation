import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { purgeLegacyCaseStorage } from "./store/storagePolicy";

// P1-021: delete the graph that older builds kept in localStorage before anything renders.
purgeLegacyCaseStorage();

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found in index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

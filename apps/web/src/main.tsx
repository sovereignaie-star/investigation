import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./index.css";
import "@fontsource-variable/noto-sans-arabic";
import { purgeLegacyCaseStorage } from "./store/storagePolicy";

// P1-021: delete the graph that older builds kept in localStorage before anything renders.
purgeLegacyCaseStorage();

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found in index.html");

createRoot(container).render(
  <StrictMode>
    {/* P3-023: last line of defence — an error outside the shell still shows a copyable report, never a white screen. */}
    <AppErrorBoundary path="/">
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);

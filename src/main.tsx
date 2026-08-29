import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { showMainWindowAfterPaint } from "./lib/showMainWindow";
import "./styles/app.css";
import "@xterm/xterm/css/xterm.css";

/** Suppress WebView/browser chrome context menu (Win + Mac). App menus still call preventDefault + render their own UI. */
window.addEventListener("contextmenu", (e) => e.preventDefault(), true);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

showMainWindowAfterPaint();

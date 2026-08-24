import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { showMainWindowAfterPaint } from "./lib/showMainWindow";
import "./styles/app.css";
import "@xterm/xterm/css/xterm.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

showMainWindowAfterPaint();

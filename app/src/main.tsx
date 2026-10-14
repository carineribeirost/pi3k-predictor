import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { installLogging } from "./shared/lib/logging";
import "./app/app.css";

void installLogging();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

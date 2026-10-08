import React from "react";
import ReactDOM from "react-dom/client";
import { ClipsApp } from "./clips-app";
import { initWindowLocale } from "@/lib/i18n";
import "../index.css";
import { initTheme } from "@/lib/theme";

initTheme();

initWindowLocale("clips.popup.windowTitle");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClipsApp />
  </React.StrictMode>,
);

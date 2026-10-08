import React from "react";
import ReactDOM from "react-dom/client";
import { CaptureApp } from "./capture-app";
import { initWindowLocale } from "@/lib/i18n";
import "../index.css";
import { initTheme } from "@/lib/theme";

initTheme();

initWindowLocale("quickCapture.windowTitle");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CaptureApp />
  </React.StrictMode>,
);

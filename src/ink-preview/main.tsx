import React from "react";
import ReactDOM from "react-dom/client";
import { PreviewApp } from "./preview-app";
import { initWindowLocale } from "@/lib/i18n";
import "../index.css";

initWindowLocale();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PreviewApp />
  </React.StrictMode>,
);

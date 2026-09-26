import React from "react";
import ReactDOM from "react-dom/client";
import { EditorApp } from "./editor-app";
import { initWindowLocale } from "@/lib/i18n";
import "../index.css";

initWindowLocale();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <EditorApp />
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import { EditorApp } from "./editor-app";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <EditorApp />
  </React.StrictMode>,
);

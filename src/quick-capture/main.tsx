import React from "react";
import ReactDOM from "react-dom/client";
import { CaptureApp } from "./capture-app";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CaptureApp />
  </React.StrictMode>,
);

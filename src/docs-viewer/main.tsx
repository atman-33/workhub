import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ViewerApp } from "./viewer-app";
import { initWindowLocale } from "@/lib/i18n";
import "../index.css";

initWindowLocale();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Same delay as the main window, whose preview this reuses. */}
    <TooltipProvider delayDuration={300}>
      <ViewerApp />
    </TooltipProvider>
  </React.StrictMode>,
);

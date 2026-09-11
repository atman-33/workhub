import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ViewerApp } from "./viewer-app";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Same delay as the main window, whose preview this reuses. */}
    <TooltipProvider delayDuration={300}>
      <ViewerApp />
    </TooltipProvider>
  </React.StrictMode>,
);

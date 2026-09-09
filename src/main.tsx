import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";
import { ErrorBoundary } from "@/components/error-boundary";
import { api } from "@/lib/api";
import "./index.css";

/**
 * Everything the webview throws goes to the diagnostic log (T-0254).
 *
 * A packaged build has no console: an uncaught error or a rejected promise
 * used to vanish, and the only symptom left was a window that had gone blank
 * or a view that quietly stopped updating. These two listeners plus the
 * boundaries below are what turn that into a line someone can read.
 */
window.addEventListener("error", (e) => {
  void api.logFrontendError("window.error", e.message, e.error?.stack);
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason as Error | undefined;
  void api.logFrontendError(
    "unhandledrejection",
    reason?.message ?? String(e.reason),
    reason?.stack,
  );
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// Drop the boot splash from index.html once React has painted its first frame.
const boot = document.getElementById("boot");
if (boot) {
  requestAnimationFrame(() => {
    boot.classList.add("boot-hidden");
    boot.addEventListener("transitionend", () => boot.remove(), { once: true });
    // Fallback: `transitionend` never fires when the transition is skipped
    // (reduced motion, background tab), and the overlay must not linger.
    setTimeout(() => boot.remove(), 1000);
  });
}

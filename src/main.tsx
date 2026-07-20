import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
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

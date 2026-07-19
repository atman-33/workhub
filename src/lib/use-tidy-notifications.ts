import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { TidyRun } from "@/types";

async function notify(title: string, body: string) {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  sendNotification({ title, body });
}

/**
 * App-level listener that surfaces vault-tidy outcomes as OS notifications, so
 * the user notices a completion, failure, or stall even when the Settings
 * dialog is closed. Mounted once at the app root.
 */
export function useTidyNotifications() {
  const lastKey = useRef("");
  useEffect(() => {
    const unlisten = listen<TidyRun>("tidy:status", (event) => {
      const run = event.payload;
      // Only notify on a meaningful transition (avoid duplicate fires).
      const key = `${run.state}:${run.at ?? ""}:${run.stalled}`;
      if (key === lastKey.current) return;
      lastKey.current = key;

      if (run.state === "completed") {
        void notify("Vault tidy complete", run.summary || "Inbox and archive index refreshed.");
      } else if (run.state === "failed") {
        void notify(
          "Vault tidy needs attention",
          run.error || "The tidy run failed — open Settings › Vault to resume it.",
        );
      } else if (run.state === "running" && run.stalled) {
        void notify(
          "Vault tidy may be stuck",
          "The run is taking longer than expected — open Settings › Vault to resume it.",
        );
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
}

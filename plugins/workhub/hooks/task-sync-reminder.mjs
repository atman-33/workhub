// Stop hook: if a task was started via task-start but never reported via
// task-report, remind once so the session does not end with a dangling
// `doing` task. Reminds a single time per started task (marker gets a
// `reminded` flag) so it can never loop.
//
// The marker is this session's own (T-0243) — a parallel session working a
// different task has its own, and neither reminder can point at the other's.
import { readPayload, resolveVault } from "./lib.mjs";
import { readMarker, sessionKey, writeMarker } from "../lib/session-marker.mjs";

const vault = resolveVault();
if (!vault) process.exit(0);

const key = sessionKey(readPayload().session_id);
const active = readMarker(vault, key);
if (!active?.id || active.reminded) process.exit(0);

writeMarker(vault, key, { ...active, reminded: true });
console.log(
  JSON.stringify({
    decision: "block",
    reason:
      `workhub: task ${active.id} was started with task-start but has no report. ` +
      `If the work is finished (or blocked), run the task-report skill to record results ` +
      `and update the task status. If you are intentionally leaving it in progress, ` +
      `you may stop; this reminder fires only once.`,
  }),
);

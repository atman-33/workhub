// Stop hook: if a task was started via task-start but never reported via
// task-report, remind once so the session does not end with a dangling
// `doing` task. Reminds a single time per started task (marker gets a
// `reminded` flag) so it can never loop.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveVault } from "./lib.mjs";

const vault = resolveVault();
if (!vault) process.exit(0);

const marker = join(vault, "_ai", "memory", "active-task.json");
if (!existsSync(marker)) process.exit(0);

let active;
try {
  active = JSON.parse(readFileSync(marker, "utf8"));
} catch {
  process.exit(0);
}
if (!active?.id || active.reminded) process.exit(0);

writeFileSync(marker, JSON.stringify({ ...active, reminded: true }, null, 2));
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

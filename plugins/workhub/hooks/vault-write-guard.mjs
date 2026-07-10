// PreToolUse (Write) hook: overwriting an EXISTING note in the vault's human
// zone (tasks/, projects/, knowledge/) with a full-file Write is destructive
// to hand-written content — ask the user first. New files, edits, and
// anything under _ai/ pass through untouched.
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { resolveVault, readPayload } from "./lib.mjs";

const vault = resolveVault();
if (!vault) process.exit(0);

const payload = readPayload();
const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

const target = resolve(filePath);
const root = resolve(vault);
if (!target.toLowerCase().startsWith(root.toLowerCase() + sep)) process.exit(0);

const rel = target.slice(root.length + 1).replaceAll("\\", "/");
const humanZones = ["tasks/", "projects/", "knowledge/"];
if (!humanZones.some((z) => rel.toLowerCase().startsWith(z))) process.exit(0);
if (!existsSync(target)) process.exit(0);

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        `workhub vault guard: "${rel}" already exists in the human zone. ` +
        `A full-file Write would replace hand-written content — prefer Edit for ` +
        `targeted changes, or confirm the overwrite.`,
    },
  }),
);

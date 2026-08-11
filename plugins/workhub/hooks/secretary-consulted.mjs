// PostToolUse (Task) hook: record that this session consulted the secretary,
// so secretary-gate.mjs lets the next owner question through.
import { readPayload, secretaryEnabled } from "./lib.mjs";
import { readState, writeState } from "./secretary-state.mjs";

if (!secretaryEnabled()) process.exit(0);

const payload = readPayload();
const subagent = payload?.tool_input?.subagent_type ?? "";
if (!String(subagent).toLowerCase().includes("secretary")) process.exit(0);

const sessionId = payload?.session_id;
writeState(sessionId, { ...readState(sessionId), consulted: true });

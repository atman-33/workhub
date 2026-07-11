#!/usr/bin/env node
// Diagnostic: print the full drift report between Claude Code plugin artifacts
// and their OpenCode copies, both project scope and user scope.
//
// Exit codes:
//   0 - no actionable drift (warnings about claude CLI absence are OK)
//   2 - actionable drift detected (missing / stale-source / diverged / orphan)
import {
  detectFullDrift,
  hasActionableDrift,
} from "./lib/claude-plugin-sync-core.mjs";

const report = await detectFullDrift({
  cwd: process.cwd(),
  claudePluginsRoot: process.env.CLAUDE_PLUGINS_ROOT || undefined,
  openCodeGlobalRoot: process.env.OPENCODE_GLOBAL_ROOT || undefined,
});

function printBucket(label, bucket) {
  console.log(`\n## ${label}`);
  console.log(`target: ${bucket.targetRoot}`);
  if (bucket.items.length === 0) {
    console.log("(no artifacts)");
    return;
  }
  for (const item of bucket.items) {
    const note = item.note ? ` — ${item.note}` : "";
    console.log(`- [${item.status}] ${item.kind} "${item.name}" (${item.pluginRef})${note}`);
  }
}

console.log("# Claude plugin sync drift report");
printBucket("Project scope / skills", report.projectScope);
let idx = 0;
for (const bucket of report.userScope) {
  idx += 1;
  const title = `User scope / ${bucket.bucket} (${idx})`;
  printBucket(title, bucket);
}

if (report.warnings.length) {
  console.log("\n## Warnings");
  for (const w of report.warnings) console.log(`- ${w}`);
}

if (hasActionableDrift(report)) {
  console.log(
    "\nActionable drift detected. Run /sync-claude-skills and /sync-claude-user-plugins (add --force for stale/diverged).",
  );
  process.exitCode = 2;
} else {
  console.log("\nNo actionable drift.");
}
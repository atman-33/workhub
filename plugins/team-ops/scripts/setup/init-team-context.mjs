#!/usr/bin/env node
// @ts-check
/**
 * Create/update the machine-local `.claude/team-context.json` and scaffold
 * the team-shared `ai/` skeleton (create-if-missing only — this script never
 * overwrites an existing file in the shared folder).
 *
 * Usage:
 *   node init-team-context.mjs --team-root <path> [--me <name>]
 *        [--project <name>] [--workspaces-root <path>] [--language <tag>]
 *
 * Prints one JSON object describing what was created/kept.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import {
  LOCAL_CONFIG_RELATIVE_PATH,
  DEFAULT_WORKSPACES_ROOT,
  resolveProjectRoot,
} from "../lib/team-config.mjs";

/** @param {string} flag */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "";
}

const teamRoot = argValue("--team-root");
const me = argValue("--me");
const project = argValue("--project");
const workspacesRoot = argValue("--workspaces-root");
const language = argValue("--language");

const projectRoot = resolveProjectRoot();
const configPath = join(projectRoot, LOCAL_CONFIG_RELATIVE_PATH);

/** @type {string[]} */
const created = [];
/** @type {string[]} */
const kept = [];

/** Create a file only if missing; track the outcome. */
/** @param {string} path @param {string} content */
function seed(path, content) {
  if (existsSync(path)) {
    kept.push(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  created.push(path);
}

// ---- 1. local config (merge onto any existing file) -----------------------

/** @type {any} */
let local = {};
if (existsSync(configPath)) {
  try {
    local = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    local = {};
  }
}
if (teamRoot) local.teamRootPath = teamRoot;
if (!local.teamRootPath) {
  process.stdout.write(
    JSON.stringify({ error: "--team-root is required (no existing config to reuse)" }),
  );
  process.exit(1);
}
if (workspacesRoot) local.repoWorkspacesRoot = workspacesRoot;
if (!local.repoWorkspacesRoot) local.repoWorkspacesRoot = DEFAULT_WORKSPACES_ROOT;
if (me) local.me = me;
if (project) {
  const list = Array.isArray(local.activeProjects) ? local.activeProjects : [];
  if (!list.includes(project)) list.push(project);
  local.activeProjects = list;
}
mkdirSync(dirname(configPath), { recursive: true });
writeFileSync(configPath, `${JSON.stringify(local, null, 2)}\n`, "utf8");

// Keep the local config out of version control (it holds machine-local paths).
const gitignorePath = join(projectRoot, ".gitignore");
const ignoreEntry = ".claude/team-context.json";
try {
  const current = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  if (!current.split(/\r?\n/).includes(ignoreEntry)) {
    appendFileSync(
      gitignorePath,
      `${current.endsWith("\n") || current === "" ? "" : "\n"}${ignoreEntry}\n`,
      "utf8",
    );
  }
} catch {
  // best-effort; not all project roots are git repos
}

// ---- 2. shared ai/ skeleton (create-if-missing) ---------------------------

const aiRoot = join(local.teamRootPath, "ai");

seed(
  join(aiRoot, "knowledge", "_index.md"),
  `# Team knowledge base\n\nCatalog of every topic folder. Maintained by the team-kb-index skill.\n\n| Topic | What lives there |\n|---|---|\n| [rules](rules/) | Team rules and working agreements |\n| [onboarding](onboarding/) | Newcomer guides |\n`,
);
seed(
  join(aiRoot, "knowledge", "rules", "_index.md"),
  `# rules\n\nTeam rules and working agreements.\n`,
);
seed(
  join(aiRoot, "knowledge", "onboarding", "_index.md"),
  `# onboarding\n\nGuides for new team members.\n`,
);
seed(
  join(aiRoot, "_meta", "team.json"),
  `${JSON.stringify({ language: language || "en" }, null, 2)}\n`,
);
seed(
  join(aiRoot, "_meta", "conventions.md"),
  `# team-ops conventions

Norms every human and AI agent working in this shared folder follows.

## IDs and files

- PBI id: \`P-<4 digits>\` per project (e.g. \`P-0012\`), assigned sequentially.
- One PBI = one file: \`backlog/items/<id>-<slug>.md\` (kebab-case slug).
- Folder names: lowercase kebab-case.

## Branches and commits

- PBI work branch: \`pbi/<id>-<slug>\` (issued by the start-pbi skill).
- Merge commits / PR titles into the project's dev-main branch carry the PBI
  id (branch name or a \`[P-0012]\` tag) — this is what links code to PBIs.

## Writing

- Content language: see \`team.json\` (\`language\`). Applies to knowledge,
  backlog, sprint, and spec documents.
- AI agents append one line per shared-folder write to \`activity-log.md\`:
  \`- <date> [<agent>/<user>] <skill>: <what>\`.
- AI agents never delete or rewrite human-authored content; append or add
  new files and link them.
`,
);
seed(
  join(aiRoot, "_meta", "activity-log.md"),
  `# AI activity log\n\nAppend-only. One line per AI write to this shared folder.\n`,
);

// ---- 3. project skeleton (optional) ---------------------------------------

if (project) {
  const pDir = join(aiRoot, "projects", project);
  seed(
    join(pDir, "_index.md"),
    `# ${project}\n\nProject catalog and current-state summary. Maintained by load-project-context.\n\n- [PRD](prd/)\n- [Product backlog](backlog/product-backlog.md)\n- [Living spec](docs/spec/spec.md)\n- [Daily reports](reports/daily/)\n`,
  );
  seed(
    join(pDir, "config", "project.json"),
    `${JSON.stringify(
      {
        repos: [
          {
            name: "example-repo",
            url: "https://github.com/your-org/example-repo",
            devMainBranch: `develop/${project}`,
            defaultBranch: "main",
          },
        ],
        sprint: { lengthDays: 10, pointScale: [1, 2, 3, 5, 8, 13] },
      },
      null,
      2,
    )}\n`,
  );
  seed(
    join(pDir, "backlog", "product-backlog.md"),
    `# Product backlog — ${project}\n\nOrdered overview. Detail lives in one file per item under [items/](items/).\n\n| Order | ID | Title | Status | Points | Sprint |\n|---|---|---|---|---|---|\n`,
  );
  seed(join(pDir, "backlog", "items", ".gitkeep"), "");
  seed(
    join(pDir, "docs", "spec", "spec.md"),
    `# ${project} — living spec\n\nWhat is implemented today, by feature area. Updated daily by the update-spec skill from PBI acceptance criteria + merged diffs.\n`,
  );
  seed(join(pDir, "docs", "decisions", ".gitkeep"), "");
  seed(join(pDir, "prd", ".gitkeep"), "");
  seed(join(pDir, "sprints", ".gitkeep"), "");
  seed(join(pDir, "reports", "daily", ".gitkeep"), "");
}

process.stdout.write(
  JSON.stringify({
    configPath,
    teamRootPath: local.teamRootPath,
    aiRoot,
    project: project || null,
    created,
    kept: kept.length,
  }),
);

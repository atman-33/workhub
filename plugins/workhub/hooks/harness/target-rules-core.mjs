// @ts-check
/**
 * Pure helpers behind the `inject-target-rules` hook.
 *
 * The hook itself (inject-target-rules.mjs) only does I/O: read stdin, write the
 * PreToolUse result, manage the de-dup sentinels. Everything it needs to decide
 * *what* to inject lives here so it can be unit-tested without a live session.
 *
 * The central concept is the **target chain**: the ordered list of repositories
 * that own a touched file. Registered projects may nest (a full-stack repo whose
 * `frontend/` and `backend/` are repositories of their own), and guidance from
 * every level applies — the outer repo carries the cross-cutting rules, the inner
 * one the local ones. The chain is ordered outermost-first so the innermost,
 * most specific guidance is injected last and therefore reads closest to the
 * request.
 *
 * Ancestors that are *not* registered are picked up too: from the outermost
 * registered root the chain walks up a bounded number of parents and adopts any
 * directory that both is a repository (`.git`) and carries guidance
 * (`CLAUDE.md` / `AGENTS.md` / `.claude/`). This mirrors Claude Code's own
 * upward memory loading, which stops at neither the repo root nor the registry;
 * a plain container directory such as `C:/repos` has no `.git` and is skipped.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** How many parent directories above the outermost registered root to consider. */
export const MAX_ANCESTOR_DEPTH = 3;

/**
 * @typedef {{ path: string, name?: string }} RegisteredProject
 * @typedef {{ root: string, name: string, source: "registered" | "ancestor" }} TargetProject
 * @typedef {{ rel: string, abs: string, body: string }} RuleFile
 * @typedef {{ name: string, description: string, path: string }} SkillEntry
 */

/** Normalise a filesystem path: forward slashes, no trailing slash. */
/** @param {string} p */
export function normalizePath(p) {
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Escape a string for use in XML text or a double-quoted attribute. */
/** @param {unknown} value */
export function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** True when `child` is the same path as, or nested under, `parent`. */
/** @param {string} child @param {string} parent */
export function isUnder(child, parent) {
  const c = child.toLowerCase();
  const p = parent.toLowerCase();
  return c === p || c.startsWith(p + "/");
}

/**
 * Convert a single glob pattern to an anchored, full-match RegExp.
 * Supports `**` (any depth, incl. slashes), `*` (single segment), `?`.
 */
/** @param {string} glob */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp("^" + re + "$");
}

/** A repo-relative path matches a glob if either the bare or `**`/-prefixed form hits. */
/** @param {string} relPath @param {string} glob */
export function matchesGlob(relPath, glob) {
  const clean = glob.replace(/^\.\//, "").replace(/^\/+/, "");
  try {
    if (globToRegExp(clean).test(relPath)) {
      return true;
    }
    // Allow a pattern like "apis/*.py" to also match nested occurrences,
    // mirroring how editors commonly treat unrooted globs.
    if (!clean.startsWith("**/") && globToRegExp("**/" + clean).test(relPath)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** @param {string} s */
function stripQuotes(s) {
  return s.replace(/^["']/, "").replace(/["']$/, "");
}

/** Return the raw front matter block of a Markdown file, or "" when there is none. */
/** @param {string} content */
function frontMatterBlock(content) {
  const m = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : "";
}

/**
 * Extract the `paths:` patterns from a rule file's front matter.
 * Returns { hasFrontMatter, paths } where `paths` is an array of glob strings.
 * Supports inline (`paths: apis/*.py`) and YAML list forms. Zero-dependency.
 */
/** @param {string} content */
export function parsePathsFrontMatter(content) {
  const body = frontMatterBlock(content);
  if (!body) {
    return { hasFrontMatter: false, paths: /** @type {string[]} */ ([]) };
  }
  const paths = [];
  let inList = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const inline = line.match(/^paths:\s*(.*)$/);
    if (inline) {
      const val = inline[1].trim();
      if (val && val !== "|" && val !== ">") {
        paths.push(stripQuotes(val));
        inList = false;
      } else {
        inList = true; // list items follow on subsequent lines
      }
      continue;
    }
    if (inList) {
      const item = line.match(/^\s*-\s*(.+)$/);
      if (item) {
        paths.push(stripQuotes(item[1].trim()));
      } else if (line.trim() && !/^\s/.test(line)) {
        // A new top-level key ends the list.
        inList = false;
      }
    }
  }
  return { hasFrontMatter: true, paths };
}

/** Strip the front matter block so only the rule body is injected. */
/** @param {string} content */
export function stripFrontMatter(content) {
  const m = content.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? content.slice(m[0].length) : content;
}

/**
 * Read a skill's `name` and `description` from its SKILL.md front matter.
 * Both are single-line scalars in the skill format; a missing one yields "".
 */
/** @param {string} content */
export function parseSkillFrontMatter(content) {
  const body = frontMatterBlock(content);
  if (!body) {
    return { name: "", description: "" };
  }
  /** @param {string} key */
  const scalar = (key) => {
    const m = body.match(new RegExp("^" + key + ":\\s*(.*)$", "m"));
    return m ? stripQuotes(m[1].trim()) : "";
  };
  return { name: scalar("name"), description: scalar("description") };
}

/** Keep only registry entries that actually carry a path. */
/** @param {unknown[]} projects @returns {RegisteredProject[]} */
export function getRegisteredProjects(projects) {
  /** @type {RegisteredProject[]} */
  const out = [];
  for (const project of projects) {
    if (
      project &&
      typeof project === "object" &&
      "path" in project &&
      typeof project.path === "string" &&
      project.path.trim()
    ) {
      out.push(/** @type {RegisteredProject} */ (project));
    }
  }
  return out;
}

/** @param {string} dir */
function isDirectory(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * True when a directory looks like a repository that carries agent guidance —
 * the gate for adopting an unregistered ancestor. Both halves matter: `.git`
 * keeps plain container directories (a `repos/` folder) out, and the guidance
 * check keeps repositories with nothing to say from adding an empty block.
 */
/** @param {string} dir */
export function hasRepoGuidance(dir) {
  const base = normalizePath(dir);
  if (!existsSync(join(base, ".git"))) {
    return false;
  }
  return (
    existsSync(join(base, "CLAUDE.md")) ||
    existsSync(join(base, "AGENTS.md")) ||
    isDirectory(join(base, ".claude"))
  );
}

/** The parent of a path, or "" once it is a filesystem/drive root. */
/** @param {string} dir */
function parentOf(dir) {
  const base = normalizePath(dir);
  const idx = base.lastIndexOf("/");
  if (idx < 0) {
    return "";
  }
  const parent = base.slice(0, idx);
  // "C:" (a drive root) and "" (the POSIX root) are both terminal.
  if (!parent || /^[a-zA-Z]:$/.test(parent)) {
    return "";
  }
  return parent;
}

/**
 * The registered projects that own `filePath`, outermost first.
 * Files inside the workspace itself are excluded: Claude Code already loads
 * guidance for the cwd tree natively.
 */
/** @param {string} filePath @param {string} workspaceRoot @param {RegisteredProject[]} projects */
export function findTargetProjectChain(filePath, workspaceRoot, projects) {
  const file = normalizePath(filePath);
  if (workspaceRoot && isUnder(file, normalizePath(workspaceRoot))) {
    return /** @type {TargetProject[]} */ ([]);
  }
  /** @type {TargetProject[]} */
  const chain = [];
  for (const project of projects) {
    const root = normalizePath(project.path.trim());
    if (!isUnder(file, root)) {
      continue;
    }
    if (chain.some((entry) => entry.root.toLowerCase() === root.toLowerCase())) {
      continue;
    }
    chain.push({
      root,
      name: project.name && project.name.trim() ? project.name.trim() : root,
      source: "registered",
    });
  }
  chain.sort((a, b) => a.root.length - b.root.length);
  return chain;
}

/**
 * Unregistered repositories above `root` that carry guidance, outermost first.
 *
 * Walks up at most `maxDepth` parents, adopting each directory that passes
 * `hasRepoGuidance`. Non-qualifying levels do not stop the walk (a repo may sit
 * one directory below its monorepo root), but the home directory and the
 * filesystem/drive root always do — nothing above them belongs to a project.
 */
/**
 * @param {string} root
 * @param {{ maxDepth?: number, home?: string, isRepo?: (dir: string) => boolean }} [options]
 * @returns {TargetProject[]}
 */
export function findAncestorProjects(root, options = {}) {
  const maxDepth = options.maxDepth ?? MAX_ANCESTOR_DEPTH;
  const home = normalizePath(options.home ?? homedir()).toLowerCase();
  const isRepo = options.isRepo ?? hasRepoGuidance;

  /** @type {TargetProject[]} */
  const found = [];
  let current = parentOf(normalizePath(root));
  for (let depth = 0; depth < maxDepth && current; depth++) {
    if (current.toLowerCase() === home) {
      break;
    }
    if (isRepo(current)) {
      // An ancestor has no registered name; its directory name is what the user
      // calls it, and the full path is still on the block's `root` attribute.
      found.push({
        root: current,
        name: current.slice(current.lastIndexOf("/") + 1) || current,
        source: "ancestor",
      });
    }
    current = parentOf(current);
  }
  // Collected innermost-first; the chain is read outermost-first.
  return found.reverse();
}

/**
 * The full chain for a touched file: unregistered ancestors first, then every
 * registered repository that owns it, outermost to innermost.
 */
/**
 * @param {string} filePath
 * @param {string} workspaceRoot
 * @param {RegisteredProject[]} projects
 * @param {{ ancestors?: boolean, maxDepth?: number, home?: string, isRepo?: (dir: string) => boolean }} [options]
 * @returns {TargetProject[]}
 */
export function resolveTargetChain(filePath, workspaceRoot, projects, options = {}) {
  const chain = findTargetProjectChain(filePath, workspaceRoot, projects);
  if (chain.length === 0 || options.ancestors === false) {
    return chain;
  }
  const known = new Set(chain.map((entry) => entry.root.toLowerCase()));
  const ancestors = findAncestorProjects(chain[0].root, options).filter(
    (entry) => !known.has(entry.root.toLowerCase())
  );
  return [...ancestors, ...chain];
}

/** The repo-relative form of `filePath` within `root`. */
/** @param {string} filePath @param {string} root */
export function toRepoRelativePath(filePath, root) {
  return normalizePath(filePath).slice(normalizePath(root).length).replace(/^\/+/, "");
}

/**
 * Resolve a project's instruction file under its root.
 * Prefers CLAUDE.md, falls back to AGENTS.md, returns "" when neither exists.
 */
/** @param {string} root */
export function resolveInstructionsFile(root) {
  const base = normalizePath(root);
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const candidate = `${base}/${name}`;
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "";
}

/**
 * The `.claude/rules/*.md` under `root` that apply to `relPath`.
 * A rule without a `paths:` front matter key applies everywhere.
 */
/** @param {string} root @param {string} relPath @returns {RuleFile[]} */
export function loadMatchingRules(root, relPath) {
  const rulesDir = `${normalizePath(root)}/.claude/rules`;
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(rulesDir).filter((f) => f.toLowerCase().endsWith(".md"));
  } catch {
    return [];
  }

  /** @type {RuleFile[]} */
  const matches = [];
  for (const file of entries.sort()) {
    const abs = `${rulesDir}/${file}`;
    let content;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const { hasFrontMatter, paths } = parsePathsFrontMatter(content);
    const applies =
      !hasFrontMatter || paths.length === 0
        ? true
        : paths.some((glob) => matchesGlob(relPath, glob));
    if (!applies) {
      continue;
    }
    matches.push({
      rel: `.claude/rules/${file}`,
      abs,
      body: stripFrontMatter(content).trim(),
    });
  }
  return matches;
}

/**
 * The skills a repository offers, as a catalog of name/description/path.
 *
 * Only the front matter is read. A hook cannot register a skill with the Skill
 * tool, so the model is told where the SKILL.md is and reads it on demand —
 * injecting every skill body would cost far more than it is worth.
 */
/** @param {string} root @returns {SkillEntry[]} */
export function collectSkillCatalog(root) {
  const skillsDir = `${normalizePath(root)}/.claude/skills`;
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }

  /** @type {SkillEntry[]} */
  const skills = [];
  for (const entry of entries.sort()) {
    const skillFile = `${skillsDir}/${entry}/SKILL.md`;
    let content;
    try {
      content = readFileSync(skillFile, "utf8");
    } catch {
      continue;
    }
    const { name, description } = parseSkillFrontMatter(content);
    skills.push({
      name: name || entry,
      description,
      path: skillFile,
    });
  }
  return skills;
}

/** Render the instructions block for one repository in the chain. */
/** @param {TargetProject} target @param {string} fileName @param {string} content */
export function renderInstructionsBlock(target, fileName, content) {
  return [
    `<target-project-instructions project="${xmlEscape(target.name)}" path="${xmlEscape(fileName)}">`,
    `  Full instructions from the target repository "${xmlEscape(target.name)}"`,
    `  (outside the current working directory). Follow them while working there.`,
    content.trim(),
    "</target-project-instructions>",
  ].join("\n");
}

/** Render the path-scoped rules block for one repository in the chain. */
/** @param {TargetProject} target @param {string} relPath @param {RuleFile[]} rules */
export function renderRulesBlock(target, relPath, rules) {
  const lines = [
    `<target-project-rules project="${xmlEscape(target.name)}" root="${xmlEscape(target.root)}">`,
    `  These path-scoped rules come from the target repository "${xmlEscape(target.name)}"`,
    `  (outside the current working directory) and apply to ${xmlEscape(relPath)}.`,
  ];
  for (const rule of rules) {
    lines.push(`  <rule path="${xmlEscape(rule.rel)}">`);
    lines.push(rule.body);
    lines.push("  </rule>");
  }
  lines.push("</target-project-rules>");
  return lines.join("\n");
}

/** Render the skill catalog block for one repository in the chain. */
/** @param {TargetProject} target @param {SkillEntry[]} skills */
export function renderSkillsBlock(target, skills) {
  const lines = [
    `<target-project-skills project="${xmlEscape(target.name)}" root="${xmlEscape(target.root)}">`,
    `  Skills defined by the target repository "${xmlEscape(target.name)}" (outside the`,
    `  current working directory). They are NOT registered with the Skill tool and`,
    `  cannot be invoked by name: when one fits the work at hand, read its SKILL.md`,
    `  with the Read tool and follow it.`,
  ];
  for (const skill of skills) {
    lines.push(
      `  <skill name="${xmlEscape(skill.name)}" path="${xmlEscape(skill.path)}">${xmlEscape(skill.description)}</skill>`
    );
  }
  lines.push("</target-project-skills>");
  return lines.join("\n");
}

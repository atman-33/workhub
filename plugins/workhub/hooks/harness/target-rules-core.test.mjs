// @ts-check
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  collectSkillCatalog,
  findAncestorProjects,
  findTargetProjectChain,
  hasRepoGuidance,
  loadMatchingRules,
  normalizePath,
  parseSkillFrontMatter,
  renderSkillsBlock,
  resolveTargetChain,
  toRepoRelativePath,
} from "./target-rules-core.mjs";

/**
 * A nested workspace mirroring the case this module exists for:
 *
 *   <tmp>/container/          plain directory, no .git -> never adopted
 *     full-stack-repo/        repo with .claude (rules + skills), unregistered
 *       frontend/             registered repo with its own .claude
 *       backend/              registered repo, no guidance of its own
 *     lone-repo/              registered repo with no ancestor guidance
 */
let container = "";
let fullStack = "";
let frontend = "";
let backend = "";
let loneRepo = "";

/** @param {string} path @param {string} content */
function write(path, content) {
  writeFileSync(path, content, "utf8");
}

/** @param {string} root */
function makeRepo(root) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

beforeAll(() => {
  container = normalizePath(join(mkdtempSync(join(tmpdir(), "target-rules-")), "container"));
  mkdirSync(container, { recursive: true });

  fullStack = normalizePath(makeRepo(join(container, "full-stack-repo")));
  write(join(fullStack, "CLAUDE.md"), "# full stack\n\nShared conventions.\n");
  mkdirSync(join(fullStack, ".claude", "rules"), { recursive: true });
  write(
    join(fullStack, ".claude", "rules", "monorepo.md"),
    "---\npaths:\n  - frontend/**\n---\n\nUse the shared design tokens.\n"
  );
  write(
    join(fullStack, ".claude", "rules", "backend-only.md"),
    "---\npaths: backend/**\n---\n\nMigrations are append-only.\n"
  );
  mkdirSync(join(fullStack, ".claude", "skills", "deploy-stack"), { recursive: true });
  write(
    join(fullStack, ".claude", "skills", "deploy-stack", "SKILL.md"),
    "---\nname: deploy-stack\ndescription: Deploy frontend and backend together.\n---\n\nSteps...\n"
  );

  frontend = normalizePath(makeRepo(join(fullStack, "frontend")));
  write(join(frontend, "AGENTS.md"), "# frontend\n");
  mkdirSync(join(frontend, ".claude", "rules"), { recursive: true });
  write(join(frontend, ".claude", "rules", "always.md"), "No front matter: always applies.\n");
  mkdirSync(join(frontend, "src"), { recursive: true });
  write(join(frontend, "src", "app.tsx"), "export {};\n");

  backend = normalizePath(makeRepo(join(fullStack, "backend")));
  mkdirSync(join(backend, "src"), { recursive: true });
  write(join(backend, "src", "main.rs"), "fn main() {}\n");

  loneRepo = normalizePath(makeRepo(join(container, "lone-repo")));
  write(join(loneRepo, "CLAUDE.md"), "# lone\n");
});

afterAll(() => {
  if (container) {
    rmSync(join(container, ".."), { recursive: true, force: true });
  }
});

/** The registry as the vault's project-context.json would hold it. */
function registry() {
  return [
    { name: "frontend", path: frontend },
    { name: "backend", path: backend },
    { name: "lone-repo", path: loneRepo },
  ];
}

describe("findTargetProjectChain", () => {
  it("returns every registered root that owns the file, outermost first", () => {
    const projects = [{ name: "full-stack-repo", path: fullStack }, ...registry()];
    const chain = findTargetProjectChain(`${frontend}/src/app.tsx`, "C:/repos/vault", projects);
    expect(chain.map((entry) => entry.name)).toEqual(["full-stack-repo", "frontend"]);
  });

  it("skips files inside the workspace, which load natively", () => {
    const chain = findTargetProjectChain(`${frontend}/src/app.tsx`, frontend, registry());
    expect(chain).toEqual([]);
  });

  it("returns nothing when no registered root owns the file", () => {
    const chain = findTargetProjectChain("C:/elsewhere/x.ts", "C:/repos/vault", registry());
    expect(chain).toEqual([]);
  });
});

describe("hasRepoGuidance", () => {
  it("accepts a repository that carries guidance", () => {
    expect(hasRepoGuidance(fullStack)).toBe(true);
  });

  it("rejects a plain container directory with no .git", () => {
    expect(hasRepoGuidance(container)).toBe(false);
  });

  it("rejects a repository with no guidance of its own", () => {
    expect(hasRepoGuidance(backend)).toBe(false);
  });
});

describe("findAncestorProjects", () => {
  it("adopts an unregistered repository ancestor that carries guidance", () => {
    const ancestors = findAncestorProjects(frontend, { home: "C:/Users/nobody" });
    expect(ancestors.map((entry) => entry.root)).toEqual([fullStack]);
    expect(ancestors[0].source).toBe("ancestor");
    // An unregistered ancestor is named by its directory, not its full path.
    expect(ancestors[0].name).toBe("full-stack-repo");
  });

  it("stops at the home directory without adopting it", () => {
    // Pretend the monorepo root is the home directory: the walk must end there
    // rather than adopt it, since nothing at or above home belongs to a project.
    const ancestors = findAncestorProjects(frontend, { home: fullStack });
    expect(ancestors).toEqual([]);
  });

  it("honours the depth bound", () => {
    const seen = [];
    findAncestorProjects(`${frontend}/a/b/c/d`, {
      maxDepth: 2,
      home: "C:/Users/nobody",
      isRepo: (dir) => {
        seen.push(dir);
        return false;
      },
    });
    expect(seen).toEqual([`${frontend}/a/b/c`, `${frontend}/a/b`]);
  });

  it("finds nothing above a repo whose parents carry no guidance", () => {
    expect(findAncestorProjects(loneRepo, { home: "C:/Users/nobody" })).toEqual([]);
  });
});

describe("resolveTargetChain", () => {
  it("prepends unregistered ancestors to the registered chain", () => {
    const chain = resolveTargetChain(`${frontend}/src/app.tsx`, "C:/repos/vault", registry(), {
      home: "C:/Users/nobody",
    });
    expect(chain.map((entry) => entry.root)).toEqual([fullStack, frontend]);
    expect(chain.map((entry) => entry.source)).toEqual(["ancestor", "registered"]);
  });

  it("does not duplicate an ancestor that is itself registered", () => {
    const projects = [{ name: "full-stack-repo", path: fullStack }, ...registry()];
    const chain = resolveTargetChain(`${frontend}/src/app.tsx`, "C:/repos/vault", projects, {
      home: "C:/Users/nobody",
    });
    expect(chain.map((entry) => entry.root)).toEqual([fullStack, frontend]);
    expect(chain.map((entry) => entry.source)).toEqual(["registered", "registered"]);
  });

  it("considers registered roots only when ancestors are disabled", () => {
    const chain = resolveTargetChain(`${frontend}/src/app.tsx`, "C:/repos/vault", registry(), {
      ancestors: false,
      home: "C:/Users/nobody",
    });
    expect(chain.map((entry) => entry.root)).toEqual([frontend]);
  });

  it("reaches an ancestor's guidance for a repo that has none of its own", () => {
    const chain = resolveTargetChain(`${backend}/src/main.rs`, "C:/repos/vault", registry(), {
      home: "C:/Users/nobody",
    });
    expect(chain.map((entry) => entry.root)).toEqual([fullStack, backend]);
  });
});

describe("loadMatchingRules across the chain", () => {
  it("matches an ancestor rule against the path relative to that ancestor", () => {
    const rules = loadMatchingRules(fullStack, toRepoRelativePath(`${frontend}/src/app.tsx`, fullStack));
    expect(rules.map((rule) => rule.rel)).toEqual([".claude/rules/monorepo.md"]);
    expect(rules[0].body).toContain("shared design tokens");
  });

  it("applies a rule with no front matter everywhere", () => {
    const rules = loadMatchingRules(frontend, "src/app.tsx");
    expect(rules.map((rule) => rule.rel)).toEqual([".claude/rules/always.md"]);
  });

  it("returns nothing for a repo with no rules directory", () => {
    expect(loadMatchingRules(backend, "src/main.rs")).toEqual([]);
  });
});

describe("skill catalog", () => {
  it("reads name and description from SKILL.md front matter", () => {
    const parsed = parseSkillFrontMatter(
      "---\nname: deploy-stack\ndescription: Deploy both halves.\n---\n\nbody\n"
    );
    expect(parsed).toEqual({ name: "deploy-stack", description: "Deploy both halves." });
  });

  it("collects the skills a repository offers", () => {
    const skills = collectSkillCatalog(fullStack);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("deploy-stack");
    expect(skills[0].description).toBe("Deploy frontend and backend together.");
    expect(normalizePath(skills[0].path)).toBe(`${fullStack}/.claude/skills/deploy-stack/SKILL.md`);
  });

  it("returns nothing for a repository with no skills directory", () => {
    expect(collectSkillCatalog(backend)).toEqual([]);
  });

  it("tells the model to read the SKILL.md rather than invoke it", () => {
    const block = renderSkillsBlock(
      { root: fullStack, name: "full-stack-repo", source: "ancestor" },
      collectSkillCatalog(fullStack)
    );
    expect(block).toContain("cannot be invoked by name");
    expect(block).toContain('name="deploy-stack"');
  });
});

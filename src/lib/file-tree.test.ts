import { describe, expect, it } from "vitest";
import { buildFileTree, type DirNode, type FileNode } from "@/lib/file-tree";
import type { CommitFileChange } from "@/types";

function change(path: string, status = "M"): CommitFileChange {
  return { path, old_path: null, status, additions: 1, deletions: 0 };
}

describe("buildFileTree", () => {
  it("keeps root-level files as leaves, alphabetically", () => {
    const tree = buildFileTree([change("b.txt"), change("a.txt")]);
    expect(tree.map((n) => n.name)).toEqual(["a.txt", "b.txt"]);
    expect(tree.every((n) => n.type === "file")).toBe(true);
  });

  it("groups files under a shared directory", () => {
    const tree = buildFileTree([change("src/a.ts"), change("src/b.ts")]);
    expect(tree).toHaveLength(1);
    const dir = tree[0] as DirNode;
    expect(dir.type).toBe("dir");
    expect(dir.name).toBe("src");
    expect(dir.children.map((c) => c.name)).toEqual(["a.ts", "b.ts"]);
  });

  it("compacts a single-child directory chain", () => {
    const tree = buildFileTree([change("src/components/repos/x.tsx")]);
    expect(tree).toHaveLength(1);
    const dir = tree[0] as DirNode;
    expect(dir.name).toBe("src/components/repos");
    expect(dir.path).toBe("src/components/repos");
    expect(dir.children).toHaveLength(1);
    expect((dir.children[0] as FileNode).path).toBe("src/components/repos/x.tsx");
  });

  it("stops compacting where the tree branches", () => {
    const tree = buildFileTree([
      change("src/components/a.tsx"),
      change("src/lib/b.ts"),
    ]);
    const src = tree[0] as DirNode;
    expect(src.name).toBe("src");
    expect(src.children.map((c) => c.name)).toEqual(["components", "lib"]);
  });

  it("sorts directories before files at each level", () => {
    const tree = buildFileTree([change("z.txt"), change("dir/a.txt")]);
    expect(tree.map((n) => n.type)).toEqual(["dir", "file"]);
  });

  it("uses the new path for a rename and carries the change", () => {
    const renamed: CommitFileChange = {
      path: "src/new-name.ts",
      old_path: "src/old-name.ts",
      status: "R",
      additions: 0,
      deletions: 0,
    };
    const tree = buildFileTree([renamed]);
    const dir = tree[0] as DirNode;
    const leaf = dir.children[0] as FileNode;
    expect(leaf.name).toBe("new-name.ts");
    expect(leaf.change.old_path).toBe("src/old-name.ts");
  });

  it("includes untracked files like any other change", () => {
    const tree = buildFileTree([change("src/brand-new.ts", "?")]);
    const dir = tree[0] as DirNode;
    expect((dir.children[0] as FileNode).change.status).toBe("?");
  });
});

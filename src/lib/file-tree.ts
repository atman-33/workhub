import type { CommitFileChange } from "@/types";

/** A leaf node: one changed file. */
export interface FileNode {
  type: "file";
  /** Leaf name (last path segment). */
  name: string;
  /** Full forward-slash path — matches `CommitFileChange.path`. */
  path: string;
  change: CommitFileChange;
}

/** A directory node. `name` may span several segments when compacted. */
export interface DirNode {
  type: "dir";
  /** Display name; compacted single-child chains join with "/" (e.g. "a/b"). */
  name: string;
  /** Full path of this directory (deepest segment when compacted). */
  path: string;
  children: TreeNode[];
}

export type TreeNode = FileNode | DirNode;

interface Interim {
  dirs: Map<string, Interim>;
  files: CommitFileChange[];
}

/**
 * Group flat changed-file paths into a directory tree. Directories are sorted
 * before files, each alphabetically. Single-child directory chains are
 * compacted into one node ("compact folders", like VS Code), so a lone
 * `src/components/repos/x.tsx` renders as one `src/components/repos` folder.
 */
export function buildFileTree(files: CommitFileChange[]): TreeNode[] {
  const root: Interim = { dirs: new Map(), files: [] };
  for (const change of files) {
    const parts = change.path.split("/");
    parts.pop(); // file name — kept via `change.path`
    let cur = root;
    for (const part of parts) {
      let next = cur.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        cur.dirs.set(part, next);
      }
      cur = next;
    }
    cur.files.push(change);
  }
  return toNodes(root, "");
}

function toNodes(interim: Interim, prefix: string): TreeNode[] {
  const dirNodes: DirNode[] = [];
  for (const [name, child] of interim.dirs) {
    const path = prefix ? `${prefix}/${name}` : name;
    dirNodes.push(compact({ type: "dir", name, path, children: toNodes(child, path) }));
  }
  dirNodes.sort((a, b) => a.name.localeCompare(b.name));

  const fileNodes: FileNode[] = interim.files
    .map((change) => ({
      type: "file" as const,
      name: change.path.split("/").pop() ?? change.path,
      path: change.path,
      change,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...dirNodes, ...fileNodes];
}

/** Fold a directory with a single sub-directory child into one node. */
function compact(node: DirNode): DirNode {
  while (node.children.length === 1 && node.children[0].type === "dir") {
    const child = node.children[0];
    node = {
      type: "dir",
      name: `${node.name}/${child.name}`,
      path: child.path,
      children: child.children,
    };
  }
  return node;
}

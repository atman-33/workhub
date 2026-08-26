/**
 * Mindmap -> mermaid `mindmap` source.
 *
 * This is the export the feature exists for: the note is the editable form,
 * and mermaid is what gets pasted into a document, a README or a chat message.
 * It is deliberately one-way. Mermaid's mindmap syntax cannot carry node ids,
 * colours, task links or the collapsed flag, so round-tripping through it
 * would quietly discard exactly the things the notation was given for.
 *
 * Two consequences shape this module:
 *
 * - **Structure only.** Modifiers are dropped rather than encoded as decoration
 *   a reader would have to interpret. A task link is the one exception worth
 *   discussing, and it loses: `T-0042` means nothing outside this vault.
 * - **Titles are sanitized, not escaped.** Mermaid's mindmap parser reads
 *   brackets and parentheses as shape syntax and has no escape for them, so a
 *   title containing them is rewritten with look-alikes instead of producing
 *   a diagram that fails to render.
 */

import type { MindmapNode } from "./parse";

/** Mermaid indents by level; two spaces is what its own examples use. */
const INDENT = "  ";

/**
 * Characters mermaid would read as shape syntax, mapped to look-alikes that
 * render as the author intended.
 */
const REPLACEMENTS: Record<string, string> = {
  "[": "（",
  "]": "）",
  "{": "（",
  "}": "）",
  "(": "（",
  ")": "）",
};

/**
 * Makes a title safe to place in a mermaid mindmap node.
 *
 * Parentheses are converted to their full-width forms rather than removed: a
 * title like "tasks (later)" should still read as "tasks（later）", not as
 * "tasks later".
 */
export function sanitizeTitle(title: string): string {
  const oneLine = title.replace(/\s*\n\s*/g, " ").trim();
  let out = "";
  for (const ch of oneLine) out += REPLACEMENTS[ch] ?? ch;
  // A node with no text at all would make mermaid inherit the next line's
  // indentation and mis-nest the tree.
  return out.trim() || "…";
}

function renderNode(node: MindmapNode, depth: number, lines: string[]): void {
  const text = sanitizeTitle(node.title);
  // The root gets the circle shape mermaid uses for a mindmap's centre;
  // everything below it is plain text, which is what mermaid's own examples do.
  const rendered = depth === 0 ? `root((${text}))` : text;
  lines.push(`${INDENT.repeat(depth + 1)}${rendered}`);
  for (const child of node.children) renderNode(child, depth + 1, lines);
}

/**
 * Renders the tree as mermaid `mindmap` source.
 *
 * Collapsed nodes are exported *with* their children: collapsing is a way of
 * looking at the map in the app, not a statement about the map's content, and
 * an export that silently omitted a subtree would be a trap.
 */
export function toMermaid(roots: MindmapNode[]): string {
  const lines = ["mindmap"];
  if (!roots.length) {
    lines.push(`${INDENT}root((empty))`);
    return lines.join("\n");
  }
  // Mermaid allows exactly one root. Several roots — legal in the note, since
  // Obsidian may grow one — are hung under the document itself by the caller;
  // here the first root wins its shape and the rest become its siblings one
  // level down, which at least renders every node.
  renderNode(roots[0], 0, lines);
  for (const extra of roots.slice(1)) renderNode(extra, 1, lines);
  return lines.join("\n");
}

/** The same source wrapped in a fenced code block, ready to paste into a
 * Markdown document — which is how it is almost always used. */
export function toMermaidBlock(roots: MindmapNode[]): string {
  return ["```mermaid", toMermaid(roots), "```"].join("\n");
}

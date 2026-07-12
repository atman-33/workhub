/** Tailwind classes for a file's single-letter git status badge. */
export function statusTone(status: string) {
  switch (status) {
    case "A":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    case "D":
      return "border-red-500/30 bg-red-500/10 text-red-400";
    case "R":
    case "C":
      return "border-sky-500/30 bg-sky-500/10 text-sky-400";
    case "?":
      return "border-violet-500/30 bg-violet-500/10 text-violet-300";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-400";
  }
}

/** Tailwind classes for one line of unified-diff text. */
export function diffLineClass(line: string) {
  if (line.startsWith("@@")) return "text-sky-400";
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("rename ") ||
    line.startsWith("similarity ") ||
    line.startsWith("Binary files")
  )
    return "text-muted-foreground";
  if (line.startsWith("+")) return "bg-emerald-500/10 text-emerald-300";
  if (line.startsWith("-")) return "bg-red-500/10 text-red-300";
  return "text-foreground/80";
}

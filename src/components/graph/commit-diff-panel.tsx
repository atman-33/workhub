import { useEffect, useMemo, useState } from "react";
import { FileDiff, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CommitEntry, CommitFileChange } from "@/types";

interface Props {
  path: string;
  entry: CommitEntry;
  onClose: () => void;
}

function statusTone(status: string) {
  switch (status) {
    case "A":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    case "D":
      return "border-red-500/30 bg-red-500/10 text-red-400";
    case "R":
    case "C":
      return "border-sky-500/30 bg-sky-500/10 text-sky-400";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-400";
  }
}

function diffLineClass(line: string) {
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

export function CommitDiffPanel({ path, entry, onClose }: Props) {
  const [files, setFiles] = useState<CommitFileChange[] | null>(null);
  const [filesError, setFilesError] = useState("");
  const [selected, setSelected] = useState<CommitFileChange | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setFilesError("");
    setSelected(null);
    setDiff(null);
    void api
      .gitCommitFiles(path, entry.hash)
      .then((list) => {
        if (cancelled) return;
        setFiles(list);
        setSelected(list[0] ?? null);
      })
      .catch((e) => {
        if (!cancelled) setFilesError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path, entry.hash]);

  useEffect(() => {
    if (!selected) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    void api
      .gitCommitFileDiff(path, entry.hash, selected.path, selected.old_path)
      .then((text) => {
        if (!cancelled) setDiff(text);
      })
      .catch((e) => {
        if (!cancelled) setDiff(`diff failed — ${e}`);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, entry.hash, selected]);

  const diffLines = useMemo(() => (diff === null ? null : diff.split("\n")), [diff]);

  return (
    <div className="flex h-full min-h-0 flex-col border-t">
      {/* panel header */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <FileDiff className="size-3.5 text-muted-foreground" />
        {entry.hash !== "WORKTREE" && (
          <code className="text-[11px] text-muted-foreground">{entry.hash.slice(0, 8)}</code>
        )}
        <span className="min-w-0 truncate text-[12px] font-medium">{entry.subject}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {files ? `${files.length} file${files.length === 1 ? "" : "s"}` : ""}
        </span>
        <Button size="icon" variant="ghost" className="size-6 shrink-0" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* file list */}
        <div className="w-72 shrink-0 overflow-y-auto border-r py-1">
          {files === null && !filesError && (
            <div className="flex justify-center py-4">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {filesError && (
            <p className="px-3 py-2 text-[11px] text-red-400">{filesError}</p>
          )}
          {files?.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">No file changes.</p>
          )}
          {files?.map((f) => (
            <button
              key={f.path}
              className={cn(
                "flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-accent/40",
                selected?.path === f.path && "bg-accent/60",
              )}
              onClick={() => setSelected(f)}
            >
              <Badge
                variant="outline"
                className={cn("h-4 w-5 shrink-0 justify-center px-0 text-[10px]", statusTone(f.status))}
              >
                {f.status}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-[11px]" title={f.path}>
                {f.path}
              </span>
              {f.additions !== null && (
                <span className="shrink-0 text-[10px] text-emerald-400">+{f.additions}</span>
              )}
              {f.deletions !== null && (
                <span className="shrink-0 text-[10px] text-red-400">−{f.deletions}</span>
              )}
            </button>
          ))}
        </div>

        {/* diff view */}
        <div className="min-w-0 flex-1 overflow-auto">
          {diffLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : diffLines === null ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              Select a file to see its diff.
            </p>
          ) : diff === "" ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              No textual diff (binary file or no content change).
            </p>
          ) : (
            <pre className="min-w-max px-2 py-1 font-mono text-[11px] leading-[1.5]">
              {diffLines.map((line, i) => (
                <div key={i} className={cn("px-1", diffLineClass(line))}>
                  {line || " "}
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

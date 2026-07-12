import { useEffect, useMemo, useState } from "react";
import { FileDiff, Loader2, X } from "lucide-react";
import { ChangeFileList } from "@/components/change-file-list";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { diffLineClass } from "@/lib/diff-format";
import { cn } from "@/lib/utils";
import type { CommitEntry, CommitFileChange } from "@/types";

interface Props {
  path: string;
  entry: CommitEntry;
  onClose: () => void;
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
        <div className="w-72 shrink-0 border-r">
          <ChangeFileList
            files={files}
            loading
            error={filesError || undefined}
            emptyLabel="No file changes."
            selectedPath={selected?.path ?? null}
            onSelect={(p) => setSelected(files?.find((f) => f.path === p) ?? null)}
            resetKey={`${path}@${entry.hash}`}
          />
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

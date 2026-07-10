import { useState } from "react";
import { GitBranch, ListTodo } from "lucide-react";
import { ReposView } from "@/components/ReposView";
import { TasksView } from "@/components/TasksView";
import { cn } from "@/lib/utils";

type Tab = "tasks" | "repos";

const TABS: { key: Tab; label: string; icon: typeof ListTodo }[] = [
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "repos", label: "Repos", icon: GitBranch },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("tasks");

  return (
    <div className="flex h-screen flex-col">
      <nav className="flex items-center gap-1 border-b bg-muted/30 px-3 py-1.5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
              tab === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        <div className={cn("h-full", tab !== "tasks" && "hidden")}>
          <TasksView />
        </div>
        <div className={cn("h-full", tab !== "repos" && "hidden")}>
          <ReposView />
        </div>
      </div>
    </div>
  );
}

import { Component, type ErrorInfo, type ReactNode } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { CircleAlert, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/**
 * Catches a render-time exception and shows it, instead of letting React
 * unmount the tree (T-0254).
 *
 * The app had no boundary at all, and `app.tsx` mounts every tab at once and
 * hides the inactive ones with CSS. One thrown error therefore blanked the
 * whole window — and because a tab the user could not even see was still
 * mounted and still re-rendering, the tab that took the app down was often
 * not the one they were looking at. That is what made "the screen disappears
 * when I archive a project" impossible to place, let alone reproduce.
 *
 * So there are two rings of these: one per tab in `app.tsx`, which keeps a
 * failing tab from taking its neighbours with it, and one around the whole
 * app in `main.tsx` for anything outside the tabs. Every catch is also
 * written to the diagnostic log, because a packaged build has no console and
 * a blank window left nothing to read afterwards.
 */

interface Props {
  /** Names the failing area in the log line and in the message on screen —
   *  "projects", "schedule", "app". */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** React's own component stack, which says *where* it threw. The error's
   *  own stack in a bundled build is mostly minified frames. */
  componentStack: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack ?? "";
    this.setState({ componentStack });
    void api.logFrontendError(
      `react:${this.props.label}`,
      error.message || String(error),
      [error.stack, componentStack].filter(Boolean).join("\n"),
    );
  }

  /** The report the user pastes into an issue: what is on screen, plus the
   *  frames the panel had to truncate. */
  private report() {
    const { error, componentStack } = this.state;
    return [
      `workhub — ${this.props.label} failed to render`,
      error?.message ?? "unknown error",
      error?.stack ?? "",
      componentStack,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /** Re-mounts the children. The error may have been a transient one (a note
   *  read mid-move, say), and re-rendering is cheaper for the user than a
   *  restart — if it throws again the boundary simply catches it again. */
  private retry = () => {
    this.setState({ error: null, componentStack: "" });
  };

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <CircleAlert className="size-4 shrink-0" />
          The {this.props.label} view stopped with an error.
        </div>
        <p className="text-xs text-muted-foreground">
          The rest of the app is still running. This was written to the
          diagnostic log (Settings → Diagnostics), so it is still readable
          after a restart.
        </p>
        <p className="font-mono text-xs text-destructive">
          {error.message || String(error)}
        </p>
        {(error.stack || componentStack) && (
          <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-[11px] leading-snug text-muted-foreground">
            {error.stack || componentStack}
          </pre>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={this.retry}>
            <RotateCcw className="size-3.5" />
            Try again
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5"
            onClick={() => void writeText(this.report())}
          >
            <Copy className="size-3.5" />
            Copy details
          </Button>
        </div>
      </div>
    );
  }
}

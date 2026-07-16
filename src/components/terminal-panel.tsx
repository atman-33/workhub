import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Stable PTY session id: re-mounting the component reattaches to the same
 * herdr client session instead of spawning a new one (`terminal_open` is
 * idempotent for an already-open id). */
const TERMINAL_ID = "main";

interface Props {
  /** Kept mounted even while the panel is visually collapsed so the xterm
   * instance (and its listeners) survive show/hide — only styling toggles. */
  visible: boolean;
}

/** Embedded terminal running the herdr client over a native PTY (ConPTY on
 * Windows). Mounted once by the Tasks view and toggled via `visible` rather
 * than conditionally rendered, so hiding the panel doesn't tear down the
 * xterm instance or its Tauri event subscriptions — the PTY session itself
 * also persists on the Rust side regardless, since `terminal_open` reuses an
 * existing session for the same id. */
export function TerminalPanel({ visible }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState(false);

  const openSession = () => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;
    setExited(false);
    // Reopening spawns a fresh herdr client; clear any output left over from
    // the previous process (e.g. its exit error message) before reattaching.
    term.reset();
    fitAddon.fit();
    void api.terminalOpen(TERMINAL_ID, term.cols, term.rows).catch((e) => {
      term.writeln(`\r\n\x1b[31mfailed to open terminal: ${e}\x1b[0m`);
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      convertEol: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#161a22",
        foreground: "#e4e4e7",
        cursor: "#e4e4e7",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const dataDisposable = term.onData((data) => {
      void api.terminalWrite(TERMINAL_ID, data);
    });

    const unlistenOutput = listen<string>(`terminal-output:${TERMINAL_ID}`, (event) => {
      term.write(event.payload);
    });
    const unlistenExit = listen(`terminal-exit:${TERMINAL_ID}`, () => {
      setExited(true);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      void api.terminalResize(TERMINAL_ID, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    openSession();

    return () => {
      dataDisposable.dispose();
      void unlistenOutput.then((fn) => fn());
      void unlistenExit.then((fn) => fn());
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit whenever the panel becomes visible again (a hidden container has
  // zero size, so the addon can't measure it while collapsed).
  useEffect(() => {
    if (!visible) return;
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;
    fitAddon.fit();
    void api.terminalResize(TERMINAL_ID, term.cols, term.rows);
  }, [visible]);

  return (
    <div className={cn("relative h-full min-h-0 bg-[#161a22]", !visible && "hidden")}>
      <div ref={containerRef} className="h-full w-full px-2 py-1" />
      {exited && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 text-sm text-muted-foreground">
          <p>herdr process exited</p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={openSession}>
            <RotateCcw className="size-3.5" /> Reopen
          </Button>
        </div>
      )}
    </div>
  );
}

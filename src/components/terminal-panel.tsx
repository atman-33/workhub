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
  /** The xterm instance is created lazily on the FIRST time this turns true:
   * xterm measures glyph metrics from the DOM in `open()`, and measuring a
   * `display:none` container yields broken metrics that corrupt all later
   * rendering. Once created, hiding only toggles CSS. */
  visible: boolean;
}

/** Embedded terminal running the herdr client over a native PTY (ConPTY on
 * Windows). Mounted once by the Tasks view; the terminal is initialized on
 * first show and kept alive across hide/show — the PTY session also persists
 * on the Rust side, since `terminal_open` reuses an existing session for the
 * same id. */
export function TerminalPanel({ visible }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [exited, setExited] = useState(false);

  const openSession = async () => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;
    setExited(false);
    // Reopening may follow a previous process exit; clear leftover output
    // before reattaching.
    term.reset();
    fitAddon.fit();
    try {
      const reused = await api.terminalOpen(TERMINAL_ID, term.cols, term.rows);
      if (reused) {
        // A reattached xterm starts blank and would only show output deltas.
        // Jiggle the PTY size so herdr repaints the whole screen.
        await api.terminalResize(TERMINAL_ID, term.cols, Math.max(1, term.rows - 1));
        await api.terminalResize(TERMINAL_ID, term.cols, term.rows);
      }
    } catch (e) {
      term.writeln(`\r\n\x1b[31mfailed to open terminal: ${e}\x1b[0m`);
    }
  };

  // Lazy init: create and wire up xterm the first time the panel is shown,
  // while the container is actually visible and measurable.
  useEffect(() => {
    if (!visible || termRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    // No `convertEol`: the backend is a real PTY (ConPTY), so line endings and
    // cursor movement arrive as exact escape sequences — injecting CRs would
    // corrupt full-screen TUI layouts like herdr's.
    const term = new Terminal({
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
      // fit() is a no-op while the container is hidden/zero-sized (the addon
      // cannot propose dimensions), so this only acts on real size changes.
      fitAddon.fit();
      void api.terminalResize(TERMINAL_ID, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    void openSession();

    cleanupRef.current = () => {
      dataDisposable.dispose();
      void unlistenOutput.then((fn) => fn());
      void unlistenExit.then((fn) => fn());
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Dispose everything only on unmount (the init effect above must NOT clean
  // up when `visible` flips back to false — the instance is kept for reuse).
  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    },
    [],
  );

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
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void openSession()}>
            <RotateCcw className="size-3.5" /> Reopen
          </Button>
        </div>
      )}
    </div>
  );
}

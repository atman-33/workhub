import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
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
  /** Whether the panel currently fills the whole view (board collapsed). */
  maximized: boolean;
  onToggleMaximize: () => void;
}

/** Embedded terminal running the herdr client over a native PTY (ConPTY on
 * Windows). Mounted once by the Tasks view; the terminal is initialized on
 * first show and kept alive across hide/show — the PTY session also persists
 * on the Rust side, since `terminal_open` reuses an existing session for the
 * same id. */
export function TerminalPanel({ visible, maximized, onToggleMaximize }: Props) {
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
    // A fresh channel per (re)open: on reuse the backend re-routes the PTY
    // stream to it. Channels deliver in order even under heavy TUI redraw
    // traffic, unlike events.
    const onOutput = new Channel<string>();
    onOutput.onmessage = (data) => {
      term.write(data);
    };
    try {
      await api.terminalOpen(TERMINAL_ID, term.cols, term.rows, onOutput);
      // Re-measure on the next frame — a freshly (re)created xterm's first
      // fit() can be slightly off while the container is still settling —
      // then jiggle the PTY size so herdr repaints the full screen at the
      // true dimensions. Also covers reattach, where the new xterm starts
      // blank and would otherwise only see output deltas.
      requestAnimationFrame(() => {
        const t = termRef.current;
        const f = fitAddonRef.current;
        if (!t || !f) return;
        f.fit();
        void api
          .terminalResize(TERMINAL_ID, t.cols, Math.max(1, t.rows - 1))
          .then(() => api.terminalResize(TERMINAL_ID, t.cols, t.rows))
          .catch(() => {});
      });
    } catch (e) {
      term.writeln(`\r\n\x1b[31mfailed to open terminal: ${e}\x1b[0m`);
    }
  };

  /** Hard recovery: kill the PTY + herdr client and rebuild the xterm
   * instance from scratch, then reattach. herdr is client/server, so the
   * server-side workspaces and running agents are unaffected. */
  const restart = async () => {
    try {
      await api.terminalClose(TERMINAL_ID);
    } catch {
      // Session already gone — still rebuild the frontend side.
    }
    cleanupRef.current?.();
    cleanupRef.current = null;
    initTerminal();
  };

  /** Creates and wires up the xterm instance. Idempotent: no-op while an
   * instance exists. Must only run while the container is visible and
   * measurable (see `visible` prop docs). */
  const initTerminal = () => {
    const container = containerRef.current;
    if (!container || termRef.current) return;

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
    // GPU renderer: much more reliable than the DOM renderer under rapid
    // full-screen TUI redraws. Fall back silently if WebGL is unavailable.
    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
        webglAddon = null;
      });
      term.loadAddon(webglAddon);
    } catch {
      webglAddon = null;
    }
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const dataDisposable = term.onData((data) => {
      void api.terminalWrite(TERMINAL_ID, data);
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
      void unlistenExit.then((fn) => fn());
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  };

  // Lazy init: create and wire up xterm the first time the panel is shown,
  // while the container is actually visible and measurable.
  useEffect(() => {
    if (!visible) return;
    initTerminal();
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
    <div
      className={cn("relative h-full min-h-0 bg-[#161a22]", !visible && "hidden")}
      // Suppress the WebView's native context menu over the terminal: herdr
      // receives the right-click through the PTY mouse protocol and shows its
      // own menu, which the browser menu would otherwise cover.
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={containerRef} className="h-full w-full px-2 py-1" />
      <div className="absolute right-2 top-1 z-10 flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={() => void restart()}
          title="Restart the terminal (herdr workspaces and agents keep running)"
        >
          <RotateCcw className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={onToggleMaximize}
          title={maximized ? "Restore terminal size" : "Maximize terminal"}
        >
          {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
      </div>
      {exited && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 text-sm text-muted-foreground">
          <p>herdr process exited</p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void restart()}>
            <RotateCcw className="size-3.5" /> Reopen
          </Button>
        </div>
      )}
    </div>
  );
}

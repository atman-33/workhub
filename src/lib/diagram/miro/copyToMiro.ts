/**
 * Writing a scene to the system clipboard for Miro (T-0720).
 *
 * One place does the write, and it only reports back: `{ ok: true }` when
 * the clipboard holds the payload, `{ ok: false, error }` otherwise, so the
 * button can show success or the reason. It never throws.
 *
 * Whether `ClipboardItem` with `text/html` works in the Tauri WebView2 is
 * unverified - the browser behaviour is confirmed, the app's is not. There
 * is deliberately no Rust `CF_HTML` fallback in this change.
 */
import { buildPlainText, encodePayload, toMiroHtml } from "./encode";
import type { MiroScene } from "./model";

export type MiroCopyResult = { ok: true } | { ok: false; error: string };

export async function copyToMiro(scene: MiroScene): Promise<MiroCopyResult> {
  try {
    const globals = globalThis as unknown as {
      ClipboardItem?: new (data: Record<string, Blob>) => ClipboardItem;
      navigator?: Navigator | undefined;
    };
    if (!globals.ClipboardItem) {
      return { ok: false, error: "this view cannot write HTML to the clipboard" };
    }
    const clipboard = globals.navigator?.clipboard;
    if (!clipboard) {
      return { ok: false, error: "no clipboard is available" };
    }
    const plain = buildPlainText(scene);
    const html = toMiroHtml(encodePayload(scene), plain);
    await clipboard.write([
      new globals.ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain || " "], { type: "text/plain" }),
      }),
    ]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

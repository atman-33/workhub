import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";

/** Collect the plain text of a React node tree (for copying a code block). */
function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement(node)) {
    return nodeText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    const text = nodeText(children).replace(/\n$/, "");
    void writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="group relative my-2">
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-md border border-border/60 bg-background/80 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

/**
 * Renders a ```mermaid fence as a diagram.
 *
 * Mermaid is loaded with a dynamic `import()` the first time a document
 * actually contains one — it is by far the heaviest thing this component can
 * pull in, and the task previews that share this renderer never need it.
 * A diagram that fails to parse falls back to its source: a broken chart in
 * someone else's document must not blank out the page around it.
 */
function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = React.useState("");
  const [failed, setFailed] = React.useState(false);
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, "");

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        // The app renders dark-only (see index.html), so the theme is fixed
        // rather than observed.
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        const rendered = await mermaid.render(`mermaid-${id}`, code);
        if (live) setSvg(rendered.svg);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [code, id]);

  if (failed) return <CodeBlock>{code}</CodeBlock>;
  if (!svg) {
    return <div className="my-2 text-xs text-muted-foreground">Rendering diagram…</div>;
  }
  return (
    <div
      className="my-3 overflow-x-auto rounded-md border bg-muted/20 p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      // Mermaid's own output, produced with securityLevel "strict" — it strips
      // script tags and event handlers out of the diagram source.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * An image whose bytes must be fetched through the backend before it can be
 * shown — the Docs tab's case, where the file sits on a share the webview
 * cannot reach on its own.
 */
function ResolvedImage({
  src,
  alt,
  resolveAsset,
}: {
  src: string;
  alt: string;
  resolveAsset: (src: string) => Promise<string | null>;
}) {
  const [resolved, setResolved] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    setFailed(false);
    setResolved(null);
    void resolveAsset(src)
      .then((uri) => {
        if (!live) return;
        if (uri) setResolved(uri);
        else setFailed(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [src, resolveAsset]);

  if (failed) {
    // Name the file rather than showing a broken-image glyph: on a share,
    // "not synced to this machine yet" is the usual reason and worth saying.
    return (
      <span className="my-1 inline-block rounded border border-dashed px-2 py-1 text-xs text-muted-foreground">
        {alt || "image"} — could not read {src}
      </span>
    );
  }
  if (!resolved) {
    return <span className="text-xs text-muted-foreground">Loading image…</span>;
  }
  return <img src={resolved} alt={alt} className="my-2 max-w-full rounded" />;
}

interface MarkdownProps {
  children: string;
  className?: string;
  /** Render ```mermaid fences as diagrams (loads mermaid on demand). */
  mermaid?: boolean;
  /**
   * Turns an image `src` written in the document into something the webview
   * can display — a `data:` URI, typically. Returning `null` marks the image
   * unreadable. Without this, image sources are passed through untouched,
   * which is what the task previews want.
   */
  resolveAsset?: (src: string) => Promise<string | null>;
}

/**
 * Minimal markdown renderer shared by the task Description preview, the
 * Results sheet and the Docs tab. Links open in the external browser (never
 * navigate the webview); fenced code blocks get a hover copy button. No
 * syntax highlighting. Single newlines render as hard breaks (remark-breaks)
 * to match how the same files read in Obsidian.
 *
 * `mermaid` and `resolveAsset` are opt-in: with neither set this renders
 * exactly what it always did, so the task previews are unaffected by what the
 * Docs tab needs.
 */
export function Markdown({ children, className, mermaid, resolveAsset }: MarkdownProps) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed break-words",
        "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold",
        "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-0.5",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_hr]:my-3 [&_hr]:border-border",
        "[&_table]:my-2 [&_table]:block [&_table]:overflow-x-auto",
        "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a({ href, children, ...props }) {
            return (
              <a
                {...props}
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (href) void openUrl(href);
                }}
              >
                {children}
              </a>
            );
          },
          pre({ children }) {
            // The fence's language lives on the <code> element react-markdown
            // nests inside the <pre>, so it is read from the child.
            const child = React.Children.toArray(children)[0];
            const language = React.isValidElement(child)
              ? ((child.props as { className?: string }).className ?? "")
              : "";
            if (mermaid && /\blanguage-mermaid\b/.test(language)) {
              return <MermaidBlock code={nodeText(children).replace(/\n$/, "")} />;
            }
            return <CodeBlock>{children}</CodeBlock>;
          },
          img({ src, alt }) {
            const source = typeof src === "string" ? src : "";
            if (resolveAsset && source) {
              return <ResolvedImage src={source} alt={alt ?? ""} resolveAsset={resolveAsset} />;
            }
            return <img src={source} alt={alt ?? ""} className="my-2 max-w-full rounded" />;
          },
          code({ className: codeClass, children, ...props }) {
            // Block code is wrapped by <pre> (handled above); style inline code.
            const isBlock = /language-/.test(codeClass ?? "");
            if (isBlock) {
              return (
                <code className={codeClass} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

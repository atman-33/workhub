import * as React from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { calloutKind, colonBlocksToCallouts, rehypeCallouts } from "@/lib/callouts";
import { cn } from "@/lib/utils";
import { CalloutBody, CalloutBox, CalloutTitle } from "./callout";

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
 * Loads mermaid and configures it once per session.
 *
 * `initialize` is global state, so calling it per block only repeated the same
 * write. The promise is memoised so concurrent blocks share one import.
 */
let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  mermaidReady ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      // The app renders dark-only (see index.html), so the theme is fixed
      // rather than observed.
      theme: "dark",
      securityLevel: "strict",
      // Without this, a diagram that fails to parse is not just an error we
      // catch: mermaid draws its "Syntax error in text" bomb into the scratch
      // element it appended to <body> and only then throws, leaving that
      // element behind. They accumulate, take full-width layout space, and
      // cover the app's own tab bar (T-0264). With it, mermaid removes the
      // scratch element before throwing and we render the fallback ourselves.
      suppressErrorRendering: true,
    });
    return mermaid;
  });
  return mermaidReady;
}

/**
 * Removes the scratch nodes `mermaid.render` attaches to <body> for `id`.
 *
 * Belt and braces on top of `suppressErrorRendering`: an unmount mid-render,
 * or a future mermaid version that misses a path, must not leave a stray
 * diagram floating over the app.
 */
function removeMermaidScratch(id: string) {
  // Scoped to direct children of <body> on purpose: mermaid appends its
  // scratch there, while the SVG we render carries the same id inside our own
  // container — an unscoped selector would delete the diagram we just drew.
  for (const selector of [`body > #${id}`, `body > #d${id}`, `body > #i${id}`]) {
    document.querySelector(selector)?.remove();
  }
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
  const id = `mermaid-${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        const rendered = await mermaid.render(id, code);
        if (live) setSvg(rendered.svg);
      } catch {
        if (live) setFailed(true);
      } finally {
        removeMermaidScratch(id);
      }
    })();
    return () => {
      live = false;
      removeMermaidScratch(id);
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
  width,
  height,
  resolveAsset,
}: {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
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
  return (
    <img
      src={resolved}
      alt={alt}
      width={width}
      height={height}
      className="my-2 h-auto max-w-full rounded"
    />
  );
}

/**
 * What survives of raw HTML in a document: GitHub's own sanitation, which is
 * what the team's notes are written against — `<details>`, `<kbd>`, `<img
 * width>`, `<br>`, `<sup>`…
 *
 * Sanitizing is not optional here. The webview this renders into holds the
 * Tauri IPC bridge, so a `<script>` or an `onerror=` in a document on a shared
 * folder would be code running with the app's own permissions.
 */
const HTML_REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [
  rehypeRaw,
  [rehypeSanitize, defaultSchema],
];

/**
 * The rehype pipeline for a combination of options. Callouts run last, after
 * sanitizing: their `data-*` attributes would not survive the GitHub schema,
 * and the tree they rearrange is safe by then.
 */
function rehypePluginsFor(allowHtml?: boolean, callouts?: boolean): Options["rehypePlugins"] {
  const plugins = allowHtml ? [...HTML_REHYPE_PLUGINS] : [];
  if (callouts) plugins.push(rehypeCallouts);
  return plugins.length > 0 ? plugins : undefined;
}

/** The compact styling the task previews and the Results sheet are sized for. */
const COMPACT_STYLE = [
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
];

/**
 * Reading styling for the Docs tab (T-0271): a bounded line length, a heading
 * scale you can find your way around a long document by, and tables and
 * quotes that stand apart from the prose. The compact style reads fine in a
 * card and poorly as a page — its h1 is the size of the body text.
 */
const DOCUMENT_STYLE = [
  "mx-auto max-w-3xl text-sm leading-7 break-words",
  "[&>*:first-child]:mt-0",
  "[&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:border-b [&_h1]:border-border [&_h1]:pb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:leading-tight",
  "[&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1.5 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-snug",
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold",
  "[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold",
  "[&_h5]:mt-4 [&_h5]:mb-1 [&_h5]:font-semibold [&_h6]:mt-4 [&_h6]:mb-1 [&_h6]:font-semibold [&_h6]:text-muted-foreground",
  "[&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3",
  "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_li]:my-1 [&_li>ul]:my-1 [&_li>ol]:my-1",
  // GFM task lists: the checkbox is the bullet.
  "[&_li.task-list-item]:list-none [&_ul.contains-task-list]:pl-2 [&_input]:mr-1.5 [&_input]:align-middle",
  "[&_blockquote]:my-4 [&_blockquote]:rounded-r-md [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:bg-muted/30 [&_blockquote]:px-4 [&_blockquote]:py-1 [&_blockquote]:text-muted-foreground",
  "[&_hr]:my-6 [&_hr]:border-border",
  "[&_table]:my-4 [&_table]:block [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-[0.8125rem]",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/60 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_tbody_tr:nth-child(even)]:bg-muted/20",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_details]:my-3 [&_details]:rounded-md [&_details]:border [&_details]:border-border [&_details]:px-3 [&_details]:py-2",
  "[&_summary]:cursor-pointer [&_summary]:font-medium",
  "[&_kbd]:rounded [&_kbd]:border [&_kbd]:border-border [&_kbd]:bg-muted [&_kbd]:px-1.5 [&_kbd]:py-0.5 [&_kbd]:font-mono [&_kbd]:text-[0.8em]",
];

interface MarkdownProps {
  children: string;
  className?: string;
  /** `compact` (the default) for cards and sheets, `document` for reading a page. */
  variant?: "compact" | "document";
  /**
   * Render raw HTML written into the Markdown — sanitized to GitHub's rules
   * first, see `HTML_REHYPE_PLUGINS`. Off, raw HTML is dropped as before.
   */
  allowHtml?: boolean;
  /** Render ```mermaid fences as diagrams (loads mermaid on demand). */
  mermaid?: boolean;
  /**
   * Turns an image `src` written in the document into something the webview
   * can display — a `data:` URI, typically. Returning `null` marks the image
   * unreadable. Without this, image sources are passed through untouched,
   * which is what the task previews want.
   */
  resolveAsset?: (src: string) => Promise<string | null>;
  /**
   * Draw Obsidian callouts (`> [!note]`), NotePM's `:::note info` and Zenn's
   * `:::message` / `:::details` blocks as boxes — see
   * `@/lib/callouts`. Off, they read as the plain quotes and text they are.
   */
  callouts?: boolean;
}

/**
 * Minimal markdown renderer shared by the task Description preview, the
 * Results sheet and the Docs tab. Links open in the external browser (never
 * navigate the webview); fenced code blocks get a hover copy button. No
 * syntax highlighting. Single newlines render as hard breaks (remark-breaks)
 * to match how the same files read in Obsidian.
 *
 * `mermaid`, `resolveAsset`, `allowHtml`, `callouts` and `variant` are
 * opt-in: with none set this renders exactly what it always did, so the task
 * previews are unaffected by what the Docs tab needs.
 */
export function Markdown({
  children,
  className,
  variant = "compact",
  allowHtml,
  mermaid,
  resolveAsset,
  callouts,
}: MarkdownProps) {
  const source = React.useMemo(
    () => (callouts ? colonBlocksToCallouts(children) : children),
    [callouts, children],
  );
  return (
    <div className={cn(variant === "document" ? DOCUMENT_STYLE : COMPACT_STYLE, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={rehypePluginsFor(allowHtml, callouts)}
        components={{
          div({ node: _node, children, ...props }) {
            // Only `rehypeCallouts` produces these attributes: sanitizing
            // strips `data-*` from raw HTML, so a document cannot forge one.
            const data = props as Record<string, unknown>;
            const type = data["data-callout-type"];
            if (callouts && typeof type === "string") {
              const fold = data["data-callout-fold"];
              return (
                <CalloutBox
                  kind={calloutKind(type)}
                  type={type}
                  fold={typeof fold === "string" ? fold : undefined}
                  noTitle={"data-callout-notitle" in data}
                  details={"data-callout-details" in data}
                >
                  {children}
                </CalloutBox>
              );
            }
            if (callouts && "data-callout-title" in data) {
              return <CalloutTitle>{children}</CalloutTitle>;
            }
            if (callouts && "data-callout-body" in data) {
              return <CalloutBody>{children}</CalloutBody>;
            }
            return <div {...props}>{children}</div>;
          },
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
          img({ src, alt, width, height }) {
            // `width`/`height` only arrive from raw HTML (`<img width="300">`),
            // which is the one way a Markdown author has to size an image.
            const source = typeof src === "string" ? src : "";
            if (resolveAsset && source) {
              return (
                <ResolvedImage
                  src={source}
                  alt={alt ?? ""}
                  width={width}
                  height={height}
                  resolveAsset={resolveAsset}
                />
              );
            }
            return (
              <img
                src={source}
                alt={alt ?? ""}
                width={width}
                height={height}
                className="my-2 h-auto max-w-full rounded"
              />
            );
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
        {source}
      </ReactMarkdown>
    </div>
  );
}

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

interface MarkdownProps {
  children: string;
  className?: string;
}

/**
 * Minimal markdown renderer shared by the task Description preview and the
 * Results sheet. Links open in the external browser (never navigate the
 * webview); fenced code blocks get a hover copy button. No syntax highlighting.
 * Single newlines render as hard breaks (remark-breaks) to match how the same
 * files read in Obsidian.
 */
export function Markdown({ children, className }: MarkdownProps) {
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
            return <CodeBlock>{children}</CodeBlock>;
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

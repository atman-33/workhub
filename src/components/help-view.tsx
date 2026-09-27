import { useCallback, useMemo, useState } from "react";
import {
  BookOpen,
  BrainCircuit,
  CalendarRange,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardList,
  Copy,
  Drama,
  FileDiff,
  FolderKanban,
  Inbox,
  Keyboard,
  type LucideIcon,
  MessageSquarePlus,
  Mic,
  MonitorUp,
  Network,
  PenLine,
  Puzzle,
  Repeat,
  Rocket,
  ScrollText,
  Sparkles,
  UserRoundCheck,
  ZoomIn,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Markdown } from "@/components/ui/markdown";
import { useLocaleStore, useT } from "@/lib/i18n";
import {
  HELP_SECTION_IDS,
  type HelpSectionId,
  helpSectionMarkdown,
  helpSections,
} from "@/lib/i18n/help";
import { cn } from "@/lib/utils";

// NOTE: This screen documents user-facing operations and setup steps. Its text
// lives in src/lib/i18n/help/ as Markdown, one file per language — the same
// Markdown is rendered here and put on the clipboard by the copy buttons. When
// an operation or setup flow changes elsewhere in the app (ink shortcuts,
// quick capture, first-run setup, settings), update the matching section in
// both help.en.ts and help.ja.ts. See .claude/rules/help-screen.md.

const SECTION_ICONS: Record<HelpSectionId, LucideIcon> = {
  setup: Rocket,
  zoom: ZoomIn,
  template: FileDiff,
  memory: BrainCircuit,
  secretary: UserRoundCheck,
  "custom-prompt": MessageSquarePlus,
  "claude-desktop": MonitorUp,
  ink: PenLine,
  "quick-capture": Keyboard,
  voice: Mic,
  clips: ClipboardList,
  projects: FolderKanban,
  schedule: CalendarRange,
  mindmap: Network,
  docs: BookOpen,
  inbox: Inbox,
  persona: Drama,
  plugins: Puzzle,
  tidy: Sparkles,
  recurring: Repeat,
  "diagnostic-log": ScrollText,
};

const ALL_SECTION_VALUES: string[] = [...HELP_SECTION_IDS];

// Labels in the guide are bold; drawn in the foreground colour they stand out
// from the muted prose the way the UI's own button names do.
const BODY_CLASS =
  "text-muted-foreground [&_li]:my-1 [&_strong]:font-medium [&_strong]:text-foreground";

function CopyButton({
  id,
  markdown,
  copiedId,
  onCopy,
  label,
  iconOnly = false,
  className,
}: {
  id: string;
  markdown: string;
  copiedId: string | null;
  onCopy: (id: string, markdown: string) => void;
  label: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const t = useT();
  const copied = copiedId === id;
  const Icon = copied ? Check : Copy;

  if (iconOnly) {
    return (
      <Hint label={label}>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={label}
          className={cn("text-muted-foreground", copied && "text-green-500", className)}
          onClick={() => onCopy(id, markdown)}
        >
          <Icon className="size-3.5" />
        </Button>
      </Hint>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("gap-1.5 text-xs", className)}
      onClick={() => onCopy(id, markdown)}
    >
      <Icon className={cn("size-3.5", copied && "text-green-500")} />
      {copied ? t("help.copied") : label}
    </Button>
  );
}

function sectionDomId(value: string) {
  return `help-section-${value}`;
}

export function HelpView() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const sections = useMemo(() => helpSections(locale), [locale]);
  const allMarkdown = useMemo(
    () => sections.map(helpSectionMarkdown).join("\n\n---\n\n"),
    [sections],
  );

  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Start fully collapsed: with every section closed the accordion headers are
  // themselves the table of contents, which is the fastest way to find a topic
  // now that the guide has grown past a screenful.
  const [openSections, setOpenSections] = useState<string[]>([]);

  const handleCopy = (id: string, markdown: string) => {
    void navigator.clipboard.writeText(markdown);
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
  };

  const allOpen = openSections.length === ALL_SECTION_VALUES.length;

  const toggleAll = useCallback(() => {
    setOpenSections(allOpen ? [] : [...ALL_SECTION_VALUES]);
  }, [allOpen]);

  // Contents row: open the target section (if it is closed) and scroll to it.
  // The scroll waits a frame so it measures the section after the accordion has
  // committed the expansion, not at its collapsed position.
  const jumpTo = useCallback((value: string) => {
    setOpenSections((prev) => (prev.includes(value) ? prev : [...prev, value]));
    requestAnimationFrame(() => {
      document
        .getElementById(sectionDomId(value))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{t("help.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("help.subtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={toggleAll}
            >
              {allOpen ? (
                <ChevronsDownUp className="size-3.5" />
              ) : (
                <ChevronsUpDown className="size-3.5" />
              )}
              {allOpen ? t("help.collapseAll") : t("help.expandAll")}
            </Button>
            <CopyButton
              id="all"
              markdown={allMarkdown}
              copiedId={copiedId}
              onCopy={handleCopy}
              label={t("help.copyAll")}
            />
          </div>
        </div>

        {/* Table of contents. Stays available once sections are open, so the
            user can move between topics without collapsing everything first. */}
        <nav aria-label={t("help.contentsAria")} className="mt-4 flex flex-wrap gap-1.5">
          {sections.map(({ id, short }) => {
            const Icon = SECTION_ICONS[id];
            return (
              <Button
                key={id}
                type="button"
                size="xs"
                variant="outline"
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => jumpTo(id)}
              >
                <Icon className="size-3.5" />
                {short}
              </Button>
            );
          })}
        </nav>

        <Accordion
          type="multiple"
          value={openSections}
          onValueChange={setOpenSections}
          className="mt-4"
        >
          {sections.map((section) => {
            const Icon = SECTION_ICONS[section.id];
            return (
              <AccordionItem
                key={section.id}
                value={section.id}
                id={sectionDomId(section.id)}
                className="scroll-mt-2"
              >
                <div className="relative">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2 pr-8">
                      <Icon className="size-4 text-muted-foreground" />
                      {section.title}
                    </span>
                  </AccordionTrigger>
                  {/* Sibling of the trigger (which is itself a <button>, so we
                      can't nest another button inside it): overlaid just left
                      of the chevron. */}
                  <CopyButton
                    id={section.id}
                    markdown={helpSectionMarkdown(section)}
                    copiedId={copiedId}
                    onCopy={handleCopy}
                    label={t("help.copySection")}
                    iconOnly
                    className="absolute top-1/2 right-7 -translate-y-1/2"
                  />
                </div>
                <AccordionContent>
                  <Markdown className={BODY_CLASS}>{section.body}</Markdown>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </div>
  );
}

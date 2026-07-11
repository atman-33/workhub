#!/usr/bin/env node
// @ts-check
/**
 * Generate a localized PR body from a template and analysis data.
 *
 * Usage:
 *     node generate_pr_body.mjs <template_file> <analysis_json_file> [output_file] [--language en|ja]
 *
 * If output_file is not specified, prints to stdout.
 */

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** @type {Record<string, Record<string, string>>} */
const CATEGORY_LABELS = {
  ja: {
    frontend: "フロントエンド",
    backend: "バックエンド",
    application: "アプリケーション",
    tests: "テスト",
    docs: "ドキュメント",
    config: "設定",
    ci: "CI",
    infrastructure: "インフラ",
    scripts: "スクリプト",
    assets: "アセット",
    data: "データ",
    other: "その他",
  },
};

const COMMIT_PREFIX_PATTERN = /^(feat|fix|docs|refactor|chore|build|ci|test)(\(.+?\))?!?:\s*/;

/**
 * @param {string} language
 * @returns {string}
 */
function normalizeLanguage(language) {
  const lowered = (language || "").trim().toLowerCase();
  if (lowered.startsWith("ja")) return "ja";
  return "en";
}

/**
 * @param {string} templatePath
 * @returns {string}
 */
function inferLanguageFromTemplate(templatePath) {
  const stem = templatePath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  return stem.toLowerCase().endsWith("-ja") ? "ja" : "en";
}

/**
 * Load PR template from file.
 * @param {string} templatePath
 * @returns {string}
 */
function loadTemplate(templatePath) {
  return readFileSync(templatePath, "utf8");
}

/**
 * Load analysis JSON data.
 * @param {string} analysisPath
 * @returns {Record<string, unknown>}
 */
function loadAnalysis(analysisPath) {
  return JSON.parse(readFileSync(analysisPath, "utf8"));
}

/**
 * Drop conventional commit prefixes for cleaner prose.
 * @param {string} subject
 * @returns {string}
 */
function stripCommitPrefix(subject) {
  const cleaned = subject.replace(COMMIT_PREFIX_PATTERN, "");
  if (!cleaned) return subject;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Format high-level diff statistics.
 * @param {Record<string, unknown>} analysis
 * @param {string} language
 * @returns {string}
 */
function formatStats(analysis, language) {
  const stats = /** @type {Record<string, number>} */ (
    analysis && typeof analysis === "object" && "stats" in analysis ? analysis.stats : {}
  ) || {};
  const files = stats.files || 0;
  const insertions = stats.insertions || 0;
  const deletions = stats.deletions || 0;
  if (normalizeLanguage(language) === "ja") {
    return `${files} 件 / +${insertions} / -${deletions}`;
  }
  return `${files} files changed, ${insertions} insertions, ${deletions} deletions`;
}

/**
 * Format category names for markdown output.
 * @param {string} rawLabel
 * @param {string} language
 * @returns {string}
 */
function formatLabel(rawLabel, language) {
  if (normalizeLanguage(language) === "ja") {
    return CATEGORY_LABELS.ja[rawLabel] || rawLabel;
  }
  return rawLabel.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Join display items with locale-aware punctuation.
 * @param {string[]} items
 * @param {string} language
 * @returns {string}
 */
function formatItems(items, language) {
  if (!items || items.length === 0) return "";
  if (normalizeLanguage(language) === "ja") {
    return items.join("、");
  }
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Format representative samples for summary bullets.
 * @param {string[]} samples
 * @param {string} language
 * @returns {string}
 */
function formatSamples(samples, language) {
  if (!samples || samples.length === 0) return "";

  const sampleLabels = samples.slice(0, 3).map((sample) => `\`${sample}\``);
  if (normalizeLanguage(language) === "ja") {
    return `。主な対象: ${formatItems(sampleLabels, language)}`;
  }

  if (sampleLabels.length === 1) return `, including ${sampleLabels[0]}`;
  if (sampleLabels.length === 2) return `, including ${sampleLabels[0]} and ${sampleLabels[1]}`;
  return `, including ${sampleLabels[0]}, ${sampleLabels[1]}, and ${sampleLabels[2]}`;
}

/**
 * Generate summary section from commits and changes.
 * @param {Record<string, unknown>} analysis
 * @param {string} language
 * @returns {string}
 */
function generateSummary(analysis, language) {
  const commits = /** @type {string[]} */ (
    Array.isArray(analysis.commits) ? analysis.commits : []
  );
  const topLevelAreas = /** @type {{ area: string, file_count: number, samples: string[] }[]} */ (
    Array.isArray(analysis.top_level_areas) ? analysis.top_level_areas : []
  );
  const lang = normalizeLanguage(language);

  if (commits.length === 0) {
    if (topLevelAreas.length > 0) {
      const areas = formatItems(
        topLevelAreas.slice(0, 3).map((area) => `\`${area.area}\``),
        lang,
      );
      if (lang === "ja") {
        return `- ${areas} を中心に ${formatStats(analysis, lang)} の更新。`;
      }
      return `- Updates ${formatStats(analysis, lang)} across ${areas}.`;
    }
    if (lang === "ja") {
      return `- ${formatStats(analysis, lang)} の更新。`;
    }
    return `- Updates ${formatStats(analysis, lang)}.`;
  }

  const messages = [];
  const seen = new Set();
  for (const commit of commits) {
    const spaceIdx = commit.indexOf(" ");
    const subject = stripCommitPrefix(spaceIdx >= 0 ? commit.slice(spaceIdx + 1) : commit);
    if (!seen.has(subject)) {
      seen.add(subject);
      messages.push(subject);
    }
  }

  if (messages.length === 1) {
    return `- ${messages[0]}`;
  }

  const summaryLines = messages.slice(0, 4).map((message) => `- ${message}`);
  if (messages.length > 4) {
    const additionalCount = messages.length - 4;
    if (lang === "ja") {
      summaryLines.push(`- ほか ${additionalCount} 件の変更テーマにまたがる補足更新`);
    } else {
      summaryLines.push(`- Additional supporting updates across ${additionalCount} more commit themes`);
    }
  }

  if (lang === "ja") {
    summaryLines.push(`- 差分規模: ${formatStats(analysis, lang)}`);
  } else {
    summaryLines.push(`- Diff scope: ${formatStats(analysis, lang)}`);
  }

  return summaryLines.join("\n");
}

/**
 * Normalize issue references for markdown output.
 * @param {string} issueRef
 * @returns {string}
 */
function formatIssueReference(issueRef) {
  return issueRef.includes("#") ? issueRef : `#${issueRef}`;
}

/**
 * Generate fallback changes breakdown using top-level areas.
 * @param {Record<string, unknown>} analysis
 * @param {string} language
 * @returns {string}
 */
function generateAreaBreakdown(analysis, language) {
  const areas = /** @type {{ area: string, file_count: number, samples: string[] }[]} */ (
    Array.isArray(analysis.top_level_areas) ? analysis.top_level_areas : []
  );
  const lang = normalizeLanguage(language);

  const lines = [];
  if (lang === "ja") {
    lines.push(`- 差分規模: ${formatStats(analysis, lang)}。`);
  } else {
    lines.push(`- Diff scope: ${formatStats(analysis, lang)}.`);
  }

  for (const area of areas.slice(0, 5)) {
    if (lang === "ja") {
      lines.push(`- \`${area.area}\`: ${area.file_count} 件${formatSamples(area.samples || [], lang)}`);
    } else {
      lines.push(`- \`${area.area}\`: ${area.file_count} file(s)${formatSamples(area.samples || [], lang)}.`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate changes breakdown by category or top-level area.
 * @param {Record<string, unknown>} analysis
 * @param {string} language
 * @returns {string}
 */
function generateChangesBreakdown(analysis, language) {
  const categorySummary = /** @type {{ category: string, file_count: number, samples: string[] }[]} */ (
    Array.isArray(analysis.category_summary) ? analysis.category_summary : []
  );
  const classification = /** @type {Record<string, unknown>} */ (
    analysis.classification && typeof analysis.classification === "object" ? analysis.classification : {}
  );
  const lang = normalizeLanguage(language);

  if (categorySummary.length === 0) {
    return lang === "ja" ? "差分は検出されませんでした。" : "No changes detected.";
  }

  if (classification.confidence === "low") {
    return generateAreaBreakdown(analysis, lang);
  }

  const lines = [];
  if (lang === "ja") {
    lines.push(`- 差分規模: ${formatStats(analysis, lang)}。`);
  } else {
    lines.push(`- Diff scope: ${formatStats(analysis, lang)}.`);
  }

  for (const item of categorySummary.slice(0, 5)) {
    const category = item.category;
    if (category === "other") continue;
    if (lang === "ja") {
      lines.push(`- ${formatLabel(category, lang)}: ${item.file_count} 件${formatSamples(item.samples || [], lang)}`);
    } else {
      lines.push(`- ${formatLabel(category, lang)}: ${item.file_count} file(s)${formatSamples(item.samples || [], lang)}.`);
    }
  }

  if (classification.confidence === "medium") {
    const otherFiles = typeof classification.other_files === "number" ? classification.other_files : 0;
    if (otherFiles) {
      if (lang === "ja") {
        lines.push(`- 未分類の差分: ${otherFiles} 件。reviewer 向けの説明は手動調整が必要な場合があります。`);
      } else {
        lines.push(`- Additional uncategorized changes: ${otherFiles} file(s); reviewer notes may need manual refinement.`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Generate related issues section.
 * @param {Record<string, unknown>} analysis
 * @param {string} language
 * @returns {string}
 */
function generateRelatedIssues(analysis, language) {
  const issueRefs = /** @type {string[]} */ (
    Array.isArray(analysis.issue_references) ? analysis.issue_references : []
  );
  const closingRefs = /** @type {string[]} */ (
    Array.isArray(analysis.closing_issue_references) ? analysis.closing_issue_references : []
  );
  let relatedRefs = /** @type {string[] | null} */ (
    Array.isArray(analysis.related_issue_references) ? analysis.related_issue_references : null
  );
  const targetIsDefaultBranch = Boolean(analysis.target_is_default_branch);
  const lang = normalizeLanguage(language);

  if (issueRefs.length === 0) {
    return lang === "ja" ? "なし" : "None";
  }

  if (relatedRefs === null) {
    const closingSet = new Set(closingRefs);
    relatedRefs = issueRefs.filter((ref) => !closingSet.has(ref));
  }

  const lines = [];
  if (targetIsDefaultBranch) {
    lines.push(...closingRefs.map((issue) => `- Closes ${formatIssueReference(issue)}`));
  } else if (closingRefs.length > 0) {
    if (lang === "ja") {
      lines.push(
        `- base \`${analysis.target_branch || "unknown"}\` が repository default branch と断定できないため、closing keyword ではなく関連 issue として記載しています。`,
      );
    } else {
      lines.push(
        `- Related issues are listed without closing keywords because base \`${analysis.target_branch || "unknown"}\` is not confirmed as the repository default branch.`,
      );
    }
    const closingSet = new Set(closingRefs);
    relatedRefs = [...closingRefs, ...relatedRefs.filter((ref) => !closingSet.has(ref))];
  }

  if (lang === "ja") {
    lines.push(...relatedRefs.map((issue) => `- 関連: ${formatIssueReference(issue)}`));
    return lines.length > 0 ? lines.join("\n") : "なし";
  }

  lines.push(...relatedRefs.map((issue) => `- Related to ${formatIssueReference(issue)}`));
  return lines.length > 0 ? lines.join("\n") : "None";
}

/**
 * Generate appropriate checklist items based on changes.
 * @param {Record<string, unknown>} analysis
 * @param {string} language
 * @returns {string}
 */
function generateChecklist(analysis, language) {
  const changes = /** @type {Record<string, { file: string }[]>} */ (
    analysis.changes_by_category && typeof analysis.changes_by_category === "object"
      ? analysis.changes_by_category
      : {}
  );
  const checklist = [];
  const lang = normalizeLanguage(language);

  if (lang === "ja") {
    checklist.push("- [ ] 自己レビューを行った");
    checklist.push("- [ ] Breaking change がある場合は影響を明記した");
  } else {
    checklist.push("- [ ] Self-reviewed the code");
    checklist.push("- [ ] Breaking changes documented (if any)");
  }

  if ("frontend" in changes || "backend" in changes || "application" in changes) {
    if (lang === "ja") {
      checklist.push("- [ ] 必要に応じて自動テストを追加または更新した");
    } else {
      checklist.push("- [ ] Automated tests added or updated as appropriate");
    }
  }

  if ("frontend" in changes) {
    if (lang === "ja") {
      checklist.push("- [ ] UI 変更を確認し、必要ならスクリーンショットを用意した");
    } else {
      checklist.push("- [ ] UI changes reviewed; screenshots added if useful");
    }
  }

  if ("docs" in changes) {
    if (lang === "ja") {
      checklist.push("- [ ] ドキュメント更新の要否を確認した");
    } else {
      checklist.push("- [ ] Documentation updated or confirmed unnecessary");
    }
  }

  if ("config" in changes || "ci" in changes || "infrastructure" in changes) {
    if (lang === "ja") {
      checklist.push("- [ ] 設定・CI・デプロイ影響を確認した");
    } else {
      checklist.push("- [ ] Config, CI, or deployment impact reviewed");
    }
  }

  let hasTests = false;
  for (const files of Object.values(changes)) {
    for (const fileInfo of files) {
      if (fileInfo && typeof fileInfo.file === "string" && fileInfo.file.toLowerCase().includes("test")) {
        hasTests = true;
        break;
      }
    }
    if (hasTests) break;
  }

  if (!hasTests && ("backend" in changes || "frontend" in changes || "application" in changes)) {
    if (lang === "ja") {
      checklist.push("- [ ] 追加の test coverage 要否を検討した");
    } else {
      checklist.push("- [ ] Follow-up test coverage considered");
    }
  }

  return checklist.join("\n");
}

/**
 * Fill template with generated content.
 * @param {string} template
 * @param {Record<string, unknown>} analysis
 * @param {string} language
 * @returns {string}
 */
function fillTemplate(template, analysis, language) {
  const replacements = [
    ["<!-- AUTO_SUMMARY -->", generateSummary(analysis, language)],
    ["<!-- AUTO_CHANGES -->", generateChangesBreakdown(analysis, language)],
    ["<!-- AUTO_ISSUES -->", generateRelatedIssues(analysis, language)],
    ["<!-- AUTO_CHECKLIST -->", generateChecklist(analysis, language)],
  ];

  let result = template;
  for (const [placeholder, content] of replacements) {
    result = result.split(placeholder).join(content);
  }
  return result;
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      language: { type: "string", short: "l" },
    },
    allowPositionals: true,
    args: process.argv.slice(2),
  });

  const templateFile = positionals[0];
  const analysisFile = positionals[1];
  const outputFile = positionals[2];

  if (!templateFile || !analysisFile) {
    process.stderr.write(
      "Usage: node generate_pr_body.mjs <template_file> <analysis_json_file> [output_file] [--language en|ja]\n",
    );
    return 2;
  }

  const language = normalizeLanguage(values.language || inferLanguageFromTemplate(templateFile));

  const template = loadTemplate(templateFile);
  const analysis = loadAnalysis(analysisFile);
  const prBody = fillTemplate(template, analysis, language);

  if (outputFile) {
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, prBody, "utf8");
    process.stderr.write(`PR body written to: ${outputFile}\n`);
  } else {
    process.stdout.write(prBody);
  }
  return 0;
}

process.exitCode = main();
// Read a decomposition workbook back into the intermediate JSON.
//
// Usage:
//   node read_xlsx.mjs <input.xlsx> <output.json> [--sheet NAME]
//
// Use this to pick up edits someone made in Excel before auditing or rebuilding.
// The header row is located by content, not by position: a workbook a human has
// edited often carries a note on row 1, a blank row 2 and the header on row 3.

import { writeFileSync } from "node:fs";
import { argv, exit } from "node:process";
import ExcelJS from "exceljs";

const { Workbook } = ExcelJS;

const HEADER_HINTS = ["level 1", "level 2", "strategy", "domain"];

/** Reduce an exceljs cell value to plain text for content matching. */
function textOf(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("result" in value) return textOf(value.result);
    if ("text" in value) return String(value.text ?? "");
    if (value instanceof Date) return value.toISOString();
    return "";
  }
  return String(value);
}

/** Reduce an exceljs cell value to a JSON-safe scalar. */
function scalarOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if ("result" in value) return scalarOf(value.result);
    if ("text" in value) return String(value.text ?? "");
    if (value instanceof Date) return value.toISOString();
    return null;
  }
  return value;
}

function isEmpty(value) {
  return value === null || value === undefined || value === "";
}

/** Return the 1-based row index of the header, or null. */
function findHeaderRow(ws, limit = 12) {
  const last = Math.min(ws.rowCount, limit);
  for (let row = 1; row <= last; row++) {
    const cells = [];
    for (let col = 1; col <= 5; col++) {
      cells.push(textOf(ws.getCell(row, col).value).toLowerCase());
    }
    const joined = cells.join(" ");
    if (HEADER_HINTS.some((hint) => joined.includes(hint)) && joined.includes("level")) {
      return row;
    }
  }
  return null;
}

function read(ws) {
  const header = findHeaderRow(ws);
  if (header === null) {
    console.error("could not find the header row (looked for a row mentioning 'Level')");
    exit(1);
  }
  const note = header > 1 ? textOf(ws.getCell(1, 1).value) : "";

  const data = { sheet: ws.name, header_note: note, strategies: [] };
  for (let row = header + 1; row <= ws.rowCount; row++) {
    const values = [];
    for (let col = 1; col <= 9; col++) {
      values.push(scalarOf(ws.getCell(row, col).value));
    }
    if (values.every(isEmpty)) continue;
    const [level1, level2, level3, level4, level5, memo, priority, rationale, noteCol] = values;
    if (!isEmpty(level1)) {
      data.strategies.push({ level1, domains: [] });
    }
    if (data.strategies.length === 0) {
      console.error(`row ${row} has content before any Level 1 value`);
      exit(1);
    }
    const strategy = data.strategies[data.strategies.length - 1];
    if (!isEmpty(level2)) {
      strategy.domains.push({ level2, components: [] });
    }
    const domain = strategy.domains[strategy.domains.length - 1];
    if (!isEmpty(level3)) {
      domain.components.push({ level3, aspects: [] });
    }
    const component = domain.components[domain.components.length - 1];
    if (!isEmpty(level4)) {
      component.aspects.push({ level4, states: [] });
    }
    const aspect = component.aspects[component.aspects.length - 1];
    if (!isEmpty(level5)) {
      aspect.states.push({
        level5,
        memo: isEmpty(memo) ? "" : memo,
        priority: isEmpty(priority) ? "" : priority,
        rationale: isEmpty(rationale) ? "" : rationale,
        note: isEmpty(noteCol) ? "" : noteCol,
      });
    }
  }
  return data;
}

function parseArgs(args) {
  const out = { input: null, output: null, sheet: null };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sheet") {
      out.sheet = args[++i] ?? null;
    } else {
      rest.push(args[i]);
    }
  }
  [out.input, out.output] = rest;
  return out;
}

async function main() {
  const { input, output, sheet } = parseArgs(argv.slice(2));
  if (!input || !output) {
    console.error("usage: node read_xlsx.mjs <input.xlsx> <output.json> [--sheet NAME]");
    exit(2);
  }

  const wb = new Workbook();
  await wb.xlsx.readFile(input);
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
  if (!ws) {
    console.error(sheet ? `no such sheet: ${sheet}` : "the workbook has no worksheets");
    exit(1);
  }
  const data = read(ws);
  writeFileSync(output, JSON.stringify(data, null, 1), "utf-8");

  const states = data.strategies.reduce(
    (n, strategy) =>
      n +
      strategy.domains.reduce(
        (m, domain) =>
          m +
          domain.components.reduce((k, component) => k + component.aspects.reduce((j, aspect) => j + aspect.states.length, 0), 0),
        0,
      ),
    0,
  );
  console.log(`read ${data.strategies.length} strategies / ${states} states from ${input} (sheet: ${ws.name})`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  exit(1);
});

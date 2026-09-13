// Build a strategy decomposition workbook from the intermediate JSON.
//
// Usage:
//   node build_xlsx.mjs <input.json> <output.xlsx> [--sheet NAME]
//
// The JSON schema is documented in ../references/xlsx-format.md.
// Rows repeat a parent value only when it changes, so the reader can see
// where each branch starts.

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import ExcelJS from "exceljs";

const { Workbook } = ExcelJS;

const HEADERS = [
  "Strategy / phase (Level 1)",
  "Domain (Level 2)",
  "Component (Level 3)",
  "Aspect (Level 4)",
  "Target state (Level 5)",
  "Memo",
  "Priority",
  "Rationale (upper connection / local situation)",
  "Notes",
];
const WIDTHS = [34, 32, 38, 42, 78, 24, 10, 60, 30];
const FILLS = {
  blue: "E8F1FB",
  orange: "FDF0E6",
  green: "E8F5E9",
  purple: "F3E8FB",
  gray: "EFEFEF",
};
const FILL_ORDER = ["blue", "orange", "green", "purple", "gray"];
const HEADER_FILL = "44546A";
const THIN_BORDER_COLOR = "BFBFBF";

/** Yield one [color, row] pair per Level 5 state. */
function flatten(data) {
  const rows = [];
  const strategies = data.strategies ?? [];
  strategies.forEach((strategy, index) => {
    const color = strategy.color || FILL_ORDER[index % FILL_ORDER.length];
    let firstOfStrategy = true;
    for (const domain of strategy.domains ?? []) {
      let firstOfDomain = true;
      for (const component of domain.components ?? []) {
        let firstOfComponent = true;
        for (const aspect of component.aspects ?? []) {
          let firstOfAspect = true;
          for (const state of aspect.states ?? []) {
            rows.push([
              color,
              [
                firstOfStrategy ? (strategy.level1 ?? null) : null,
                firstOfDomain ? (domain.level2 ?? null) : null,
                firstOfComponent ? (component.level3 ?? null) : null,
                firstOfAspect ? (aspect.level4 ?? null) : null,
                state.level5 ?? null,
                state.memo ?? null,
                state.priority ?? null,
                state.rationale ?? null,
                state.note ?? null,
              ],
            ]);
            firstOfStrategy = false;
            firstOfDomain = false;
            firstOfComponent = false;
            firstOfAspect = false;
          }
        }
      }
    }
  });
  return rows;
}

function thinBorder() {
  const side = { style: "thin", color: { argb: `FF${THIN_BORDER_COLOR}` } };
  return { left: side, right: side, top: side, bottom: side };
}

async function build(data, outPath, sheetName) {
  const rows = flatten(data);
  if (rows.length === 0) {
    console.error("no Level 5 states found in the input JSON");
    exit(1);
  }

  const wb = new Workbook();
  const ws = wb.addWorksheet(sheetName);
  const border = thinBorder();

  ws.mergeCells(1, 1, 1, HEADERS.length);
  const note = ws.getCell(1, 1);
  note.value = data.header_note || "";
  note.font = { bold: true, size: 11 };
  note.alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(1).height = 34;

  HEADERS.forEach((title, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = title;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER_FILL}` } };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    cell.border = border;
  });
  ws.getRow(2).height = 30;

  rows.forEach(([color, values], offset) => {
    const row = offset + 3;
    values.forEach((value, i) => {
      const cell = ws.getCell(row, i + 1);
      if (value !== null && value !== undefined && value !== "") {
        cell.value = value;
      }
      cell.alignment = { wrapText: true, vertical: "top" };
      cell.border = border;
    });
    const fill = FILLS[color] ?? FILLS.gray;
    ws.getCell(row, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fill}` } };
    for (const col of [1, 2]) {
      if (ws.getCell(row, col).value) {
        ws.getCell(row, col).font = { bold: true };
      }
    }
  });

  WIDTHS.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 2 }];

  await wb.xlsx.writeFile(outPath);
  return rows.length;
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
    console.error("usage: node build_xlsx.mjs <input.json> <output.xlsx> [--sheet NAME]");
    exit(2);
  }
  const data = JSON.parse(readFileSync(input, "utf-8"));
  const sheetName = sheet || data.sheet || "Decomposition";
  const count = await build(data, output, sheetName);
  console.log(`wrote ${count} rows to ${output} (sheet: ${sheetName})`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  exit(1);
});

#!/usr/bin/env node
// @ts-check
/**
 * init-task.mjs — scaffold the PBI task/acceptance-criteria markdown files
 * for one monday.com item or subitem, and link them back from the board via
 * that item's `link`-typed column(s).
 *
 *   node init-task.mjs --item <itemId> [epicFolder]
 *   node init-task.mjs --subitem <subitemId> [epicFolder]
 *
 * `epicFolder` is optional: when omitted, it is resolved from
 * `.claude/scrum-context.json`'s `mondayEpics` map using the item's (or, for
 * a subitem, its parent item's) monday group title — no need to retype the
 * Drive path once the Epic is configured there.
 *
 * Item mode generates:
 *   <epicFolder>/pbi/<itemId>-<name>/acceptance.md    (always)
 *   <epicFolder>/pbi/<itemId>-<name>/tasks.md          (only if the item has
 *                                                       no subitems —
 *                                                       otherwise task
 *                                                       breakdown lives
 *                                                       per-subitem)
 *   <epicFolder>/pbi/<itemId>-<name>/evidence/README.md (always, placeholder
 *                                                       for acceptance-test
 *                                                       evidence)
 * and writes the item's "Acceptance Criteria" / "Tasks" link columns,
 * resolved by column *title* — monday generates a random id suffix per
 * board (e.g. `link_mm4y5g57`), so column ids must never be hardcoded.
 *
 * Subitem mode generates:
 *   <epicFolder>/pbi/<parentItemId>-<name>/sub-tasks/<subitemId>-<name>.md
 * and writes the subitem's link column (subitem boards have exactly one
 * `link`-typed column in this convention, so it is matched by type alone).
 *
 * The `<id>-<name>` folder/file names are resolved via
 * `resolveIdPrefixedEntry` (in `monday-client.mjs`): once created, the name
 * suffix is never recomputed on a later monday rename — the id prefix alone
 * is what's relied on to keep finding the right folder/file. `.pm/backlog/*`
 * (written by `save-all.mjs`, see `scripts/lib/layout.mjs`) deliberately
 * stays id-only since it is fully overwritten every run.
 *
 * Files are created with `skipIfExists: true` so re-running this script
 * never clobbers a user's edits. monday.com changes are visible to the whole
 * workspace; as with `update-item-status.mjs`, the calling skill is expected
 * to have already confirmed the target with the user, so this script
 * performs the write without prompting.
 */

import { basename, join } from "node:path";
import {
  mondayFetch,
  printJson,
  writeFileWithBridge,
  slugifyName,
  resolveIdPrefixedEntry,
  resolveEpicFolder,
  findLinkColumnByTitle,
  findFirstLinkColumn,
  setLinkColumn,
} from "./monday-client.mjs";

const ITEM_FOR_INIT_QUERY = `
  query GetItemForInit($itemId: ID!) {
    items(ids: [$itemId]) {
      id
      name
      group { title }
      board { id columns { id title type } }
      subitems { id }
    }
  }
`;

const SUBITEM_FOR_INIT_QUERY = `
  query GetSubitemForInit($subitemId: ID!) {
    items(ids: [$subitemId]) {
      id
      name
      parent_item { id name group { title } }
      board { id columns { id title type } }
    }
  }
`;

/**
 * Build a best-effort `file://` URI for a Windows drive-letter path (e.g.
 * `G:\マイドライブ\...`), so the monday `link` column has something
 * clickable when opened on the machine the Drive folder is synced to.
 * @param {string} winPath
 * @returns {string}
 */
function toFileUri(winPath) {
  const posix = winPath.replace(/\\/g, "/");
  return "file:///" + posix.split("/").map(encodeURIComponent).join("/");
}

/** @param {string} name */
function acceptanceTemplate(name) {
  return `# 受入基準: ${name}\n\n- [ ] \n\n## メモ\n\n(記入してください)\n`;
}

/** @param {string} name */
function tasksTemplate(name) {
  return `# タスク一覧: ${name}\n\n- [ ] \n\n## メモ\n\n(記入してください)\n`;
}

/** @param {string} name */
function evidenceTemplate(name) {
  return (
    `# 検収エビデンス: ${name}\n\n` +
    "ここに動作確認（検収）に使ったテスト内容・エビデンス" +
    "（スクリーンショット、ログ、テスト手順のメモなど）を格納してください。\n"
  );
}

/**
 * @param {string} itemId
 * @param {string} [epicFolderArg]
 */
async function runItemMode(itemId, epicFolderArg) {
  const data =
    /** @type {{ items?: Array<{ id: string, name: string, group?: { title: string }, board?: { id: string, columns: import("./monday-client.mjs").BoardColumn[] }, subitems?: Array<{ id: string }> }> }} */ (
      await mondayFetch(ITEM_FOR_INIT_QUERY, { itemId })
    );
  const item = data.items && data.items[0];
  if (!item || !item.board) {
    throw new Error(`monday: item ${itemId} not found or inaccessible`);
  }

  const epicFolder =
    epicFolderArg || (await resolveEpicFolder(item.group ? item.group.title : ""));
  if (!epicFolder) {
    throw new Error(
      `monday: no epicFolder given and no mondayEpics["${
        item.group ? item.group.title : ""
      }"] configured in \`.claude/scrum-context.json\`.`
    );
  }

  const hasSubitems = (item.subitems || []).length > 0;
  const pbiDir = resolveIdPrefixedEntry(
    join(epicFolder, "pbi"),
    item.id,
    slugifyName(item.name)
  );
  const pbiEntryName = basename(pbiDir);

  const acceptancePath = join(pbiDir, "acceptance.md");
  const acceptanceResult = writeFileWithBridge(
    acceptancePath,
    acceptanceTemplate(item.name),
    { skipIfExists: true }
  );

  const evidencePath = join(pbiDir, "evidence", "README.md");
  const evidenceResult = writeFileWithBridge(
    evidencePath,
    evidenceTemplate(item.name),
    { skipIfExists: true }
  );

  /** @type {{ path: string, skipped: boolean, bridge: boolean } | null} */
  let tasksInfo = null;
  let tasksPath = "";
  if (!hasSubitems) {
    tasksPath = join(pbiDir, "tasks.md");
    const result = writeFileWithBridge(tasksPath, tasksTemplate(item.name), {
      skipIfExists: true,
    });
    tasksInfo = {
      path: tasksPath,
      skipped: result.skipped,
      bridge: result.bridge,
    };
  }

  /** @type {Array<{ column: string, columnId: string }>} */
  const linksWritten = [];

  const acceptanceColId = findLinkColumnByTitle(
    item.board.columns,
    "Acceptance Criteria"
  );
  if (acceptanceColId) {
    await setLinkColumn(
      item.board.id,
      item.id,
      acceptanceColId,
      toFileUri(acceptancePath),
      `pbi/${pbiEntryName}/acceptance.md`
    );
    linksWritten.push({
      column: "Acceptance Criteria",
      columnId: acceptanceColId,
    });
  }

  if (!hasSubitems && tasksPath) {
    const tasksColId = findLinkColumnByTitle(item.board.columns, "Tasks");
    if (tasksColId) {
      await setLinkColumn(
        item.board.id,
        item.id,
        tasksColId,
        toFileUri(tasksPath),
        `pbi/${pbiEntryName}/tasks.md`
      );
      linksWritten.push({ column: "Tasks", columnId: tasksColId });
    }
  }

  printJson({
    mode: "item",
    itemId: item.id,
    pbiDir,
    hasSubitems,
    acceptance: {
      path: acceptancePath,
      skipped: acceptanceResult.skipped,
      bridge: acceptanceResult.bridge,
    },
    evidence: {
      path: evidencePath,
      skipped: evidenceResult.skipped,
      bridge: evidenceResult.bridge,
    },
    tasks: tasksInfo,
    linksWritten,
  });
}

/**
 * @param {string} subitemId
 * @param {string} [epicFolderArg]
 */
async function runSubitemMode(subitemId, epicFolderArg) {
  const data =
    /** @type {{ items?: Array<{ id: string, name: string, parent_item?: { id: string, name: string, group?: { title: string } } | null, board?: { id: string, columns: import("./monday-client.mjs").BoardColumn[] } }> }} */ (
      await mondayFetch(SUBITEM_FOR_INIT_QUERY, { subitemId })
    );
  const subitem = data.items && data.items[0];
  if (!subitem || !subitem.board) {
    throw new Error(`monday: subitem ${subitemId} not found or inaccessible`);
  }
  const parent = subitem.parent_item;
  if (!parent) {
    throw new Error(`monday: subitem ${subitemId} has no parent item`);
  }

  const epicFolder =
    epicFolderArg ||
    (await resolveEpicFolder(parent.group ? parent.group.title : ""));
  if (!epicFolder) {
    throw new Error(
      `monday: no epicFolder given and no mondayEpics["${
        parent.group ? parent.group.title : ""
      }"] configured in \`.claude/scrum-context.json\`.`
    );
  }

  const pbiDir = resolveIdPrefixedEntry(
    join(epicFolder, "pbi"),
    parent.id,
    slugifyName(parent.name)
  );
  const pbiEntryName = basename(pbiDir);

  const subTaskPath = resolveIdPrefixedEntry(
    join(pbiDir, "sub-tasks"),
    subitem.id,
    slugifyName(subitem.name),
    ".md"
  );
  const result = writeFileWithBridge(subTaskPath, tasksTemplate(subitem.name), {
    skipIfExists: true,
  });

  /** @type {Array<{ column: string, columnId: string }>} */
  const linksWritten = [];
  const linkColId = findFirstLinkColumn(subitem.board.columns);
  if (linkColId) {
    await setLinkColumn(
      subitem.board.id,
      subitem.id,
      linkColId,
      toFileUri(subTaskPath),
      `pbi/${pbiEntryName}/sub-tasks/${basename(subTaskPath)}`
    );
    linksWritten.push({ column: "link", columnId: linkColId });
  }

  printJson({
    mode: "subitem",
    subitemId: subitem.id,
    parentId: parent.id,
    pbiDir,
    subTask: {
      path: subTaskPath,
      skipped: result.skipped,
      bridge: result.bridge,
    },
    linksWritten,
  });
}

async function main() {
  const mode = process.argv[2];
  const id = process.argv[3];
  const epicFolderArg = process.argv[4];
  if (
    (mode !== "--item" && mode !== "--subitem") ||
    !id ||
    !/^\d+$/.test(id.trim())
  ) {
    process.stderr.write(
      "monday: usage: init-task.mjs --item <itemId> [epicFolder]\n" +
        "        init-task.mjs --subitem <subitemId> [epicFolder]\n" +
        "epicFolder falls back to `mondayEpics[<item's monday group>]` in " +
        "`.claude/scrum-context.json`.\n"
    );
    process.exit(2);
  }

  if (mode === "--item") {
    await runItemMode(id.trim(), epicFolderArg);
  } else {
    await runSubitemMode(id.trim(), epicFolderArg);
  }
}

main().catch((err) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + "\n"
  );
  process.exit(1);
});

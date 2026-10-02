/**
 * lint.mjs / diff.mjs — pin what each check does and, as importantly, what it
 * leaves alone. Both are pointers for a human or model, so a false alarm on
 * ordinary prose is the failure that matters.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffTexts } from "./diff.mjs";
import { lintText } from "./lint.mjs";

const rules = (text) => lintText(text).findings.map((f) => f.rule);

describe("lint", () => {
  it("passes plain prose", () => {
    expect(lintText("設定ファイルを読み込んで起動する。起動後はログを確認する。").isClean).toBe(true);
  });

  it("flags metaphor verbs, fillers and decoration", () => {
    expect(rules("通信が切れると静かに壊れる。")).toContain("metaphor_verb");
    expect(rules("結論から言うと、押すだけです。")).toContain("meta_filler");
    expect(rules("これは決まった方針に他なりません。")).toContain("meta_filler");
    expect(rules("完了しました 🎉")).toContain("emoji");
    expect(rules("認証――とりわけ認可――は慎重に扱う。")).toContain("em_dash");
    expect(rules("次の点に注意:")).toContain("trailing_colon");
    expect(rules("この README は、 yomiyasu で 作った。")).toContain("halfwidth_space");
  });

  it("reads ordinary words that are also AI favourites as info, not warn", () => {
    const f = lintText("設計の土台を決める。").findings;
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("info");
  });

  it("leaves code, quotes, tables and front matter alone", () => {
    const text = ["---", "title: 静かに壊れる", "---", "```", "静かに壊れる", "```", "> 静かに壊れる", "| 静かに壊れる |"].join("\n");
    expect(lintText(text).isClean).toBe(true);
  });

  it("flags the third same sentence ending in a row only", () => {
    expect(rules("これはAです。これはBです。")).not.toContain("sentence_end_repetition");
    expect(rules("これはAです。これはBです。これはCです。")).toContain("sentence_end_repetition");
  });

  it("reports negation as info only", () => {
    const f = lintText("目的は機能の追加ではなく使いやすさです。").findings;
    expect(f.map((x) => x.rule)).toEqual(["negative_parallelism"]);
    expect(f[0].severity).toBe("info");
  });
});

describe("diff", () => {
  it("is quiet when nothing moved", () => {
    const t = "設定を保存する。再起動する。";
    const d = diffTexts(t, t);
    expect(d.markers).toEqual([]);
    expect(d.newWords).toEqual([]);
    expect(d.lostWords).toEqual([]);
  });

  it("catches a duty added to a plain statement and a new word", () => {
    const d = diffTexts("設定を保存する。", "設定を保存する必要があります。ログも確認します。");
    expect(d.markers.map((m) => m.kind)).toContain("義務");
    expect(d.newWords).toContain("ログ");
  });

  it("catches a dropped condition word", () => {
    const d = diffTexts("認証に失敗した場合は再試行する。", "認証に失敗したら再試行する。");
    expect(d.markers.map((m) => m.kind)).toContain("条件");
  });

  it("notes a list turned into prose and merged paragraphs", () => {
    const d = diffTexts("- 保存する\n- 閉じる\n\n補足です。", "保存して閉じます。補足です。");
    expect(d.structure.join("\n")).toContain("箇条書き");
    expect(d.structure.join("\n")).toContain("段落");
  });

  it("points at connectives and demonstratives in the rewrite", () => {
    const d = diffTexts("設定を変えた。再起動が要る。", "設定を変えた。ただし、再起動が要る。これは重要だ。");
    expect(d.logic.map((p) => p.kind)).toEqual(expect.arrayContaining(["文頭のつなぎ", "文頭の指示語"]));
  });
});

describe("command line", () => {
  const dir = mkdtempSync(join(os.tmpdir(), "nj-"));
  const lint = fileURLToPath(new URL("./lint.mjs", import.meta.url));
  const diff = fileURLToPath(new URL("./diff.mjs", import.meta.url));

  it("exits 1 under --strict when a warn exists, 0 otherwise", () => {
    const bad = join(dir, "bad.md");
    const good = join(dir, "good.md");
    writeFileSync(bad, "静かに壊れる。");
    writeFileSync(good, "動かなくなる。");
    expect(() => execFileSync("node", [lint, bad, "--strict"], { stdio: "pipe" })).toThrow();
    expect(execFileSync("node", [lint, good, "--strict"], { encoding: "utf8" })).toContain("指摘なし");
  });

  it("diff prints candidates for two files", () => {
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    writeFileSync(a, "保存する。");
    writeFileSync(b, "保存してください。");
    expect(execFileSync("node", [diff, a, b], { encoding: "utf8" })).toContain("依頼");
  });
});

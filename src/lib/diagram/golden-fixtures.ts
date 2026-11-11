/**
 * One deliberately messy note per Kind (T-1219), the input of `golden.test.ts`.
 *
 * Each note is what a person or an agent might leave behind after hand-editing
 * in Obsidian: a missing id, a duplicate id, another kind's id, a mark this
 * build does not know, a malformed `@`, an arrow to nowhere, a duplicate pair,
 * a stray line, an unknown section. The test pins what every Kind makes of it
 * (the parsed model and the text written back), so the note grammar can move
 * into a shared module without a single saved file changing meaning.
 *
 * Add a case here when a new quirk is found; never edit one to make a refactor
 * pass - a changed snapshot is a changed file format.
 */
import { parseAlgorithm, serializeAlgorithm, warningCount as algorithmWarnings } from "./algorithm/parse";
import {
  parseArchitecture,
  serializeArchitecture,
  warningCount as architectureWarnings,
} from "./architecture/parse";
import { parseFlow, serializeFlow, warningCount as flowWarnings } from "./flow/parse";
import { parseIfdam, serializeIfdam, warningCount as ifdamWarnings } from "./ifdam/parse";
import { parseMatrix, serializeMatrix, warningCount as matrixWarnings } from "./matrix2x2/parse";
import { parsePfd, serializePfd, warningCount as pfdWarnings } from "./pfd/parse";
import { parseUsecase, serializeUsecase, warningCount as usecaseWarnings } from "./usecase/parse";

export interface GoldenCase {
  content: string;
  parse(content: string, fallbackTitle: string): unknown;
  serialize(source: string, doc: never, today: string): string;
  warnings(doc: never): number;
}

const FLOW = `---
type: flow
title: 見積フロー
owner: someone
stickies: hidden
created: 2026-10-01
---

## Lanes

- L-001 営業 #blue
- 経理
- L-003 開発 #nocolor
  indented line under a lane
a line that is not a list item
- F-099 a step id under Lanes

## Steps

- F-001 受注 ^start lane:L-001 @120,0
  メモ一行目
  メモ二行目
- 見積を作る lane:L-001 task:T-0100 #green
- F-001 重複した id ^decision lane:L-009
- X-005 another kind's element
- F-004 完了 ^end @malformed
- ^unknown mark stays #nocolor @1,2
free text under steps

## Edges

- F-001 -> F-002 "承認"
- F-001 -> F-002 "duplicate"
- F-002 -> F-002
- F-001:E@0.5 -> F-004:W "a "quoted" label"
- F-001 -> F-777
- garbage line

## Stickies

- S-001 node:F-001 @32,24 #amber 要確認
  second line
- S-002 node:F-404 @1,2 orphan
- not a sticky

## Memo

kept byte for byte

## Unknown

- also kept
`;

const PFD = `---
type: pfd
title: 開発の流れ
created: 2026-10-09
---

## Nodes

- P-001 要件を整理する @120,160
  定義書の要点。
  二行目。
- D-001 要件定義書 task:T-0100 #amber @360,160
- 設計する
- P-001 duplicate id
- Q-001 a prefix that is not a symbol
- D-002 設計書 @-40,-12
- N-001 another kind's id? (kept raw)
plain text

## Edges

- P-001 -> D-001
- P-001 -> D-001
- D-001 -> P-002
- P-001:E@0.5 -> D-002:W
- P-001 -> P-001
- P-001 -> Q-001
- P-001 -> D-001 "a label this kind cannot read"
- P-001 -> X-999

## Stickies

- S-001 node:D-001 @32,24 note

## Memo

memo
`;

const ALGORITHM = `---
type: algorithm
title: 在庫引当
direction: LR
---

## Nodes

- A-001 開始 ^start @0,0
- A-002 在庫を引き当てる ^sub task:T-0100 #blue
  メモ
- 入力を読む ^io
- A-002 duplicate ^doc
- A-005 unknown ^bogus mark @x,y
- A-006 終了 ^end
- F-001 flow id kept raw
stray

## Edges

- A-001 -> A-002
- A-002 -> A-006 "ok"
- A-002 -> A-006
- A-002 -> A-006 "later label"
- A-001:S@0.25 -> A-005:N "ports"
- A-001 -> A-404
- A-006 -> A-006
- nonsense

## Stickies

- S-001 node:A-002 @10,10 memo

## Memo

keep
`;

const IFDAM = `---
type: ifdam
title: Todo 登録
---

## Nodes

- V-001 一覧画面 ^screen @0,0
  show: Todo の一覧
  input: 検索語
  action: 追加を押す
  show:
  ただのメモ
  action: 削除する
- V-002 登録する ^trigger task:T-0100
  show: not an item on a trigger
  memo line
- V-003 DB ^store #green
- 保存済み ^message
- V-001 duplicate screen ^screen
  input: second
- V-009 mark ^unknown stays @1,2
- A-001 another kind
stray

## Edges

- V-001 -> V-002 "押下"
- V-001 -> V-002
- V-002 -> V-003 "later"
- V-003:W@0.2 -> V-001:E
- V-001 -> V-404
- V-002 -> V-002

## Stickies

- S-001 node:V-001 @10,10 a
- S-002 node:V-404 @10,10 gone

## Memo

memo
`;

const USECASE = `---
type: usecase
title: 問い合わせ
---

## Nodes

- U-001 利用者 ^person @0,0
  ログインする
  問い合わせる
- U-002 窓口システム ^system task:T-0100 #blue
  hover memo
- 外部メール ^ext
- U-002 duplicate id
- U-009 mark ^unknown stays
- V-001 another kind
stray

## Edges

- U-001 -- U-002 "利用"
- U-002 -> U-001
- U-001 -> U-003 "矢印"
- u-001 -- U-003
- U-002 -- U-003 "two"
- U-003 -- U-002 "reverse duplicate"
- U-001 -- U-404
- U-001 -- U-001
- U-001:E -> U-002

## Stickies

- S-001 node:U-001 @10,10 hi

## Memo

memo
`;

const ARCHITECTURE = `---
type: architecture
title: 構成
---

## Frames

- G-001 Client side #blue
  frame memo
- G-002 Server @10,20 frame:G-001
- 空の枠 @5,5 #nocolor
- G-001 duplicate frame
- C-001 a node id under Frames
stray frame line

## Nodes

- C-001 Screen frame:G-001 ^round task:T-0100 #green @640,260
  node memo
- C-002 API frame:G-002 ^block icon:server
- C-003 DB frame:G-404 ^db
- 外部 ^cloud
- C-001 duplicate ^user
- C-009 mark ^unknown stays icon: frame:
- G-009 another kind
stray

## Edges

- C-001 -> C-002 "call"
- C-002 -> C-001
- C-001 <-> C-003 "both"
- C-003 <-> C-001
- C-001 -> C-002
- C-001:E@0.5 -> C-003:W "ports"
- C-002 -- C-003
- C-001 -> C-404
- C-001 -> C-001

## Stickies

- S-001 node:G-001 @10,10 on a frame
- S-002 node:C-002 @10,10 on a block
- S-003 node:C-404 @10,10 gone

## Memo

memo
`;

const MATRIX = `---
type: matrix2x2
title: 施策の優先度
x_axis: "工数"
x_low: 小
x_high: 大
y_axis: 効果
y_low: 小
y_high: 大
q_tl: 先にやる
q_br: やらない
stickies: hidden
---

## Items

- M-001 タブの並び替え @0.20,0.85 #green task:T-0684
  メモ
- 位置なし #amber
- M-001 duplicate @2,-1
- M-004 malformed @0.5 #nocolor task:
- M-005 precise @0.123,0.987
- N-001 another kind
stray

## Quadrants

- q_tl 左上のメモ
  - nested bullet
- q_tl second entry for the same quadrant
- q_zz unknown key
loose line

## Stickies

- S-001 node:M-001 @10,10 s

## Memo

memo
`;

export const GOLDEN: Record<string, GoldenCase> = {
  flow: {
    content: FLOW,
    parse: parseFlow,
    serialize: serializeFlow as GoldenCase["serialize"],
    warnings: flowWarnings as GoldenCase["warnings"],
  },
  pfd: {
    content: PFD,
    parse: parsePfd,
    serialize: serializePfd as GoldenCase["serialize"],
    warnings: pfdWarnings as GoldenCase["warnings"],
  },
  algorithm: {
    content: ALGORITHM,
    parse: parseAlgorithm,
    serialize: serializeAlgorithm as GoldenCase["serialize"],
    warnings: algorithmWarnings as GoldenCase["warnings"],
  },
  ifdam: {
    content: IFDAM,
    parse: parseIfdam,
    serialize: serializeIfdam as GoldenCase["serialize"],
    warnings: ifdamWarnings as GoldenCase["warnings"],
  },
  usecase: {
    content: USECASE,
    parse: parseUsecase,
    serialize: serializeUsecase as GoldenCase["serialize"],
    warnings: usecaseWarnings as GoldenCase["warnings"],
  },
  architecture: {
    content: ARCHITECTURE,
    parse: parseArchitecture,
    serialize: serializeArchitecture as GoldenCase["serialize"],
    warnings: architectureWarnings as GoldenCase["warnings"],
  },
  matrix2x2: {
    content: MATRIX,
    parse: parseMatrix,
    serialize: serializeMatrix as GoldenCase["serialize"],
    warnings: matrixWarnings as GoldenCase["warnings"],
  },
};

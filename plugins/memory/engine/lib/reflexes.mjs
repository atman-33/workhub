// The reflexes: how a session is expected to *use* memory.
//
// Everything else in this plugin builds the record. This is the part that gets
// it read. Without it, whether memory is consulted depends on whether the
// agent happens to think of it — which, in a long session about something
// else, it does not. A store nobody queries is the same as no store.
//
// Where this lives, and why not an output style
// ---------------------------------------------
// Claude Code output styles are the obvious home — they sit in the system
// prompt, so they never fade — but only one can be active at a time, and it is
// a global choice. Taking that slot would mean memory competing with whatever
// the owner actually wants their sessions to sound like, which is a bad trade
// for a plugin that is supposed to be switchable on its own.
//
// So: the full text once at SessionStart, and a single line on each prompt
// after that. Cheap, and it survives compaction — which the SessionStart block
// on its own would not. The `persona` plugin already works this way here.
//
// Why not `.claude/rules/`
// ------------------------
// Rules are path-scoped and fire on touching a file: they say what is true
// about *the code being edited*. These fire unconditionally and say what is
// true about *the session*. Different trigger, different subject. Putting them
// in rules would mean memory advice arriving only while editing some
// particular directory, which is exactly when it is least relevant.

/** Where the owner's own writing standard lives, when they have written one. */
export const WRITING_NOTE = "memory/identity/writing.md";

const FULL = `## 記憶の使い方

長期記憶（\`memory/\`）と短期記憶（会話の逐語）がある。前者は時間をまたいで効くこと、
後者は直前に何をしていたか。以下は指示ではなく反射として扱う。

**答える前に引く。** 「前にどう決めたか」「どこまでやったか」「同じ失敗をしていないか」
に答えるときは、訓練データや今の文脈からではなく先に記憶を検索する。答えに形が
あるなら構造化クエリを使う（未決の判断なら \`type: decision\` + \`status: open\`、
進行中なら \`type: session\` + \`status: open\`）。形が無い開かれた問いのときだけ
意味検索に落ちる。

**本物の判断はその場で書く。** 選択肢と理由のある判断だけ。雑談や一度きりの好みは
入れない。書くときは \`type: decision\` を刻む——型の無いノートは構造化リコールから
見えないので、書いたのに次から見つからない。1つの判断につき1ノート。

**出典を指す。** 過去の作業に言及するときはノートを指し、記憶から言い換えない。
引用できるものを要約で置き換えると、確かめられなくなる。

**記憶が食い違ったら、黙ってどちらかを採らない。** auto-memory と \`memory/\` が
矛盾したとき、あるいはノート同士が矛盾したときは、衝突していることを明示する。

**証拠の境界。** 実行していないテストを「通った」と書かない。意図・影響・検証・判断を
でっち上げない。不確かなら不確かと書く。記憶に嘘が1件入ると、その層全体が信用を失う。

**過剰に書かない。** 残す価値のあるものだけ。走行サマリは短期記憶が持っている。`;

const SHORT =
  "（記憶: 過去の判断や進捗に触れる前に `memory/` を検索。本物の判断は `type: decision` で記録し、出典を指す）";

/**
 * The reflexes, or "" when there is nothing to reflect against.
 *
 * A vault with no store gets no text: advice about searching a folder that is
 * not there is noise, and noise in an opening block is how a session learns to
 * skim it.
 *
 * @param {object} options
 * @param {boolean} options.hasStore
 * @param {boolean} [options.hasWritingNote] the owner has their own standard
 */
export function reflexes({ hasStore = false, hasWritingNote = false } = {}) {
  if (!hasStore) return "";
  const blocks = [FULL];
  if (hasWritingNote) {
    // The standard is a note the owner edits, not a constant in here: how they
    // want their memory written is theirs to decide, and a preference that
    // needs a release to change is a preference nobody adjusts.
    blocks.push(
      `ノートを書くときは \`${WRITING_NOTE}\` の基準に従う。オーナーが編集するノートで、` +
        `声と粒度はそこが正。`,
    );
  }
  return blocks.join("\n\n");
}

/** The per-prompt reminder. One line, because it is paid for on every turn. */
export function reflexReminder({ hasStore = false } = {}) {
  return hasStore ? SHORT : "";
}

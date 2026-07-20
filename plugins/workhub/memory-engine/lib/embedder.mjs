// Local text embedding via transformers.js (ONNX, CPU). Model files are
// cached under ENGINE_HOME/models by setup, so hooks never download.
//
// The ONNX conversion repo (onnx-community) ships only the model weights,
// so the tokenizer is loaded from the original cl-nagoya repo and pooling
// (attention-masked mean + L2 normalize, per the model's sentence-
// transformers config) is done here by hand.
//
// Ruri v3 distinguishes documents from queries by prefix:
//   documents: "文章: " + text   /   queries: "クエリ: " + text
import { loadTransformers } from "./deps.mjs";
import { MODELS_DIR } from "./paths.mjs";

export const MODEL_ID = "onnx-community/ruri-v3-310m-ONNX";
const TOKENIZER_ID = "cl-nagoya/ruri-v3-310m";
export const MODEL_DTYPE = "q8";
export const MODEL_DIMS = 768;
const DOC_PREFIX = "文章: ";
const QUERY_PREFIX = "クエリ: ";

// Giant pasted blobs (skill dumps etc.) make a single chunk balloon to the
// model's 8k-token limit and take 20s+ per item on CPU. The full text is
// already in FTS5; the head is enough for the vector to capture the topic.
const MAX_EMBED_CHARS = 2000;

// Small batches keep padding waste bounded when long and short texts mix.
const BATCH_SIZE = 4;

let loaded = null;

async function getModel({ localOnly = true } = {}) {
  if (!loaded) {
    loaded = (async () => {
      const tf = await loadTransformers();
      if (!tf) throw new Error("transformers.js not installed — run memory-setup");
      tf.env.cacheDir = MODELS_DIR;
      // Hooks must never hit the network; only setup downloads the model.
      tf.env.allowRemoteModels = !localOnly;
      const tokenizer = await tf.AutoTokenizer.from_pretrained(TOKENIZER_ID);
      const model = await tf.AutoModel.from_pretrained(MODEL_ID, { dtype: MODEL_DTYPE });
      return { tokenizer, model };
    })();
  }
  return loaded;
}

/** Attention-masked mean pooling + L2 normalization. */
function poolBatch(lastHiddenState, attentionMask) {
  const [n, seqLen, dims] = lastHiddenState.dims;
  const hidden = lastHiddenState.data;
  const mask = attentionMask.data;
  const vectors = [];
  for (let i = 0; i < n; i += 1) {
    const vec = new Array(dims).fill(0);
    let count = 0;
    for (let t = 0; t < seqLen; t += 1) {
      if (Number(mask[i * seqLen + t]) === 0) continue;
      count += 1;
      const base = (i * seqLen + t) * dims;
      for (let d = 0; d < dims; d += 1) vec[d] += Number(hidden[base + d]);
    }
    let norm = 0;
    for (let d = 0; d < dims; d += 1) {
      vec[d] /= count || 1;
      norm += vec[d] * vec[d];
    }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dims; d += 1) vec[d] /= norm;
    vectors.push(vec);
  }
  return vectors;
}

async function encode(texts, opts = {}) {
  const { tokenizer, model } = await getModel(opts);
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const inputs = tokenizer(batch, { padding: true, truncation: true });
    const output = await model(inputs);
    vectors.push(...poolBatch(output.last_hidden_state, inputs.attention_mask));
  }
  return vectors;
}

/** Document-side embedding (used when storing chunks). */
export async function embedDocs(texts, opts = {}) {
  return encode(
    texts.map((t) => DOC_PREFIX + t.slice(0, MAX_EMBED_CHARS)),
    opts,
  );
}

/** Query-side embedding (used when searching). */
export async function embedQuery(text, opts = {}) {
  const [vec] = await encode([QUERY_PREFIX + text.slice(0, MAX_EMBED_CHARS)], opts);
  return vec;
}

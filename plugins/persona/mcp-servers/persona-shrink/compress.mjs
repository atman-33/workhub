// persona-shrink — prose compressor for MCP descriptions.
//
// Derived from genshijin-shrink (MIT, InterfaceX-co-jp)
// https://github.com/InterfaceX-co-jp/genshijin
//
// Compresses natural language while protecting code, URLs, paths, identifiers
// and version numbers. Character-agnostic by construction: this rewrites the
// tool catalogue the model reads, not anything the model says.

const FILLERS = /\b(?:just|really|basically|actually|simply|quite|very|essentially|literally)\b/gi;
const PLEASANTRIES = /\b(?:please|kindly|thank you|thanks|sure|certainly|of course|happy to|i'?d be happy)\b[,.]?\s*/gi;
const HEDGES = /\b(?:perhaps|maybe|might|could potentially|would like to|i think|in my opinion|it seems|it appears)\b\s*/gi;
const LEADERS = /^(?:i'?ll|i will|i can|i'?d|you can|we will|we can|let me|let'?s)\s+/gim;
const ARTICLES = /\b(?:a|an|the)\s+(?=[a-z])/gi;

const JA_KEIGO = /(?:です|ます|でした|ました|でしょう|ましょう|ございます|ください|くださいませ)(?=[。、！？\s]|$)/g;
const JA_CUSHION = /(?:基本的に|一応|とりあえず|ざっくり言うと|ちなみに|要するに|まあ|えーと|あのー)/g;
const JA_PREAMBLE = /(?:ご質問ありがとうございます|お力になれれば幸いです|お調べしたところ|ご確認いただけ(?:ますでしょう|たら)|よろしくお願いします)[、。]?/g;
const JA_HEDGE = /(?:かもしれません|と思われます|と思います|おそらく|たぶん|多分)(?=[。、！？\s]|$)/g;
const JA_FORMAL_NOUN = /(?:すること|するもの|するため)/g;

const PROTECTED_PATTERNS = [
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /\bhttps?:\/\/\S+/gi,
  /\b[\w.-]*[/\\][\w./\\-]+/g,
  /\b[A-Z][A-Za-z0-9]*(?:_[A-Z][A-Za-z0-9]*)+\b/g,
  /\b\w+\.\w+(?:\.\w+)*\(\)?/g,
  /[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)/g,
  /\b\d+\.\d+\.\d+\b/g,
];

const MAX_RESTORE_PASSES = 8;
const SENTINEL_OPEN = String.fromCharCode(0xe000);
const SENTINEL_CLOSE = String.fromCharCode(0xe001);

export function withProtectedSegments(text, transform) {
  const segments = [];
  let sentinelPrefix;
  do {
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    sentinelPrefix = `${SENTINEL_OPEN}${nonce}:`;
  } while (text.includes(sentinelPrefix));

  const sentinelPattern = new RegExp(`${sentinelPrefix}(\\d+)${SENTINEL_CLOSE}`, 'g');
  const spacedSentinelPattern = new RegExp(
    `[ \\t]*${sentinelPrefix}(\\d+)${SENTINEL_CLOSE}[ \\t]*`,
    'g'
  );

  let working = text;
  for (const pattern of PROTECTED_PATTERNS) {
    working = working.replace(pattern, (match) => {
      const index = segments.length;
      segments.push(match);
      return ` ${sentinelPrefix}${index}${SENTINEL_CLOSE} `;
    });
  }

  let out = transform(working);
  for (let pass = 0; pass < MAX_RESTORE_PASSES; pass++) {
    sentinelPattern.lastIndex = 0;
    if (!sentinelPattern.test(out)) break;
    spacedSentinelPattern.lastIndex = 0;
    out = out.replace(spacedSentinelPattern, (match, index) => {
      const numericIndex = Number(index);
      return Number.isInteger(numericIndex) && numericIndex < segments.length
        ? segments[numericIndex]
        : match;
    });
  }
  return out;
}

function compressProse(text) {
  let result = text;
  result = result.replace(LEADERS, '');
  result = result.replace(PLEASANTRIES, '');
  result = result.replace(HEDGES, '');
  result = result.replace(FILLERS, '');
  result = result.replace(ARTICLES, '');
  result = result.replace(JA_PREAMBLE, '');
  result = result.replace(JA_CUSHION, '');
  result = result.replace(JA_HEDGE, '');
  result = result.replace(JA_KEIGO, '');
  result = result.replace(JA_FORMAL_NOUN, '');
  result = result.replace(/[ \t]{2,}/g, ' ');
  result = result.replace(/\s+([,.;:!?])/g, '$1');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.replace(/(^|[.!?]\s+)([a-z])/g, (_, prefix, char) => prefix + char.toUpperCase());
  return result.trim();
}

export function compress(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { compressed: text, before: 0, after: 0 };
  }
  const before = text.length;
  const compressed = withProtectedSegments(text, compressProse);
  return { compressed, before, after: compressed.length };
}

export function compressDescriptionsInPlace(obj, fieldNames) {
  const fields = new Set(fieldNames || ['description']);
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) compressDescriptionsInPlace(item, [...fields]);
    return;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (fields.has(key) && typeof value === 'string') {
      obj[key] = compress(value).compressed;
    } else if (value && typeof value === 'object') {
      compressDescriptionsInPlace(value, [...fields]);
    }
  }
}

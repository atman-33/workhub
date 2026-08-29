// persona-shrink — MCP stdio middleware.
//
// Derived from genshijin-shrink (MIT, InterfaceX-co-jp)
// https://github.com/InterfaceX-co-jp/genshijin
//
// Wraps one upstream MCP server and compresses the prose fields of its
// catalogue responses, so the model spends fewer tokens reading the tool list.
// Tool semantics are unchanged.
//
//   node index.mjs <upstream-command> [...args]
//
// This is a proxy over a single upstream, so it needs one mcpServers entry per
// server you want compressed — the plugin cannot register a generic one.
//
//   "mcpServers": {
//     "context7-shrunk": {
//       "command": "node",
//       "args": [
//         "<pluginRoot>/mcp-servers/persona-shrink/index.mjs",
//         "npx", "-y", "@upstash/context7-mcp"
//       ]
//     }
//   }
//
// Environment:
//   PERSONA_SHRINK_FIELDS   comma-separated field names (default: description)
//   PERSONA_SHRINK_DEBUG=1  log per-field byte deltas to stderr
//
// Deliberately conservative, and unchanged from the original in this respect:
//   - requests to the upstream pass through untouched
//   - tools/call responses pass through untouched, so data the upstream returns
//     to the model is never silently rewritten
//   - identifiers, URLs, paths and code-like tokens are protected inside prose

import { spawn } from 'node:child_process';
import { compress, compressDescriptionsInPlace } from './compress.mjs';

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('persona-shrink: upstream command が指定されていません。\n');
  process.stderr.write('usage: node index.mjs <upstream-command> [...args]\n');
  process.exit(2);
}

const debug = process.env.PERSONA_SHRINK_DEBUG === '1';
const fields = (process.env.PERSONA_SHRINK_FIELDS || 'description')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// cross-spawn is avoided so the plugin needs no npm install. On Windows a bare
// command name like `npx` resolves only through the shell, so the whole command
// line is quoted and handed over as a single string — passing separate args
// alongside shell:true is deprecated (DEP0190) because they are concatenated
// unescaped.
const useShell = process.platform === 'win32';
const quote = (value) => (/[\s"^&|<>()]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

const upstream = useShell
  ? spawn(args.map(quote).join(' '), {
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
    shell: true,
  })
  : spawn(args[0], args.slice(1), {
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });

upstream.on('error', (err) => {
  process.stderr.write(`persona-shrink: upstream の起動に失敗しました: ${err.message}\n`);
  process.exit(1);
});

upstream.on('exit', (code, signal) => {
  if (signal) process.exit(128 + (signal === 'SIGTERM' ? 15 : 9));
  process.exit(code || 0);
});

function makeLineBuffer(onLine) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) onLine(line);
    }
  };
}

function transformResponse(msg) {
  if (!msg || !msg.result || typeof msg.result !== 'object') return msg;
  const result = msg.result;
  let compressedSomething = false;

  for (const arrayName of ['tools', 'prompts', 'resources', 'resourceTemplates']) {
    if (!Array.isArray(result[arrayName])) continue;
    for (const item of result[arrayName]) {
      for (const field of fields) {
        if (typeof item[field] !== 'string') continue;
        const before = item[field];
        const after = compress(before).compressed;
        if (after === before) continue;
        item[field] = after;
        compressedSomething = true;
        if (debug) {
          process.stderr.write(
            `[persona-shrink] ${arrayName}.${item.name || '?'}.${field}: ` +
            `${before.length}→${after.length} bytes\n`
          );
        }
      }
    }
  }

  // Some servers bury descriptions in nested schemas. Only walk when nothing
  // matched at the top level, to avoid compressing the same string twice.
  if (!compressedSomething) compressDescriptionsInPlace(result, fields);

  return msg;
}

upstream.stdout.on('data', makeLineBuffer((line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    process.stdout.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(transformResponse(msg))}\n`);
}));

process.stdin.on('data', (chunk) => upstream.stdin.write(chunk));
process.stdin.on('end', () => upstream.stdin.end());

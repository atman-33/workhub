#!/usr/bin/env node
/**
 * self-check.mjs — verify a generated diagram file before handing it over.
 *
 *   node self-check.mjs diagram.html [more.html ...]
 *
 * Checks three things a reviewer cannot see by looking at the picture:
 *
 *   1. The accessible-SVG contract — role, title first, filled title and desc,
 *      prefixed ids, aria-labelledby naming them in order.
 *   2. Single-file safety — no remote resource except the Google Fonts
 *      stylesheet, no executable attributes, no script (diagrams are static).
 *   3. Diagonal connectors — a <line> whose endpoints share neither x nor y
 *      breaks the first connector rule, and it is the one rule a machine can
 *      settle outright.
 *
 * Ported from diagram-design's self_check.py (MIT). Plugin scripts in this
 * repository run on node, so the Python original could not ship as-is; the
 * motion contract it also checked has no counterpart here, since these
 * diagrams are static by definition.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const REFERENCE_ATTRS = new Set(['src', 'href', 'xlink:href', 'poster', 'srcset', 'action', 'formaction']);
const FORBIDDEN_TAGS = new Set(['base', 'embed', 'object', 'iframe']);

// ------------------------------------------------------------------ parsing

const TAG = /<(\/?)([a-zA-Z][-\w:]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const ATTR = /([-\w:@.]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttributes(raw) {
  const attrs = {};
  const order = [];
  ATTR.lastIndex = 0;
  let match;
  while ((match = ATTR.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
    order.push(name);
  }
  return { attrs, order };
}

/**
 * Walk the tag stream. This is not a conforming HTML parser and does not need
 * to be: everything checked here is decided by tag order and attributes.
 */
function parseDocument(source) {
  const doc = {
    unsafe: [],
    references: [],
    scripts: [],
    svgs: [],
    lines: [],
  };

  let svgDepth = 0;
  let current = null;
  let capture = null;
  let captureStart = 0;

  TAG.lastIndex = 0;
  let match;
  while ((match = TAG.exec(source)) !== null) {
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const selfClosing = match[4] === '/';

    if (closing) {
      if (capture && tag === capture.name) {
        capture.node.text = source.slice(captureStart, match.index);
        capture = null;
      }
      if (svgDepth > 0) {
        svgDepth -= 1;
        if (svgDepth === 0) current = null;
      }
      continue;
    }

    const { attrs, order } = parseAttributes(match[3]);

    if (FORBIDDEN_TAGS.has(tag)) {
      doc.unsafe.push(`<${tag}> is not allowed in a diagram file`);
    }
    for (const name of order) {
      if (name.startsWith('on')) doc.unsafe.push(`executable attribute ${name} on <${tag}>`);
      if (name === 'srcdoc') doc.unsafe.push(`srcdoc attribute on <${tag}>`);
      if (REFERENCE_ATTRS.has(name)) doc.references.push({ tag, rel: attrs.rel ?? '', value: attrs[name] });
    }

    if (tag === 'script') doc.scripts.push({ attrs });
    if (tag === 'line' && svgDepth > 0) doc.lines.push(attrs);

    if (tag === 'svg' && svgDepth === 0) {
      svgDepth = 1;
      current = { attrs, first: null, title: null, desc: null };
      doc.svgs.push(current);
      continue;
    }

    if (svgDepth > 0) {
      const childDepth = svgDepth;
      if (!selfClosing) svgDepth += 1;
      if (childDepth === 1 && current) {
        if (current.first === null) current.first = tag;
        if (tag === 'title' || tag === 'desc') {
          const node = { attrs, text: '' };
          current[tag] = node;
          if (!selfClosing) {
            capture = { name: tag, node };
            captureStart = TAG.lastIndex;
          }
        }
      }
    }
  }

  return doc;
}

// ------------------------------------------------------------------- checks

function isApprovedFontsStylesheet(value) {
  let url;
  try {
    url = new URL(value, 'https://example.invalid');
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.hostname.toLowerCase() === 'fonts.googleapis.com' &&
    url.port === '' &&
    url.pathname === '/css2' &&
    url.hash === ''
  );
}

const FONT_ORIGINS = new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);

function referenceError({ tag, rel, value }) {
  const stripped = (value ?? '').trim();
  const lowered = stripped.toLowerCase();
  if (!stripped || stripped.startsWith('#')) return null;

  // A preconnect or dns-prefetch to the font origins fetches nothing on its
  // own; it only opens the connection the approved stylesheet will use.
  const rels = rel.toLowerCase().split(/\s+/);
  if (tag === 'link' && (rels.includes('preconnect') || rels.includes('dns-prefetch'))) {
    if (FONT_ORIGINS.has(lowered.replace(/\/$/, ''))) return null;
    return `preconnect is only allowed to the font origins: ${stripped.slice(0, 80)}`;
  }
  if (lowered.startsWith('javascript:') || lowered.startsWith('data:text/html')) {
    return `executable URL on <${tag}>: ${stripped.slice(0, 80)}`;
  }
  const scheme = stripped.split('/', 1)[0];
  const remote = /^(https?:)?\/\//.test(lowered) || (scheme.includes(':') && !lowered.startsWith('data:'));
  if (!remote) {
    if (lowered.startsWith('data:') && !lowered.startsWith('data:image/')) {
      return `non-image data URL on <${tag}>: ${stripped.slice(0, 80)}`;
    }
    return null;
  }
  if (tag === 'link' && rel.toLowerCase().split(/\s+/).includes('stylesheet')) {
    if (isApprovedFontsStylesheet(stripped)) return null;
    return `remote stylesheet is not the approved Google Fonts /css2 URL: ${stripped.slice(0, 80)}`;
  }
  return `remote reference on <${tag}>: ${stripped.slice(0, 80)}`;
}

function checkSvgs(doc, errors) {
  const checkable = doc.svgs.filter((svg) => (svg.attrs['aria-hidden'] ?? '').toLowerCase() !== 'true');
  if (checkable.length === 0) {
    errors.push('the file needs at least one accessible (non-aria-hidden) svg');
    return;
  }
  checkable.forEach((svg, index) => {
    const n = index + 1;
    if (svg.attrs.role !== 'img') errors.push(`svg ${n} needs role="img"`);
    if (svg.first !== 'title') errors.push(`svg ${n}: <title> must be its first child, before <defs>`);

    const title = svg.title;
    const desc = svg.desc;
    if (!title || !title.text.trim() || !desc || !desc.text.trim()) {
      errors.push(`svg ${n} needs a non-empty <title> and <desc>`);
      return;
    }
    const titleId = title.attrs.id ?? '';
    const descId = desc.attrs.id ?? '';
    if (!titleId || titleId === 'title' || !descId || descId === 'desc') {
      errors.push(`svg ${n}: title/desc ids must be diagram-prefixed, never bare "title"/"desc"`);
    }
    const labelled = (svg.attrs['aria-labelledby'] ?? '').trim().split(/\s+/).filter(Boolean);
    if (labelled.length !== 2 || labelled[0] !== titleId || labelled[1] !== descId) {
      errors.push(`svg ${n}: aria-labelledby must name the title then the desc ("${titleId} ${descId}")`);
    }
    if (desc.text.trim().length < 20) {
      errors.push(`svg ${n}: <desc> is too short to describe the content to a reader who cannot see it`);
    }
  });
}

function checkScripts(doc, errors) {
  if (doc.scripts.length > 0) {
    errors.push(`diagrams are static: found ${doc.scripts.length} <script> element(s)`);
  }
}

function checkConnectors(doc, errors) {
  for (const attrs of doc.lines) {
    const x1 = Number(attrs.x1);
    const y1 = Number(attrs.y1);
    const x2 = Number(attrs.x2);
    const y2 = Number(attrs.y2);
    if ([x1, y1, x2, y2].some(Number.isNaN)) continue;
    if (x1 !== x2 && y1 !== y2) {
      errors.push(
        `diagonal <line> (${x1},${y1}) to (${x2},${y2}): connectors between off-axis ` +
        'nodes must be rounded right-angle elbows',
      );
    }
  }
}

function verify(path) {
  const source = readFileSync(path, 'utf8');
  const doc = parseDocument(source);
  const errors = [...doc.unsafe];
  for (const reference of doc.references) {
    const finding = referenceError(reference);
    if (finding) errors.push(finding);
  }
  checkSvgs(doc, errors);
  checkScripts(doc, errors);
  checkConnectors(doc, errors);
  return errors;
}

// --------------------------------------------------------------------- main

const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (files.length === 0) {
  console.error(`usage: node ${basename(process.argv[1])} <diagram.html> [...]`);
  process.exit(2);
}

let failed = false;
for (const path of files) {
  let errors;
  try {
    errors = verify(path);
  } catch (error) {
    errors = [error.message];
  }
  if (errors.length > 0) {
    failed = true;
    console.log(`FAIL ${path}`);
    for (const error of errors) console.log(`  - ${error}`);
  } else {
    console.log(`OK   ${path}`);
  }
}
process.exit(failed ? 1 : 0);

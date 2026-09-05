#!/usr/bin/env node
/**
 * html-to-pdf.mjs — convert HTML to publication-quality PDF with Playwright.
 *
 *   node html-to-pdf.mjs [options] <input.html> [output.pdf]
 *   node html-to-pdf.mjs [options] <a.html> <b.html> <c.html>
 *
 * Two modes:
 *
 *   --mode page    (default) One document, paginated by Chromium. Honours
 *                  @page CSS, margins, bookmarks, header/footer templates.
 *                  Use for reports, one-pagers, anything built on
 *                  shared/html-skeleton.md.
 *
 *   --mode slides  One fixed-stage deck, one slide per PDF page. Each .slide
 *                  is shown in turn and captured at the stage resolution, then
 *                  the captures are assembled into a PDF. Print CSS cannot do
 *                  this: it paginates the slides at paper size in portrait, and
 *                  leaves every slide but the active one blank because their
 *                  entrance animations never ran.
 *
 * Playwright is resolved from the environment, and otherwise installed once
 * into a cache directory under the user's home. Nothing is installed into the
 * project being worked on.
 */

import { createServer } from 'node:http';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve as resolvePath, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLAYWRIGHT_VERSION = '1.49.1';
const CACHE_DIR = join(homedir(), '.workhub', 'visuals-playwright');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = {
    mode: 'page',
    format: 'A4',
    landscape: false,
    preferCssPageSize: false,
    outline: false,
    tagged: false,
    scale: 1,
    background: true,
    margins: {},
    headerTemplate: null,
    footerTemplate: null,
    width: 1920,
    height: 1080,
    quiet: false,
    files: [],
  };

  const takeValue = (name, value) => {
    if (value === undefined) {
      fail(`${name} needs a value`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--mode': opts.mode = takeValue(arg, argv[++i]); break;
      case '--format': opts.format = takeValue(arg, argv[++i]); break;
      case '--landscape': opts.landscape = true; break;
      case '--prefer-css-page-size': opts.preferCssPageSize = true; break;
      case '--outline': opts.outline = true; break;
      case '--tagged': opts.tagged = true; break;
      case '--scale': opts.scale = Number(takeValue(arg, argv[++i])); break;
      case '--no-background': opts.background = false; break;
      case '--margin-top': opts.margins.top = takeValue(arg, argv[++i]); break;
      case '--margin-right': opts.margins.right = takeValue(arg, argv[++i]); break;
      case '--margin-bottom': opts.margins.bottom = takeValue(arg, argv[++i]); break;
      case '--margin-left': opts.margins.left = takeValue(arg, argv[++i]); break;
      case '--header-template': opts.headerTemplate = takeValue(arg, argv[++i]); break;
      case '--footer-template': opts.footerTemplate = takeValue(arg, argv[++i]); break;
      case '--compact': opts.width = 1280; opts.height = 720; break;
      case '--width': opts.width = Number(takeValue(arg, argv[++i])); break;
      case '--height': opts.height = Number(takeValue(arg, argv[++i])); break;
      case '--quiet':
      case '-q': opts.quiet = true; break;
      case '--help':
      case '-h': printUsage(); process.exit(0); break;
      default:
        if (arg.startsWith('-')) fail(`unknown option: ${arg}`);
        opts.files.push(arg);
    }
  }

  // Chromium builds the outline out of the tagged structure tree, so --outline
  // on its own is silently ignored. Imply --tagged rather than emit a PDF with
  // no bookmarks in it.
  if (opts.outline) opts.tagged = true;

  if (opts.mode !== 'page' && opts.mode !== 'slides') {
    fail(`--mode must be "page" or "slides" (got "${opts.mode}")`);
  }
  if (opts.files.length === 0) {
    printUsage();
    process.exit(1);
  }
  return opts;
}

function printUsage() {
  console.log(`html-to-pdf.mjs — HTML to PDF via Playwright

  node html-to-pdf.mjs [options] <input.html> [output.pdf]

Mode
  --mode page|slides        page (default) paginates a document;
                            slides captures one .slide per page

Page layout (--mode page)
  --format FORMAT           A4 (default), Letter, Legal, A0-A6
  --landscape               landscape orientation
  --prefer-css-page-size    obey @page size and margins from the CSS
  --margin-top DIM          e.g. 2cm, 1in, 72pt
  --margin-right DIM
  --margin-bottom DIM
  --margin-left DIM
  --outline                 PDF bookmarks from h1-h6
  --tagged                  accessibility tags
  --scale N                 zoom factor (default 1.0)
  --no-background           omit background colours and images

Header / footer (--mode page)
  --header-template HTML
  --footer-template HTML    e.g. 'Page <span class="pageNumber"></span>'

Deck capture (--mode slides)
  --compact                 capture at 1280x720 instead of 1920x1080
  --width N / --height N    explicit capture size

Output
  --quiet, -q               suppress progress output`);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// --------------------------------------------------------------- playwright

async function loadChromium(quiet) {
  const tryImport = async (specifier) => {
    try {
      const mod = await import(specifier);
      return mod.chromium ?? mod.default?.chromium ?? null;
    } catch {
      return null;
    }
  };

  let chromium = await tryImport('playwright');
  if (chromium) return chromium;

  const cached = join(CACHE_DIR, 'node_modules', 'playwright', 'index.js');
  if (existsSync(cached)) {
    chromium = await tryImport(pathToFileURL(cached).href);
    if (chromium) return chromium;
  }

  if (!quiet) {
    console.log('Playwright is not available. Installing it once into');
    console.log(`  ${CACHE_DIR}`);
    console.log('This downloads Chromium and takes a minute on first run.');
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const stdio = quiet ? 'ignore' : 'inherit';

  // npm is npm.cmd on Windows, which since Node 20 cannot be spawned without a
  // shell — so the command goes through execSync as one quoted string.
  const quote = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  try {
    execSync(
      `npm install --no-save --prefix ${quote(CACHE_DIR)} playwright@${PLAYWRIGHT_VERSION}`,
      { stdio },
    );
  } catch {
    fail(
      'could not install Playwright automatically.\n' +
      '  Install it yourself and re-run:\n' +
      '    npm install -g playwright\n' +
      '    npx playwright install chromium',
    );
  }

  // The npm package does not always fetch the browser binaries, so ask its own
  // CLI to. That is plain JavaScript, so it needs no shell.
  const cli = join(CACHE_DIR, 'node_modules', 'playwright', 'cli.js');
  if (existsSync(cli)) {
    try {
      execFileSync(process.execPath, [cli, 'install', 'chromium'], { stdio });
    } catch {
      fail('Chromium could not be downloaded. Run: npx playwright install chromium');
    }
  }

  chromium = await tryImport(pathToFileURL(cached).href);
  if (!chromium) {
    fail('Playwright installed but could not be loaded. Try: npx playwright install chromium');
  }
  return chromium;
}

// ------------------------------------------------------------- static serve

/**
 * Serve the directory holding the HTML file over HTTP.
 *
 * A deck loaded over file:// cannot fetch webfonts or sibling assets in a
 * headless browser, so both modes go through a throwaway local server.
 */
async function serveDirectory(rootDir, indexFile) {
  const server = createServer((req, res) => {
    let requested;
    try {
      requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    const relative = requested === '/' ? indexFile : requested.replace(/^\/+/, '');
    const filePath = resolvePath(rootDir, relative);

    // Never serve outside the directory that was explicitly opened.
    if (filePath !== rootDir && !filePath.startsWith(rootDir + (process.platform === 'win32' ? '\\' : '/'))) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      if (!statSync(filePath).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    } catch {
      res.writeHead(404).end('Not found');
    }
  });

  const port = await new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port)));
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
}

// ------------------------------------------------------------------- modes

async function convertPage(chromium, inputPath, outputPath, opts) {
  const site = await serveDirectory(dirname(inputPath), basename(inputPath));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(site.url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    const pdfOptions = {
      path: outputPath,
      format: opts.format,
      landscape: opts.landscape,
      preferCSSPageSize: opts.preferCssPageSize,
      outline: opts.outline,
      tagged: opts.tagged,
      scale: opts.scale,
      printBackground: opts.background,
    };
    if (Object.keys(opts.margins).length > 0) pdfOptions.margin = opts.margins;
    if (opts.headerTemplate || opts.footerTemplate) {
      pdfOptions.displayHeaderFooter = true;
      pdfOptions.headerTemplate = opts.headerTemplate ?? '<span></span>';
      pdfOptions.footerTemplate = opts.footerTemplate ?? '<span></span>';
    }
    await page.pdf(pdfOptions);
  } finally {
    await browser.close();
    site.close();
  }
}

async function convertSlides(chromium, inputPath, outputPath, opts) {
  const site = await serveDirectory(dirname(inputPath), basename(inputPath));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
    await page.goto(site.url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);

    const slideCount = await page.evaluate(() => document.querySelectorAll('.slide').length);
    if (slideCount === 0) {
      fail(
        'no .slide elements found.\n' +
        '  --mode slides expects a fixed-stage deck whose slides carry class="slide".\n' +
        '  For an ordinary document use --mode page.',
      );
    }
    if (!opts.quiet) console.log(`  ${slideCount} slides`);

    const shots = [];
    for (let i = 0; i < slideCount; i++) {
      // Switch slides the way viewport-base.css does: classes only. Setting
      // display here would fight the deck's own layout rules.
      await page.evaluate((index) => {
        document.querySelectorAll('.slide').forEach((slide, idx) => {
          slide.classList.toggle('active', idx === index);
          slide.classList.toggle('visible', idx === index);
        });
        if (window.presentation && typeof window.presentation.showSlide === 'function') {
          window.presentation.showSlide(index);
        }
      }, i);

      // Entrance animations are keyed off .visible, so give them time, then
      // pin anything still mid-transition to its final state.
      await page.waitForTimeout(500);
      await page.evaluate((index) => {
        const slide = document.querySelectorAll('.slide')[index];
        if (!slide) return;
        slide.querySelectorAll('.reveal, [class*="reveal"]').forEach((el) => {
          el.style.opacity = '1';
          el.style.transform = 'none';
          el.style.filter = 'none';
          el.style.visibility = 'visible';
        });
      }, i);
      await page.waitForTimeout(120);

      shots.push(await page.screenshot({ fullPage: false }));
      if (!opts.quiet) console.log(`  captured ${i + 1}/${slideCount}`);
    }

    if (!opts.quiet) console.log('  assembling PDF');
    const pages = shots
      .map((buf) => `<div class="page"><img src="data:image/png;base64,${buf.toString('base64')}"></div>`)
      .join('\n');
    const assembly = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: ${opts.width}px ${opts.height}px; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .page { width: ${opts.width}px; height: ${opts.height}px; overflow: hidden; break-after: page; }
      .page:last-child { break-after: auto; }
      img { display: block; width: ${opts.width}px; height: ${opts.height}px; }
    </style></head><body>${pages}</body></html>`;

    const assembler = await browser.newPage();
    await assembler.setContent(assembly, { waitUntil: 'load' });
    await assembler.pdf({ path: outputPath, printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
    site.close();
  }
}

// -------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let files = opts.files;
  let outputOverride = null;
  if (files.length === 2 && files[1].toLowerCase().endsWith('.pdf')) {
    outputOverride = resolvePath(files[1]);
    files = [files[0]];
  }

  const inputs = files.map((f) => {
    const p = resolvePath(f);
    if (!existsSync(p)) fail(`${p} not found`);
    if (!/\.html?$/i.test(p)) console.error(`Warning: ${p} does not look like an HTML file`);
    return p;
  });

  const chromium = await loadChromium(opts.quiet);
  const started = Date.now();

  for (const [index, input] of inputs.entries()) {
    const output = inputs.length === 1 && outputOverride
      ? outputOverride
      : join(dirname(input), basename(input).replace(/\.html?$/i, '') + '.pdf');

    if (!opts.quiet) {
      const counter = inputs.length > 1 ? `[${index + 1}/${inputs.length}] ` : '';
      console.log(`${counter}${basename(input)} -> ${basename(output)} (${opts.mode})`);
    }

    try {
      if (opts.mode === 'slides') {
        await convertSlides(chromium, input, output, opts);
      } else {
        await convertPage(chromium, input, output, opts);
      }
    } catch (error) {
      fail(`converting ${basename(input)}: ${error.message}`);
    }

    if (!opts.quiet) {
      console.log(`  done (${Math.round(statSync(output).size / 1024)} KB)`);
    }
  }

  if (!opts.quiet) {
    console.log(`Finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}

main().catch((error) => fail(error.stack ?? String(error)));

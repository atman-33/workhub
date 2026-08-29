// persona — statusline badge.
//
// Derived from genshijin (MIT, InterfaceX-co-jp)
// https://github.com/InterfaceX-co-jp/genshijin
//
// Prints e.g. "[ノクト:無口]" so the active character is visible at a glance.
// The label is precomputed by persona-activate / persona-mode-tracker and read
// verbatim here — this script never parses character files, which keeps the
// statusline cheap and keeps YAML parsing out of the render path.
//
// Enable it by adding to <claudeDir>/settings.json:
//   "statusLine": {
//     "type": "command",
//     "command": "node \"<pluginRoot>/hooks/persona-statusline.mjs\""
//   }

import { readStatuslineLabel } from './persona-config.mjs';

const label = readStatuslineLabel();
if (!label) process.exit(0);

const ESC = String.fromCharCode(27);
process.stdout.write(`${ESC}[38;5;110m[${label}]${ESC}[0m`);

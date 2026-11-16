// fast-marked driver: reads every case from <input>/cases.json, renders each one on its own with
// parse() and writes the HTML strings, in case order, as a JSON array to <output>/html.json.
// MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR replace /input and /output for local runs.

import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

// The whole run is one cold pass over ~3 MB of Markdown. TurboFan's background compilations cost
// more CPU than they save in that time; Maglev (on by default since Node 22) remains the optimizing
// tier. This only changes how V8 tiers code, never what parse() returns. It must run before
// parse.js is loaded, hence the dynamic import below.
setFlagsFromString('--no-turbofan');
const { parse } = (await import('./parse.js')) as { parse: (md: string) => string };

const inDir: string = process.env.MAKEFUN_INPUT_DIR || '/input';
const outDir: string = process.env.MAKEFUN_OUTPUT_DIR || '/output';

type Case = { id: string; markdown: string } | null;

const cases: Case[] = JSON.parse(readFileSync(inDir + '/cases.json', 'utf8'));

// Stream the array out: each case's HTML is stringified (and so flattened) as soon as it is made
// and written in ~1 MB chunks, so the heap never holds all 720 results at once.
const fd = openSync(outDir + '/html.json', 'w');
let chunk = '[';
for (let i = 0; i < cases.length; i++) {
  const c = cases[i] as { id: string; markdown: string };
  chunk += (i === 0 ? '' : ',') + JSON.stringify(parse(c.markdown));
  cases[i] = null;
  if (chunk.length > 1 << 20) {
    writeSync(fd, chunk);
    chunk = '';
  }
}
writeSync(fd, chunk + ']');
closeSync(fd);

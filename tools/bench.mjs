// Time parse.js (and optionally another module exporting parse) over a cases file.
//   node tools/bench.mjs <cases.json> [rounds] [other-module.js]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [casesFile, roundsArg, other] = process.argv.slice(2);
const rounds = Number(roundsArg || 5);
const cases = JSON.parse(readFileSync(casesFile, 'utf8'));
const mods = [['fast', '../parse.js']];
if (other) mods.push(['other', pathToFileURL(resolve(other)).href]);

for (const [name, path] of mods) {
  const { parse } = await import(path);
  const times = [];
  let docs = 0, spec = 0;
  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    for (const c of cases) parse(c.markdown);
    times.push(performance.now() - t0);
  }
  // split cost between spec examples and documents on one extra round
  let t = performance.now();
  for (const c of cases) if (!c.id.startsWith('doc')) parse(c.markdown);
  spec = performance.now() - t;
  t = performance.now();
  for (const c of cases) if (c.id.startsWith('doc')) parse(c.markdown);
  docs = performance.now() - t;
  console.log(`${name}: first ${times[0].toFixed(1)} ms, best ${Math.min(...times).toFixed(1)} ms; spec ${spec.toFixed(1)} ms, docs ${docs.toFixed(1)} ms`);
}

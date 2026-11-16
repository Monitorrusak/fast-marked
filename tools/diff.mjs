// Compare parse.js with reference HTML.
//   node tools/diff.mjs <cases.json> <expected.json> [--show N] [--only id]
// cases.json: [{id, markdown}], expected.json: the generator's {cases:[{id, html}]} or a plain array.
import { readFileSync } from 'node:fs';
import { parse } from '../parse.js';

const [casesFile, expectedFile, ...rest] = process.argv.slice(2);
const show = rest.includes('--show') ? Number(rest[rest.indexOf('--show') + 1]) : 10;
const only = rest.includes('--only') ? rest[rest.indexOf('--only') + 1] : null;
const cases = JSON.parse(readFileSync(casesFile, 'utf8'));
const exp = JSON.parse(readFileSync(expectedFile, 'utf8'));
const expected = Array.isArray(exp) ? exp : exp.cases.map((c) => c.html);

let bad = 0;
let shown = 0;
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  if (only && c.id !== only) continue;
  let got;
  try {
    got = parse(c.markdown);
  } catch (e) {
    got = 'THREW ' + e.stack;
  }
  const want = expected[i];
  if (got === want) continue;
  bad++;
  if (shown++ >= show) continue;
  let d = 0;
  while (d < got.length && d < want.length && got[d] === want[d]) d++;
  const ctx = (s) => JSON.stringify(s.slice(Math.max(0, d - 80), d + 80));
  console.log(`--- ${c.id} differs at ${d} (md ${c.markdown.length} chars)`);
  if (c.markdown.length < 400) console.log('md:  ' + JSON.stringify(c.markdown));
  console.log('got: ' + ctx(got));
  console.log('want:' + ctx(want));
}
console.log(`${cases.length - bad}/${cases.length} identical`);
process.exitCode = bad ? 1 : 0;

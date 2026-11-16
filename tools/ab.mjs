// A/B: alternate fresh processes for two parse.js versions; CPU of one cold pass over a cases file.
//   node tools/ab.mjs <a.js> <b.js> <cases.json> [runs]
// The order alternates every round (ab, ba, ab, ...) to cancel drift; reports median and the mean
// of the middle 60% of runs.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [a, b, casesFile, runsArg] = process.argv.slice(2);
const runs = Number(runsArg || 10);
const child = `
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
v8.setFlagsFromString('--no-turbofan');
const { parse } = await import(process.argv[1]);
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const u0 = process.cpuUsage();
for (const c of cases) parse(c.markdown);
const u = process.cpuUsage(u0);
console.log(((u.user + u.system) / 1000).toFixed(1));
`;
const res = { a: [], b: [] };
for (let r = 0; r < runs; r++) {
  const order = r % 2 ? [['b', b], ['a', a]] : [['a', a], ['b', b]];
  for (const [k, f] of order) {
    const p = spawnSync(process.execPath, ['--input-type=module', '-e', child, pathToFileURL(resolve(f)).href, resolve(casesFile)], { encoding: 'utf8' });
    if (p.status !== 0) throw new Error(p.stderr);
    res[k].push(Number(p.stdout.trim()));
  }
}
const sorted = (x) => [...x].sort((p, q) => p - q);
const med = (x) => sorted(x)[x.length >> 1];
const trim = (x) => {
  const s = sorted(x);
  const cut = Math.floor(s.length * 0.2);
  const mid = s.slice(cut, s.length - cut);
  return mid.reduce((p, q) => p + q, 0) / mid.length;
};
for (const k of ['a', 'b']) console.log(`${k}: median ${med(res[k]).toFixed(0)} ms, trimmed mean ${trim(res[k]).toFixed(1)} ms, min ${Math.min(...res[k]).toFixed(0)} ms`);
console.log(`b/a: median ${(med(res.b) / med(res.a)).toFixed(3)}, trimmed ${(trim(res.b) / trim(res.a)).toFixed(3)}`);

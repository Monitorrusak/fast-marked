// Sampled allocations by function (including objects the GC later collected) over one pass.
//   node tools/allocprof.mjs <cases.json> [N]
import { readFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';

const [casesFile, nArg] = process.argv.slice(2);
const { parse } = await import('../parse.js');
const cases = JSON.parse(readFileSync(casesFile, 'utf8'));
const session = new Session();
session.connect();
await session.post('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
for (const c of cases) parse(c.markdown);
const { profile } = await session.post('HeapProfiler.stopSampling');
const bySite = new Map();
let total = 0;
const walk = (node) => {
  const cf = node.callFrame;
  const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
  bySite.set(key, (bySite.get(key) || 0) + node.selfSize);
  total += node.selfSize;
  for (const ch of node.children) walk(ch);
};
walk(profile.head);
const rows = [...bySite].sort((a, b) => b[1] - a[1]).slice(0, Number(nArg || 25));
for (const [k, v] of rows) console.log(`${(v / 1048576).toFixed(1).padStart(7)} MB ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
console.log(`total sampled ${(total / 1048576).toFixed(1)} MB`);

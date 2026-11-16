// Summarise a V8 .cpuprofile by self time per function (top N).
//   node tools/prof.mjs <file.cpuprofile> [N]
import { readFileSync } from 'node:fs';

const [file, nArg] = process.argv.slice(2);
const prof = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = prof.timeDeltas;
for (let i = 0; i < prof.samples.length; i++) {
  const node = byId.get(prof.samples[i]);
  const cf = node.callFrame;
  const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + (dt[i] || 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(nArg || 30));
for (const [k, v] of rows) console.log(`${(v / 1000).toFixed(1).padStart(8)} ms ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
console.log(`total ${(total / 1000).toFixed(1)} ms`);

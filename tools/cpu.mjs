// Interleaved process-CPU comparison: this entry vs marked's baseline vs a null program.
//   node tools/cpu.mjs <kit-dir> [runs] [input-dir]
// Each run is a fresh `node` process; CPU (user+sys) is read at exit through tools/cpu-hook.mjs.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [kit, runsArg, inputArg] = process.argv.slice(2);
const runs = Number(runsArg || 7);
const input = resolve(inputArg || join(kit, 'practice', 'input'));
const out = resolve('.cache/cpu-out');
mkdirSync(out, { recursive: true });
writeFileSync(resolve('.cache/null.mjs'), 'process.exit(0)\n');
const hook = './tools/cpu-hook.mjs';
const progs = {
  entry: resolve('main.ts'),
  marked: resolve(kit, 'baselines', 'main.ts'),
  null: resolve('.cache/null.mjs'),
};
const res = Object.fromEntries(Object.keys(progs).map((k) => [k, []]));
for (let r = 0; r < runs; r++) {
  for (const [name, file] of Object.entries(progs)) {
    const p = spawnSync(process.execPath, ['--import', hook, file], { env: { ...process.env, MAKEFUN_INPUT_DIR: input, MAKEFUN_OUTPUT_DIR: out }, encoding: 'utf8' });
    const m = /cpu (\d+) ms/.exec(p.stderr);
    if (!m) throw new Error(`${name}: ${p.stderr}`);
    res[name].push(Number(m[1]));
  }
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const min = (a) => Math.min(...a);
for (const [k, v] of Object.entries(res)) console.log(`${k.padEnd(7)} median ${med(v)} ms  min ${min(v)} ms  [${v.join(' ')}]`);
const n = med(res.null);
console.log(`net speedup (median): ${((med(res.marked) - n) / (med(res.entry) - n)).toFixed(2)}x; by minimums ${((min(res.marked) - min(res.null)) / (min(res.entry) - min(res.null))).toFixed(2)}x`);

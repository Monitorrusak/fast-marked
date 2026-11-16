// fast-marked driver: reads every case from <input>/cases.json, renders each one on its own with
// parse() and writes the HTML strings, in case order, to <output>/html.json.
// MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR replace /input and /output for local runs.

import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from './parse.js';

const inDir: string = process.env.MAKEFUN_INPUT_DIR || '/input';
const outDir: string = process.env.MAKEFUN_OUTPUT_DIR || '/output';

type Case = { id: string; markdown: string };

const cases: Case[] = JSON.parse(readFileSync(inDir + '/cases.json', 'utf8'));
const rendered: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) rendered[i] = parse(cases[i].markdown);
writeFileSync(outDir + '/html.json', JSON.stringify(rendered));

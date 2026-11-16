// Differential fuzzing against marked: random inline soups, random block layouts and mutated
// spec examples / generated documents.
//   node tools/fuzz.mjs <marked.esm.js> <examples.json> [count] [seed] [cases.json ...]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parse } from '../parse.js';

const [markedPath, examplesPath, countArg, seedArg, ...docFiles] = process.argv.slice(2);
const { marked } = await import(pathToFileURL(resolve(markedPath)).href);
const examples = JSON.parse(readFileSync(examplesPath, 'utf8')).map((e) => e.markdown);
const docs = [];
for (const f of docFiles) for (const c of JSON.parse(readFileSync(f, 'utf8'))) if (c.id.startsWith('doc')) docs.push(c.markdown);
const count = Number(countArg || 20000);

let state = Number(seedArg || 1) >>> 0 || 1;
function rnd() {
  // xorshift32
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (n) => Math.floor(rnd() * n);

const ATOMS = [
  'a', 'b', 'foo', 'bar', ' ', ' ', ' ', '  ', '\n', '\t', '*', '*', '**', '***', '_', '_', '__', '___', '~', '~~', '~~~',
  '`', '``', '\\', '\\*', '\\_', '[', ']', '(', ')', '[a]', '[foo]', '[x](/u)', '![i](/p "t")', '[r][foo]', '<', '>',
  '<a href="x">', '</a>', '<span>', '</span>', '<pre>', '</pre>', '<code>', '</code>', '<!-- c -->', '<b>', '!', '"', "'",
  '.', ',', ':', ';', '?', '-', '+', '=', '#', '&', '&amp;', '&#42;', '&#x2a;', '&copy;', '&#0;', 'é', 'ß', ' ',
  '—', '“', '’', '\u{1F600}', '　', ' ', '1.', 'http://x.org/p?q=1', 'www.x.com', 'a@b.co',
  'mailto:a@b.co', '<http://a.b>', '<a@b.co>', 'https://e.com/a_b_(c)', '|', 'x_y_z', '*foo*', '_bar_', '**baz**',
  '~~del~~', '`code`', ' \\\n', '  \n', 'ftp://f.o', 'HTTP://U.V', 'xmpp:a@b.cd',
  '@', 'foo@bar.com', 'x.y+z@q-r.io', 'a_b@c.d', '*a@b.c*', '~x@y.z', 'www.', 'www.a.b', '(www.a.b)', '_www.a.b_', 'http', 'https://',
  'Http', 'hTTps://a.b/c?d=e&f=g', 'ftp', 'mailto:', 'xmpp:', '&#', '&#x', '&#12', '&#x1f;', ';', '&amp', '&nbsp', '&#38;', '&#x26;',
  'a.b', 'e.g.', 'x-y', 'v1.2', 'é@ü.de', '!!', '#tag',
  '[foo](x)', '[a][foo](z)', '\\[foo]', '[x\\[foo](y)', '[foo][]', '[foo][](q)', '![foo]', '[Foo]', '[bar](<a b>)', '][',
];
const LINE_STARTS = ['', '', '', '', '- ', '* ', '+ ', '1. ', '2) ', '10. ', '> ', '>> ', '# ', '## ', '###### ', '    ', '\t', '  ', '   ',
  '```', '~~~', '```js', '---', '***', '___', '===', '- - -', '| a | b |', '|---|:-:|', '--- | ---', '<div>', '</div>', '<!--', '-->',
  '[foo]: /url "title"', '[bar]: <x y>', '- [ ] ', '- [x] ', '1. [X] ', '  - ', '    - ', '   > ', '<pre>', '<details>', '<summary>s</summary>'];

function inlineSoup(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += pick(ATOMS);
  return s;
}

function blockSoup() {
  const lines = [];
  const n = 1 + int(10);
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.15) lines.push('');
    lines.push(pick(LINE_STARTS) + (rnd() < 0.8 ? inlineSoup(int(8)) : ''));
  }
  return lines.join(rnd() < 0.1 ? '\r\n' : '\n') + (rnd() < 0.7 ? '\n' : '');
}

// a table, then lines that may or may not end its body
const ROW_LINES = ['| 1 | 2 |', 'a | b', 'x', '', ' ', '   ', '\t', ' \t', '    code', '   \tx', '\tx', '1. x', '1) x', '2. x', '1.x', '- x', '-x', '+ x', '* x', '*x', '> q',
  '>q', '   > q', '# h', '#h', '####### h', '```', '``` js', '~~~', '<div>', '<div', '</div>', '<!-- c', '<?x', '<!X', '<![CDATA[', '<span>', '***', '___', '---',
  '- - -', 'a b', 'p ', '| x \\| y |', '|', '||', ':-:', '=='];
function tableSoup() {
  const head = pick(['| a | b |', 'a | b', '|a|', 'x|y|z', '  | h1 | h2 |']);
  const delim = pick(['|---|---|', '--- | ---', '|:-|', ':-:|--:|---', '|---|', '   |-|-|']);
  const lines = [head, delim];
  const n = int(6);
  for (let i = 0; i < n; i++) lines.push(pick(ROW_LINES));
  return (rnd() < 0.3 ? pick(['para', '', '# t']) + '\n' : '') + lines.join('\n') + (rnd() < 0.6 ? '\n' : '') + (rnd() < 0.3 ? '\npara after' : '');
}


// a blockquote, then lazy and interrupting lines
const QUOTE_LINES = ['> a', '>b', '   > c', '    > d', '>', '> ', '>	', 'lazy', '  lazy', '', ' ', '	', '- x', '-', '-	', '* y', '+', '1. z', '1)', '12. w', '1234567890. v', '# h', '#', '---', '***',
  '___', '```', '~~~', '<div>', '<!--', '<p>', '<x>', '> > n', '>> m', '> - li', '> 1. li', '> ```', '>     code', '> # h', '> ---', 'a b', '=', '> ==', '> --'];
function quoteSoup() {
  const lines = [];
  const n = 1 + int(7);
  for (let i = 0; i < n; i++) lines.push(i === 0 ? pick(['> a', '>b', '  > c', '> - li']) : pick(QUOTE_LINES));
  return (rnd() < 0.3 ? pick(['para', '- item', '1. one']) + '\n' : '') + lines.join('\n') + (rnd() < 0.6 ? '\n' : '');
}

function mutate(s) {
  const ops = 1 + int(4);
  for (let k = 0; k < ops; k++) {
    const i = int(s.length + 1);
    const r = rnd();
    if (r < 0.35) s = s.slice(0, i) + pick(ATOMS) + s.slice(i);
    else if (r < 0.55) s = s.slice(0, i) + s.slice(i + 1 + int(3));
    else if (r < 0.7) s = s.slice(0, i) + pick(LINE_STARTS) + s.slice(i);
    else if (r < 0.85) {
      const j = int(s.length + 1);
      s = s.slice(0, i) + s.slice(Math.min(i, j), Math.max(i, j)) + s.slice(i);
    } else s = s.slice(0, i) + '\n' + s.slice(i);
  }
  return s;
}

function docSlice() {
  const d = pick(docs);
  const a = int(d.length);
  return mutate(d.slice(a, a + 200 + int(3000)));
}

let bad = 0;
const t0 = Date.now();
for (let i = 0; i < count; i++) {
  const r = rnd();
  let md;
  if (r < 0.25) md = inlineSoup(1 + int(25));
  else if (r < 0.4) md = blockSoup();
  else if (r < 0.55) md = tableSoup();
  else if (r < 0.65) md = quoteSoup();
  else if (r < 0.8 || docs.length === 0) md = mutate(pick(examples));
  else md = docSlice();
  let want, got;
  try {
    want = marked.parse(md);
  } catch {
    continue; // marked itself throws (infinite-loop guard): not a valid case
  }
  try {
    got = parse(md);
  } catch (e) {
    got = 'THREW ' + e.stack;
  }
  if (got !== want) {
    bad++;
    if (bad <= 8) {
      let d = 0;
      while (got[d] === want[d]) d++;
      console.log('--- mismatch', JSON.stringify(md));
      console.log('got: ', JSON.stringify(got.slice(Math.max(0, d - 60), d + 60)));
      console.log('want:', JSON.stringify(want.slice(Math.max(0, d - 60), d + 60)));
    }
  }
}
console.log(`${count} inputs, ${bad} mismatches, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = bad ? 1 : 0;

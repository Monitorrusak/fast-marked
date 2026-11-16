# fast-marked

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Monitorrusak/fast-marked/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Monitorrusak/fast-marked/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A dependency-free Markdown renderer whose `parse(markdown)` returns exactly the HTML that
[marked](https://github.com/markedjs/marked) 18.1.3 returns from `marked.parse(markdown)` with
its default options (GFM on, breaks off, pedantic off), character for character and quirks
included, while using roughly half the CPU time.

`parse.js` is a single ES module specialised for that one configuration:

- no extension, hook, renderer-override, async or pedantic machinery; the renderer is folded
  into the lexer, so inline text becomes HTML directly instead of a token tree;
- block rules are gated by the first character of the line, and paragraphs, block quotes and
  list items are delimited by line scanners that call marked's (exact) interrupt rules only on
  lines that could interrupt;
- inline rules run as sticky regular expressions at an index into one string instead of on a
  fresh substring per token, with a hand-written equivalent of marked's inline `text` rule;
- the emphasis and strikethrough closer searches classify delimiter runs directly instead of
  looping a large Unicode-property regular expression over the rest of the paragraph;
- `main.ts` turns off V8's optimising compiler (TurboFan) for its single short run, where
  compiling costs more than it saves.

Correctness is checked by differential testing against the real marked: every CommonMark and
GFM spec example, freshly generated README documents, mutated spec examples and
emphasis-heavy random strings must all render identically.

Licence: MIT (see `LICENSE`). The parsing rules are derived from marked; see `NOTICE`.

## Run it

```sh
# the bounty harness runs: node /bot/main.ts  (reads /input/cases.json, writes /output/html.json)
mkdir -p out && MAKEFUN_INPUT_DIR=./in MAKEFUN_OUTPUT_DIR=./out node main.ts

# or use the renderer directly (Node 22+)
node -e "import('./parse.js').then(({ parse }) => console.log(parse('# Hello *world*')))"
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=p10r0j8a&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>

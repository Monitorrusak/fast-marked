# fast-marked

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Monitorrusak/fast-marked/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Monitorrusak/fast-marked/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A dependency-free Markdown renderer whose `parse(markdown)` returns exactly the HTML that
[marked](https://github.com/markedjs/marked) 18.1.3 produces with its default options (GFM on),
byte for byte, while spending far less CPU.

How it gets there:

- the block pass walks the document by index with sticky regular expressions and only tries the
  rules a line's first non-space character allows; paragraphs and list items are scanned line by
  line, calling the exact interrupt checks only on lines that could interrupt;
- inline text is lexed and rendered in one step (no inline token objects), with a hand-written
  scanner for marked's plain-text rule and emphasis delimiters classified on a masked copy of the
  text, as marked does;
- blocks with inline content are rendered in the order marked lexes them, so state marked carries
  between blocks (an unclosed `<a>` tag, raw `<pre>` spans) behaves the same.

`parse.js` is the module, `main.ts` the program the bounty harness runs (it reads
`/input/cases.json` and writes `/output/html.json`; `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR`
override the two directories). `tools/` holds the differential test and benchmark scripts.

## Run it

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=p10r0j8a&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>

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

- emphasis and strikethrough closers are found by classifying each delimiter run from the
  characters on either side of it (the same decision marked's closer regexes make), on the same
  masked text marked uses;
- V8 is kept on its optimized code: reads never run off the end of a string, block tokens share
  one shape, and matching uses `test()` with `lastIndex` wherever a match array is not needed;
- the largest composite regexes of marked (table bodies, blockquote extents, the HTML block
  opener's tag list) are replaced by line scanners, which also saves compiling them;
- `main.ts` runs without TurboFan (Maglev stays the optimizing tier), compiles regular
  expressions straight to native code, grows the young generation faster, and streams
  `html.json` out as it goes.

`parse.js` is the module, `main.ts` the program the bounty harness runs (it reads
`/input/cases.json` and writes `/output/html.json`; `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR`
override the two directories). `tools/` holds the test and benchmark scripts:

- `tools/diff.mjs` compares the output with reference HTML (the kit's practice set, or instances
  drawn with the kit's generator by `tools/gen.sh`);
- `tools/fuzz.mjs` compares with marked itself on random inline soups, random block layouts and
  mutated spec examples and documents;
- `tools/cpu.mjs` and `tools/ab.mjs` measure process CPU against marked and between versions.

Checked identical to marked on the practice set, on 40 more instances drawn from other seeds
(1,600 generated READMEs plus the 680 spec examples each time) and on over a million fuzz inputs.
On the practice set it uses about 2.5x less CPU than marked, net of Node's start-up (process CPU,
medians of 31 interleaved runs on Node 26; the grader runs Node 22).

## Run it

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=p10r0j8a&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>

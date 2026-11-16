// fast-marked: parse(markdown) returns the HTML that marked 18.1.3 renders with its default options
// (gfm on, breaks off, pedantic off). Dependency-free ES module.
//
// Design: the block pass walks one string by index (sticky regexes, gated on the first non-space
// character of the line) and builds a small block tree. Every block that carries inline text is put
// on a queue in creation order; after the block pass (when all link definitions are known) the queue
// is rendered in that order, so inline state that marked carries from one block to the next (an
// unclosed <a> tag) flows the same way. The inline pass lexes and renders in one step: no inline
// token objects, adjacent text runs are escaped once.

const R = String.raw;

// ---------------------------------------------------------------------------------------------
// Block rules (sticky sources, no leading ^)

const TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

const HR_CAP = R` {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)`;
const HR_NC = R` {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)`;
const HEAD_OPEN = R` {0,3}#{1,6}(?:\s|$)`;
const FENCE_OPEN = R` {0,3}(?:\x60{3,}(?=[^\x60\n]*(?:\n|$))|~~~)[^\n]*(?:\n|$)`;
const HTML_OPEN = R` {0,3}(?:<\/?(?:${TAGS})(?: +|\n|\/?>)|<(?:(?:script|pre|style|textarea)(?:[\s>]|$)|!--)|<\?|<![A-Za-z]|<!\[CDATA\[)`;
const TABLE_SRC = R` *([^\n ].*)\n {0,3}((?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?)(?:\n((?:(?! *\n|${HR_CAP}|${HEAD_OPEN}| {0,3}>|(?: {4}| {0,3}\t)[^\n]|${FENCE_OPEN}| {0,3}(?:[*+-]|1[.)])[ \t]|${HTML_OPEN}).*(?:\n|$))*)\n*|$)`;
const BQ_PARA = R`[^\n]+(?:\n(?!${HR_CAP}|${HEAD_OPEN}| {0,3}>|${FENCE_OPEN}| {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)|${HTML_OPEN}|[ \t]+\n)[^\n]+)*`;
const LH_BULL = R` {0,3}(?:[*+-]|\d{1,9}[.)]) `;
const LH_FENCE = R` {0,3}(?:\x60{3,}|~{3,})`;
const LH_HTML = R` {0,3}<[^\n>]+>\n`;
const LH_TABLE = R` {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n`;
const LHEAD_SRC = R`(?!${LH_BULL}|(?: {4}| {0,3}\t)|${LH_FENCE}| {0,3}>|${HEAD_OPEN}|${LH_HTML}|${LH_TABLE})((?:.|\n(?!\s*?\n|${LH_BULL}|${LH_FENCE}| {0,3}>|${HEAD_OPEN}|${HR_NC}|${LH_HTML}|${LH_TABLE}))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)`;

const RE_NEWLINE = /(?:[ \t]*(?:\n|$))+/y;
const RE_CODE = /(?:(?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/y;
const RE_FENCES = / {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/y;
const RE_HEADING = / {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/y;
const RE_HR = new RegExp(HR_CAP, 'y');
const RE_BQ = new RegExp(R`(?: {0,3}> ?(?:(?![ \t]*(?:\n|$))${BQ_PARA}|[^\n]*)(?:\n|$))+`, 'y');
const RE_LIST = /( {0,3}(?:[*+-]|\d{1,9}[.)]))([ \t][^\n]*?)?(?:\n|$)/y;
const RE_HTML = new RegExp(R` {0,3}(?:<(script|pre|style|textarea)[\s>][\s\S]*?(?:<\/\1>[^\n]*\n*|$)|<!--(?:-?>|[\s\S]*?(?:-->|$))[^\n]*(\n+|$)|<\?[\s\S]*?(?:\?>[^\n]*\n*|$)|<![A-Z][\s\S]*?(?:>[^\n]*\n*|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>[^\n]*\n*|$)|<\/?(${TAGS})(?:[ \t]+|\n|\/?>|$)[\s\S]*?(?:(?:\n[ \t]*)+\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?: +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>\x60]+)?)*? *\/?>(?=[ \t]*(?:\n|$))[\s\S]*?(?:(?:\n[ \t]*)+\n|$)|<\/[a-z][a-z0-9-]*\s*>(?=[ \t]*(?:\n|$))[\s\S]*?(?:(?:\n[ \t]*)+\n|$))`, 'iy');
const RE_DEF = new RegExp(R` {0,3}\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)((?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))))? *(?:\n+|$)`, 'y');
const RE_TABLE = new RegExp(TABLE_SRC, 'y');
const RE_LHEADING = new RegExp(LHEAD_SRC, 'y');
const RE_LHEADING_A = new RegExp('^' + LHEAD_SRC);

const RE_CODE_INDENT = /^(?: {0,3}\t| {1,4})/gm;
const RE_BQ_START = /^ {0,3}>/;
const RE_BQ_MARKER_WS = /^( {0,3}>)([ \t]+)/gm;
const RE_BQ_SETEXT = /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g;
const RE_BQ_STRIP = /^ {0,3}>[ \t]?/gm;

// list item helpers, one per indent clamp 0..3
const ind = (f) => [0, 1, 2, 3].map(f);
const HR_IND = ind((n) => new RegExp(`^ {0,${n}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\\n+|$)`));
const HTML_IND = ind((n) => new RegExp(`^ {0,${n}}(?:<\\/?(?:${TAGS})(?: +|$|\\/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i'));
const ITEM_RE = {
  '*': /( {0,3}\*)((?:[\t ][^\n]*)?(?:\n|$))/y,
  '+': /( {0,3}\+)((?:[\t ][^\n]*)?(?:\n|$))/y,
  '-': /( {0,3}-)((?:[\t ][^\n]*)?(?:\n|$))/y,
  '.': /( {0,3}\d{1,9}\.)((?:[\t ][^\n]*)?(?:\n|$))/y,
  ')': /( {0,3}\d{1,9}\))((?:[\t ][^\n]*)?(?:\n|$))/y,
};
const RE_FENCE_OPEN = new RegExp(FENCE_OPEN, 'y');
const RE_HTML_OPEN = new RegExp(HTML_OPEN, 'y');
const RE_TASK = /^\[[ xX]\][ \t]+\S/;
const RE_TASK_PREFIX = /^\[[ xX]\][ \t]+/;

// ---------------------------------------------------------------------------------------------
// Inline rules

const LINK_LABEL = R`(?:\[(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|\x60+(?!\x60)[^\x60]*?\x60+(?!\x60)|\x60\x60+(?=\])|[^\[\]\\\x60])*?`;
const REF_LABEL = R`(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+`;
const LINK_SRC = R`!?\[(${LINK_LABEL})\]\([ \t\n]*(<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\)))(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)))?[ \t\n]*\)`;
const RE_LINK = new RegExp(LINK_SRC, 'y');
const RE_LINK_A = new RegExp('^' + LINK_SRC);
const RE_REFLINK = new RegExp(R`!?\[(${LINK_LABEL})\]\[(${REF_LABEL})\]`, 'y');
const RE_NOLINK = new RegExp(R`!?\[(${REF_LABEL})\](?:\[\])?`, 'y');
const REFSEARCH_SRC = R`!?\[((?:[^\[\]\\\x60]*(?:\[(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|\x60+(?!\x60)[^\x60]*?\x60+(?!\x60)|\x60\x60+(?=\]))){0,999}?[^\[\]\\\x60]*?)\]\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999})\]|!?\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999})\](?:\[\])?(?!\()`;
const RE_REFSEARCH = new RegExp(REFSEARCH_SRC, 'g');
const RE_BLOCKSKIP = new RegExp(R`\[(?:[^\[\]\x60]|(?<a>\x60+)[^\x60]+\k<a>(?!\x60))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)|(?<!\x60)()(?<b>\x60+)[^\x60]+\k<b>(?!\x60)|<(?! )[^<>]*?>`, 'g');
const RE_ANY_PUNCT = /\\([\p{P}\p{S}])/gu;
const RE_ESCAPE = /\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/y;
const RE_TAG = new RegExp(R`<!--(?:-?>|[\s\S]*?-->)|<\/[a-zA-Z][a-zA-Z0-9-]*\s*>|<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>\x60]+)?)*?\s*\/?>|<\?[\s\S]*?\?>|<![a-zA-Z]+\s[\s\S]*?>|<!\[CDATA\[[\s\S]*?\]\]>`, 'y');
const RE_TAG_A = new RegExp('^(?:' + RE_TAG.source + ')');
const RE_AUTOLINK = new RegExp(R`<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[a-zA-Z0-9.!#$%&'*+/=?_\x60{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_]))>`, 'y');
const RE_AUTOLINK_A = new RegExp('^' + RE_AUTOLINK.source);
const RE_CODESPAN = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/y;
const RE_CODESPAN_A = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const RE_BR = /( {2,}|\\)\n(?!\s*$)[ \t]*/y;
const EMAIL_TAIL = R`[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])`;
const RE_URL = new RegExp(R`(?:mailto:[A-Za-z0-9._+-]+@${EMAIL_TAIL}|xmpp:[A-Za-z0-9._+-]+@${EMAIL_TAIL}(?:\/[A-Za-z0-9@.]+)?)|((?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|[A-Za-z0-9._+-]+(@)${EMAIL_TAIL}`, 'y');
const RE_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;

const RE_PUNCT_SPACE = /^(?![*_])[\s\p{P}\p{S}]/u;
const RE_ALNUM_U = /[\p{L}\p{N}]/u;

// ---------------------------------------------------------------------------------------------
// Per-parse state (reset at the start of every parse call; nothing survives between calls)

let links = null; // label -> {href, title}
let defCount = 0;
let queue = null; // blocks whose inline text is rendered after the block pass, in creation order
let top = true;
let inLink = false;
let inRawBlock = false;
let linkEmitted = false;

const T_SPACE = 1, T_CODE = 2, T_HEADING = 3, T_HR = 4, T_BQ = 5, T_LIST = 6, T_HTML = 7, T_DEF = 8,
  T_TABLE = 9, T_PARA = 10, T_TEXT = 11, T_CHECKBOX = 12;

export function parse(markdown) {
  const src = markdown.indexOf('\r') === -1 ? markdown : markdown.replace(/\r\n|\r/g, '\n');
  links = Object.create(null);
  defCount = 0;
  queue = [];
  top = true;
  inLink = false;
  inRawBlock = false;
  linkEmitted = false;
  const tokens = blockTokens(src, [], false);
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    inRawBlock = false;
    q.html = inline(q.src, false);
  }
  const html = renderBlocks(tokens);
  links = null;
  queue = null;
  return html;
}

// Every block token has this one shape, so reads of its fields stay monomorphic.
class Block {
  constructor(type, raw) {
    this.type = type;
    this.raw = raw;
    this.q = null; // inline queue entry (paragraph, text, heading)
    this.check = -1; // task checkbox: -1 none, 0 unchecked, 1 checked
    this.depth = 0;
    this.text = '';
    this.lang = '';
    this.tokens = null;
    this.ordered = false;
    this.start = 0;
    this.loose = false;
    this.items = null;
    this.align = null;
    this.header = null;
    this.body = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Small helpers

function rtrimChar(s, ch) {
  let n = s.length;
  while (n > 0 && s[n - 1] === ch) n--;
  return n === s.length ? s : s.slice(0, n);
}

function trimBlankTail(a) {
  const lines = a.split('\n');
  let t = lines.length - 1;
  while (t >= 0 && /^[ \t]*$/.test(lines[t])) t--;
  return lines.length - t <= 2 ? a : lines.slice(0, t + 1).join('\n');
}

function expandTabs(s, col) {
  let out = '';
  for (const ch of s) {
    if (ch === '\t') {
      const w = 4 - (col % 4);
      out += ' '.repeat(w);
      col += w;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
}

const RE_SIMPLE_LABEL = /^[!-~]+(?: [!-~]+)*$/;
function normLabel(s) {
  // printable ASCII words joined by single spaces: trimming and collapsing change nothing, and the
  // lower/upper/lower round trip is plain lower-casing
  if (RE_SIMPLE_LABEL.test(s)) return s.toLowerCase();
  return s.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

function closingParen(s) {
  if (s.indexOf('(') === -1 && s.indexOf(')') === -1) return -1;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++;
    else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth < 0) return i;
    }
  }
  return depth > 0 ? -2 : -1;
}

function newQ(src) {
  const q = { src, html: '' };
  queue.push(q);
  return q;
}

// ---------------------------------------------------------------------------------------------
// Block pass

function blockTokens(src, out, mergePara) {
  const len = src.length;
  let pos = 0;
  let blankAt = -1;
  let setextAt = -1;
  while (pos < len) {
    // (every charCodeAt in this file stays in bounds -- reads that could run off a string are written
    // "i < s.length ? s.charCodeAt(i) : -1": a NaN from a read past the end deoptimizes the caller)
    let i = pos;
    let c = src.charCodeAt(i);
    while (c === 32) c = ++i < len ? src.charCodeAt(i) : -1;
    const indent = i - pos;
    let m;

    if (c === 10 || c === 9 || i >= len) {
      RE_NEWLINE.lastIndex = pos;
      if (RE_NEWLINE.test(src) && RE_NEWLINE.lastIndex > pos) {
        const raw = src.slice(pos, RE_NEWLINE.lastIndex);
        pos += raw.length;
        const last = out[out.length - 1];
        // a lone newline joins the previous token's raw; only lists, blockquotes and blank-line
        // tokens have their raw read again (blockquote continuation, list looseness)
        if (raw.length === 1 && last !== undefined) {
          if (last.type === T_LIST || last.type === T_BQ || last.type === T_SPACE) last.raw += '\n';
        } else out.push(new Block(T_SPACE, raw));
        continue;
      }
    }

    if (indent >= 4 || c === 9) {
      RE_CODE.lastIndex = pos;
      if (RE_CODE.test(src)) {
        const raw = trimBlankTail(src.slice(pos, RE_CODE.lastIndex));
        const text = raw.replace(RE_CODE_INDENT, '');
        pos += raw.length;
        const last = out[out.length - 1];
        if (last !== undefined && (last.type === T_PARA || last.type === T_TEXT)) {
          last.q.src += '\n' + text;
        } else {
          const b = new Block(T_CODE, raw);
          b.text = text;
          out.push(b);
        }
        continue;
      }
    }

    if (indent <= 3) {
      if (c === 96 || c === 126) {
        RE_FENCES.lastIndex = pos;
        m = RE_FENCES.exec(src);
        if (m !== null) {
          const raw = m[0];
          pos += raw.length;
          const b = new Block(T_CODE, raw);
          b.text = fenceIndent(raw, m[3] || '');
          b.lang = m[2] ? unescapePunct(m[2].trim()) : '';
          out.push(b);
          continue;
        }
      }
      if (c === 35) {
        RE_HEADING.lastIndex = pos;
        if (RE_HEADING.test(src)) {
          // the match is the "#" run at i (at most six, then blank or end), the rest of the line
          // (it cannot hold a line separator, or the match fails) and the newlines after it
          let h = i;
          while (h < len && src.charCodeAt(h) === 35) h++;
          let le = src.indexOf('\n', h);
          if (le === -1) le = len;
          let text = src.slice(h, le).trim();
          if (text.endsWith('#')) {
            const s = rtrimChar(text, '#');
            if (!s || /[ \t]$/.test(s)) text = s.trim();
          }
          const raw = src.slice(pos, le);
          pos += raw.length;
          const b = new Block(T_HEADING, raw);
          b.depth = h - i;
          b.q = newQ(text);
          out.push(b);
          continue;
        }
      }
      if (c === 45 || c === 95 || c === 42) {
        RE_HR.lastIndex = pos;
        if (RE_HR.test(src)) {
          const raw = rtrimChar(src.slice(pos, RE_HR.lastIndex), '\n');
          pos += raw.length;
          out.push(new Block(T_HR, raw));
          continue;
        }
      }
      if (c === 62) {
        const t = blockquote(src, pos);
        if (t !== null) {
          pos += t.raw.length;
          out.push(t);
          continue;
        }
      }
      if (c === 45 || c === 42 || c === 43 || (c >= 48 && c <= 57)) {
        const t = list(src, pos);
        if (t !== null) {
          pos += t.raw.length;
          out.push(t);
          continue;
        }
      }
      if (c === 60) {
        RE_HTML.lastIndex = pos;
        if (RE_HTML.test(src)) {
          const raw = trimBlankTail(src.slice(pos, RE_HTML.lastIndex));
          pos += raw.length;
          const b = new Block(T_HTML, raw);
          b.text = raw;
          out.push(b);
          continue;
        }
      }
      if (c === 91) {
        RE_DEF.lastIndex = pos;
        m = RE_DEF.exec(src);
        if (m !== null && (m[2][0] === '<' || closingParen(m[2]) === -1)) {
          const raw = rtrimChar(m[0], '\n');
          pos += raw.length;
          const last = out[out.length - 1];
          if (last !== undefined && (last.type === T_PARA || last.type === T_TEXT)) {
            last.q.src += '\n' + raw;
          } else {
            const tag = normLabel(m[1]);
            if (!(tag in links)) {
              defCount++;
              links[tag] = {
                href: m[2] ? unescapePunct(m[2].replace(/^<(.*)>$/, '$1')) : '',
                title: m[3] ? unescapePunct(m[3].substring(1, m[3].length - 1)) : m[3],
              };
            }
            out.push(new Block(T_DEF, raw));
          }
          continue;
        }
      }
    }

    // table: the next line must open like a delimiter row
    {
      const nl = src.indexOf('\n', pos);
      if (nl !== -1) {
        let k = nl + 1;
        const lim = k + 3;
        while (k < lim && (k < src.length ? src.charCodeAt(k) : -1) === 32) k++;
        const d = (k < src.length ? src.charCodeAt(k) : -1);
        if (d === 124 || d === 58 || d === 45) {
          const t = table(src, pos);
          if (t !== null) {
            pos += t.raw.length;
            out.push(t);
            continue;
          }
        }
      }
    }

    // setext heading: only possible when an underline-looking line comes before the next blank line
    if (blankAt < pos) {
      const b = src.indexOf('\n\n', pos);
      blankAt = b === -1 ? len + 1 : b;
    }
    if (setextAt < pos) setextAt = underlineBefore(src, pos, blankAt);
    if (setextAt < blankAt) {
      RE_LHEADING.lastIndex = pos;
      m = RE_LHEADING.exec(src);
      if (m !== null) {
        const raw = rtrimChar(m[0], '\n');
        pos += raw.length;
        const b = new Block(T_HEADING, raw);
        b.depth = m[2][0] === '=' ? 1 : 2;
        b.q = newQ(m[1].trim());
        out.push(b);
        continue;
      }
    }

    if (top) {
      const raw = src.slice(pos, paraEnd(src, pos));
      const last = out[out.length - 1];
      if (mergePara && last !== undefined && last.type === T_PARA) {
        last.q.src += '\n' + raw;
      } else {
        const b = new Block(T_PARA, raw);
        b.q = newQ(raw);
        out.push(b);
      }
      mergePara = false;
      pos += raw.length;
      continue;
    }

    {
      // marked's text rule [^\n]+ (pos is never at a newline here)
      let e = src.indexOf('\n', pos);
      if (e === -1) e = len;
      const raw = src.slice(pos, e);
      pos = e;
      const last = out[out.length - 1];
      if (last !== undefined && last.type === T_TEXT) {
        last.q.src += '\n' + raw;
      } else {
        const b = new Block(T_TEXT, raw);
        b.q = newQ(raw);
        out.push(b);
      }
    }
  }
  top = true;
  return out;
}

// Index of the first "\n" in [from, limit) that starts a line opening with up to three spaces and
// "=" or "-" (a possible setext underline); `limit` when there is none.
function underlineBefore(src, from, limit) {
  let j = src.indexOf('\n', from);
  while (j !== -1 && j < limit) {
    let k = j + 1;
    const lim = k + 3;
    while (k < lim && (k < src.length ? src.charCodeAt(k) : -1) === 32) k++;
    const c = (k < src.length ? src.charCodeAt(k) : -1);
    if (c === 61 || c === 45) return j;
    j = src.indexOf('\n', j + 1);
  }
  return limit;
}

// End of the paragraph starting at pos (marked's gfm paragraph rule): lines continue until an empty
// or blank line, or a line that opens an hr, ATX heading, blockquote, fence, list item, HTML block or
// a table (the line plus a delimiter row under it).
function paraEnd(src, pos) {
  const len = src.length;
  let end = src.indexOf('\n', pos);
  while (end !== -1) {
    const ls = end + 1;
    if (ls >= len || paraBreak(src, ls)) return end;
    end = src.indexOf('\n', ls);
  }
  return len;
}

function paraBreak(src, ls) {
  let i = ls;
  let c = src.charCodeAt(i);
  if (c === 10) return true;
  while (c === 32 || c === 9) c = ++i < src.length ? src.charCodeAt(i) : -1;
  if (c === 10) return true; // [ \t]+\n
  i = ls;
  c = src.charCodeAt(i);
  while (c === 32 && i - ls < 3) c = ++i < src.length ? src.charCodeAt(i) : -1;
  switch (c) {
    case 45:
    case 42:
    case 43: {
      // " {0,3}[*+-][ \t]+[^ \t\n]"
      let j = i + 1;
      let d = (j < src.length ? src.charCodeAt(j) : -1);
      if (d === 32 || d === 9) {
        while (d === 32 || d === 9) d = ++j < src.length ? src.charCodeAt(j) : -1;
        if (d !== -1 && d !== 10) return true;
      }
      if (c === 43) break;
      RE_HR.lastIndex = ls;
      if (RE_HR.test(src)) return true;
      break;
    }
    case 95:
      RE_HR.lastIndex = ls;
      if (RE_HR.test(src)) return true;
      break;
    case 49: {
      const d = (i + 1 < src.length ? src.charCodeAt(i + 1) : -1);
      if (d === 46 || d === 41) {
        let j = i + 2;
        let e = (j < src.length ? src.charCodeAt(j) : -1);
        if (e === 32 || e === 9) {
          while (e === 32 || e === 9) e = ++j < src.length ? src.charCodeAt(j) : -1;
          if (e !== -1 && e !== 10) return true;
        }
      }
      break;
    }
    case 35:
      if (headingOpensAt(src, i)) return true;
      break;
    case 62:
      return true;
    case 96:
    case 126:
      RE_FENCE_OPEN.lastIndex = ls;
      if (RE_FENCE_OPEN.test(src)) return true;
      break;
    case 60:
      RE_HTML_OPEN.lastIndex = ls;
      if (RE_HTML_OPEN.test(src)) return true;
      break;
  }
  // table: this line is a header if the next one is a delimiter row
  const nl = src.indexOf('\n', ls);
  if (nl !== -1) {
    let k = nl + 1;
    const lim = k + 3;
    while (k < lim && (k < src.length ? src.charCodeAt(k) : -1) === 32) k++;
    const d = (k < src.length ? src.charCodeAt(k) : -1);
    if (d === 124 || d === 58 || d === 45) {
      RE_TABLE.lastIndex = ls;
      if (RE_TABLE.test(src)) return true;
    }
  }
  return false;
}

function fenceIndent(raw, text) {
  const m = raw.match(/^(\s+)(?:```)/);
  if (m === null) return text;
  const n = m[1].length;
  return text
    .split('\n')
    .map((line) => {
      const s = line.match(/^\s+/);
      if (s === null) return line;
      return line.slice(Math.min(s[0].length, n));
    })
    .join('\n');
}

function blockquote(src, pos) {
  RE_BQ.lastIndex = pos;
  if (!RE_BQ.test(src)) return null;
  let lines = rtrimChar(src.slice(pos, RE_BQ.lastIndex), '\n').split('\n');
  let raw = '';
  let text = '';
  const toks = [];
  while (lines.length > 0) {
    let inQ = false;
    const cur = [];
    let p;
    for (p = 0; p < lines.length; p++) {
      if (RE_BQ_START.test(lines[p])) {
        cur.push(lines[p]);
        inQ = true;
      } else if (!inQ) cur.push(lines[p]);
      else break;
    }
    lines = lines.slice(p);
    const h = cur.join('\n');
    // (expanding the blanks after ">" only changes anything when there is a tab)
    const u = (h.indexOf('\t') === -1 ? h : h.replace(RE_BQ_MARKER_WS, (g, b, w) => b + expandTabs(w, b.length)))
      .replace(RE_BQ_SETEXT, '\n    $1')
      .replace(RE_BQ_STRIP, '');
    raw = raw ? raw + '\n' + h : h;
    text = text ? text + '\n' + u : u;
    const savedTop = top;
    top = true;
    blockTokens(u, toks, true);
    top = savedTop;
    if (lines.length === 0) break;
    const last = toks[toks.length - 1];
    const lt = last === undefined ? 0 : last.type;
    if (lt === T_CODE || lt === T_HEADING || lt === T_HR || lt === T_HTML || lt === T_TABLE) break;
    if (lt === T_BQ) {
      const joined = last.raw + '\n' + lines.join('\n').replace(RE_BQ_STRIP, '');
      const f = blockquote(joined, 0);
      toks[toks.length - 1] = f;
      const y = joined.substring(f.raw.length).replace(/^\n/, '');
      const nRest = y ? y.split('\n').length : 0;
      const taken = nRest ? lines.slice(0, -nRest) : lines;
      if (taken.length > 0) raw = raw + '\n' + taken.join('\n');
      text = text.substring(0, text.length - last.text.length) + f.text;
      lines = lines.slice(taken.length);
      if (lines.length > 0 && RE_BQ_START.test(lines[0])) continue;
      break;
    } else if (lt === T_LIST) {
      const joined = last.raw + '\n' + lines.join('\n');
      const nl = list(joined, 0);
      toks[toks.length - 1] = nl;
      const f = nl.raw.length > last.raw.length ? joined.slice(last.raw.length + 1, nl.raw.length).split('\n').length : 0;
      if (f > 0) {
        const y = lines.slice(0, f).join('\n');
        raw = raw + '\n' + y;
        text = text + '\n' + y;
      }
      lines = lines.slice(f);
      continue;
    }
  }
  const b = new Block(T_BQ, raw);
  b.tokens = toks;
  b.text = text;
  return b;
}

// leading spaces/tabs of s expanded to spaces as if s started at column col (marked's indentCodeCompensation-free J())
function expandLead(s, col) {
  let i = 0;
  let tab = false;
  for (;;) {
    const c = (i < s.length ? s.charCodeAt(i) : -1);
    if (c === 32) i++;
    else if (c === 9) {
      tab = true;
      i++;
    } else break;
  }
  if (!tab) return s;
  return expandTabs(s.slice(0, i), col) + s.slice(i);
}

// !s.trim(): only JS whitespace in s
function isBlankStr(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9 && !isJsSpace(c)) return false;
  }
  return true;
}

function firstNonSpace(s) {
  let i = 0;
  while ((i < s.length ? s.charCodeAt(i) : -1) === 32) i++;
  return i < s.length ? i : -1;
}

// width of the leading blanks with every tab counted as four columns; -1 for a blank string
function tabWidthIndent(s) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32) w++;
    else if (c === 9) w += 4;
    else return w;
  }
  return -1;
}

function endsWithBlankLine(s) {
  let i = s.length - 1;
  while (i >= 0 && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i--;
  if (i < 0 || s.charCodeAt(i) !== 10) return false;
  i--;
  while (i >= 0 && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i--;
  return i >= 0 && s.charCodeAt(i) === 10;
}

// " {0,ci}#{1,6}(?:\s|$)" with the #-run starting at i
function headingOpensAt(s, i) {
  let j = i;
  while ((j < s.length ? s.charCodeAt(j) : -1) === 35) j++;
  if (j - i > 6) return false;
  return j >= s.length || isJsSpace(s.charCodeAt(j));
}

// Does `line` (one line, no newline) start a block that ends a list item? `full` adds the
// blockquote and next-bullet checks marked applies to the current line but not the previous one.
function itemBreak(line, ci, full) {
  let sp = 0;
  while ((sp < line.length ? line.charCodeAt(sp) : -1) === 32) sp++;
  if (sp > ci) return false;
  const c = (sp < line.length ? line.charCodeAt(sp) : -1);
  switch (c) {
    case 96:
      return line.startsWith('```', sp);
    case 126:
      return line.startsWith('~~~', sp);
    case 35:
      return headingOpensAt(line, sp);
    case 60:
      return HTML_IND[ci].test(line);
    case 62:
      return full;
    case 95:
      return HR_IND[ci].test(line);
    case 42:
    case 43:
    case 45: {
      if (full) {
        const d = (sp + 1 < line.length ? line.charCodeAt(sp + 1) : -1);
        if (d === -1 || d === 32 || d === 9) return true;
      }
      return c !== 43 && HR_IND[ci].test(line);
    }
  }
  if (full && c >= 48 && c <= 57) {
    let j = sp + 1;
    while (j - sp < 9 && (j < line.length ? line.charCodeAt(j) : -1) >= 48 && (j < line.length ? line.charCodeAt(j) : -1) <= 57) j++;
    const d = (j < line.length ? line.charCodeAt(j) : -1);
    if (d === 46 || d === 41) {
      const e = (j + 1 < line.length ? line.charCodeAt(j + 1) : -1);
      return e === -1 || e === 32 || e === 9;
    }
  }
  return false;
}

// Is s one non-blank line whose first character opens no block rule? Then marked's block lexer
// (with paragraphs off, as inside list items) turns it into exactly one text token: no indented
// code (no leading blank), and the fence, heading, rule, quote, list, HTML and definition rules
// all need one of the excluded first characters; tables and setext headings need a second line.
function oneTextLine(s) {
  if (s.length === 0 || s.indexOf('\n') !== -1) return false;
  const c = s.charCodeAt(0);
  if (c < 128) {
    if (c <= 32 || (c >= 48 && c <= 57)) return false;
    switch (c) {
      case 96: case 126: case 35: case 45: case 95: case 42: case 62: case 43: case 60: case 91:
        return false;
    }
    return true;
  }
  return !isBlankStr(s);
}

// itemBreak(line, ci, true) for the line src[e, le) whose first non-space character fc is at f
// (f - e <= ci): the same checks made by position, without cutting the line out of src.
function itemBreakAt(src, e, f, fc, le, ci) {
  switch (fc) {
    case 96:
      return src.startsWith('```', f);
    case 126:
      return src.startsWith('~~~', f);
    case 35: {
      let j = f;
      while (j < le && src.charCodeAt(j) === 35) j++;
      return j - f <= 6 && (j >= le || isJsSpace(src.charCodeAt(j)));
    }
    case 60:
      return HTML_IND[ci].test(src.slice(e, le));
    case 62:
      return true;
    case 95:
      return HR_IND[ci].test(src.slice(e, le));
    case 42:
    case 43:
    case 45: {
      const d = f + 1 < le ? src.charCodeAt(f + 1) : -1;
      if (d === -1 || d === 32 || d === 9) return true;
      return fc !== 43 && HR_IND[ci].test(src.slice(e, le));
    }
  }
  if (fc >= 48 && fc <= 57) {
    let j = f + 1;
    while (j - f < 9 && j < le && src.charCodeAt(j) >= 48 && src.charCodeAt(j) <= 57) j++;
    const d = j < le ? src.charCodeAt(j) : -1;
    if (d === 46 || d === 41) {
      const g = j + 1 < le ? src.charCodeAt(j + 1) : -1;
      return g === -1 || g === 32 || g === 9;
    }
  }
  return false;
}

// Start and end of the list marker of a line at p that the list regexes matched: up to three
// spaces, then "*", "+", "-" or up to nine digits and "." or ")".
function markerStart(src, p) {
  while (src.charCodeAt(p) === 32) p++;
  return p;
}
function markerEnd(src, p) {
  p = markerStart(src, p);
  const c = src.charCodeAt(p);
  if (c < 48 || c > 57) return p + 1;
  p++;
  while (src.charCodeAt(p) >= 48 && src.charCodeAt(p) <= 57) p++;
  return p + 1;
}

function list(src, pos) {
  RE_LIST.lastIndex = pos;
  if (!RE_LIST.test(src)) return null;
  const len = src.length;
  const bull = src.slice(markerStart(src, pos), markerEnd(src, pos));
  const ordered = bull.length > 1;
  const lst = new Block(T_LIST, '');
  lst.ordered = ordered;
  lst.start = ordered ? +bull.slice(0, -1) : 0;
  lst.items = [];
  const itemRe = ITEM_RE[bull[bull.length - 1]];
  let endsWithBlank = false;
  let e = pos;
  while (e < len) {
    let blankEnd = false;
    let itemText = '';
    itemRe.lastIndex = e;
    if (!itemRe.test(src)) break;
    const itemEnd = itemRe.lastIndex;
    RE_HR.lastIndex = e;
    if (RE_HR.test(src)) break;
    const k = e;
    // marked's t[1] (indent and marker) and t[2] (the rest of the line, with its newline)
    const b = markerEnd(src, e) - e;
    const t2 = src.slice(e + b, itemEnd);
    e = itemEnd;
    let line = expandLead(t2.length > 0 && t2.charCodeAt(t2.length - 1) === 10 ? t2.slice(0, -1) : t2, b);
    let le = src.indexOf('\n', e);
    if (le === -1) le = len;
    let next = src.slice(e, le);
    let blankFirst = isBlankStr(line);
    let indent = 0;
    if (blankFirst) indent = b + 1;
    else {
      indent = firstNonSpace(line);
      indent = indent > 4 ? 1 : indent;
      itemText = line.slice(indent);
      indent += b;
    }
    if (blankFirst && /^[ \t]*$/.test(next)) {
      e = le + 1 > len ? len : le + 1;
      blankEnd = true;
    }
    if (!blankEnd) {
      const ci = indent > 4 ? 3 : indent > 1 ? indent - 1 : 0;
      while (e < len) {
        le = src.indexOf('\n', e);
        if (le === -1) le = len;
        // leading spaces of the line and the character after them (-1 for a blank line)
        let f = e;
        while (f < le && src.charCodeAt(f) === 32) f++;
        const sp = f - e;
        const fc = f < le ? src.charCodeAt(f) : -1;
        if (fc === 9) {
          // tab in the indentation: the general path on the line string
          next = src.slice(e, le);
          if (itemBreak(next, ci, true)) break;
          const Z = expandLead(next, 0);
          const nextBlank = isBlankStr(next);
          if (nextBlank || firstNonSpace(Z) >= indent) itemText += '\n' + Z.slice(indent);
          else {
            if (blankFirst) break;
            if (tabWidthIndent(line) >= 4) break;
            if (itemBreak(line, ci, false)) break;
            itemText += '\n' + (/^ {0,3}(?:=+|-+) *$/.test(next) && RE_LHEADING_A.test(line + '\n' + next) ? '    ' + Z.replace(/^ {0,3}/, '') : next);
          }
          blankFirst = nextBlank;
          e = le + 1 > len ? len : le + 1;
          line = Z.slice(indent);
          continue;
        }
        if (fc !== -1 && sp <= ci && itemBreakAt(src, e, f, fc, le, ci)) break;
        // no tab in the indentation, so the expanded line is the line itself
        const nextBlank = fc === -1 || (isJsSpace(fc) && isBlankStr(src.slice(f, le)));
        const rest = e + indent < le ? src.slice(e + indent, le) : '';
        if (nextBlank || sp >= indent) itemText += '\n' + rest;
        else {
          if (blankFirst) break;
          if (tabWidthIndent(line) >= 4) break;
          if (itemBreak(line, ci, false)) break;
          next = src.slice(e, le);
          itemText += '\n' + (/^ {0,3}(?:=+|-+) *$/.test(next) && RE_LHEADING_A.test(line + '\n' + next) ? '    ' + next.replace(/^ {0,3}/, '') : next);
        }
        blankFirst = nextBlank;
        e = le + 1 > len ? len : le + 1;
        line = rest;
      }
    }
    const itemRaw = src.slice(k, e);
    if (!lst.loose) {
      if (endsWithBlank) lst.loose = true;
      else if (endsWithBlankLine(itemRaw)) endsWithBlank = true;
    }
    lst.items.push({ raw: itemRaw, task: RE_TASK.test(itemText), text: itemText, tokens: [] });
  }
  const lastItem = lst.items[lst.items.length - 1];
  if (lastItem === undefined) return null;
  lastItem.raw = lastItem.raw.trimEnd();
  lastItem.text = lastItem.text.trimEnd();
  lst.raw = src.slice(pos, e).trimEnd();
  for (const it of lst.items) {
    top = false;
    if (oneTextLine(it.text)) {
      // what blockTokens returns for it: a single text token (and it leaves top set)
      const b = new Block(T_TEXT, it.text);
      b.q = newQ(it.text);
      it.tokens.push(b);
      top = true;
    } else blockTokens(it.text, it.tokens, false);
    if (!lst.loose) {
      let loose = false;
      for (const tk of it.tokens) if (tk.type === T_SPACE && /\n.*\n/.test(tk.raw)) loose = true;
      lst.loose = loose;
    }
  }
  for (const it of lst.items) {
    const d = it.tokens[0];
    if (it.task && d !== undefined && (d.type === T_TEXT || d.type === T_PARA)) {
      for (let g = queue.length - 1; g >= 0; g--) {
        if (RE_TASK.test(queue[g].src)) {
          queue[g].src = queue[g].src.replace(RE_TASK_PREFIX, '');
          break;
        }
      }
      const k = /\[[ xX]\]/.exec(it.raw);
      if (k !== null) {
        const checked = k[0] !== '[ ]';
        if (lst.loose) d.check = checked ? 1 : 0; // paragraph/text tokens carry check (-1: none)
        else {
          const b = new Block(T_CHECKBOX, '');
          b.check = checked ? 1 : 0;
          it.tokens.unshift(b);
        }
      }
    } else if (it.task) it.task = false;
  }
  if (lst.loose) {
    for (const it of lst.items) for (const tk of it.tokens) if (tk.type === T_TEXT) tk.type = T_PARA;
  }
  return lst;
}

function splitCells(row, count) {
  let s = '';
  let last = 0;
  for (let i = row.indexOf('|'); i !== -1; i = row.indexOf('|', i + 1)) {
    let esc = false;
    for (let p = i - 1; p >= 0 && row[p] === '\\'; p--) esc = !esc;
    if (!esc) {
      s += row.slice(last, i) + ' |';
      last = i + 1;
    }
  }
  s += row.slice(last);
  const cells = s.split(' |');
  if (!cells[0].trim()) cells.shift();
  if (cells.length > 0 && !cells[cells.length - 1].trim()) cells.pop();
  if (count) {
    if (cells.length > count) cells.splice(count);
    else while (cells.length < count) cells.push('');
  }
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i].trim();
    cells[i] = c.indexOf('\\|') === -1 ? c : c.replace(/\\\|/g, '|');
  }
  return cells;
}

function table(src, pos) {
  RE_TABLE.lastIndex = pos;
  const m = RE_TABLE.exec(src);
  if (m === null || !/[:|]/.test(m[2])) return null;
  const head = splitCells(m[1]);
  const aligns = m[2].replace(/^\||\| *$/g, '').split('|');
  if (head.length !== aligns.length) return null;
  const rows = m[3] && m[3].trim() ? m[3].replace(/\n[ \t]*$/, '').split('\n') : [];
  const align = aligns.map((a) => (/^ *-+: *$/.test(a) ? 'right' : /^ *:-+: *$/.test(a) ? 'center' : /^ *:-+ *$/.test(a) ? 'left' : null));
  const header = head.map((h) => newQ(h));
  const body = rows.map((r) => splitCells(r, head.length).map((c) => newQ(c)));
  const b = new Block(T_TABLE, rtrimChar(m[0], '\n'));
  b.align = align;
  b.header = header;
  b.body = body;
  return b;
}

// ---------------------------------------------------------------------------------------------
// Block rendering

function checkboxHtml(checked) {
  return checked ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ';
}

function renderBlocks(toks) {
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    switch (t.type) {
      case T_PARA:
        out += '<p>' + (t.check === -1 ? '' : checkboxHtml(t.check === 1)) + t.q.html + '</p>\n';
        break;
      case T_TEXT:
        out += (t.check === -1 ? '' : checkboxHtml(t.check === 1)) + t.q.html;
        break;
      case T_HEADING:
        out += '<h' + t.depth + '>' + t.q.html + '</h' + t.depth + '>\n';
        break;
      case T_CODE: {
        const lang = (t.lang || '').match(/^\S*/)[0];
        const body = t.text ? escapeAll(t.text.replace(/\n$/, '') + '\n') : '';
        out += lang ? '<pre><code class="language-' + escapeHtml(lang) + '">' + body + '</code></pre>\n' : '<pre><code>' + body + '</code></pre>\n';
        break;
      }
      case T_HR:
        out += '<hr>\n';
        break;
      case T_BQ:
        out += '<blockquote>\n' + renderBlocks(t.tokens) + '</blockquote>\n';
        break;
      case T_LIST: {
        const tag = t.ordered ? 'ol' : 'ul';
        out += '<' + tag + (t.ordered && t.start !== 1 ? ' start="' + t.start + '"' : '') + '>\n';
        for (const it of t.items) out += '<li>' + renderBlocks(it.tokens) + '</li>\n';
        out += '</' + tag + '>\n';
        break;
      }
      case T_HTML:
        out += t.text;
        break;
      case T_TABLE: {
        out += '<table>\n<thead>\n<tr>\n';
        for (let c = 0; c < t.header.length; c++) out += cellHtml('th', t.align[c], t.header[c].html);
        out += '</tr>\n</thead>\n';
        if (t.body.length > 0) {
          out += '<tbody>';
          for (const row of t.body) {
            out += '<tr>\n';
            for (let c = 0; c < row.length; c++) out += cellHtml('td', t.align[c], row[c].html);
            out += '</tr>\n';
          }
          out += '</tbody>';
        }
        out += '</table>\n';
        break;
      }
      case T_CHECKBOX:
        out += checkboxHtml(t.check === 1);
        break;
    }
  }
  return out;
}

function cellHtml(tag, align, html) {
  return (align ? '<' + tag + ' align="' + align + '">' : '<' + tag + '>') + html + '</' + tag + '>\n';
}

// ---------------------------------------------------------------------------------------------
// Escaping


/** marked's escape(s, true): every & < > " ' */
function escapeAll(s) {
  if (!RE_HTML_SPECIAL.test(s)) return s;
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    let rep;
    switch (s.charCodeAt(i)) {
      case 38:
        rep = '&amp;';
        break;
      case 60:
        rep = '&lt;';
        break;
      case 62:
        rep = '&gt;';
        break;
      case 34:
        rep = '&quot;';
        break;
      case 39:
        rep = '&#39;';
        break;
      default:
        continue;
    }
    out += s.slice(last, i) + rep;
    last = i + 1;
  }
  return out + s.slice(last);
}

// marked's backslash-unescaping of hrefs, titles and info strings: \ before punctuation or a symbol
function unescapePunct(s) {
  return s.indexOf('\\') === -1 ? s : s.replace(RE_ANY_PUNCT, '$1');
}

function isWordCode(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}
function isHexCode(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

// Does s[i..] read (#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+); -- marked leaves such an & alone.
function entityAhead(s, i) {
  let c = (i < s.length ? s.charCodeAt(i) : -1);
  if (c === 35) {
    c = (i + 1 < s.length ? s.charCodeAt(i + 1) : -1);
    let j;
    if (c === 120 || c === 88) {
      j = i + 2;
      while (j - i - 2 < 6 && isHexCode((j < s.length ? s.charCodeAt(j) : -1))) j++;
      return j > i + 2 && (j < s.length ? s.charCodeAt(j) : -1) === 59;
    }
    j = i + 1;
    while (j - i - 1 < 7 && (j < s.length ? s.charCodeAt(j) : -1) >= 48 && (j < s.length ? s.charCodeAt(j) : -1) <= 57) j++;
    return j > i + 1 && (j < s.length ? s.charCodeAt(j) : -1) === 59;
  }
  let j = i;
  while (isWordCode((j < s.length ? s.charCodeAt(j) : -1))) j++;
  return j > i && (j < s.length ? s.charCodeAt(j) : -1) === 59;
}

const RE_HTML_SPECIAL = /[<>"'&]/;

/** marked's escape(s): < > " ' and any & that does not open an entity-like reference */
function escapeHtml(s) {
  if (!RE_HTML_SPECIAL.test(s)) return s;
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    let rep;
    switch (s.charCodeAt(i)) {
      case 60:
        rep = '&lt;';
        break;
      case 62:
        rep = '&gt;';
        break;
      case 34:
        rep = '&quot;';
        break;
      case 39:
        rep = '&#39;';
        break;
      case 38:
        if (entityAhead(s, i + 1)) continue;
        rep = '&amp;';
        break;
      default:
        continue;
    }
    out += s.slice(last, i) + rep;
    last = i + 1;
  }
  return last === 0 ? s : out + s.slice(last);
}

function decodeNumeric(s) {
  if (s.indexOf('&#') === -1 || !/&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/.test(s)) return s;
  return s.replace(/&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, (all, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const n = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '\uFFFD';
    return n === 38 ? '&amp;' : String.fromCodePoint(n);
  });
}

// characters encodeURI keeps as they are, plus "%" (encodeURI's %25 is turned back into %)
const URL_SAFE = new Uint8Array(128);
for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789;,/?:@&=+$-_.!~*'()#%") URL_SAFE[ch.charCodeAt(0)] = 1;

function cleanUrl(href) {
  let i = 0;
  while (i < href.length) {
    const c = href.charCodeAt(i);
    if (c >= 128 || URL_SAFE[c] === 0) break;
    i++;
  }
  if (i === href.length) return href;
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Inline pass

function isAlnum(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

// [a-zA-Z0-9.!#$%&'*+/=?_`{|}~-]
function isEmailChar(c) {
  if (isAlnum(c)) return true;
  switch (c) {
    case 46: case 33: case 35: case 36: case 37: case 38: case 39: case 42: case 43: case 47:
    case 61: case 63: case 95: case 96: case 123: case 124: case 125: case 126: case 45:
      return true;
  }
  return false;
}

function isJsSpace(c) {
  return c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}

function emailAhead(s, i) {
  let j = i;
  while (j < s.length && isEmailChar(s.charCodeAt(j))) j++;
  return j > i && (j < s.length ? s.charCodeAt(j) : -1) === 64;
}

function protoAhead(s, i) {
  return s.startsWith('mailto:', i) || s.startsWith('xmpp:', i);
}

function spacesNl(s, i) {
  if ((i < s.length ? s.charCodeAt(i) : -1) !== 32 || (i + 1 < s.length ? s.charCodeAt(i + 1) : -1) !== 32) return false;
  i += 2;
  while ((i < s.length ? s.charCodeAt(i) : -1) === 32) i++;
  return (i < s.length ? s.charCodeAt(i) : -1) === 10;
}

// Character classes for the inline text scanner (ASCII only; everything else is 0).
const C_ALNUM = 1, C_EMAIL = 2, C_STOP = 4, C_CHECK = 8;
const CLS = new Uint8Array(128);
for (let c = 0; c < 128; c++) {
  let k = 0;
  if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) k |= C_ALNUM | C_EMAIL;
  if (".!#$%&'*+/=?_`{|}~-".includes(String.fromCharCode(c))) k |= C_EMAIL;
  if ('\\<![`*~_'.includes(String.fromCharCode(c))) k |= C_STOP;
  if ('hHfFw'.includes(String.fromCharCode(c))) k |= C_CHECK;
  CLS[c] = k;
}

const RE_TEXT_STOP = /[\\<!\[`*~_]|[hH][tT][tT][pP]|[fF][tT][pP]:\/\/|www\.| {2,}\n|mailto:|xmpp:/g;

/**
 * End of the inline text token marked's gfm `text` rule matches at p. `at` is the index of the next
 * "@" at or after p (-1 when there is none), which lets the email look-aheads be skipped.
 */
function textEnd(s, p, at) {
  const n = s.length;
  let c = s.charCodeAt(p);
  const d0 = (p + 1 < s.length ? s.charCodeAt(p + 1) : -1);
  if ((d0 === 109 || d0 === 120) && !(c < 128 && CLS[c] & C_ALNUM) && protoAhead(s, p + 1)) return p + 1;
  let q = p + 1;
  if (c === 96 || c === 126) while (q < n && s.charCodeAt(q) === c) q++;
  if (q >= n) return q;
  c = s.charCodeAt(q);
  if (c === 96 || c === 126) return q;
  if (c === 32 && spacesNl(s, q)) return q;
  if (at !== -1 && emailAhead(s, q)) return q;
  // The lazy part: the first q >= q0 where marked's text rule may stop. Group 1: stop before q
  // (special character, "http", "ftp://"); group 2: "www." (stop before it when the character in
  // front is blank or one of * _ ~ (); otherwise the match is "x  \n" or "xmailto:" / "xxmpp:"
  // and the stop is after the first character.
  // (test() + lastIndex rather than exec(): no match array per text token. The alternative that
  // matched is told by its last character, which differs between all of them.)
  const q0 = q;
  let cEnd = n;
  let from = q;
  for (;;) {
    RE_TEXT_STOP.lastIndex = from;
    if (!RE_TEXT_STOP.test(s)) break;
    const li = RE_TEXT_STOP.lastIndex;
    const z = s.charCodeAt(li - 1);
    if (z === 10) {
      // "x  \n": stop after the non-space character in front of the spaces (the leftmost match
      // starts at the first space of the run, and that character lies at or after q0)
      let i = li - 1;
      while (i > from && s.charCodeAt(i - 1) === 32) i--;
      cEnd = i;
    } else if (z === 46) {
      // "www.": stop before it when the character in front is blank or one of * _ ~ (
      const i = li - 4;
      const b = s.charCodeAt(i - 1);
      if (!(isJsSpace(b) || b === 42 || b === 95 || b === 126 || b === 40)) {
        from = i + 1;
        continue;
      }
      cEnd = i;
    } else if (z === 58) {
      // "xmailto:" / "xxmpp:" with x not alphanumeric: stop after x
      const i = s.charCodeAt(li - 2) === 111 ? li - 7 : li - 5;
      const b = s.charCodeAt(i - 1);
      if (i - 1 < q0 || (b < 128 && CLS[b] & C_ALNUM)) {
        from = i + 1;
        continue;
      }
      cEnd = i;
    } else if (z === 47) cEnd = li - 6; // "ftp://"
    else if (z === 112 || z === 80) cEnd = li - 4; // "http"
    else cEnd = li - 1; // a special character
    break;
  }
  if (at === -1) return cEnd;
  // "[^email](?=email+@)": before an "@" the only such stop is right after the last non-email
  // character in front of the email run that ends at the "@".
  let a = at >= q0 ? at : s.indexOf('@', q0);
  while (a !== -1) {
    let r0 = a;
    while (r0 > q0) {
      const e = s.charCodeAt(r0 - 1);
      if (e >= 128 || !(CLS[e] & C_EMAIL)) break;
      r0--;
    }
    if (r0 < a) return r0 < cEnd ? r0 : cEnd;
    if (a >= cEnd) return cEnd;
    a = s.indexOf('@', a + 1);
  }
  return cEnd;
}

// marked's punctuation rule ^((?![*_])[\s\p{P}\p{S}]) on a one-character (or one code point) string
function isPunctSpace(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  if (c < 128) return c !== 42 && c !== 95 && kindOf(c) !== K_OTHER;
  return RE_PUNCT_SPACE.test(ch);
}

// /[\p{L}\p{N}]/u.test(ch) for marked's prevChar strings
function hasAlnum(ch) {
  if (ch.length === 1) {
    const c = ch.charCodeAt(0);
    if (c < 128) return (CLS[c] & C_ALNUM) !== 0;
  }
  return RE_ALNUM_U.test(ch);
}

function lastCodePoint(s, l) {
  if (l <= 0) return '';
  const lo = s.charCodeAt(l - 1);
  if (l >= 2 && lo >= 0xdc00 && lo <= 0xdfff) {
    const hi = s.charCodeAt(l - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return s.slice(l - 2, l);
  }
  return s[l - 1];
}

// n characters of the "a" filler masked spans get (a slice of one string when short enough)
const A_FILL = 'a'.repeat(4096);
function fill(n) {
  return n <= 4096 ? A_FILL.slice(0, n) : 'a'.repeat(n);
}

/** marked's emStrongMask: hide what emphasis must not see (link text, code, tags, escapes). */
function maskSrc(src) {
  // every masking pass needs one of these characters; without them it leaves the text unchanged
  const br = src.indexOf('[') !== -1;
  const tick = src.indexOf('`') !== -1;
  const bs = src.indexOf('\\') !== -1;
  const lt = src.indexOf('<') !== -1;
  let t = src;
  if (br && defCount > 0 && definedBracket(t)) t = t.replace(RE_REFSEARCH, refMask);
  if (tick || bs) t = maskCodeEscapes(t);
  // (a link span needs "](")
  if (tick || lt || (br && t.indexOf('](') !== -1)) t = maskSkips(t);
  return t;
}

// Pass 2, marked's anyPunctuationOutsideCode replace done as a scan: inside a code span each inner
// backtick becomes "+"; outside code spans a backslash and the punctuation it escapes become "+"s.
function maskCodeEscapes(t) {
  const n = t.length;
  let out = '';
  let last = 0;
  let i = 0;
  let nTick = -1;
  let nBs = -1;
  while (i < n) {
    const c = t.charCodeAt(i);
    if (c === 96) {
      let e = i + 1;
      while (e < n && t.charCodeAt(e) === 96) e++;
      const L = e - i;
      // the span closes at the next run of exactly L backticks (it cannot be empty)
      let close = -1;
      for (let j = e; j < n; ) {
        j = t.indexOf('`', j);
        if (j === -1) break;
        let k = j + 1;
        while (k < n && t.charCodeAt(k) === 96) k++;
        if (k - j === L) {
          close = j;
          break;
        }
        j = k;
      }
      if (close === -1) {
        i = e;
        continue;
      }
      if (t.indexOf('`', e) < close) {
        out += t.slice(last, e) + t.slice(e, close).replace(/`/g, '+');
        last = close;
      }
      i = close + L;
      continue;
    }
    if (c === 92) {
      const cp = cpAt(t, i + 1);
      if (cp >= 0 && kindOf(cp) === K_PUNCT) {
        const len = cp > 0xffff ? 3 : 2;
        out += t.slice(last, i) + (len === 2 ? '++' : '+++');
        last = i + len;
        i += len;
        continue;
      }
      i++;
      continue;
    }
    if (nTick < i) nTick = t.indexOf('`', i);
    if (nTick === -1) nTick = n;
    if (nBs < i) nBs = t.indexOf('\\', i);
    if (nBs === -1) nBs = n;
    i = nTick < nBs ? nTick : nBs;
  }
  return last === 0 ? t : out + t.slice(last);
}

// end of a blockSkip link destination "(...)" body starting at j (just after "]("), or -1:
// escapes, characters other than parentheses, and one level of balanced parentheses, then ")"
function skipDestEnd(t, j) {
  const n = t.length;
  while (j < n) {
    const c = t.charCodeAt(j);
    if (c === 41) return j + 1;
    if (c === 92) {
      if (j + 1 >= n) return -1;
      j += 2;
    } else if (c === 40) {
      let k = j + 1;
      for (;;) {
        if (k >= n) return -1;
        const d = t.charCodeAt(k);
        if (d === 41) break;
        if (d === 40) return -1;
        k += d === 92 ? 2 : 1;
      }
      j = k + 1;
    } else j++;
  }
  return -1;
}

// blockSkip's link alternative at i: "[" (no brackets; code spans allowed) "](" destination ")"
function skipLinkEnd(t, i) {
  const n = t.length;
  let j = i + 1;
  while (j < n) {
    const c = t.charCodeAt(j);
    if (c === 93) return (j + 1 < t.length ? t.charCodeAt(j + 1) : -1) === 40 ? skipDestEnd(t, j + 2) : -1;
    if (c === 91) return -1;
    if (c === 96) {
      let e = j + 1;
      while (e < n && t.charCodeAt(e) === 96) e++;
      const k = e < n ? t.indexOf('`', e) : -1;
      if (k <= e) return -1;
      let k2 = k + 1;
      while (k2 < n && t.charCodeAt(k2) === 96) k2++;
      if (k2 - k !== e - j) return -1;
      j = k2;
    } else j++;
  }
  return -1;
}

// Pass 3, marked's blockSkip replace done as a scan: link spans, code spans and <...> spans become
// "[aaa]" of the same length.
function maskSkips(t) {
  const n = t.length;
  let out = '';
  let last = 0;
  let i = 0;
  let nBr = -1;
  let nTick = -1;
  let nLt = -1;
  while (i < n) {
    const c = t.charCodeAt(i);
    let end = -1;
    if (c === 91) end = skipLinkEnd(t, i);
    else if (c === 96) {
      // (?<!`)(`+)[^`]+\1(?!`)
      if (i === 0 || t.charCodeAt(i - 1) !== 96) {
        let e = i + 1;
        while (e < n && t.charCodeAt(e) === 96) e++;
        const k = e < n ? t.indexOf('`', e) : -1;
        if (k > e) {
          let k2 = k + 1;
          while (k2 < n && t.charCodeAt(k2) === 96) k2++;
          if (k2 - k === e - i) end = k2;
        }
      }
    } else if (c === 60) {
      // <(?! )[^<>]*?>
      if (i + 1 < n && t.charCodeAt(i + 1) !== 32) {
        let j = i + 1;
        while (j < n) {
          const d = t.charCodeAt(j);
          if (d === 62 || d === 60) break;
          j++;
        }
        if (j < n && t.charCodeAt(j) === 62) end = j + 1;
      }
    } else {
      if (nBr < i) nBr = t.indexOf('[', i);
      if (nBr === -1) nBr = n;
      if (nTick < i) nTick = t.indexOf('`', i);
      if (nTick === -1) nTick = n;
      if (nLt < i) nLt = t.indexOf('<', i);
      if (nLt === -1) nLt = n;
      i = nBr < nTick ? (nBr < nLt ? nBr : nLt) : nTick < nLt ? nTick : nLt;
      continue;
    }
    if (end === -1) {
      i++;
      continue;
    }
    out += t.slice(last, i) + '[' + fill(end - i - 2) + ']';
    last = end;
    i = end;
  }
  return last === 0 ? t : out + t.slice(last);
}

// refMask changes a match only when the text between its last "[" and its final "]" is a defined
// label. Every match ends at some "]" of t, and its last "[" is the last "[" of t before that "]",
// so when no "]" of t has a defined label in front of it, the reference pass changes nothing.
function definedBracket(t) {
  for (let j = t.indexOf(']'); j !== -1; j = t.indexOf(']', j + 1)) {
    const i = t.lastIndexOf('[', j);
    if (i === -1) continue;
    // "...](": a match of the short form cannot end here (it refuses a following "("); the full
    // form "[text][label]" has a "]" right before its last "[" (or a "\" when that "[" is escaped)
    if (j + 1 < t.length && t.charCodeAt(j + 1) === 40) {
      const b = i > 0 ? t.charCodeAt(i - 1) : -1;
      if (b !== 93 && b !== 92) continue;
    }
    if (normLabel(t.slice(i + 1, j)) in links) return true;
  }
  return false;
}

function refMask(r) {
  const o = r.lastIndexOf('[');
  if (!(normLabel(r.slice(o + 1, -1)) in links)) return r;
  if (o > 1 && r[0] !== '!') {
    const inner = r.slice(1, o - 1);
    if (linkInText(inner)) return '[' + inner.replace(RE_REFSEARCH, refMask) + '][' + fill(r.length - o - 2) + ']';
  }
  return '[' + fill(r.length - 2) + ']';
}

function linkInText(e) {
  if (e.indexOf('[') === -1) return false;
  for (const n of e.matchAll(RE_BLOCKSKIP)) if (RE_LINK_A.test(n[0]) && e.charAt(n.index - 1) !== '!') return true;
  for (const n of e.matchAll(RE_REFSEARCH)) {
    const s = n[0];
    const r = s.lastIndexOf('[');
    if (!(s.charAt(0) === '!' || !(normLabel(s.slice(r + 1, -1)) in links)) && !(r > 1 && linkInText(s.slice(1, r - 1)))) return true;
  }
  return false;
}

/** Does the link label contain an HTML tag or autolink that runs past its closing bracket? */
function labelSpillsTag(src, start, label) {
  if (label.indexOf('<') === -1) return false;
  for (let s = 0; s < label.length; s++) {
    const ch = label[s];
    if (ch === '\\') {
      s++;
      continue;
    }
    if (ch === '`') {
      const i = RE_CODESPAN_A.exec(label.slice(s));
      if (i !== null) {
        s += i[0].length - 1;
        continue;
      }
    }
    if (ch !== '<') continue;
    const r = src.slice(start + s);
    const o = RE_TAG_A.exec(r) || RE_AUTOLINK_A.exec(r);
    if (o !== null) {
      if (o[0].length > label.length - s) return true;
      s += o[0].length - 1;
    }
  }
  return false;
}

// output of the inline pass for one link/image; null when marked rejects it
function linkOrImage(isImage, label, href, title, plain) {
  const text = label.indexOf('\\') === -1 ? label : label.replace(/\\([\[\]])/g, '$1');
  const savedInLink = inLink, savedEmitted = linkEmitted, savedRaw = inRawBlock;
  inLink = true;
  linkEmitted = false;
  const inner = inline(text, plain || isImage);
  const emitted = linkEmitted;
  linkEmitted = savedEmitted;
  inLink = savedInLink;
  if (!isImage) {
    if (emitted) {
      inRawBlock = savedRaw;
      return null;
    }
    linkEmitted = true;
  }
  if (plain) return inner;
  const url = cleanUrl(href);
  if (isImage) {
    if (url === null) return escapeHtml(inner);
    return '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(inner) + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>';
  }
  if (url === null) return inner;
  return '<a href="' + escapeHtml(url) + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + inner + '</a>';
}

function autolinkHtml(text, href, plain) {
  if (plain) return text;
  const t = escapeAll(text);
  const url = cleanUrl(href);
  if (url === null) return t;
  return '<a href="' + escapeAll(url) + '">' + t + '</a>';
}

// Everything that can start an inline rule other than plain text, or end a text token: without any
// of these the whole text is a single text token.
const RE_INLINE_SPECIAL = /[\\<!\[`*~_@]|[hH][tT][tT][pP]|[fF][tT][pP]:\/\/|www\.|mailto:|xmpp:| {2,}\n/;

function inline(src, plain) {
  if (!RE_INLINE_SPECIAL.test(src)) {
    if (inRawBlock) return src;
    const text = decodeNumeric(src);
    return plain ? text : escapeHtml(text);
  }
  let paren = -1; // marked's linkParenPossible: whether this text has a ")" (-1: not checked yet)
  const len = src.length;
  let out = '';
  // The current text run: consecutive text tokens, which are contiguous in src. Undecoded text is
  // src[runStart, pos); runBuf holds what came before it when a token had to be decoded.
  let runStart = -1;
  let runBuf = '';
  let runEscape = false; // escape the run when it is flushed
  let ctx = null; // mask and closer bounds, built when emphasis or strikethrough first needs them
  let prev = ''; // last character of the previous text token (marked's prevChar)
  let wasText = false;
  let at = src.indexOf('@');
  let amp = src.indexOf('&');
  let pos = 0;
  while (pos < len) {
    if (!wasText) prev = '';
    wasText = false;
    if (at !== -1 && at < pos) at = src.indexOf('@', pos);
    const c = src.charCodeAt(pos);
    let html = null;
    let end = -1;

    switch (c) {
      case 92: {
        // escape, then hard break
        RE_ESCAPE.lastIndex = pos;
        if (RE_ESCAPE.test(src)) {
          end = pos + 2;
          const ch = src[pos + 1];
          html = plain ? ch : escapeHtml(ch);
          break;
        }
        RE_BR.lastIndex = pos;
        if (RE_BR.test(src)) {
          end = RE_BR.lastIndex;
          html = plain ? '' : '<br>';
        }
        break;
      }
      case 60: {
        RE_TAG.lastIndex = pos;
        if (RE_TAG.test(src)) {
          const raw = src.slice(pos, RE_TAG.lastIndex);
          if (!inLink && /^<a /i.test(raw)) inLink = true;
          else if (inLink && /^<\/a>/i.test(raw)) inLink = false;
          if (!inRawBlock && /^<(pre|code|kbd|script)(\s|>)/i.test(raw)) inRawBlock = true;
          else if (inRawBlock && /^<\/(pre|code|kbd|script)(\s|>)/i.test(raw)) inRawBlock = false;
          end = pos + raw.length;
          html = raw;
          break;
        }
        RE_AUTOLINK.lastIndex = pos;
        if (RE_AUTOLINK.test(src)) {
          end = RE_AUTOLINK.lastIndex;
          // <scheme:...> always holds a ":", which the email form cannot
          const inner = src.slice(pos + 1, end - 1);
          html = autolinkHtml(inner, inner.indexOf(':') === -1 ? 'mailto:' + inner : inner, plain);
        }
        break;
      }
      case 33:
      case 91: {
        if (c === 33 && (pos + 1 < src.length ? src.charCodeAt(pos + 1) : -1) !== 91) break;
        if (paren === -1) paren = src.indexOf(')') === -1 ? 0 : 1;
        if (paren === 1) {
          html = tryLink(src, pos, plain);
          if (html !== null) {
            end = gEnd;
            break;
          }
        }
        RE_REFLINK.lastIndex = pos;
        let m = RE_REFLINK.exec(src);
        if (m === null) {
          RE_NOLINK.lastIndex = pos;
          m = RE_NOLINK.exec(src);
        }
        if (m !== null && !labelSpillsTag(src, pos + (c === 33 ? 2 : 1), m[1])) {
          const def = links[normLabel(m[2] || m[1])];
          if (def === undefined) {
            // a lone "[" or "!" text token: joins the text run but is no inline text token itself
            if (runStart === -1) {
              runStart = pos;
              runEscape = true;
            }
            pos += 1;
            continue;
          }
          const h = linkOrImage(c === 33, m[1], def.href, def.title || null, plain);
          if (h !== null) {
            end = pos + m[0].length;
            html = h;
          }
        }
        break;
      }
      case 42:
      case 95: {
        if (ctx === null) ctx = { masked: null, ast: -2, und: -2, til: -2 };
        html = emStrong(src, pos, prev, ctx, plain);
        if (html === null && c === 95 && !inLink && urlCouldStart(src, pos, at)) html = tryUrl(src, pos, plain);
        if (html !== null) end = gEnd;
        break;
      }
      case 96: {
        RE_CODESPAN.lastIndex = pos;
        if (RE_CODESPAN.test(src)) {
          // the closing run is as long as the opening one, which starts at pos
          let ticks = 1;
          while (src.charCodeAt(pos + ticks) === 96) ticks++;
          end = RE_CODESPAN.lastIndex;
          const inner = src.slice(pos + ticks, end - ticks);
          let t = inner.indexOf('\n') === -1 ? inner : inner.replace(/\n/g, ' ');
          if (/[^ ]/.test(t) && t[0] === ' ' && t[t.length - 1] === ' ') t = t.substring(1, t.length - 1);
          html = plain ? t : '<code>' + escapeAll(t) + '</code>';
        }
        break;
      }
      case 32: {
        RE_BR.lastIndex = pos;
        if (RE_BR.test(src)) {
          end = RE_BR.lastIndex;
          html = plain ? '' : '<br>';
        }
        break;
      }
      case 126: {
        if (ctx === null) ctx = { masked: null, ast: -2, und: -2, til: -2 };
        html = del(src, pos, prev, ctx, plain);
        if (html !== null) end = gEnd;
        break;
      }
      default:
        if (!inLink && ((c < 128 && CLS[c] & C_ALNUM) || c === 46 || c === 43 || c === 45) && urlCouldStart(src, pos, at)) {
          html = tryUrl(src, pos, plain);
          if (html !== null) end = gEnd;
        }
    }

    if (html !== null) {
      if (runStart !== -1) {
        const run = runBuf + src.slice(runStart, pos);
        out += runEscape && !plain ? escapeHtml(run) : run;
        runStart = -1;
        runBuf = '';
      }
      out += html;
      pos = end;
      continue;
    }

    // inline text
    end = textEnd(src, pos, at);
    if (runStart === -1) {
      runStart = pos;
      runEscape = !inRawBlock;
    }
    if (amp !== -1 && amp < end) {
      if (amp < pos) amp = src.indexOf('&', pos);
      if (amp !== -1 && amp < end && !inRawBlock) {
        // marked decodes numeric references token by token
        const raw = src.slice(pos, end);
        const dec = decodeNumeric(raw);
        if (dec !== raw) {
          runBuf += src.slice(runStart, pos) + dec;
          runStart = end;
        }
      }
    }
    const last = src.charCodeAt(end - 1);
    if (last !== 95) prev = src[end - 1];
    wasText = true;
    pos = end;
  }
  if (runStart !== -1) {
    const run = runBuf + src.slice(runStart, pos);
    out += runEscape && !plain ? escapeHtml(run) : run;
  }
  return out;
}

function tryLink(src, pos, plain) {
  RE_LINK.lastIndex = pos;
  const m = RE_LINK.exec(src);
  if (m === null) return null;
  const isImage = m[0][0] === '!';
  if (labelSpillsTag(src, pos + (isImage ? 2 : 1), m[1])) return null;
  let raw = m[0];
  let href = m[2];
  let title = m[3];
  const s = href.trim();
  if (s[0] === '<') {
    if (s[s.length - 1] !== '>') return null;
    const l = rtrimChar(s.slice(0, -1), '\\');
    if ((s.length - l.length) % 2 === 0) return null;
  } else {
    const l = closingParen(m[2]);
    if (l === -2) return null;
    if (l > -1) {
      const h = (raw.indexOf('!') === 0 ? 5 : 4) + m[1].length + l;
      href = m[2].substring(0, l);
      raw = raw.substring(0, h).trim();
      title = '';
    }
  }
  const r = rtrimChar(raw.slice(0, -1), '\\');
  if ((raw.length - r.length) % 2 === 0) return null;
  title = title ? title.slice(1, -1) : '';
  href = href.trim();
  if (href[0] === '<') href = href.slice(1, -1);
  const html = linkOrImage(isImage, m[1], href && unescapePunct(href), title && unescapePunct(title), plain);
  if (html === null) return null;
  gEnd = pos + raw.length;
  return html;
}

// Can marked's gfm url rule match at pos? It needs "http"/"ftp" (then "://"), "www.", "mailto:",
// "xmpp:", or a run of [A-Za-z0-9._+-] reaching the next "@" (at: its index, -1 if none).
function urlCouldStart(src, pos, at) {
  const c = src.charCodeAt(pos);
  if (c === 104 || c === 72) {
    if (((pos + 1 < src.length ? src.charCodeAt(pos + 1) : -1) | 32) === 116 && ((pos + 2 < src.length ? src.charCodeAt(pos + 2) : -1) | 32) === 116 && ((pos + 3 < src.length ? src.charCodeAt(pos + 3) : -1) | 32) === 112) return true;
  } else if (c === 102 || c === 70) {
    if (((pos + 1 < src.length ? src.charCodeAt(pos + 1) : -1) | 32) === 116 && ((pos + 2 < src.length ? src.charCodeAt(pos + 2) : -1) | 32) === 112) return true;
  } else if (c === 119) {
    if (src.startsWith('www.', pos)) return true;
  } else if (c === 109) {
    if (src.startsWith('mailto:', pos)) return true;
  } else if (c === 120) {
    if (src.startsWith('xmpp:', pos)) return true;
  }
  if (at === -1) return false;
  let j = pos;
  while (j < at) {
    const d = src.charCodeAt(j);
    if (!((d < 128 && CLS[d] & C_ALNUM) || d === 46 || d === 95 || d === 43 || d === 45)) return false;
    j++;
  }
  return j > pos;
}

function tryUrl(src, pos, plain) {
  RE_URL.lastIndex = pos;
  const m = RE_URL.exec(src);
  if (m === null) return null;
  let text = m[0];
  let href;
  if (m[2] === '@') href = 'mailto:' + text;
  else {
    let prevText;
    do {
      prevText = text;
      const b = RE_BACKPEDAL.exec(text);
      text = b === null ? '' : b[0];
    } while (prevText !== text);
    href = m[1] === 'www.' ? 'http://' + text : text;
  }
  if (text === '') return null; // marked throws (no progress); never seen in valid cases
  gEnd = pos + text.length;
  return autolinkHtml(text, href, plain);
}

// ---------------------------------------------------------------------------------------------
// Delimiter runs. marked finds emphasis and strikethrough closers with global regexes over the
// masked text; every alternative of those regexes matches a whole run of the delimiter, chosen only
// by the code point before the run and the one after it. Classifying runs directly gives the same
// group numbers (1-6) without running the regexes.

const K_OTHER = 0, K_SPACE = 1, K_PUNCT = 2;
const RE_UNI_PUNCT = /^[\p{P}\p{S}]$/u;

function kindOf(cp) {
  if (cp < 128) {
    if (cp === 32 || (cp >= 9 && cp <= 13)) return K_SPACE;
    if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return K_PUNCT;
    return K_OTHER;
  }
  if (cp <= 0xffff && isJsSpace(cp)) return K_SPACE;
  return RE_UNI_PUNCT.test(String.fromCodePoint(cp)) ? K_PUNCT : K_OTHER;
}

// code point starting at i (-1 past the end) and the one ending just before i (-1 at 0)
function cpAt(s, i) {
  if (i >= s.length) return -1;
  const c = s.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
    const d = s.charCodeAt(i + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return ((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
  }
  return c;
}
function cpBefore(s, i) {
  if (i <= 0) return -1;
  const d = s.charCodeAt(i - 1);
  if (d >= 0xdc00 && d <= 0xdfff && i >= 2) {
    const c = s.charCodeAt(i - 2);
    if (c >= 0xd800 && c <= 0xdbff) return ((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
  }
  return d;
}

// Group of marked's closer regex a run of `delim` matches, given the code points around it (0: none).
// `tildeWord`: the gfm "*" closer, where "~" counts as a word character instead of punctuation.
function runGroup(prev, next, delim, tildeWord) {
  let pk = kindOf(prev);
  let nk = next < 0 ? -1 : kindOf(next);
  if (tildeWord) {
    if (prev === 126) pk = K_OTHER;
    if (next === 126) nk = K_OTHER;
  }
  const nextEndOrSpace = nk === -1 || nk === K_SPACE;
  if (pk === K_PUNCT && prev !== delim && nextEndOrSpace) return 1;
  if (pk === K_OTHER && (nk !== K_OTHER)) return 2;
  if (pk !== K_OTHER && prev !== delim && nk === K_OTHER) return 3;
  if (pk === K_SPACE && nk === K_PUNCT) return 4;
  if (pk === K_PUNCT && prev !== delim && nk === K_PUNCT) return 5;
  if (pk === K_OTHER && nk === K_OTHER && delim !== 95) return 6;
  return 0;
}

// index of the first "*" or "_" at or after i, -1 if none
const RE_NOT_EM = /[^_*]*/y;
function nextEmChar(m, i) {
  RE_NOT_EM.lastIndex = i;
  RE_NOT_EM.test(m);
  const j = RE_NOT_EM.lastIndex;
  return j < m.length ? j : -1;
}

// marked's closer regexes open with ^[^_*]*?__[^_*]*?\*[^_*]*?(?=__) (and its mirror for "_"):
// a lone delimiter inside a double run of the other kind is skipped. Returns the scan start.
function emHeadSkip(m, Q, r) {
  const a = r === 42 ? 95 : 42;
  const j = nextEmChar(m, Q);
  if (j < 0 || m.charCodeAt(j) !== a || (j + 1 < m.length ? m.charCodeAt(j + 1) : -1) !== a) return Q;
  const j2 = nextEmChar(m, j + 2);
  if (j2 < 0 || m.charCodeAt(j2) !== r) return Q;
  const j3 = nextEmChar(m, j2 + 1);
  if (j3 < 0 || m.charCodeAt(j3) !== a || (j3 + 1 < m.length ? m.charCodeAt(j3 + 1) : -1) !== a) return Q;
  return j3;
}

/** Start of the last run of `c` whose preceding character is not blank (marked's closer bound). */
function lastRun(m, ch) {
  const c = ch.charCodeAt(0);
  let i = m.lastIndexOf(ch);
  while (i !== -1) {
    let s = i;
    while (s > 0 && m.charCodeAt(s - 1) === c) s--;
    const pc = s === 0 ? 10 : m.charCodeAt(s - 1);
    if (pc !== 32 && pc !== 9 && pc !== 10 && pc !== 13 && pc !== 12) return s;
    i = s === 0 ? -1 : m.lastIndexOf(ch, s - 1);
  }
  return -1;
}

let gEnd = 0; // end index of the last successful emStrong/del/link/url match

function emStrong(src, pos, prevChar, ctx, plain) {
  const r = src.charCodeAt(pos);
  let re = pos + 1;
  while ((re < src.length ? src.charCodeAt(re) : -1) === r) re++;
  const k = re - pos;
  const nx = cpAt(src, re);
  if (nx < 0) return null;
  const nk = kindOf(nx);
  if (nk === K_SPACE) return null;
  const opensPunct = nk === K_PUNCT && nx !== 126; // marked's s[1] / s[3]
  if (pos === 0 || src.charCodeAt(pos - 1) !== r) {
    // masking never creates a delimiter, so the run cannot extend backwards in the masked text
    // either: marked's early rejections below need only the previous text token's character
    if (r === 95 && !opensPunct && hasAlnum(prevChar)) return null;
    if (opensPunct && prevChar && !isPunctSpace(prevChar)) return null;
  }
  if (ctx.masked === null) ctx.masked = maskSrc(src);
  const masked = ctx.masked;
  const delim = r === 42 ? '*' : '_';
  const sameAsPrev = prevChar === delim;
  let l = pos;
  while (l > 0 && masked.charCodeAt(l - 1) === r) l--;
  const p = lastCodePoint(masked, l);
  const pIsPunct = p === '*' || p === '_' || isPunctSpace(p);
  let n = prevChar;
  if (l < pos) n = p;
  const u = l < pos ? pIsPunct : isPunctSpace(n);
  if (r === 95 && !opensPunct && hasAlnum(n)) return null;
  if (opensPunct && n && !u) return null;
  let remaining = k;
  let skipped = 0;
  const y = pos - l + k;
  const strict = !!p.trim() && (opensPunct || (r === 42 && !pIsPunct));
  let v;
  if (r === 42) {
    if (ctx.ast === -2) ctx.ast = lastRun(masked, '*');
    v = ctx.ast;
  } else {
    if (ctx.und === -2) ctx.und = lastRun(masked, '_');
    v = ctx.und;
  }
  const Q = pos + k;
  if (v < Q) return null;
  let cur = emHeadSkip(masked, Q, r);
  for (;;) {
    const rs = masked.indexOf(delim, cur);
    if (rs === -1) return null;
    let rend = rs + 1;
    while ((rend < masked.length ? masked.charCodeAt(rend) : -1) === r) rend++;
    const prev = cpBefore(masked, rs);
    if (rs - (prev > 0xffff ? 2 : 1) > v) return null;
    cur = rend;
    const g = runGroup(prev, cpAt(masked, rend), r, r === 42);
    if (g === 0) continue;
    let b = rend - rs;
    if (g === 3 || g === 4) {
      remaining += b;
      continue;
    } else if (g >= 5 || strict) {
      if (sameAsPrev && g >= 5) return null;
      if (y % 3 && !((y + b) % 3)) {
        skipped += b;
        continue;
      }
    }
    remaining -= b;
    if (remaining > 0) continue;
    b = Math.min(b, b + remaining + skipped);
    const end = rs + b;
    if (Math.min(k, b) % 2) {
      const inner = inline(src.slice(pos + 1, end - 1), plain);
      gEnd = end;
      return plain ? inner : '<em>' + inner + '</em>';
    }
    const inner = inline(src.slice(pos + 2, end - 2), plain);
    gEnd = end;
    return plain ? inner : '<strong>' + inner + '</strong>';
  }
}

function del(src, pos, prevChar, ctx, plain) {
  let re = pos + 1;
  while ((re < src.length ? src.charCodeAt(re) : -1) === 126) re++;
  const o = re - pos;
  if (o > 2) return null;
  const nx = cpAt(src, re);
  if (nx < 0) return null;
  const nk = kindOf(nx);
  if (nk === K_SPACE) return null;
  if (nk === K_PUNCT && prevChar && !isPunctSpace(prevChar)) return null;
  if (ctx.masked === null) ctx.masked = maskSrc(src);
  const masked = ctx.masked;
  if (ctx.til === -2) ctx.til = lastRun(masked, '~');
  const u = ctx.til;
  const d = pos + o;
  if (u < d) return null;
  let remaining = o;
  let cur = d;
  for (;;) {
    const rs = masked.indexOf('~', cur);
    if (rs === -1) return null;
    let rend = rs + 1;
    while ((rend < masked.length ? masked.charCodeAt(rend) : -1) === 126) rend++;
    const prev = cpBefore(masked, rs);
    if (rs - (prev > 0xffff ? 2 : 1) > u) return null;
    cur = rend;
    const len = rend - rs;
    if (len > 2) continue;
    const g = runGroup(prev, cpAt(masked, rend), 126, false);
    if (g === 0 || len !== o) continue;
    if (g === 3 || g === 4) {
      remaining += len;
      continue;
    }
    remaining -= len;
    if (remaining > 0) continue;
    const end = rs + Math.min(len, len + remaining);
    const inner = inline(src.slice(pos + o, end - o), plain);
    gEnd = end;
    return plain ? inner : '<del>' + inner + '</del>';
  }
}

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
const PARA_SRC = R`[^\n]+(?:\n(?!${HR_CAP}|${HEAD_OPEN}| {0,3}>|${FENCE_OPEN}| {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]|${HTML_OPEN}|${TABLE_SRC}|[ \t]+\n)[^\n]+)*`;
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
const RE_PARA = new RegExp(PARA_SRC, 'y');
const RE_TEXT = /[^\n]+/y;
const RE_SETEXT_SCAN = /\n {0,3}[=-]/g;
const RE_HR_A = new RegExp('^' + HR_CAP);

const RE_CODE_INDENT = /^(?: {0,3}\t| {1,4})/gm;
const RE_BQ_START = /^ {0,3}>/;
const RE_BQ_MARKER_WS = /^( {0,3}>)([ \t]+)/gm;
const RE_BQ_SETEXT = /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g;
const RE_BQ_STRIP = /^ {0,3}>[ \t]?/gm;

// list item helpers, one per indent clamp 0..3
const ind = (f) => [0, 1, 2, 3].map(f);
const NEXT_BULLET = ind((n) => new RegExp(`^ {0,${n}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`));
const HR_IND = ind((n) => new RegExp(`^ {0,${n}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\\n+|$)`));
const FENCE_IND = ind((n) => new RegExp(`^ {0,${n}}(?:\`\`\`|~~~)`));
const HEAD_IND = ind((n) => new RegExp(`^ {0,${n}}#{1,6}(?:\\s|$)`));
const HTML_IND = ind((n) => new RegExp(`^ {0,${n}}(?:<\\/?(?:${TAGS})(?: +|$|\\/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i'));
const BQ_IND = ind((n) => new RegExp(`^ {0,${n}}>`));
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
const RE_PUNCT_OUTSIDE_CODE = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu;
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

const P_PUNCT = R`[\p{P}\p{S}]`;
const P_PUNCT_NT = R`(?!~)[\p{P}\p{S}]`;
const RE_EM_L = /(?:\*+(?:((?!\*)(?!~)[\p{P}\p{S}])|([^\s*]))?)|_+(?:((?!_)(?!~)[\p{P}\p{S}])|([^\s_]))?/uy;
const RE_EM_AST_HEAD = /[^_*]*?__[^_*]*?\*[^_*]*?(?=__)/uy;
const RE_EM_AST = new RegExp(R`[^*]+(?=[^*])|(?!\*)${P_PUNCT_NT}(\*+)(?=[\s]|$)|(?:[^\s\p{P}\p{S}]|~)(\*+)(?!\*)(?=(?!~)[\s\p{P}\p{S}]|$)|(?!\*)(?!~)[\s\p{P}\p{S}](\*+)(?=(?:[^\s\p{P}\p{S}]|~))|[\s](\*+)(?!\*)(?=${P_PUNCT_NT})|(?!\*)${P_PUNCT_NT}(\*+)(?!\*)(?=${P_PUNCT_NT})|(?:[^\s\p{P}\p{S}]|~)(\*+)(?=(?:[^\s\p{P}\p{S}]|~))`, 'gu');
const RE_EM_UND_HEAD = /[^_*]*?\*\*[^_*]*?_[^_*]*?(?=\*\*)/uy;
const RE_EM_UND = new RegExp(R`[^_]+(?=[^_])|(?!_)${P_PUNCT}(_+)(?=[\s]|$)|[^\s\p{P}\p{S}](_+)(?!_)(?=[\s\p{P}\p{S}]|$)|(?!_)[\s\p{P}\p{S}](_+)(?=[^\s\p{P}\p{S}])|[\s](_+)(?!_)(?=${P_PUNCT})|(?!_)${P_PUNCT}(_+)(?!_)(?=${P_PUNCT})`, 'gu');
const RE_DEL_L = /~~?(?:((?!~)[\p{P}\p{S}])|[^\s~])/uy;
const RE_DEL_HEAD = /[^~]+(?=[^~])/uy;
const RE_DEL = new RegExp(R`(?!~)${P_PUNCT}(~~?)(?=[\s]|$)|[^\s\p{P}\p{S}](~~?)(?!~)(?=[\s\p{P}\p{S}]|$)|(?!~)[\s\p{P}\p{S}](~~?)(?=[^\s\p{P}\p{S}])|[\s](~~?)(?!~)(?=${P_PUNCT})|(?!~)${P_PUNCT}(~~?)(?!~)(?=${P_PUNCT})|[^\s\p{P}\p{S}](~~?)(?=[^\s\p{P}\p{S}])`, 'gu');
const RE_PUNCT_SPACE = /^(?![*_])[\s\p{P}\p{S}]/u;
const RE_ALNUM_U = /[\p{L}\p{N}]/u;

// ---------------------------------------------------------------------------------------------
// Per-parse state (reset at the start of every parse call; nothing survives between calls)

let links = null; // label -> {href, title}
let queue = null; // blocks whose inline text is rendered after the block pass, in creation order
let top = true;
let inLink = false;
let inRawBlock = false;
let linkEmitted = false;
let lpp = true; // marked's linkParenPossible

const T_SPACE = 1, T_CODE = 2, T_HEADING = 3, T_HR = 4, T_BQ = 5, T_LIST = 6, T_HTML = 7, T_DEF = 8,
  T_TABLE = 9, T_PARA = 10, T_TEXT = 11, T_CHECKBOX = 12;

export function parse(markdown) {
  const src = markdown.indexOf('\r') === -1 ? markdown : markdown.replace(/\r\n|\r/g, '\n');
  links = Object.create(null);
  queue = [];
  top = true;
  inLink = false;
  inRawBlock = false;
  linkEmitted = false;
  lpp = true;
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

function normLabel(s) {
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
    let i = pos;
    let c = src.charCodeAt(i);
    while (c === 32) c = src.charCodeAt(++i);
    const indent = i - pos;
    let m;

    if (c === 10 || c === 9 || i >= len) {
      RE_NEWLINE.lastIndex = pos;
      m = RE_NEWLINE.exec(src);
      if (m !== null && m[0].length > 0) {
        const raw = m[0];
        pos += raw.length;
        const last = out[out.length - 1];
        if (raw.length === 1 && last !== undefined) last.raw += '\n';
        else out.push({ type: T_SPACE, raw });
        continue;
      }
    }

    if (indent >= 4 || c === 9) {
      RE_CODE.lastIndex = pos;
      m = RE_CODE.exec(src);
      if (m !== null) {
        const raw = trimBlankTail(m[0]);
        const text = raw.replace(RE_CODE_INDENT, '');
        pos += raw.length;
        const last = out[out.length - 1];
        if (last !== undefined && (last.type === T_PARA || last.type === T_TEXT)) {
          last.raw += (last.raw.endsWith('\n') ? '' : '\n') + raw;
          last.q.src += '\n' + text;
        } else out.push({ type: T_CODE, raw, text, lang: '' });
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
          out.push({ type: T_CODE, raw, text: fenceIndent(raw, m[3] || ''), lang: m[2] ? m[2].trim().replace(RE_ANY_PUNCT, '$1') : m[2] });
          continue;
        }
      }
      if (c === 35) {
        RE_HEADING.lastIndex = pos;
        m = RE_HEADING.exec(src);
        if (m !== null) {
          let text = m[2].trim();
          if (text.endsWith('#')) {
            const s = rtrimChar(text, '#');
            if (!s || /[ \t]$/.test(s)) text = s.trim();
          }
          const raw = rtrimChar(m[0], '\n');
          pos += raw.length;
          out.push({ type: T_HEADING, raw, depth: m[1].length, q: newQ(text) });
          continue;
        }
      }
      if (c === 45 || c === 95 || c === 42) {
        RE_HR.lastIndex = pos;
        m = RE_HR.exec(src);
        if (m !== null) {
          const raw = rtrimChar(m[0], '\n');
          pos += raw.length;
          out.push({ type: T_HR, raw });
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
        m = RE_HTML.exec(src);
        if (m !== null) {
          const raw = trimBlankTail(m[0]);
          pos += raw.length;
          out.push({ type: T_HTML, raw, text: raw });
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
            last.raw += (last.raw.endsWith('\n') ? '' : '\n') + raw;
            last.q.src += '\n' + raw;
          } else {
            const tag = normLabel(m[1]);
            if (!(tag in links)) {
              links[tag] = {
                href: m[2] ? m[2].replace(/^<(.*)>$/, '$1').replace(RE_ANY_PUNCT, '$1') : '',
                title: m[3] ? m[3].substring(1, m[3].length - 1).replace(RE_ANY_PUNCT, '$1') : m[3],
              };
            }
            out.push({ type: T_DEF, raw });
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
        while (k < lim && src.charCodeAt(k) === 32) k++;
        const d = src.charCodeAt(k);
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
    if (setextAt < pos) {
      RE_SETEXT_SCAN.lastIndex = pos;
      const s = RE_SETEXT_SCAN.exec(src);
      setextAt = s === null ? len + 1 : s.index;
    }
    if (blankAt < pos) {
      const b = src.indexOf('\n\n', pos);
      blankAt = b === -1 ? len + 1 : b;
    }
    if (setextAt < blankAt) {
      RE_LHEADING.lastIndex = pos;
      m = RE_LHEADING.exec(src);
      if (m !== null) {
        const raw = rtrimChar(m[0], '\n');
        pos += raw.length;
        out.push({ type: T_HEADING, raw, depth: m[2][0] === '=' ? 1 : 2, q: newQ(m[1].trim()) });
        continue;
      }
    }

    if (top) {
      const raw = src.slice(pos, paraEnd(src, pos));
      const last = out[out.length - 1];
      if (mergePara && last !== undefined && last.type === T_PARA) {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + raw;
        last.q.src += '\n' + raw;
      } else out.push({ type: T_PARA, raw, q: newQ(raw) });
      mergePara = false;
      pos += raw.length;
      continue;
    }

    RE_TEXT.lastIndex = pos;
    m = RE_TEXT.exec(src);
    if (m !== null) {
      const raw = m[0];
      pos += raw.length;
      const last = out[out.length - 1];
      if (last !== undefined && last.type === T_TEXT) {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + raw;
        last.q.src += '\n' + raw;
      } else out.push({ type: T_TEXT, raw, q: newQ(raw) });
      continue;
    }
    break; // unreachable for well-formed input
  }
  top = true;
  return out;
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
  while (c === 32 || c === 9) c = src.charCodeAt(++i);
  if (c === 10) return true; // [ \t]+\n
  i = ls;
  c = src.charCodeAt(i);
  while (c === 32 && i - ls < 3) c = src.charCodeAt(++i);
  switch (c) {
    case 45:
    case 42:
    case 43: {
      // " {0,3}[*+-][ \t]+[^ \t\n]"
      let j = i + 1;
      let d = src.charCodeAt(j);
      if (d === 32 || d === 9) {
        while (d === 32 || d === 9) d = src.charCodeAt(++j);
        if (d === d && d !== 10) return true;
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
      const d = src.charCodeAt(i + 1);
      if (d === 46 || d === 41) {
        let j = i + 2;
        let e = src.charCodeAt(j);
        if (e === 32 || e === 9) {
          while (e === 32 || e === 9) e = src.charCodeAt(++j);
          if (e === e && e !== 10) return true;
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
    while (k < lim && src.charCodeAt(k) === 32) k++;
    const d = src.charCodeAt(k);
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
  const mm = RE_BQ.exec(src);
  if (mm === null) return null;
  let lines = rtrimChar(mm[0], '\n').split('\n');
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
    const u = h
      .replace(RE_BQ_MARKER_WS, (g, b, w) => b + expandTabs(w, b.length))
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
  return { type: T_BQ, raw, tokens: toks, text };
}

// leading spaces/tabs of s expanded to spaces as if s started at column col (marked's indentCodeCompensation-free J())
function expandLead(s, col) {
  let i = 0;
  let tab = false;
  for (;;) {
    const c = s.charCodeAt(i);
    if (c === 32) i++;
    else if (c === 9) {
      tab = true;
      i++;
    } else break;
  }
  if (!tab) return s;
  return expandTabs(s.slice(0, i), col) + s.slice(i);
}

function firstNonSpace(s) {
  let i = 0;
  while (s.charCodeAt(i) === 32) i++;
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
  while (s.charCodeAt(j) === 35) j++;
  if (j - i > 6) return false;
  return j >= s.length || isJsSpace(s.charCodeAt(j));
}

// Does `line` (one line, no newline) start a block that ends a list item? `full` adds the
// blockquote and next-bullet checks marked applies to the current line but not the previous one.
function itemBreak(line, ci, full) {
  let sp = 0;
  while (line.charCodeAt(sp) === 32) sp++;
  if (sp > ci) return false;
  const c = line.charCodeAt(sp);
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
        const d = line.charCodeAt(sp + 1);
        if (d !== d || d === 32 || d === 9) return true;
      }
      return c !== 43 && HR_IND[ci].test(line);
    }
  }
  if (full && c >= 48 && c <= 57) {
    let j = sp + 1;
    while (j - sp < 9 && line.charCodeAt(j) >= 48 && line.charCodeAt(j) <= 57) j++;
    const d = line.charCodeAt(j);
    if (d === 46 || d === 41) {
      const e = line.charCodeAt(j + 1);
      return e !== e || e === 32 || e === 9;
    }
  }
  return false;
}

function list(src, pos) {
  RE_LIST.lastIndex = pos;
  let t = RE_LIST.exec(src);
  if (t === null) return null;
  const len = src.length;
  const bull = t[1].trim();
  const ordered = bull.length > 1;
  const lst = { type: T_LIST, raw: '', ordered, start: ordered ? +bull.slice(0, -1) : '', loose: false, items: [] };
  const itemRe = ITEM_RE[bull[bull.length - 1]];
  let endsWithBlank = false;
  let e = pos;
  while (e < len) {
    let blankEnd = false;
    let itemText = '';
    itemRe.lastIndex = e;
    if ((t = itemRe.exec(src)) === null) break;
    RE_HR.lastIndex = e;
    if (RE_HR.test(src)) break;
    const k = e;
    e += t[0].length;
    const t2 = t[2];
    const b = t[1].length;
    let line = expandLead(t2.charCodeAt(t2.length - 1) === 10 ? t2.slice(0, -1) : t2, b);
    let le = src.indexOf('\n', e);
    if (le === -1) le = len;
    let next = src.slice(e, le);
    let blankFirst = !line.trim();
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
        next = src.slice(e, le);
        if (itemBreak(next, ci, true)) break;
        const Z = expandLead(next, 0);
        const nextBlank = !next.trim();
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
      }
    }
    const itemRaw = src.slice(k, e);
    if (!lst.loose) {
      if (endsWithBlank) lst.loose = true;
      else if (endsWithBlankLine(itemRaw)) endsWithBlank = true;
    }
    lst.items.push({ raw: itemRaw, task: RE_TASK.test(itemText), text: itemText, tokens: null });
  }
  const lastItem = lst.items[lst.items.length - 1];
  if (lastItem === undefined) return null;
  lastItem.raw = lastItem.raw.trimEnd();
  lastItem.text = lastItem.text.trimEnd();
  lst.raw = src.slice(pos, e).trimEnd();
  for (const it of lst.items) {
    top = false;
    it.tokens = blockTokens(it.text, [], false);
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
        if (lst.loose) d.check = checked;
        else it.tokens.unshift({ type: T_CHECKBOX, raw: '', checked });
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
  for (let i = 0; i < cells.length; i++) cells[i] = cells[i].trim().replace(/\\\|/g, '|');
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
  return { type: T_TABLE, raw: rtrimChar(m[0], '\n'), align, header, body };
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
        out += '<p>' + (t.check === undefined ? '' : checkboxHtml(t.check)) + t.q.html + '</p>\n';
        break;
      case T_TEXT:
        out += (t.check === undefined ? '' : checkboxHtml(t.check)) + t.q.html;
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
        out += checkboxHtml(t.checked);
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

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escChar = (c) => ESC_MAP[c];

/** marked's escape(s, true): every & < > " ' */
function escapeAll(s) {
  return /[&<>"']/.test(s) ? s.replace(/[&<>"']/g, escChar) : s;
}

/** marked's escape(s): < > " ' and any & that does not open an entity-like reference */
function escapeHtml(s) {
  const re = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
  return /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/.test(s) ? s.replace(re, escChar) : s;
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

function cleanUrl(href) {
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
  return j > i && s.charCodeAt(j) === 64;
}

function protoAhead(s, i) {
  return s.startsWith('mailto:', i) || s.startsWith('xmpp:', i);
}

function spacesNl(s, i) {
  if (s.charCodeAt(i) !== 32 || s.charCodeAt(i + 1) !== 32) return false;
  i += 2;
  while (s.charCodeAt(i) === 32) i++;
  return s.charCodeAt(i) === 10;
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

/**
 * End of the inline text token marked's gfm `text` rule matches at p. `at` is the index of the next
 * "@" at or after p (-1 when there is none), which lets the email look-aheads be skipped.
 */
function textEnd(s, p, at) {
  const n = s.length;
  let c = s.charCodeAt(p);
  const d0 = s.charCodeAt(p + 1);
  if ((d0 === 109 || d0 === 120) && !(c < 128 && CLS[c] & C_ALNUM) && protoAhead(s, p + 1)) return p + 1;
  let q = p + 1;
  if (c === 96 || c === 126) while (q < n && s.charCodeAt(q) === c) q++;
  if (q >= n) return q;
  c = s.charCodeAt(q);
  if (c === 96 || c === 126) return q;
  if (c === 32 && spacesNl(s, q)) return q;
  if (at !== -1 && emailAhead(s, q)) return q;
  for (;;) {
    if (q >= n) return q;
    c = s.charCodeAt(q);
    const k = c < 128 ? CLS[c] : 0;
    if (k & (C_STOP | C_CHECK)) {
      if (k & C_STOP) return q;
      if (c === 104 || c === 72) {
        if ((s.charCodeAt(q + 1) | 32) === 116 && (s.charCodeAt(q + 2) | 32) === 116 && (s.charCodeAt(q + 3) | 32) === 112) return q;
      } else if (c === 102 || c === 70) {
        if ((s.charCodeAt(q + 1) | 32) === 116 && (s.charCodeAt(q + 2) | 32) === 112 && s.startsWith('://', q + 3)) return q;
      } else if (s.startsWith('www.', q)) {
        const b = s.charCodeAt(q - 1);
        if (isJsSpace(b) || b === 42 || b === 95 || b === 126 || b === 40) return q;
      }
    }
    const d = s.charCodeAt(q + 1);
    if (d === 32 && c !== 32 && spacesNl(s, q + 1)) return q + 1;
    if (!(k & C_ALNUM)) {
      if ((d === 109 || d === 120) && protoAhead(s, q + 1)) return q + 1;
      if (!(k & C_EMAIL) && at !== -1) {
        if (at <= q) at = s.indexOf('@', q + 1);
        if (at !== -1 && emailAhead(s, q + 1)) return q + 1;
      }
    }
    q++;
  }
}

function isPunctSpace(ch) {
  return ch !== '' && RE_PUNCT_SPACE.test(ch);
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

/** marked's emStrongMask: hide what emphasis must not see (link text, code, tags, escapes). */
function maskSrc(src) {
  // every masking rule needs one of these characters; without them the mask is the text itself
  if (src.indexOf('[') === -1 && src.indexOf('`') === -1 && src.indexOf('\\') === -1 && src.indexOf('<') === -1) return src;
  let t = src;
  if (src.indexOf('[') !== -1) t = t.replace(RE_REFSEARCH, refMask);
  t = t.replace(RE_PUNCT_OUTSIDE_CODE, (all, ticks, punct) =>
    punct ? '+'.repeat(all.length) : ticks ? ticks + all.slice(ticks.length, -ticks.length).replace(/`/g, '+') + ticks : all,
  );
  t = t.replace(RE_BLOCKSKIP, (all) => '[' + 'a'.repeat(all.length - 2) + ']');
  return t;
}

function refMask(r) {
  const o = r.lastIndexOf('[');
  if (!(normLabel(r.slice(o + 1, -1)) in links)) return r;
  if (o > 1 && r[0] !== '!') {
    const inner = r.slice(1, o - 1);
    if (linkInText(inner)) return '[' + inner.replace(RE_REFSEARCH, refMask) + '][' + 'a'.repeat(r.length - o - 2) + ']';
  }
  return '[' + 'a'.repeat(r.length - 2) + ']';
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

/** Last start of a run of each delimiter that is not preceded by whitespace (marked's closer bound). */
function lastRuns(m) {
  let ast = -1, und = -1, til = -1;
  const n = m.length;
  for (let s = 0; s < n; s++) {
    const c = m.charCodeAt(s);
    if (c !== 42 && c !== 95 && c !== 126) continue;
    const pc = s === 0 ? 10 : m.charCodeAt(s - 1);
    let i = s + 1;
    while (i < n && m.charCodeAt(i) === c) i++;
    if (pc !== 32 && pc !== 9 && pc !== 10 && pc !== 13 && pc !== 12) {
      if (c === 42) ast = s;
      else if (c === 95) und = s;
      else til = s;
    }
    s = i - 1;
  }
  return { masked: m, ast, und, til };
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
  const text = label.replace(/\\([\[\]])/g, '$1');
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

function inline(src, plain) {
  const outerLpp = lpp;
  lpp = outerLpp && src.indexOf(')') !== -1;
  const len = src.length;
  let out = '';
  let run = '';
  let runEscape = false; // escape the run when it is flushed
  let ctx = null; // mask and closer bounds, built when emphasis or strikethrough first needs them
  let prev = ''; // last character of the previous text token (marked's prevChar)
  let wasText = false;
  let at = src.indexOf('@');
  let pos = 0;
  while (pos < len) {
    if (!wasText) prev = '';
    wasText = false;
    const c = src.charCodeAt(pos);
    let html = null;
    let end = -1;

    switch (c) {
      case 92: {
        // escape, then hard break
        RE_ESCAPE.lastIndex = pos;
        const m = RE_ESCAPE.exec(src);
        if (m !== null) {
          end = pos + 2;
          html = plain ? m[1] : escapeHtml(m[1]);
          break;
        }
        RE_BR.lastIndex = pos;
        const b = RE_BR.exec(src);
        if (b !== null) {
          end = pos + b[0].length;
          html = plain ? '' : '<br>';
        }
        break;
      }
      case 60: {
        RE_TAG.lastIndex = pos;
        let m = RE_TAG.exec(src);
        if (m !== null) {
          const raw = m[0];
          if (!inLink && /^<a /i.test(raw)) inLink = true;
          else if (inLink && /^<\/a>/i.test(raw)) inLink = false;
          if (!inRawBlock && /^<(pre|code|kbd|script)(\s|>)/i.test(raw)) inRawBlock = true;
          else if (inRawBlock && /^<\/(pre|code|kbd|script)(\s|>)/i.test(raw)) inRawBlock = false;
          end = pos + raw.length;
          html = raw;
          break;
        }
        RE_AUTOLINK.lastIndex = pos;
        m = RE_AUTOLINK.exec(src);
        if (m !== null) {
          end = pos + m[0].length;
          html = autolinkHtml(m[1], m[2] === '@' ? 'mailto:' + m[1] : m[1], plain);
        }
        break;
      }
      case 33:
      case 91: {
        if (c === 33 && src.charCodeAt(pos + 1) !== 91) break;
        if (lpp) {
          const r = tryLink(src, pos, plain);
          if (r !== null) {
            end = r.end;
            html = r.html;
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
            if (run === '') runEscape = true;
            run += m[0][0];
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
        if (ctx === null) ctx = lastRuns(src.indexOf('*') !== -1 || src.indexOf('_') !== -1 || src.indexOf('~') !== -1 ? maskSrc(src) : src);
        const r = emStrong(src, pos, prev, ctx, plain);
        if (r !== null) {
          end = r.end;
          html = r.html;
          break;
        }
        if (c === 95 && !inLink) {
          const u = tryUrl(src, pos, plain);
          if (u !== null) {
            end = u.end;
            html = u.html;
          }
        }
        break;
      }
      case 96: {
        RE_CODESPAN.lastIndex = pos;
        const m = RE_CODESPAN.exec(src);
        if (m !== null) {
          let t = m[2].replace(/\n/g, ' ');
          if (/[^ ]/.test(t) && t[0] === ' ' && t[t.length - 1] === ' ') t = t.substring(1, t.length - 1);
          end = pos + m[0].length;
          html = plain ? t : '<code>' + escapeAll(t) + '</code>';
        }
        break;
      }
      case 32: {
        RE_BR.lastIndex = pos;
        const b = RE_BR.exec(src);
        if (b !== null) {
          end = pos + b[0].length;
          html = plain ? '' : '<br>';
        }
        break;
      }
      case 126: {
        if (ctx === null) ctx = lastRuns(maskSrc(src));
        const r = del(src, pos, prev, ctx, plain);
        if (r !== null) {
          end = r.end;
          html = r.html;
        }
        break;
      }
      default:
        if (!inLink && (isAlnum(c) || c === 46 || c === 43 || c === 45)) {
          const u = tryUrl(src, pos, plain);
          if (u !== null) {
            end = u.end;
            html = u.html;
          }
        }
    }

    if (html !== null) {
      if (run !== '') {
        out += runEscape && !plain ? escapeHtml(run) : run;
        run = '';
      }
      out += html;
      pos = end;
      continue;
    }

    // inline text
    if (at !== -1 && at < pos) at = src.indexOf('@', pos);
    end = textEnd(src, pos, at);
    const raw = src.slice(pos, end);
    if (run === '') runEscape = !inRawBlock;
    run += inRawBlock ? raw : decodeNumeric(raw);
    if (raw[raw.length - 1] !== '_') prev = raw[raw.length - 1];
    wasText = true;
    pos = end;
  }
  if (run !== '') out += runEscape && !plain ? escapeHtml(run) : run;
  lpp = outerLpp;
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
  const html = linkOrImage(isImage, m[1], href && href.replace(RE_ANY_PUNCT, '$1'), title && title.replace(RE_ANY_PUNCT, '$1'), plain);
  if (html === null) return null;
  return { end: pos + raw.length, html };
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
  return { end: pos + text.length, html: autolinkHtml(text, href, plain) };
}

function emStrong(src, pos, prevChar, ctx, plain) {
  RE_EM_L.lastIndex = pos;
  let s = RE_EM_L.exec(src);
  if (s === null || (!s[1] && !s[2] && !s[3] && !s[4])) return null;
  const masked = ctx.masked;
  const r = s[0][0];
  const sameAsPrev = prevChar === r;
  let l = pos;
  while (l > 0 && masked[l - 1] === r) l--;
  const p = lastCodePoint(masked, l);
  const pIsPunct = p === '*' || p === '_' || isPunctSpace(p);
  let n = prevChar;
  if (l < pos) n = p;
  const u = l < pos ? pIsPunct : isPunctSpace(n);
  if (s[4] && RE_ALNUM_U.test(n)) return null;
  const d = s[1] || s[3] || '';
  if (d && n && !u) return null;
  const k = s[0].length - (s[0].codePointAt(s[0].length - 1) > 0xffff ? 2 : 1);
  let remaining = k;
  let skipped = 0;
  const y = pos - l + k;
  const strict = !!p.trim() && (!!d || (r === '*' && !pIsPunct));
  const v = r === '*' ? ctx.ast : ctx.und;
  const Q = pos + k;
  if (v < Q) return null;
  const head = r === '*' ? RE_EM_AST_HEAD : RE_EM_UND_HEAD;
  const closer = r === '*' ? RE_EM_AST : RE_EM_UND;
  head.lastIndex = Q;
  closer.lastIndex = head.test(masked) ? head.lastIndex : Q;
  while ((s = closer.exec(masked)) !== null && s.index <= v) {
    const g = s[1] || s[2] || s[3] || s[4] || s[5] || s[6];
    if (!g) continue;
    let b = g.length;
    if (s[3] || s[4]) {
      remaining += b;
      continue;
    } else if (s[5] || s[6] || strict) {
      if (sameAsPrev && (s[5] || s[6])) break;
      if (y % 3 && !((y + b) % 3)) {
        skipped += b;
        continue;
      }
    }
    remaining -= b;
    if (remaining > 0) continue;
    b = Math.min(b, b + remaining + skipped);
    const te = s[0].codePointAt(0) > 0xffff ? 2 : 1;
    const end = s.index + te + b;
    if (Math.min(k, b) % 2) {
      const inner = inline(src.slice(pos + 1, end - 1), plain);
      return { end, html: plain ? inner : '<em>' + inner + '</em>' };
    }
    const inner = inline(src.slice(pos + 2, end - 2), plain);
    return { end, html: plain ? inner : '<strong>' + inner + '</strong>' };
  }
  return null;
}

function del(src, pos, prevChar, ctx, plain) {
  RE_DEL_L.lastIndex = pos;
  let s = RE_DEL_L.exec(src);
  if (s === null) return null;
  if (s[1] && prevChar && !isPunctSpace(prevChar)) return null;
  const masked = ctx.masked;
  const o = s[0].length - (s[0].codePointAt(s[0].length - 1) > 0xffff ? 2 : 1);
  const u = ctx.til;
  const d = pos + o;
  if (u < d) return null;
  let remaining = o;
  RE_DEL_HEAD.lastIndex = d;
  RE_DEL.lastIndex = RE_DEL_HEAD.test(masked) ? RE_DEL_HEAD.lastIndex : d;
  while ((s = RE_DEL.exec(masked)) !== null && s.index <= u) {
    const i = s[1] || s[2] || s[3] || s[4] || s[5] || s[6];
    if (!i) continue;
    let l = i.length;
    if (l !== o) continue;
    if (s[3] || s[4]) {
      remaining += l;
      continue;
    }
    remaining -= l;
    if (remaining > 0) continue;
    l = Math.min(l, l + remaining);
    const g = s[0].codePointAt(0) > 0xffff ? 2 : 1;
    const end = s.index + g + l;
    const inner = inline(src.slice(pos + o, end - o), plain);
    return { end, html: plain ? inner : '<del>' + inner + '</del>' };
  }
  return null;
}

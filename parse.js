// fast-marked: a specialised Markdown renderer whose parse(markdown) returns exactly what
// marked 18.1.3's marked.parse(markdown) returns with marked's default options (gfm on,
// breaks off, pedantic off). Only that one configuration exists here: no extensions, hooks,
// walkTokens, async or pedantic mode, and the renderer is folded into the lexer, so inline
// text is turned into HTML directly instead of into token trees.
//
// The rules (which construct wins, where a paragraph ends, how emphasis delimiters pair)
// follow marked's own algorithms closely, because the output has to match it byte for byte,
// quirks included. See NOTICE for marked's licence.

// ---------------------------------------------------------------------------------------
// Regular expressions, composed from named pieces.

const TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|' +
  'fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|' +
  'menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|' +
  'tr|track|ul';

const R = String.raw;
const HR_SRC = R` {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)`;
const HR_NC_SRC = R` {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)`;
const I_HEADING = R` {0,3}#{1,6}(?:\s|$)`;
const I_BQ = R` {0,3}>`;
const I_FENCE = R` {0,3}(?:${'`'}{3,}(?=[^${'`'}\n]*(?:\n|$))|~~~)[^\n]*(?:\n|$)`;
const I_HTML = R` {0,3}(?:<\/?(?:${TAGS})(?: +|\n|\/?>)|<(?:(?:script|pre|style|textarea)(?:[\s>]|$)|!--)|<\?|<![A-Za-z]|<!\[CDATA\[)`;
const I_LIST_PARA = R` {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]`;
const I_LIST_BQ = R` {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)`;
const TABLE_SRC =
  R` *([^\n ].*)\n {0,3}((?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?)(?:\n((?:(?! *\n|${HR_SRC}|${I_HEADING}|${I_BQ}|(?: {4}| {0,3}\t)[^\n]|${I_FENCE}| {0,3}(?:[*+-]|1[.)])[ \t]|${I_HTML}).*(?:\n|$))*)\n*|$)`;

const RE_NEWLINE = /^(?:[ \t]*(?:\n|$))+/;
const RE_CODE = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const RE_FENCES = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
const RE_HEADING = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const RE_HR = new RegExp('^' + HR_SRC);
const RE_LIST = /^( {0,3}(?:[*+-]|\d{1,9}[.)]))([ \t][^\n]*?)?(?:\n|$)/;
const RE_HTML = new RegExp(
  R`^ {0,3}(?:<(script|pre|style|textarea)[\s>][\s\S]*?(?:<\/\1>[^\n]*\n*|$)|<!--(?:-?>|[\s\S]*?(?:-->|$))[^\n]*(\n+|$)|<\?[\s\S]*?(?:\?>[^\n]*\n*|$)|<![A-Z][\s\S]*?(?:>[^\n]*\n*|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>[^\n]*\n*|$)|<\/?(${TAGS})(?:[ \t]+|\n|\/?>|$)[\s\S]*?(?:(?:\n[ \t]*)+\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?: +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>${'`'}]+)?)*? *\/?>(?=[ \t]*(?:\n|$))[\s\S]*?(?:(?:\n[ \t]*)+\n|$)|<\/[a-z][a-z0-9-]*\s*>(?=[ \t]*(?:\n|$))[\s\S]*?(?:(?:\n[ \t]*)+\n|$))`,
  'i',
);
const RE_DEF = new RegExp(
  R`^ {0,3}\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)((?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))))? *(?:\n+|$)`,
);
const RE_TABLE = new RegExp('^' + TABLE_SRC);
const LH_BULL = R` {0,3}(?:[*+-]|\d{1,9}[.)])`;
const LH_STOPS = R`| {0,3}(?:${'`'}{3,}|~{3,})| {0,3}>| {0,3}#{1,6}(?:\s|$)`;
const LH_TAIL = R`| {0,3}<[^\n>]+>\n| {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n`;
const RE_LHEADING = new RegExp(
  R`^(?!${LH_BULL} |(?: {4}| {0,3}\t)${LH_STOPS}${LH_TAIL})((?:.|\n(?!\s*?\n|${LH_BULL} ${LH_STOPS}|${HR_NC_SRC}${LH_TAIL}))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)`,
);
const RE_PARAGRAPH = new RegExp(
  R`^([^\n]+(?:\n(?!${HR_SRC}|${I_HEADING}|${I_BQ}|${I_FENCE}|${I_LIST_PARA}|${I_HTML}|${TABLE_SRC}|[ \t]+\n)[^\n]+)*)`,
);
const BQ_PARA = R`([^\n]+(?:\n(?!${HR_SRC}|${I_HEADING}|${I_BQ}|${I_FENCE}|${I_LIST_BQ}|${I_HTML}|[ \t]+\n)[^\n]+)*)`;
const RE_BLOCKQUOTE = new RegExp(R`^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(${BQ_PARA})|[^\n]*)(?:\n|$))+`);
const RE_TEXT = /^[^\n]+/;

// list item helpers, one variant per indentation 0..3 (marked caps the indent there)
const LIST_ITEM = {};
for (const b of ['-', '*', '+']) {
  const bullet = '\\' + b;
  LIST_ITEM[b] = new RegExp(R`^( {0,3}${bullet})((?:[	 ][^\n]*)?(?:\n|$))`);
}
LIST_ITEM['.'] = new RegExp(R`^( {0,3}\d{1,9}\.)((?:[	 ][^\n]*)?(?:\n|$))`);
LIST_ITEM[')'] = new RegExp(R`^( {0,3}\d{1,9}\))((?:[	 ][^\n]*)?(?:\n|$))`);
const NEXT_BULLET = [], HR_AT = [], FENCE_AT = [], HEADING_AT = [], HTML_AT = [], BQ_AT = [];
for (let n = 0; n < 4; n++) {
  NEXT_BULLET.push(new RegExp(R`^ {0,${n}}(?:[*+-]|\d{1,9}[.)])((?:[ 	][^\n]*)?(?:\n|$))`));
  HR_AT.push(new RegExp(R`^ {0,${n}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\*[ 	]*){3,})(?:\n+|$)`));
  FENCE_AT.push(new RegExp(R`^ {0,${n}}(?:${'```'}|~~~)`));
  HEADING_AT.push(new RegExp(R`^ {0,${n}}#{1,6}(?:\s|$)`));
  HTML_AT.push(new RegExp(R`^ {0,${n}}(?:<\/?(?:${TAGS})(?: +|$|\/?>)|<(?:(?:script|pre|style|textarea)(?:[\s>]|$)|!--)|<\?|<![A-Za-z]|<!\[CDATA\[)`, 'i'));
  BQ_AT.push(new RegExp(R`^ {0,${n}}>`));
}
const indexFor = (r) => Math.max(0, Math.min(3, r - 1));

// inline
const P0 = R`[\p{P}\p{S}]`;
const PS0 = R`[\s\p{P}\p{S}]`;
const NPS0 = R`[^\s\p{P}\p{S}]`;
const PT = R`(?!~)[\p{P}\p{S}]`;
const PST = R`(?!~)[\s\p{P}\p{S}]`;
const NPST = R`(?:[^\s\p{P}\p{S}]|~)`;

const RE_ESCAPE = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const RE_TAG = new RegExp(
  R`^<!--(?:-?>|[\s\S]*?-->)|^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>${'`'}]+)?)*?\s*\/?>|^<\?[\s\S]*?\?>|^<![a-zA-Z]+\s[\s\S]*?>|^<!\[CDATA\[[\s\S]*?\]\]>`,
);
const BT = '`';
const LABEL = R`(?:\[(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|${BT}+(?!${BT})[^${BT}]*?${BT}+(?!${BT})|${BT}${BT}+(?=\])|[^\[\]\\${BT}])*?`;
const REF = R`(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+`;
const RE_LINK = new RegExp(
  R`^!?\[(${LABEL})\]\([ \t\n]*(<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\)))(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)))?[ \t\n]*\)`,
);
const RE_REFLINK = new RegExp(R`^!?\[(${LABEL})\]\[(${REF})\]`);
const RE_NOLINK = new RegExp(R`^!?\[(${REF})\](?:\[\])?`);
const RE_REFLINK_SEARCH = new RegExp(
  R`!?\[((?:[^\[\]\\${BT}]*(?:\[(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|${BT}+(?!${BT})[^${BT}]*?${BT}+(?!${BT})|${BT}${BT}+(?=\]))){0,999}?[^\[\]\\${BT}]*?)\]\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999})\]|!?\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999})\](?:\[\])?(?!\()`,
  'g',
);
const RE_BLOCK_SKIP = /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)|(?<!`)()(?<b>`+)[^`]+\k<b>(?!`)|<(?! )[^<>]*?>/g;
const RE_ANY_PUNCT = /\\([\p{P}\p{S}])/gu;
const RE_ANY_PUNCT_OUTSIDE_CODE = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu;
const RE_AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[a-zA-Z0-9.!#$%&'*+/=?_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_]))>/;
const RE_BR = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
const RE_CODESPAN = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const RE_DEL_L = new RegExp(R`^~~?(?:((?!~)${P0})|[^\s~])`, 'u');
const RE_DEL_R = new RegExp(
  R`^[^~]+(?=[^~])|(?!~)${P0}(~~?)(?=[\s]|$)|${NPS0}(~~?)(?!~)(?=${PS0}|$)|(?!~)${PS0}(~~?)(?=${NPS0})|[\s](~~?)(?!~)(?=${P0})|(?!~)${P0}(~~?)(?!~)(?=${P0})|${NPS0}(~~?)(?=${NPS0})`,
  'gu',
);
const RE_EM_L = new RegExp(R`^(?:\*+(?:((?!\*)${PT})|([^\s*]))?)|^_+(?:((?!_)${PT})|([^\s_]))?`, 'u');
const RE_EM_R_AST = new RegExp(
  R`^[^_*]*?__[^_*]*?\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\*)${PT}(\*+)(?=[\s]|$)|${NPST}(\*+)(?!\*)(?=${PST}|$)|(?!\*)${PST}(\*+)(?=${NPST})|[\s](\*+)(?!\*)(?=${PT})|(?!\*)${PT}(\*+)(?!\*)(?=${PT})|${NPST}(\*+)(?=${NPST})`,
  'gu',
);
const RE_EM_R_UND = new RegExp(
  R`^[^_*]*?\*\*[^_*]*?_[^_*]*?(?=\*\*)|[^_]+(?=[^_])|(?!_)${P0}(_+)(?=[\s]|$)|${NPS0}(_+)(?!_)(?=${PS0}|$)|(?!_)${PS0}(_+)(?=${NPS0})|[\s](_+)(?!_)(?=${P0})|(?!_)${P0}(_+)(?!_)(?=${P0})`,
  'gu',
);
const RE_PUNCTUATION = new RegExp(R`^((?![*_])${PS0})`, 'u');
const RE_UNICODE_ALNUM = /[\p{L}\p{N}]/u;
const EC = R`[a-zA-Z0-9.!#$%&'*+\/=?_${BT}{\|}~-]`;
const RE_INLINE_TEXT = new RegExp(
  R`^(?:[^a-zA-Z0-9](?=(?:mailto|xmpp):)|(${BT}+|~+|[^${BT}~])(?:(?=[${BT}~])|(?= {2,}\n)|(?=${EC}+@)|[\s\S]*?(?:(?=[\\<!\[${BT}*~_]|\b_|[hH][tT][tT][pP][sS]?|[fF][tT][pP]:\/\/|(?<![^\s*_~(])www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=(?:mailto|xmpp):)|[^a-zA-Z0-9.!#$%&'*+\/=?_${BT}{\|}~-](?=${EC}+@))))`,
);
const EMAIL_TAIL = R`[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])`;
const RE_URL = new RegExp(
  R`^(?:mailto:${EMAIL_TAIL}|xmpp:${EMAIL_TAIL}(?:\/[A-Za-z0-9@.]+)?)|^((?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])`,
);
const RE_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;

// ---------------------------------------------------------------------------------------
// Small helpers

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escChar = (c) => ESC_MAP[c];
const RE_ESC_TEST = /[&<>"']/;
const RE_ESC_ALL = /[&<>"']/g;
const RE_ESC_TEST_NE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
const RE_ESC_ALL_NE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;

/** HTML-escape every special character. */
function escapeAll(s) {
  return RE_ESC_TEST.test(s) ? s.replace(RE_ESC_ALL, escChar) : s;
}
/** HTML-escape, leaving an ampersand that already starts an entity alone. */
function escapeText(s) {
  return RE_ESC_TEST_NE.test(s) ? s.replace(RE_ESC_ALL_NE, escChar) : s;
}

const RE_NUMREF = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/;
const RE_NUMREF_OR_AMP = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
function decodeNumeric(s) {
  if (!RE_NUMREF.test(s)) return s;
  return s.replace(RE_NUMREF_OR_AMP, (_, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const cp = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\uFFFD';
    if (cp === 38) return '&amp;';
    return String.fromCodePoint(cp);
  });
}

function cleanUrl(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

/** Strip trailing `ch` characters. */
function rtrimChar(s, ch) {
  let n = s.length;
  while (n > 0 && s[n - 1] === ch) n--;
  return s.slice(0, n);
}

/** Drop trailing blank lines when there are at least two of them (marked keeps a single one). */
function trimTrailingBlankLines(s) {
  const lines = s.split('\n');
  let i = lines.length - 1;
  while (i >= 0 && /^[ \t]*$/.test(lines[i])) i--;
  return lines.length - i <= 2 ? s : lines.slice(0, i + 1).join('\n');
}

function normLabel(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

/** Index of the bracket that closes an unbalanced run, -1 when balanced, -2 when left open. */
function findClosingBracket(s, open, close) {
  if (s.indexOf(open) === -1 && s.indexOf(close) === -1) return -1;
  let level = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++;
    else if (c === open) level++;
    else if (c === close) {
      level--;
      if (level < 0) return i;
    }
  }
  return level > 0 ? -2 : -1;
}

function expandTabs(s, col = 0) {
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

function splitCells(row, count) {
  const marked = row.replace(/\|/g, (_, off, str) => {
    let escaped = false;
    let p = off;
    while (--p >= 0 && str[p] === '\\') escaped = !escaped;
    return escaped ? '|' : ' |';
  });
  const cells = marked.split(/ \|/);
  if (!cells[0].trim()) cells.shift();
  if (cells.length > 0 && !cells[cells.length - 1].trim()) cells.pop();
  if (count) {
    if (cells.length > count) cells.splice(count);
    else while (cells.length < count) cells.push('');
  }
  for (let i = 0; i < cells.length; i++) cells[i] = cells[i].trim().replace(/\\\|/g, '|');
  return cells;
}

// ---------------------------------------------------------------------------------------
// Per-document state (reset by every parse call; nothing survives from one call to the next)

let links = null; // label -> {href, title}
let queue = null; // inline jobs in the order marked would lex them
let top = true;
let inLink = false;
let inRawBlock = false;
let linkEmitted = false;
let linkParenPossible = true;

function inlineJob(src) {
  const job = { src, html: '', prefix: '' };
  queue.push(job);
  return job;
}

// ---------------------------------------------------------------------------------------
// Block level

function lastOf(a) {
  return a.length ? a[a.length - 1] : undefined;
}

function blockTokens(src, tokens, mergeFirst) {
  let m, tok;
  while (src) {
    // blank lines
    if ((m = RE_NEWLINE.exec(src)) && m[0].length > 0) {
      src = src.substring(m[0].length);
      const prev = lastOf(tokens);
      if (m[0].length === 1 && prev !== undefined) prev.raw += '\n';
      else tokens.push({ type: 'space', raw: m[0] });
      continue;
    }
    // indented code
    if ((m = RE_CODE.exec(src))) {
      const raw = trimTrailingBlankLines(m[0]);
      const text = raw.replace(/^(?: {0,3}\t| {1,4})/gm, '');
      src = src.substring(raw.length);
      const prev = lastOf(tokens);
      if (prev && (prev.type === 'paragraph' || prev.type === 'text')) {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + raw;
        prev.text += '\n' + text;
        queue[queue.length - 1].src = prev.text;
      } else tokens.push({ type: 'code', raw, text, lang: undefined });
      continue;
    }
    if ((m = RE_FENCES.exec(src))) {
      const raw = m[0];
      src = src.substring(raw.length);
      tokens.push({
        type: 'code',
        raw,
        text: indentCompensation(raw, m[3] || ''),
        lang: m[2] ? m[2].trim().replace(RE_ANY_PUNCT, '$1') : m[2],
      });
      continue;
    }
    if ((m = RE_HEADING.exec(src))) {
      let text = m[2].trim();
      if (text.endsWith('#')) {
        const t = rtrimChar(text, '#');
        if (!t || /[ \t]$/.test(t)) text = t.trim();
      }
      const raw = rtrimChar(m[0], '\n');
      src = src.substring(raw.length);
      tokens.push({ type: 'heading', raw, depth: m[1].length, job: inlineJob(text) });
      continue;
    }
    if ((m = RE_HR.exec(src))) {
      const raw = rtrimChar(m[0], '\n');
      src = src.substring(raw.length);
      tokens.push({ type: 'hr', raw });
      continue;
    }
    if ((tok = blockquote(src))) {
      src = src.substring(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if ((tok = list(src))) {
      src = src.substring(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if ((m = RE_HTML.exec(src))) {
      const raw = trimTrailingBlankLines(m[0]);
      src = src.substring(raw.length);
      tokens.push({ type: 'html', raw, text: raw });
      continue;
    }
    if ((tok = def(src))) {
      src = src.substring(tok.raw.length);
      const prev = lastOf(tokens);
      if (prev && (prev.type === 'paragraph' || prev.type === 'text')) {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        prev.text += '\n' + tok.raw;
        queue[queue.length - 1].src = prev.text;
      } else {
        if (!links[tok.tag]) links[tok.tag] = { href: tok.href, title: tok.title };
        tokens.push(tok);
      }
      continue;
    }
    if ((tok = table(src))) {
      src = src.substring(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if ((m = RE_LHEADING.exec(src))) {
      const raw = rtrimChar(m[0], '\n');
      src = src.substring(raw.length);
      tokens.push({ type: 'heading', raw, depth: m[2].charAt(0) === '=' ? 1 : 2, job: inlineJob(m[1].trim()) });
      continue;
    }
    if (top && (m = RE_PARAGRAPH.exec(src))) {
      const raw = m[0];
      const text = m[1].charAt(m[1].length - 1) === '\n' ? m[1].slice(0, -1) : m[1];
      const job = inlineJob(text);
      const prev = lastOf(tokens);
      if (mergeFirst && prev && prev.type === 'paragraph') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + raw;
        prev.text += '\n' + text;
        queue.pop();
        queue[queue.length - 1].src = prev.text;
      } else tokens.push({ type: 'paragraph', raw, text, job });
      mergeFirst = false;
      src = src.substring(raw.length);
      continue;
    }
    if ((m = RE_TEXT.exec(src))) {
      const raw = m[0];
      src = src.substring(raw.length);
      const job = inlineJob(raw);
      const prev = lastOf(tokens);
      if (prev && prev.type === 'text') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + raw;
        prev.text += '\n' + raw;
        queue.pop();
        queue[queue.length - 1].src = prev.text;
      } else tokens.push({ type: 'text', raw, text: raw, job });
      continue;
    }
    throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
  }
  top = true;
  return tokens;
}

function indentCompensation(raw, text) {
  const m = raw.match(/^(\s+)(?:```)/);
  if (m === null) return text;
  const indent = m[1].length;
  return text
    .split('\n')
    .map((line) => {
      const ws = line.match(/^\s+/);
      if (ws === null) return line;
      return line.slice(Math.min(ws[0].length, indent));
    })
    .join('\n');
}

const RE_BQ_START = /^ {0,3}>/;
const RE_BQ_MARKER_WS = /^( {0,3}>)([ \t]+)/gm;
const RE_BQ_SETEXT = /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g;
const RE_BQ_STRIP = /^ {0,3}>[ \t]?/gm;

function blockquote(src) {
  const m = RE_BLOCKQUOTE.exec(src);
  if (!m) return;
  let lines = rtrimChar(m[0], '\n').split('\n');
  let raw = '';
  let text = '';
  const tokens = [];
  while (lines.length > 0) {
    let inQuote = false;
    const cur = [];
    let i;
    for (i = 0; i < lines.length; i++) {
      if (RE_BQ_START.test(lines[i])) {
        cur.push(lines[i]);
        inQuote = true;
      } else if (!inQuote) cur.push(lines[i]);
      else break;
    }
    lines = lines.slice(i);
    const curRaw = cur.join('\n');
    const curText = curRaw
      .replace(RE_BQ_MARKER_WS, (_, marker, ws) => marker + expandTabs(ws, marker.length))
      .replace(RE_BQ_SETEXT, '\n    $1')
      .replace(RE_BQ_STRIP, '');
    raw = raw ? `${raw}\n${curRaw}` : curRaw;
    text = text ? `${text}\n${curText}` : curText;
    const savedTop = top;
    top = true;
    blockTokens(curText, tokens, true);
    top = savedTop;
    if (lines.length === 0) break;
    const last = lastOf(tokens);
    const lt = last && last.type;
    if (lt === 'code' || lt === 'heading' || lt === 'hr' || lt === 'html' || lt === 'table') break;
    if (lt === 'blockquote') {
      const rest = lines.join('\n');
      const again = last.raw + '\n' + rest.replace(RE_BQ_STRIP, '');
      const fresh = blockquote(again);
      tokens[tokens.length - 1] = fresh;
      const leftover = again.substring(fresh.raw.length).replace(/^\n/, '');
      const nLeft = leftover ? leftover.split('\n').length : 0;
      const used = nLeft ? lines.slice(0, -nLeft) : lines;
      if (used.length > 0) raw = `${raw}\n${used.join('\n')}`;
      text = text.substring(0, text.length - last.text.length) + fresh.text;
      lines = lines.slice(used.length);
      if (lines.length > 0 && RE_BQ_START.test(lines[0])) continue;
      break;
    } else if (lt === 'list') {
      const again = last.raw + '\n' + lines.join('\n');
      const fresh = list(again);
      tokens[tokens.length - 1] = fresh;
      const f = fresh.raw.length > last.raw.length ? again.slice(last.raw.length + 1, fresh.raw.length).split('\n').length : 0;
      if (f > 0) {
        const y = lines.slice(0, f).join('\n');
        raw = `${raw}\n${y}`;
        text = `${text}\n${y}`;
      }
      lines = lines.slice(f);
      continue;
    }
  }
  return { type: 'blockquote', raw, tokens, text };
}

const RE_LEADING_WS = /^[ \t]+/;
const RE_BLANK_LINE = /^[ \t]*$/;
const RE_TASK = /^\[[ xX]\][ \t]+\S/;
const RE_TASK_STRIP = /^\[[ xX]\][ \t]+/;
const RE_TASK_BOX = /\[[ xX]\]/;
const RE_SETEXT_LINE = /^ {0,3}(?:=+|-+) *$/;

function list(src) {
  let m = RE_LIST.exec(src);
  if (!m) return;
  const whole = src;
  let bull = m[1].trim();
  const ordered = bull.length > 1;
  const token = { type: 'list', raw: '', ordered, start: ordered ? +bull.slice(0, -1) : '', loose: false, items: [] };
  const itemRe = LIST_ITEM[ordered ? bull.slice(-1) : bull];
  let endsWithBlank = false;
  while (src) {
    let blankFound = false;
    let content = '';
    if (!(m = itemRe.exec(src)) || RE_HR.test(src)) break;
    const startAt = whole.length - src.length;
    src = src.substring(m[0].length);
    const firstLine = m[2].split('\n', 1)[0];
    const markerLen = m[1].length;
    let line = firstLine.replace(RE_LEADING_WS, (ws) => expandTabs(ws, markerLen));
    let next = src.split('\n', 1)[0];
    let blank = !line.trim();
    let indent = 0;
    if (blank) indent = markerLen + 1;
    else {
      indent = line.search(/[^ ]/);
      indent = indent > 4 ? 1 : indent;
      content = line.slice(indent);
      indent += markerLen;
    }
    if (blank && RE_BLANK_LINE.test(next)) {
      src = src.substring(next.length + 1);
      blankFound = true;
    }
    if (!blankFound) {
      const k = indexFor(indent);
      const reBullet = NEXT_BULLET[k], reHr = HR_AT[k], reFence = FENCE_AT[k], reHeading = HEADING_AT[k], reHtml = HTML_AT[k], reBq = BQ_AT[k];
      while (src) {
        const rawLine = src.split('\n', 1)[0];
        next = rawLine;
        const expanded = next.replace(RE_LEADING_WS, (ws) => expandTabs(ws));
        if (reFence.test(next) || reHeading.test(next) || reHtml.test(next) || reBq.test(next) || reBullet.test(next) || reHr.test(next)) break;
        if (expanded.search(/[^ ]/) >= indent || !next.trim()) content += '\n' + expanded.slice(indent);
        else {
          if (blank || line.replace(/\t/g, '    ').search(/[^ ]/) >= 4 || reFence.test(line) || reHeading.test(line) || reHtml.test(line) || reHr.test(line)) break;
          const add = RE_SETEXT_LINE.test(next) && RE_LHEADING.test(`${line}\n${next}`) ? `    ${expanded.replace(/^ {0,3}/, '')}` : next;
          content += '\n' + add;
        }
        blank = !next.trim();
        src = src.substring(rawLine.length + 1);
        line = expanded.slice(indent);
      }
    }
    const raw = whole.slice(startAt, whole.length - src.length);
    if (!token.loose) {
      if (endsWithBlank) token.loose = true;
      else if (/\n[ \t]*\n[ \t]*$/.test(raw)) endsWithBlank = true;
    }
    token.items.push({ raw, task: RE_TASK.test(content), checked: undefined, loose: false, text: content, tokens: [] });
  }
  const lastItem = lastOf(token.items);
  if (!lastItem) return;
  lastItem.raw = lastItem.raw.trimEnd();
  lastItem.text = lastItem.text.trimEnd();
  token.raw = whole.slice(0, whole.length - src.length).trimEnd();
  for (const item of token.items) {
    top = false;
    item.tokens = blockTokens(item.text, []);
    if (!token.loose) {
      let loose = false;
      for (const t of item.tokens) if (t.type === 'space' && /\n.*\n/.test(t.raw)) loose = true;
      token.loose = loose;
    }
  }
  for (const item of token.items) {
    const first = item.tokens[0];
    if (item.task && first && (first.type === 'text' || first.type === 'paragraph')) {
      item.text = item.text.replace(RE_TASK_STRIP, '');
      first.raw = first.raw.replace(RE_TASK_STRIP, '');
      first.text = first.text.replace(RE_TASK_STRIP, '');
      for (let g = queue.length - 1; g >= 0; g--) {
        if (RE_TASK.test(queue[g].src)) {
          queue[g].src = queue[g].src.replace(RE_TASK_STRIP, '');
          break;
        }
      }
      const box = RE_TASK_BOX.exec(item.raw);
      if (box) {
        const checked = box[0] !== '[ ]';
        const boxHtml = '<input ' + (checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
        item.checked = checked;
        if (token.loose) {
          if (first.job) first.job.prefix = boxHtml + first.job.prefix;
        } else item.tokens.unshift({ type: 'checkbox', html: boxHtml });
      }
    } else if (item.task) item.task = false;
  }
  if (token.loose) {
    for (const item of token.items) {
      item.loose = true;
      for (const t of item.tokens) if (t.type === 'text') t.type = 'paragraph';
    }
  }
  return token;
}

function def(src) {
  const m = RE_DEF.exec(src);
  if (!m) return;
  if (!/^</.test(m[2]) && findClosingBracket(m[2], '(', ')') !== -1) return;
  return {
    type: 'def',
    tag: normLabel(m[1]),
    raw: rtrimChar(m[0], '\n'),
    href: m[2] ? m[2].replace(/^<(.*)>$/, '$1').replace(RE_ANY_PUNCT, '$1') : '',
    title: m[3] ? m[3].substring(1, m[3].length - 1).replace(RE_ANY_PUNCT, '$1') : m[3],
  };
}

function table(src) {
  const m = RE_TABLE.exec(src);
  if (!m || !/[:|]/.test(m[2])) return;
  const headers = splitCells(m[1]);
  const aligns = m[2].replace(/^\||\| *$/g, '').split('|');
  const rows = m[3] && m[3].trim() ? m[3].replace(/\n[ \t]*$/, '').split('\n') : [];
  if (headers.length !== aligns.length) return;
  const align = aligns.map((a) =>
    /^ *-+: *$/.test(a) ? 'right' : /^ *:-+: *$/.test(a) ? 'center' : /^ *:-+ *$/.test(a) ? 'left' : null,
  );
  const header = headers.map((h) => inlineJob(h));
  const body = rows.map((r) => splitCells(r, header.length).map((c) => inlineJob(c)));
  return { type: 'table', raw: rtrimChar(m[0], '\n'), align, header, body };
}

// ---------------------------------------------------------------------------------------
// Inline level. lexInline returns rendered HTML (or, in text mode, the plain text marked's
// TextRenderer produces, which image alt attributes use).

/** marked's emphasis masking: hide link text, code spans and escapes from delimiter search. */
function maskSource(src) {
  let t = src;
  if (src.includes('[')) {
    const swap = (r) => {
      const o = r.lastIndexOf('[');
      if (!Object.hasOwn(links, normLabel(r.slice(o + 1, -1)))) return r;
      if (o > 1 && r.charAt(0) !== '!') {
        const inner = r.slice(1, o - 1);
        if (linkInText(inner)) return '[' + inner.replace(RE_REFLINK_SEARCH, swap) + '][' + 'a'.repeat(r.length - o - 2) + ']';
      }
      return '[' + 'a'.repeat(r.length - 2) + ']';
    };
    t = t.replace(RE_REFLINK_SEARCH, swap);
  }
  t = t.replace(RE_ANY_PUNCT_OUTSIDE_CODE, (n, fence, esc) =>
    esc ? '+'.repeat(n.length) : fence ? fence + n.slice(fence.length, -fence.length).replace(/`/g, '+') + fence : n,
  );
  t = t.replace(RE_BLOCK_SKIP, (n, a, pre) => {
    const o = pre ? pre.length : 0;
    return n.slice(0, o) + '[' + 'a'.repeat(n.length - o - 2) + ']';
  });
  return t;
}

function linkInText(e) {
  if (!e.includes('[')) return false;
  for (const n of e.matchAll(RE_BLOCK_SKIP)) if (RE_LINK.test(n[0]) && e.charAt(n.index - 1) !== '!') return true;
  for (const n of e.matchAll(RE_REFLINK_SEARCH)) {
    const s = n[0];
    const r = s.lastIndexOf('[');
    if (!(s.charAt(0) === '!' || !Object.hasOwn(links, normLabel(s.slice(r + 1, -1)))) && !(r > 1 && linkInText(s.slice(1, r - 1)))) return true;
  }
  return false;
}

/** The start index of the last run of `*`, `_` and `~` that is not preceded by whitespace. */
function closerIndexes(masked) {
  const res = { '*': -1, _: -1, '~': -1 };
  const n = masked.length;
  for (let s = 0; s < n; s++) {
    const c = masked[s];
    if (c !== '*' && c !== '_' && c !== '~') continue;
    const before = s === 0 ? '\n' : masked[s - 1];
    let i = s + 1;
    while (i < n && masked[i] === c) i++;
    if (before !== ' ' && before !== '\t' && before !== '\n' && before !== '\r' && before !== '\f') res[c] = s;
    s = i - 1;
  }
  return res;
}

/** Does the link text hold an HTML tag or autolink that runs past its closing bracket? */
function tagCrossesLabel(src, label, offset) {
  if (!label.includes('<')) return false;
  for (let s = 0; s < label.length; s++) {
    if (label[s] === '\\') {
      s++;
      continue;
    }
    if (label[s] === '`') {
      const c = RE_CODESPAN.exec(label.slice(s));
      if (c) {
        s += c[0].length - 1;
        continue;
      }
    }
    if (label[s] !== '<') continue;
    const r = src.slice(offset + s);
    const o = RE_TAG.exec(r) || RE_AUTOLINK.exec(r);
    if (o) {
      if (o[0].length > label.length - s) return true;
      s += o[0].length - 1;
    }
  }
  return false;
}

/** Lex the text of a link or image; undefined when a link would nest inside a link. */
function linkOut(m, href, title, raw, textMode) {
  const text = m[1].replace(/\\([\[\]])/g, '$1');
  const isImage = m[0].charAt(0) === '!';
  const savedInLink = inLink, savedEmitted = linkEmitted, savedRaw = inRawBlock;
  inLink = true;
  linkEmitted = false;
  const inner = lexInline(text, textMode || isImage);
  const emitted = linkEmitted;
  linkEmitted = savedEmitted;
  inLink = savedInLink;
  if (!isImage) {
    if (emitted) {
      inRawBlock = savedRaw;
      return;
    }
    linkEmitted = true;
  }
  let html;
  if (textMode) html = inner;
  else if (isImage) {
    const u = cleanUrl(href);
    if (u === null) html = escapeText(inner);
    else {
      html = `<img src="${escapeText(u)}" alt="${escapeText(inner)}"`;
      if (title) html += ` title="${escapeText(title)}"`;
      html += '>';
    }
  } else {
    const u = cleanUrl(href);
    if (u === null) html = inner;
    else {
      html = '<a href="' + escapeText(u) + '"';
      if (title) html += ' title="' + escapeText(title) + '"';
      html += '>' + inner + '</a>';
    }
  }
  return { raw, html };
}

function autoLinkHtml(text, href, textMode) {
  if (textMode) return text;
  const u = cleanUrl(href);
  const body = escapeAll(text);
  if (u === null) return body;
  return '<a href="' + escapeAll(u) + '">' + body + '</a>';
}

function lexInline(src, textMode) {
  const savedParen = linkParenPossible;
  linkParenPossible = savedParen && src.includes(')');
  try {
    return lexInlineInner(src, textMode);
  } finally {
    linkParenPossible = savedParen;
  }
}

function lexInlineInner(src, textMode) {
  const masked = src.includes('*') || src.includes('_') || src.includes('~') ? maskSource(src) : src;
  let closers = null;
  let out = '';
  // the pending run of text tokens marked would merge into one
  let textRun = null;
  let textRunEscaped = false;
  const flush = () => {
    if (textRun !== null) {
      out += textMode || textRunEscaped ? textRun : escapeText(textRun);
      textRun = null;
    }
  };
  let prevWasText = false;
  let prevChar = '';
  let m;
  while (src) {
    if (!prevWasText) prevChar = '';
    prevWasText = false;

    if ((m = RE_ESCAPE.exec(src))) {
      src = src.substring(m[0].length);
      flush();
      out += textMode ? m[1] : escapeText(m[1]);
      continue;
    }
    if ((m = RE_TAG.exec(src))) {
      const t = m[0];
      if (!inLink && /^<a /i.test(t)) inLink = true;
      else if (inLink && /^<\/a>/i.test(t)) inLink = false;
      if (!inRawBlock && /^<(pre|code|kbd|script)(\s|>)/i.test(t)) inRawBlock = true;
      else if (inRawBlock && /^<\/(pre|code|kbd|script)(\s|>)/i.test(t)) inRawBlock = false;
      src = src.substring(t.length);
      flush();
      out += t;
      continue;
    }
    let lk;
    if ((lk = inlineLink(src, textMode))) {
      src = src.substring(lk.raw.length);
      flush();
      out += lk.html;
      continue;
    }
    if ((lk = refLink(src, textMode))) {
      src = src.substring(lk.raw.length);
      if (lk.text !== undefined) {
        if (textRun !== null) textRun += lk.text;
        else {
          textRun = lk.text;
          textRunEscaped = false;
        }
      } else {
        flush();
        out += lk.html;
      }
      continue;
    }
    if (closers === null && (src.charCodeAt(0) === 42 || src.charCodeAt(0) === 95 || src.charCodeAt(0) === 126)) closers = closerIndexes(masked);
    if ((lk = emStrong(src, masked, prevChar, closers, textMode))) {
      src = src.substring(lk.raw.length);
      flush();
      out += lk.html;
      continue;
    }
    if ((m = RE_CODESPAN.exec(src))) {
      let text = m[2].replace(/\n/g, ' ');
      if (/[^ ]/.test(text) && text.startsWith(' ') && text.endsWith(' ')) text = text.substring(1, text.length - 1);
      src = src.substring(m[0].length);
      flush();
      out += textMode ? text : '<code>' + escapeAll(text) + '</code>';
      continue;
    }
    if ((m = RE_BR.exec(src))) {
      src = src.substring(m[0].length);
      flush();
      if (!textMode) out += '<br>';
      continue;
    }
    if ((lk = strike(src, masked, prevChar, closers, textMode))) {
      src = src.substring(lk.raw.length);
      flush();
      out += lk.html;
      continue;
    }
    if ((m = RE_AUTOLINK.exec(src))) {
      const text = m[1];
      const href = m[2] === '@' ? 'mailto:' + text : text;
      src = src.substring(m[0].length);
      flush();
      out += autoLinkHtml(text, href, textMode);
      continue;
    }
    if (!inLink && (m = RE_URL.exec(src))) {
      let text, href;
      if (m[2] === '@') {
        text = m[0];
        href = 'mailto:' + text;
      } else {
        let prev;
        do {
          prev = m[0];
          const b = RE_BACKPEDAL.exec(m[0]);
          m[0] = b ? b[0] : '';
        } while (prev !== m[0]);
        text = m[0];
        href = m[1] === 'www.' ? 'http://' + m[0] : m[0];
      }
      src = src.substring(m[0].length);
      flush();
      out += autoLinkHtml(text, href, textMode);
      continue;
    }
    if ((m = RE_INLINE_TEXT.exec(src))) {
      const raw = m[0];
      src = src.substring(raw.length);
      const last = raw.charAt(raw.length - 1);
      if (last !== '_') prevChar = last;
      prevWasText = true;
      const text = inRawBlock ? raw : decodeNumeric(raw);
      if (textRun !== null) textRun += text;
      else {
        textRun = text;
        textRunEscaped = inRawBlock;
      }
      continue;
    }
    throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
  }
  flush();
  return out;
}

function inlineLink(src, textMode) {
  if (linkParenPossible === false) return;
  const m = RE_LINK.exec(src);
  if (!m) return;
  const off = m[0].charAt(0) === '!' ? 2 : 1;
  if (tagCrossesLabel(src, m[1], off)) return;
  const s = m[2].trim();
  if (/^</.test(s)) {
    if (!/>$/.test(s)) return;
    const l = rtrimChar(s.slice(0, -1), '\\');
    if ((s.length - l.length) % 2 === 0) return;
  } else {
    const l = findClosingBracket(m[2], '(', ')');
    if (l === -2) return;
    if (l > -1) {
      const h = (m[0].indexOf('!') === 0 ? 5 : 4) + m[1].length + l;
      m[2] = m[2].substring(0, l);
      m[0] = m[0].substring(0, h).trim();
      m[3] = '';
    }
  }
  const r = rtrimChar(m[0].slice(0, -1), '\\');
  if ((m[0].length - r.length) % 2 === 0) return;
  let href = m[2];
  const title = m[3] ? m[3].slice(1, -1) : '';
  href = href.trim();
  if (/^</.test(href)) href = href.slice(1, -1);
  return linkOut(
    m,
    href && href.replace(RE_ANY_PUNCT, '$1'),
    (title && title.replace(RE_ANY_PUNCT, '$1')) || null,
    m[0],
    textMode,
  );
}

function refLink(src, textMode) {
  const m = RE_REFLINK.exec(src) || RE_NOLINK.exec(src);
  if (!m) return;
  const off = m[0].charAt(0) === '!' ? 2 : 1;
  if (tagCrossesLabel(src, m[1], off)) return;
  const ref = links[normLabel(m[2] || m[1])];
  if (!ref) {
    const c = m[0].charAt(0);
    return { raw: c, text: c };
  }
  return linkOut(m, ref.href, ref.title || null, m[0], textMode);
}

function emStrong(src, masked, prevChar, closers, textMode) {
  let m = RE_EM_L.exec(src);
  if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return;
  const ch = m[0][0];
  const sameAsPrev = prevChar === ch;
  const pos = masked.length - src.length;
  let l = pos;
  while (l > 0 && masked[l - 1] === ch) l--;
  const before = [...masked.slice(Math.max(0, l - 2), l)].at(-1) ?? '';
  const beforeIsPunct = before === '*' || before === '_' || !!RE_PUNCTUATION.exec(before);
  if (l < pos) prevChar = before;
  const prevPunct = l < pos ? beforeIsPunct : !!RE_PUNCTUATION.exec(prevChar);
  if (m[4] && prevChar.match(RE_UNICODE_ALNUM)) return;
  const punctAfter = m[1] || m[3] || '';
  if (punctAfter && prevChar && !prevPunct) return;
  const lLength = [...m[0]].length - 1;
  let delimTotal = lLength;
  let midDelimTotal = 0;
  const runLen = pos - l + lLength;
  const strictLeft = !!before.trim() && (!!punctAfter || (ch === '*' && !beforeIsPunct));
  if (ch !== '*' && ch !== '_') return;
  const rRe = ch === '*' ? RE_EM_R_AST : RE_EM_R_UND;
  const lastCloser = closers[ch];
  const startIn = masked.length - src.length + lLength;
  if (lastCloser < startIn) return;
  const rest = masked.slice(-1 * src.length + lLength);
  const limit = lastCloser - startIn;
  rRe.lastIndex = 0;
  while ((m = rRe.exec(rest)) !== null && !(m.index > limit)) {
    const rDelim = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
    if (!rDelim) continue;
    let rLength = [...rDelim].length;
    if (m[3] || m[4]) {
      delimTotal += rLength;
      continue;
    } else if (m[5] || m[6] || strictLeft) {
      if (sameAsPrev && (m[5] || m[6])) break;
      if (runLen % 3 && !((runLen + rLength) % 3)) {
        midDelimTotal += rLength;
        continue;
      }
    }
    delimTotal -= rLength;
    if (delimTotal > 0) continue;
    rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
    const firstLen = [...m[0]][0].length;
    const raw = src.slice(0, lLength + m.index + firstLen + rLength);
    if (Math.min(lLength, rLength) % 2) {
      const inner = lexInline(raw.slice(1, -1), textMode);
      return { raw, html: textMode ? inner : '<em>' + inner + '</em>' };
    }
    const inner = lexInline(raw.slice(2, -2), textMode);
    return { raw, html: textMode ? inner : '<strong>' + inner + '</strong>' };
  }
}

function strike(src, masked, prevChar, closers, textMode) {
  let m = RE_DEL_L.exec(src);
  if (!m) return;
  if ((m[1] || '') && prevChar && !RE_PUNCTUATION.exec(prevChar)) return;
  const lLength = [...m[0]].length - 1;
  let delimTotal = lLength;
  const lastCloser = closers['~'];
  const startIn = masked.length - src.length + lLength;
  if (lastCloser < startIn) return;
  const rest = masked.slice(-1 * src.length + lLength);
  const limit = lastCloser - startIn;
  RE_DEL_R.lastIndex = 0;
  while ((m = RE_DEL_R.exec(rest)) !== null && !(m.index > limit)) {
    const rDelim = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
    if (!rDelim) continue;
    let rLength = [...rDelim].length;
    if (rLength !== lLength) continue;
    if (m[3] || m[4]) {
      delimTotal += rLength;
      continue;
    }
    delimTotal -= rLength;
    if (delimTotal > 0) continue;
    rLength = Math.min(rLength, rLength + delimTotal);
    const firstLen = [...m[0]][0].length;
    const raw = src.slice(0, lLength + m.index + firstLen + rLength);
    const inner = lexInline(raw.slice(lLength, -lLength), textMode);
    return { raw, html: textMode ? inner : '<del>' + inner + '</del>' };
  }
}

// ---------------------------------------------------------------------------------------
// Rendering of block tokens (inline HTML is ready in each token's job by then)

function renderBlocks(tokens) {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case 'space':
      case 'def':
        break;
      case 'hr':
        out += '<hr>\n';
        break;
      case 'heading':
        out += `<h${t.depth}>${t.job.prefix}${t.job.html}</h${t.depth}>\n`;
        break;
      case 'code': {
        const lang = (t.lang || '').match(/^\S*/)?.[0];
        const body = t.text ? t.text.replace(/\n$/, '') + '\n' : '';
        out += lang ? '<pre><code class="language-' + escapeText(lang) + '">' + escapeAll(body) + '</code></pre>\n' : '<pre><code>' + escapeAll(body) + '</code></pre>\n';
        break;
      }
      case 'blockquote':
        out += '<blockquote>\n' + renderBlocks(t.tokens) + '</blockquote>\n';
        break;
      case 'list': {
        const tag = t.ordered ? 'ol' : 'ul';
        out += '<' + tag + (t.ordered && t.start !== 1 ? ' start="' + t.start + '"' : '') + '>\n';
        for (const item of t.items) out += '<li>' + renderBlocks(item.tokens) + '</li>\n';
        out += '</' + tag + '>\n';
        break;
      }
      case 'checkbox':
        out += t.html;
        break;
      case 'html':
        out += t.text;
        break;
      case 'paragraph':
        out += '<p>' + t.job.prefix + t.job.html + '</p>\n';
        break;
      case 'text':
        out += t.job.prefix + t.job.html;
        break;
      case 'table': {
        let head = '';
        for (let c = 0; c < t.header.length; c++) head += cell('th', t.align[c], t.header[c]);
        let body = '';
        for (const row of t.body) {
          let r = '';
          for (let c = 0; c < row.length; c++) r += cell('td', t.align[c], row[c]);
          body += '<tr>\n' + r + '</tr>\n';
        }
        if (body) body = '<tbody>' + body + '</tbody>';
        out += '<table>\n<thead>\n<tr>\n' + head + '</tr>\n</thead>\n' + body + '</table>\n';
        break;
      }
    }
  }
  return out;
}

function cell(tag, align, job) {
  return (align ? `<${tag} align="${align}">` : `<${tag}>`) + job.html + `</${tag}>\n`;
}

// ---------------------------------------------------------------------------------------

/** Render `markdown` to HTML exactly as marked 18.1.3 does with its default options. */
export function parse(markdown) {
  links = Object.create(null);
  queue = [];
  top = true;
  inLink = false;
  inRawBlock = false;
  linkEmitted = false;
  linkParenPossible = true;
  const tokens = blockTokens(markdown.replace(/\r\n|\r/g, '\n'), [], false);
  for (let i = 0; i < queue.length; i++) {
    inRawBlock = false;
    queue[i].html = lexInline(queue[i].src, false);
  }
  const html = renderBlocks(tokens);
  links = null;
  queue = null;
  return html;
}

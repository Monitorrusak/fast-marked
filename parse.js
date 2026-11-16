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
// (paragraphs and block quotes are delimited by paragraphLength / blockquoteLength below)

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
// (the emphasis right-delimiter rules, RE_EM_R_AST / RE_EM_R_UND in marked, are implemented
// by emStrong's run scanner and flankGroup below)
const RE_PUNCTUATION = new RegExp(R`^((?![*_])${PS0})`, 'u');
const RE_UNICODE_ALNUM = /[\p{L}\p{N}]/u;
const EMAIL_TAIL = R`[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])`;
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
  if (s.indexOf('&#') === -1 || !RE_NUMREF.test(s)) return s;
  return s.replace(RE_NUMREF_OR_AMP, (_, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const cp = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\uFFFD';
    if (cp === 38) return '&amp;';
    return String.fromCodePoint(cp);
  });
}

/** Characters encodeURI leaves alone ('%' excluded, so a URL holding one still goes through it). */
const URI_SAFE = new Uint8Array(128);
for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'();/?:@&=+$,#") URI_SAFE[ch.charCodeAt(0)] = 1;

function cleanUrl(href) {
  let i = 0;
  while (i < href.length) {
    const c = href.charCodeAt(i);
    if (c >= 128 || URI_SAFE[c] === 0) break;
    i++;
  }
  if (i === href.length) return href;
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
let linkCount = 0;
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
    // What the line starts with decides which rules can match: `ind` leading spaces (counted
    // up to 4) and `c`, the character after them. Rules marked "<=3" need ind <= 3.
    const c0 = src.charCodeAt(0);
    let ind = 0;
    while (ind < 4 && src.charCodeAt(ind) === 32) ind++;
    const c = src.charCodeAt(ind);
    const lead = ind <= 3 ? c : -1;

    // blank lines
    if (c0 === 10 || c0 === 32 || c0 === 9) {
      const len = blankRunLength(src);
      if (len > 0) {
        const raw = src.slice(0, len);
        src = src.substring(len);
        const prev = lastOf(tokens);
        if (len === 1 && prev !== undefined) prev.raw += '\n';
        else tokens.push({ type: 'space', raw });
        continue;
      }
    }
    // indented code: four spaces, or up to three and a tab
    if ((ind === 4 || c === 9) && (m = RE_CODE.exec(src))) {
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
    if ((lead === 96 || lead === 126) && (m = RE_FENCES.exec(src))) {
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
    if (lead === 35 && (m = RE_HEADING.exec(src))) {
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
    const dash = lead === 45 || lead === 42; // '-' and '*' open both rules and lists
    if ((dash || lead === 95) && (m = RE_HR.exec(src))) {
      const raw = rtrimChar(m[0], '\n');
      src = src.substring(raw.length);
      tokens.push({ type: 'hr', raw });
      continue;
    }
    if (lead === 62 && (tok = blockquote(src))) {
      src = src.substring(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if ((dash || lead === 43 || (lead >= 48 && lead <= 57)) && (tok = list(src))) {
      src = src.substring(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if (lead === 60 && (m = RE_HTML.exec(src))) {
      const raw = trimTrailingBlankLines(m[0]);
      src = src.substring(raw.length);
      tokens.push({ type: 'html', raw, text: raw });
      continue;
    }
    if (lead === 91 && (tok = def(src))) {
      src = src.substring(tok.raw.length);
      const prev = lastOf(tokens);
      if (prev && (prev.type === 'paragraph' || prev.type === 'text')) {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        prev.text += '\n' + tok.raw;
        queue[queue.length - 1].src = prev.text;
      } else {
        if (!links[tok.tag]) {
          links[tok.tag] = { href: tok.href, title: tok.title };
          linkCount++;
        }
        tokens.push(tok);
      }
      continue;
    }
    const firstNl = src.indexOf('\n');
    if (firstNl !== -1 && delimiterRow(src, firstNl + 1) === 2 && (tok = table(src))) {
      src = src.substring(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if (firstNl !== -1 && setextUnderlineAhead(src, firstNl) && (m = RE_LHEADING.exec(src))) {
      const raw = rtrimChar(m[0], '\n');
      src = src.substring(raw.length);
      tokens.push({ type: 'heading', raw, depth: m[2].charAt(0) === '=' ? 1 : 2, job: inlineJob(m[1].trim()) });
      continue;
    }
    if (top && c0 !== 10) {
      const raw = src.slice(0, paragraphLength(src, firstNl));
      const text = raw;
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
    if (c0 !== 10) {
      const raw = firstNl === -1 ? src : src.slice(0, firstNl);
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

/**
 * Is the line at i a whole GFM delimiter row, ` {0,3}(?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?`
 * up to its end? 0: no, 1: yes, 2: yes and it holds a ':' or '|' (marked's table() needs one).
 */
function delimiterRow(src, i) {
  const n = src.length;
  let j = i;
  while (j < i + 3 && src.charCodeAt(j) === 32) j++;
  let special = false;
  if (src.charCodeAt(j) === 124) {
    special = true;
    j++;
    while (src.charCodeAt(j) === 32) j++;
  }
  for (;;) {
    // a cell, :?-+:? *
    if (src.charCodeAt(j) === 58) {
      special = true;
      j++;
    }
    if (src.charCodeAt(j) !== 45) return 0;
    while (src.charCodeAt(j) === 45) j++;
    if (src.charCodeAt(j) === 58) {
      special = true;
      j++;
    }
    while (src.charCodeAt(j) === 32) j++;
    // then the end of the line, or a pipe and either the end of the line or another cell
    if (j >= n || src.charCodeAt(j) === 10) return special ? 2 : 1;
    if (src.charCodeAt(j) !== 124) return 0;
    special = true;
    j++;
    while (src.charCodeAt(j) === 32) j++;
    if (j >= n || src.charCodeAt(j) === 10) return 2;
  }
}

/** marked's table rule as a paragraph interrupter at line start ls: a header line ` *([^\n ].*)`
 * followed by a delimiter row (the rows after it may be empty, so nothing else is needed). */
function tableInterrupts(src, ls) {
  const n = src.length;
  let j = ls;
  while (src.charCodeAt(j) === 32) j++;
  if (j >= n || src.charCodeAt(j) === 10) return false;
  for (let k = j + 1; k < n; k++) {
    const d = src.charCodeAt(k);
    if (d === 10) return delimiterRow(src, k + 1) !== 0;
    if (d === 13 || d === 0x2028 || d === 0x2029) return false; // `.` stops there
  }
  return false;
}

/** Is there a setext underline (` {0,3}(=+|-+)[ \t]*` alone on its line) among the lines after
 * the first, before the next whitespace-only line? If not, the lheading rule cannot match. */
function setextUnderlineAhead(src, nl) {
  const n = src.length;
  while (nl !== -1) {
    const ls = nl + 1;
    let j = ls;
    while (j < ls + 3 && src.charCodeAt(j) === 32) j++;
    const ch = src.charCodeAt(j);
    if (ch === 61 || ch === 45) {
      let k = j;
      while (src.charCodeAt(k) === ch) k++;
      while (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9) k++;
      if (k >= n || src.charCodeAt(k) === 10) return true;
    }
    // lines the heading text cannot run on over: a bullet and a space, a quote marker, an ATX
    // heading, a fence (some of the rule's own stops; the others are left to the regex)
    if (ch === 62) return false;
    if ((ch === 42 || ch === 43 || ch === 45) && src.charCodeAt(j + 1) === 32) return false;
    if (ch >= 48 && ch <= 57) {
      let d = j;
      while (d < j + 9 && src.charCodeAt(d) >= 48 && src.charCodeAt(d) <= 57) d++;
      const c2 = src.charCodeAt(d);
      if ((c2 === 46 || c2 === 41) && src.charCodeAt(d + 1) === 32) return false;
    }
    if (ch === 35) {
      let h = j;
      while (h < j + 6 && src.charCodeAt(h) === 35) h++;
      if (h >= n || isJsSpace(src.charCodeAt(h))) return false;
    }
    if ((ch === 96 || ch === 126) && src.charCodeAt(j + 1) === ch && src.charCodeAt(j + 2) === ch) return false;
    let k = ls;
    while (k < n && src.charCodeAt(k) !== 10 && isJsSpace(src.charCodeAt(k))) k++;
    if (k >= n || src.charCodeAt(k) === 10) return false;
    nl = src.indexOf('\n', ls);
  }
  return false;
}

// What can interrupt a paragraph, tried at the start of its next line. The table rule (a header
// line followed by a delimiter row) is kept apart: it is costly and needs a delimiter row next.
const RE_PARA_STOP = new RegExp(`(?:${HR_SRC}|${I_HEADING}|${I_BQ}|${I_FENCE}|${I_LIST_PARA}|${I_HTML}|[ \\t]+\\n)`, 'y');
// The same for a paragraph inside a block quote (its list rule differs, and tables do not count).
const RE_BQ_STOP = new RegExp(`(?:${HR_SRC}|${I_HEADING}|${I_BQ}|${I_FENCE}|${I_LIST_BQ}|${I_HTML}|[ \\t]+\\n)`, 'y');

/** Can one of those interrupters start at line start ls? 0: no, 2: certainly (a quote marker,
 * or a bullet as the list rule needs it), 1: maybe, so the regex decides. Every interrupter
 * needs one of the characters below after the line's spaces, or a whitespace-only line. */
function interruptKind(src, ls, inQuote) {
  let j = ls;
  while (src.charCodeAt(j) === 32) j++;
  let ch = src.charCodeAt(j);
  if (j - ls <= 3) {
    if (ch === 62) return 2; // ` {0,3}>`
    if (ch === 42 || ch === 43 || ch === 45) {
      const d = src.charCodeAt(j + 1);
      if (inQuote) {
        if (d === 32 || d === 9 || d === 10 || j + 1 >= src.length) return 2; // [*+-](?:[ \t]|\n|$)
      } else if (d === 32 || d === 9) {
        let k = j + 2;
        while (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9) k++;
        if (k < src.length && src.charCodeAt(k) !== 10) return 2; // [*+-][ \t]+[^ \t\n]
      }
    }
  }
  while (ch === 32 || ch === 9) ch = src.charCodeAt(++j);
  switch (ch) {
    case 10: case 45: case 95: case 42: case 35: case 62: case 96: case 126: case 43: case 60:
      return 1;
  }
  return ch >= 48 && ch <= 57 ? 1 : 0;
}
/** Length of the paragraph at the start of src (src does not start with a newline). */
function paragraphLength(src, end) {
  if (end === -1) return src.length;
  const n = src.length;
  for (;;) {
    const ls = end + 1;
    if (ls >= n || src.charCodeAt(ls) === 10) return end;
    const kind = interruptKind(src, ls, false);
    if (kind === 2) return end;
    if (kind === 1) {
      RE_PARA_STOP.lastIndex = ls;
      if (RE_PARA_STOP.test(src)) return end;
    }
    const nx = src.indexOf('\n', ls);
    if (nx === -1) return n;
    if (tableInterrupts(src, ls)) return end;
    end = nx;
  }
}

/** Length of RE_BLOCKQUOTE's match at the start of src (0 when it does not match): lines that
 * start with ` {0,3}>`, each followed, when not blank, by the lazy continuation lines of its
 * paragraph. */
function blockquoteLength(src) {
  const n = src.length;
  let pos = 0;
  for (;;) {
    let j = pos;
    while (j < pos + 3 && src.charCodeAt(j) === 32) j++;
    if (src.charCodeAt(j) !== 62) break;
    j++;
    if (src.charCodeAt(j) === 32) j++;
    let e = src.indexOf('\n', j);
    if (e === -1) e = n;
    let k = j;
    while (k < e && (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9)) k++;
    if (k < e) {
      // a paragraph: it runs on over following lines until an empty line or an interrupter
      while (e < n) {
        const ls = e + 1;
        if (ls >= n || src.charCodeAt(ls) === 10) break;
        const kind = interruptKind(src, ls, true);
        if (kind === 2) break;
        if (kind === 1) {
          RE_BQ_STOP.lastIndex = ls;
          if (RE_BQ_STOP.test(src)) break;
        }
        const nx = src.indexOf('\n', ls);
        e = nx === -1 ? n : nx;
      }
    }
    if (e >= n) return n;
    pos = e + 1;
  }
  return pos;
}

/** Length of RE_NEWLINE's match, `^(?:[ \t]*(?:\n|$))+`: whole lines of spaces and tabs. */
function blankRunLength(src) {
  const n = src.length;
  let i = 0;
  for (;;) {
    let j = i;
    while (j < n && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9)) j++;
    if (j >= n) return n; // the last line, ended by the end of the text
    if (src.charCodeAt(j) !== 10) return i;
    i = j + 1;
  }
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
  const len = blockquoteLength(src);
  if (len === 0) return;
  let lines = rtrimChar(src.slice(0, len), '\n').split('\n');
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

/** Does a list-item break rule (fence, heading, html, quote, next bullet, hr) match `line`?
 * Each needs at most k spaces and then one particular character, so only the rules that
 * character can start are tried. */
function itemBreak(line, k) {
  let i = 0;
  while (i <= k && line.charCodeAt(i) === 32) i++;
  if (i > k) return false; // more than k spaces: no rule can match
  const c = line.charCodeAt(i);
  switch (c) {
    case 96: // `
    case 126: // ~
      return FENCE_AT[k].test(line);
    case 35: // #
      return HEADING_AT[k].test(line);
    case 60: // <
      return HTML_AT[k].test(line);
    case 62: // > (BQ_AT[k] is just ` {0,k}>`)
      return true;
    case 42: // *
    case 45: // -
      return NEXT_BULLET[k].test(line) || HR_AT[k].test(line);
    case 43: // +
      return NEXT_BULLET[k].test(line);
    case 95: // _
      return HR_AT[k].test(line);
    default:
      return c >= 48 && c <= 57 && NEXT_BULLET[k].test(line);
  }
}

/** /\n[ \t]*\n[ \t]*$/ */
function endsWithBlankLine(s) {
  let i = s.length - 1;
  while (i >= 0 && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i--;
  if (i < 0 || s.charCodeAt(i) !== 10) return false;
  i--;
  while (i >= 0 && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i--;
  return i >= 0 && s.charCodeAt(i) === 10;
}

/** Index of the first character that is not a space, or -1 (`s.search(/[^ ]/)`). */
function firstNonSpace(s) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) !== 32) return i;
  return -1;
}
/** `!s.trim()`: s is empty or only (JavaScript) whitespace. */
function isBlank(s) {
  for (let i = 0; i < s.length; i++) if (!isJsSpace(s.charCodeAt(i))) return false;
  return true;
}
/** `s.replace(/^[ \t]+/, (ws) => expandTabs(ws, col))` */
function expandLeadingTabs(s, col) {
  let i = 0;
  let tab = false;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9) tab = true;
    else if (c !== 32) break;
  }
  return tab ? expandTabs(s.slice(0, i), col) + s.slice(i) : s;
}
/** `s.replace(/\t/g, '    ').search(/[^ ]/) >= 4` */
function indentedFourWithTabsAsFour(s) {
  let col = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32) col++;
    else if (c === 9) col += 4;
    else return col >= 4;
  }
  return false;
}

const Y_HR = new RegExp(HR_SRC, 'y');
const Y_LIST_ITEM = {};
for (const key of Object.keys(LIST_ITEM)) Y_LIST_ITEM[key] = new RegExp(LIST_ITEM[key].source.slice(1), 'y');

function list(src) {
  let m = RE_LIST.exec(src);
  if (!m) return;
  const n = src.length;
  let bull = m[1].trim();
  const ordered = bull.length > 1;
  const token = { type: 'list', raw: '', ordered, start: ordered ? +bull.slice(0, -1) : '', loose: false, items: [] };
  const itemRe = Y_LIST_ITEM[ordered ? bull.slice(-1) : bull];
  let endsWithBlank = false;
  let pos = 0; // marked consumes src line by line; pos is how far it has got
  while (pos < n) {
    let blankFound = false;
    let content = '';
    itemRe.lastIndex = pos;
    if (!(m = itemRe.exec(src))) break;
    Y_HR.lastIndex = pos;
    if (Y_HR.test(src)) break;
    const startAt = pos;
    pos += m[0].length;
    const markerLen = m[1].length;
    const firstLine = m[2].charCodeAt(m[2].length - 1) === 10 ? m[2].slice(0, -1) : m[2];
    let line = expandLeadingTabs(firstLine, markerLen);
    let nl = src.indexOf('\n', pos);
    let next = nl === -1 ? src.slice(pos) : src.slice(pos, nl);
    let blank = isBlank(line);
    let indent = 0;
    if (blank) indent = markerLen + 1;
    else {
      indent = firstNonSpace(line);
      indent = indent > 4 ? 1 : indent;
      content = line.slice(indent);
      indent += markerLen;
    }
    if (blank && RE_BLANK_LINE.test(next)) {
      pos = nl === -1 ? n : nl + 1;
      blankFound = true;
    }
    if (!blankFound) {
      const k = indexFor(indent);
      const reHr = HR_AT[k], reFence = FENCE_AT[k], reHeading = HEADING_AT[k], reHtml = HTML_AT[k];
      while (pos < n) {
        nl = src.indexOf('\n', pos);
        next = nl === -1 ? src.slice(pos) : src.slice(pos, nl);
        // every break rule is "at most k spaces, then one of these characters"
        if (itemBreak(next, k)) break;
        const expanded = expandLeadingTabs(next, 0);
        const nextBlank = isBlank(next);
        const rest = expanded.slice(indent);
        if (firstNonSpace(expanded) >= indent || nextBlank) content += '\n' + rest;
        else {
          if (blank || indentedFourWithTabsAsFour(line) || reFence.test(line) || reHeading.test(line) || reHtml.test(line) || reHr.test(line)) break;
          const add = RE_SETEXT_LINE.test(next) && RE_LHEADING.test(`${line}\n${next}`) ? `    ${expanded.replace(/^ {0,3}/, '')}` : next;
          content += '\n' + add;
        }
        blank = nextBlank;
        pos = nl === -1 ? n : nl + 1;
        line = rest;
      }
    }
    const raw = src.slice(startAt, pos);
    if (!token.loose) {
      if (endsWithBlank) token.loose = true;
      else if (endsWithBlankLine(raw)) endsWithBlank = true;
    }
    token.items.push({ raw, task: RE_TASK.test(content), checked: undefined, loose: false, text: content, tokens: [] });
  }
  const lastItem = lastOf(token.items);
  if (!lastItem) return;
  lastItem.raw = lastItem.raw.trimEnd();
  lastItem.text = lastItem.text.trimEnd();
  token.raw = src.slice(0, pos).trimEnd();
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

/** A reference link marked masks: a defined label becomes 'a's (the same length as r). */
function maskRef(r) {
  const o = r.lastIndexOf('[');
  if (!Object.hasOwn(links, normLabel(r.slice(o + 1, -1)))) return r;
  if (o > 1 && r.charAt(0) !== '!') {
    const inner = r.slice(1, o - 1);
    if (linkInText(inner)) return '[' + inner.replace(RE_REFLINK_SEARCH, maskRef) + '][' + 'a'.repeat(r.length - o - 2) + ']';
  }
  return '[' + 'a'.repeat(r.length - 2) + ']';
}
/** Its own copy, so maskRef's nested use of RE_REFLINK_SEARCH cannot move this loop's lastIndex. */
const LOOP_REFLINK_SEARCH = new RegExp(RE_REFLINK_SEARCH.source, 'g');

/**
 * marked's emphasis masking: hide reference labels, escapes, code spans, links and tags from the
 * delimiter search, keeping every index where it was. Same three passes as marked's replace()
 * calls, written as exec loops that rebuild the string only when a match really changes.
 */
function maskSource(src) {
  // pieces are joined at the end of each pass, so the result is a flat string (character
  // reads on a deep rope of concatenations would be slow in emStrong)
  let t = src;
  let m, parts, last;
  if (linkCount > 0 && t.indexOf('[') !== -1) {
    const re = LOOP_REFLINK_SEARCH;
    re.lastIndex = 0;
    parts = null;
    last = 0;
    while ((m = re.exec(t)) !== null) {
      const rep = maskRef(m[0]);
      if (rep !== m[0]) {
        (parts ??= []).push(t.slice(last, m.index), rep);
        last = m.index + m[0].length;
      }
    }
    if (parts !== null) {
      parts.push(t.slice(last));
      t = parts.join('');
    }
  }
  const tick = t.indexOf('`') !== -1;
  if (tick || t.indexOf('\\') !== -1) {
    const re = RE_ANY_PUNCT_OUTSIDE_CODE;
    re.lastIndex = 0;
    parts = null;
    last = 0;
    while ((m = re.exec(t)) !== null) {
      const n = m[0];
      let rep;
      if (m[2] !== undefined) rep = '+'.repeat(n.length); // an escaped punctuation character
      else if (m[1] !== undefined) {
        // a code span: backticks inside it (other run lengths) become '+'
        const inner = n.slice(m[1].length, -m[1].length);
        if (inner.indexOf('`') === -1) continue;
        rep = m[1] + inner.replace(/`/g, '+') + m[1];
      } else continue;
      (parts ??= []).push(t.slice(last, m.index), rep);
      last = m.index + n.length;
    }
    if (parts !== null) {
      parts.push(t.slice(last));
      t = parts.join('');
    }
  }
  // links need '[', code spans '`' and tags '<' (a code span masked above still has its backticks)
  if (tick || t.indexOf('[') !== -1 || t.indexOf('<') !== -1) {
    const re = RE_BLOCK_SKIP;
    re.lastIndex = 0;
    parts = null;
    last = 0;
    while ((m = re.exec(t)) !== null) {
      const n = m[0];
      const o = m[2] ? m[2].length : 0;
      (parts ??= []).push(t.slice(last, m.index), n.slice(0, o), '[', 'a'.repeat(n.length - o - 2), ']');
      last = m.index + n.length;
    }
    if (parts !== null) {
      parts.push(t.slice(last));
      t = parts.join('');
    }
  }
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

// --- inline lexing, index based ------------------------------------------------------------
// The inline rules are matched as sticky regexes at `lastIndex = pos` in the whole inline
// source rather than as ^-anchored regexes on a fresh substring at every position. None of
// them looks behind and `$` still means the end of the source, so the matches are the same.

const Y_TAG = new RegExp(
  R`<!--(?:-?>|[\s\S]*?-->)|<\/[a-zA-Z][a-zA-Z0-9-]*\s*>|<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>${BT}]+)?)*?\s*\/?>|<\?[\s\S]*?\?>|<![a-zA-Z]+\s[\s\S]*?>|<!\[CDATA\[[\s\S]*?\]\]>`,
  'y',
);
const unanchored = (re, flags) => new RegExp(re.source.slice(1), flags); // drops the single leading ^
const Y_AUTOLINK = unanchored(RE_AUTOLINK, 'y');
const Y_LINK = unanchored(RE_LINK, 'y');
const Y_REFLINK = unanchored(RE_REFLINK, 'y');
const Y_NOLINK = unanchored(RE_NOLINK, 'y');
const Y_CODESPAN = unanchored(RE_CODESPAN, 'y');
const Y_BR = unanchored(RE_BR, 'y');
const Y_DEL_L = unanchored(RE_DEL_L, 'uy');
const Y_EM_L = new RegExp(R`\*+(?:((?!\*)${PT})|([^\s*]))?|_+(?:((?!_)${PT})|([^\s_]))?`, 'uy');
const Y_URL = new RegExp(
  R`mailto:${EMAIL_TAIL}|xmpp:${EMAIL_TAIL}(?:\/[A-Za-z0-9@.]+)?|((?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])`,
  'y',
);

/** ASCII punctuation a backslash escapes, and the HTML each escaped character renders as. */
const ESCAPABLE = new Uint8Array(128);
const ESCAPED_HTML = [];
for (const ch of '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~') {
  ESCAPABLE[ch.charCodeAt(0)] = 1;
  ESCAPED_HTML[ch.charCodeAt(0)] = ESC_MAP[ch] || ch;
}

/** End index of the token the last helper below produced. */
let lastEnd = 0;
/** refLink's answer for "[label]" with no definition: the bracket is plain text. */
const TEXT_CHAR = {};

/** Does the link text hold an HTML tag or autolink that runs past its closing bracket? */
function tagCrossesLabel(s, pos, label, offset) {
  if (label.indexOf('<') === -1) return false;
  for (let i = 0; i < label.length; i++) {
    const ch = label.charCodeAt(i);
    if (ch === 92) {
      i++;
      continue;
    }
    if (ch === 96) {
      Y_CODESPAN.lastIndex = i;
      const c = Y_CODESPAN.exec(label);
      if (c) {
        i += c[0].length - 1;
        continue;
      }
    }
    if (ch !== 60) continue;
    const at = pos + offset + i;
    Y_TAG.lastIndex = at;
    let o = Y_TAG.exec(s);
    if (!o) {
      Y_AUTOLINK.lastIndex = at;
      o = Y_AUTOLINK.exec(s);
    }
    if (o) {
      if (o[0].length > label.length - i) return true;
      i += o[0].length - 1;
    }
  }
  return false;
}

/** Render a link or image whose match is m; null when a link would nest inside a link. */
function linkOut(m, href, title, textMode, features, pos) {
  const text = m[1].indexOf('\\') === -1 ? m[1] : m[1].replace(/\\([\[\]])/g, '$1');
  const isImage = m[0].charCodeAt(0) === 33;
  const savedInLink = inLink, savedEmitted = linkEmitted, savedRaw = inRawBlock;
  inLink = true;
  linkEmitted = false;
  const inner = lexInline(text, textMode || isImage, features);
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
  lastEnd = pos + m[0].length;
  if (textMode) return inner;
  const u = cleanUrl(href);
  if (isImage) {
    if (u === null) return escapeText(inner);
    let html = `<img src="${escapeText(u)}" alt="${escapeText(inner)}"`;
    if (title) html += ` title="${escapeText(title)}"`;
    return html + '>';
  }
  if (u === null) return inner;
  let html = '<a href="' + escapeText(u) + '"';
  if (title) html += ' title="' + escapeText(title) + '"';
  return html + '>' + inner + '</a>';
}

function autoLinkHtml(text, href, textMode) {
  if (textMode) return text;
  const u = cleanUrl(href);
  const body = escapeAll(text);
  if (u === null) return body;
  return '<a href="' + escapeAll(u) + '">' + body + '</a>';
}

// --- hand-written equivalent of marked's gfm inline `text` rule -------------------------
// The rule takes one unit (a run of backticks, a run of tildes, or one code unit) and then
// extends lazily until the earliest position where another inline construct could start.

function isAlnum(c) {
  return (c >= 48 && c <= 57) || ((c | 32) >= 97 && (c | 32) <= 122);
}
/** Characters of an e-mail local part as marked's text rule lists them: [a-zA-Z0-9.!#$%&'*+/=?_`{|}~-] */
const EMAIL_CHAR = new Uint8Array(128);
for (const ch of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?_`{|}~-") EMAIL_CHAR[ch.charCodeAt(0)] = 1;
const isEmailChar = (c) => c < 128 && EMAIL_CHAR[c] === 1;
/** JavaScript's \s */
function isJsSpace(c) {
  if (c <= 32) return c === 32 || (c >= 9 && c <= 13);
  if (c < 0xa0) return false;
  return c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}
/** ` {2,}\n` at i */
function spacesThenNewline(s, i) {
  let j = i;
  while (s.charCodeAt(j) === 32) j++;
  return j - i >= 2 && s.charCodeAt(j) === 10;
}
function mailOrXmpp(s, i) {
  const c = s.charCodeAt(i);
  return (c === 109 && s.startsWith('mailto:', i)) || (c === 120 && s.startsWith('xmpp:', i));
}

// Whether the e-mail look-aheads can apply at all (checked once per job; a nested source is
// part of its parent, so the parent's answer stays a safe superset).
const HAS_AT = 1, HAS_REF = 2; // '@' (e-mail look-aheads), "&#" (numeric references to decode)
function rareFeatures(s) {
  return (s.indexOf('@') !== -1 ? HAS_AT : 0) | (s.indexOf('&#') !== -1 ? HAS_REF : 0);
}

/** 0: ordinary, 1: always stops, 2: may start "http", 3: may start "ftp://", 4: may start "www." */
const TEXT_STOP = new Uint8Array(128);
for (const ch of '\\<![`*~_') TEXT_STOP[ch.charCodeAt(0)] = 1;
TEXT_STOP[104] = TEXT_STOP[72] = 2;
TEXT_STOP[102] = TEXT_STOP[70] = 3;
TEXT_STOP[119] = 4;

/** Does the zero-width stop of the text rule hold at p (p > token start)? */
function textStopsAt(s, p, c) {
  const k = TEXT_STOP[c];
  if (k === 1) return true;
  if (k === 2) return (s.charCodeAt(p + 1) | 32) === 116 && (s.charCodeAt(p + 2) | 32) === 116 && (s.charCodeAt(p + 3) | 32) === 112;
  if (k === 3) return (s.charCodeAt(p + 1) | 32) === 116 && (s.charCodeAt(p + 2) | 32) === 112 && s.startsWith('://', p + 3);
  if (k === 4 && s.startsWith('www.', p)) {
    const b = s.charCodeAt(p - 1);
    return b === 42 || b === 95 || b === 126 || b === 40 || isJsSpace(b);
  }
  return false;
}

TEXT_STOP[10] = TEXT_STOP[58] = 5; // '\n' and ':' may end a hard-break or mailto look-ahead

/**
 * End of the inline text token starting at pos: the smallest end any alternative of marked's
 * text rule allows. The consuming alternatives end the token where a run starts:
 *  - `[^ ](?= {2,}\n)`: at the first of two or more spaces before a newline (seen at the '\n'),
 *  - `[^a-zA-Z0-9](?=(?:mailto|xmpp):)`: at the 'm' / 'x' (seen at the ':'),
 *  - `[^email](?=email+@)`: at the first character of an e-mail local part (found from the '@').
 * None of those runs can contain a stop character, so the first stop still bounds the scan.
 */
function textEnd(s, pos, ctx) {
  const n = s.length;
  const c0 = s.charCodeAt(pos);
  if (!isAlnum(c0) && mailOrXmpp(s, pos + 1)) return pos + 1;
  let u = pos + 1; // end of the first unit
  if (c0 === 96 || c0 === 126) while (u < n && s.charCodeAt(u) === c0) u++;
  if (u >= n) return n;
  const cu = s.charCodeAt(u);
  if (cu === 96 || cu === 126) return u;
  if (cu === 32 && spacesThenNewline(s, u)) return u;
  const limit = ctx.hasAt ? emailEnd(s, u, ctx) : n;
  if (limit === u) return u;
  for (let p = u; p < limit; p++) {
    const c = s.charCodeAt(p);
    if (c >= 128) continue;
    const k = TEXT_STOP[c];
    if (k === 0) continue;
    if (k !== 5) {
      if (k === 1 || textStopsAt(s, p, c)) return p;
    } else if (c === 10) {
      let r = p;
      while (r > u && s.charCodeAt(r - 1) === 32) r--;
      if (r > u && p - r >= 2) return r;
    } else {
      let m = -1;
      if (p >= 6 && s.startsWith('mailto', p - 6)) m = p - 6;
      else if (p >= 4 && s.startsWith('xmpp', p - 4)) m = p - 4;
      if (m > u && !isAlnum(s.charCodeAt(m - 1))) return m;
    }
  }
  return limit;
}

/** The smallest token end the e-mail look-aheads allow from u on (n when none). */
function emailEnd(s, u, ctx) {
  let a = ctx.atNext;
  if (a !== -1 && a < u) ctx.atNext = a = s.indexOf('@', u);
  while (a !== -1) {
    // how far back from the '@' the run of e-mail characters reaches (u is far enough)
    let r = a;
    while (r > u && isEmailChar(s.charCodeAt(r - 1))) r--;
    if (r < a) {
      if (r > u) return r; // [^email](?=email+@) at r - 1
      if (u < a) return u; // the run covers u: (?=email+@) right after the first unit
    }
    a = s.indexOf('@', a + 1);
  }
  return s.length;
}

/** Can marked's gfm `url` rule match at pos? (a cheap, conservative pre-check) */
function urlPossible(s, pos, c, hasAt) {
  if (c === 104 || c === 72 || c === 102 || c === 70 || c === 119 || c === 109 || c === 120) return true;
  if (!hasAt) return false;
  // the bare e-mail alternative: [A-Za-z0-9._+-]+@
  let j = pos;
  const n = s.length;
  for (; j < n; j++) {
    const k = s.charCodeAt(j);
    if (!(isAlnum(k) || k === 46 || k === 95 || k === 43 || k === 45)) break;
  }
  return j > pos && s.charCodeAt(j) === 64;
}

/** Number of code points in s. */
function codePoints(s) {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n--;
        i++;
      }
    }
  }
  return n;
}
/** Length in code units of the first code point of s. */
function firstCodePointLength(s) {
  const c = s.charCodeAt(0);
  if (c >= 0xd800 && c <= 0xdbff) {
    const d = s.charCodeAt(1);
    if (d >= 0xdc00 && d <= 0xdfff) return 2;
  }
  return 1;
}

function lexInline(src, textMode, features) {
  const savedParen = linkParenPossible;
  linkParenPossible = savedParen && src.indexOf(')') !== -1;
  const html = lexInlineInner(src, textMode, features);
  linkParenPossible = savedParen;
  return html;
}

/** Per-call emphasis context: the masked source and closer indexes, both computed on first use. */
function maskedOf(ctx) {
  if (ctx.masked === null) {
    const s = ctx.whole;
    ctx.masked = s.includes('*') || s.includes('_') || s.includes('~') ? maskSource(s) : s;
  }
  return ctx.masked;
}
/** Start of the last run of `ch` in the masked source not preceded by whitespace (-1: none). */
function lastCloser(ctx, ch) {
  if (ctx.closers === null) ctx.closers = { '*': -2, _: -2, '~': -2 };
  let v = ctx.closers[ch];
  if (v === -2) {
    const masked = maskedOf(ctx);
    v = -1;
    let i = masked.lastIndexOf(ch);
    while (i !== -1) {
      let s = i;
      while (s > 0 && masked[s - 1] === ch) s--;
      const b = s === 0 ? 10 : masked.charCodeAt(s - 1);
      if (b !== 32 && b !== 9 && b !== 10 && b !== 13 && b !== 12) {
        v = s;
        break;
      }
      i = s === 0 ? -1 : masked.lastIndexOf(ch, s - 1);
    }
    ctx.closers[ch] = v;
  }
  return v;
}

// ASCII answers for marked's punctuation tests (non-ASCII falls back to the Unicode regexes)
const ASCII_PUNCT_OR_SPACE = new Uint8Array(128); // [\s\p{P}\p{S}] but not * or _
for (let c = 0; c < 128; c++) {
  const ch = String.fromCharCode(c);
  if (ch !== '*' && ch !== '_' && /[\s\p{P}\p{S}]/u.test(ch)) ASCII_PUNCT_OR_SPACE[c] = 1;
}
/** RE_PUNCTUATION.exec(s) for s = '' or one code point */
function isPunctuation(s) {
  if (s === '') return false;
  const c = s.charCodeAt(0);
  return c < 128 ? ASCII_PUNCT_OR_SPACE[c] === 1 : RE_PUNCTUATION.test(s);
}
/** RE_UNICODE_ALNUM.test(s) for s = '' or one code point */
function isUnicodeAlnum(s) {
  if (s === '') return false;
  const c = s.charCodeAt(0);
  return c < 128 ? isAlnum(c) : RE_UNICODE_ALNUM.test(s);
}

/** A finished run of text tokens, as marked renders their merged text. */
function runHtml(s, start, end, str, esc, textMode) {
  const text = str === null ? s.slice(start, end) : str;
  return textMode || esc ? text : escapeText(text);
}

function lexInlineInner(s, textMode, features) {
  const n = s.length;
  const ctx = { whole: s, masked: null, closers: null, hasAt: (features & HAS_AT) !== 0, atNext: -2 };
  let out = '';
  // the pending run of text tokens marked would merge into one: s[runStart, runEnd), or runStr
  // once a token's text differs from its source (a decoded numeric character reference)
  let runStart = -1, runEnd = 0, runStr = null, runEsc = false;
  let prevWasText = false, prevChar = '';
  let nextRef = (features & HAS_REF) !== 0 ? -2 : -1; // next "&#" at or after pos (-1: none, -2: not looked up)
  let pos = 0;
  let m;
  while (pos < n) {
    if (!prevWasText) prevChar = '';
    prevWasText = false;
    // Each rule can only match when the source starts with particular characters, so the
    // first character decides which ones are tried (in marked's order).
    const c = s.charCodeAt(pos);
    let html = null;
    switch (c) {
      case 92: {
        // escape, else a backslash hard break
        const d = s.charCodeAt(pos + 1);
        if (d < 128 && ESCAPABLE[d] === 1) {
          html = textMode ? s[pos + 1] : ESCAPED_HTML[d];
          lastEnd = pos + 2;
        } else if (d === 10) {
          Y_BR.lastIndex = pos;
          if (Y_BR.test(s)) {
            html = textMode ? '' : '<br>';
            lastEnd = Y_BR.lastIndex;
          }
        }
        break;
      }
      case 60: {
        // raw HTML tag, else an autolink
        Y_TAG.lastIndex = pos;
        if ((m = Y_TAG.exec(s))) {
          const t = m[0];
          if (!inLink && /^<a /i.test(t)) inLink = true;
          else if (inLink && /^<\/a>/i.test(t)) inLink = false;
          if (!inRawBlock && /^<(pre|code|kbd|script)(\s|>)/i.test(t)) inRawBlock = true;
          else if (inRawBlock && /^<\/(pre|code|kbd|script)(\s|>)/i.test(t)) inRawBlock = false;
          html = t;
          lastEnd = pos + t.length;
        } else {
          Y_AUTOLINK.lastIndex = pos;
          if ((m = Y_AUTOLINK.exec(s))) {
            html = autoLinkHtml(m[1], m[2] === '@' ? 'mailto:' + m[1] : m[1], textMode);
            lastEnd = pos + m[0].length;
          }
        }
        break;
      }
      case 33:
      case 91: {
        html = inlineLink(s, pos, textMode, features);
        if (html === null) {
          html = refLink(s, pos, textMode, features);
          if (html === TEXT_CHAR) {
            // "[" or "!" of an undefined reference: a one-character text token
            if (runStart === -1) {
              runStart = pos;
              runStr = null;
              runEsc = false;
            } else if (runStr !== null) runStr += s[pos];
            runEnd = ++pos;
            continue;
          }
        }
        break;
      }
      case 42:
      case 95:
        html = emStrong(s, pos, ctx, prevChar, textMode, features);
        break;
      case 96: {
        Y_CODESPAN.lastIndex = pos;
        if ((m = Y_CODESPAN.exec(s))) {
          let text = m[2].indexOf('\n') === -1 ? m[2] : m[2].replace(/\n/g, ' ');
          if (text.charCodeAt(0) === 32 && text.charCodeAt(text.length - 1) === 32 && /[^ ]/.test(text)) text = text.substring(1, text.length - 1);
          html = textMode ? text : '<code>' + escapeAll(text) + '</code>';
          lastEnd = pos + m[0].length;
        }
        break;
      }
      case 32: {
        Y_BR.lastIndex = pos;
        if (Y_BR.test(s)) {
          html = textMode ? '' : '<br>';
          lastEnd = Y_BR.lastIndex;
        }
        break;
      }
      case 126:
        html = strike(s, pos, ctx, prevChar, textMode, features);
        break;
    }
    if (html === null && !inLink && urlPossible(s, pos, c, ctx.hasAt)) {
      Y_URL.lastIndex = pos;
      if ((m = Y_URL.exec(s))) {
        let text, href;
        if (m[2] === '@') {
          text = m[0];
          href = 'mailto:' + text;
        } else {
          let prev;
          text = m[0];
          do {
            prev = text;
            const b = RE_BACKPEDAL.exec(text);
            text = b ? b[0] : '';
          } while (prev !== text);
          href = m[1] === 'www.' ? 'http://' + text : text;
        }
        html = autoLinkHtml(text, href, textMode);
        lastEnd = pos + text.length;
      }
    }
    if (html !== null) {
      if (runStart !== -1) {
        out += runHtml(s, runStart, runEnd, runStr, runEsc, textMode);
        runStart = -1;
      }
      out += html;
      pos = lastEnd;
      continue;
    }

    // plain text up to the next place another rule could start
    const end = textEnd(s, pos, ctx);
    if (s.charCodeAt(end - 1) !== 95) prevChar = s[end - 1];
    prevWasText = true;
    if (runStart === -1) {
      runStart = pos;
      runStr = null;
      runEsc = inRawBlock;
    }
    let decoded = null;
    if (!inRawBlock && nextRef !== -1) {
      if (nextRef < pos) nextRef = s.indexOf('&#', pos);
      if (nextRef !== -1 && nextRef < end) {
        const raw = s.slice(pos, end);
        const t = decodeNumeric(raw);
        if (t !== raw) decoded = t;
      }
    }
    if (runStr !== null) runStr += decoded === null ? s.slice(pos, end) : decoded;
    else if (decoded !== null) runStr = s.slice(runStart, pos) + decoded;
    runEnd = pos = end;
  }
  if (runStart !== -1) out += runHtml(s, runStart, runEnd, runStr, runEsc, textMode);
  return out;
}

function inlineLink(s, pos, textMode, features) {
  if (linkParenPossible === false) return null;
  Y_LINK.lastIndex = pos;
  const m = Y_LINK.exec(s);
  if (!m) return null;
  const off = m[0].charCodeAt(0) === 33 ? 2 : 1;
  if (tagCrossesLabel(s, pos, m[1], off)) return null;
  const t = m[2].trim();
  if (t.charCodeAt(0) === 60) {
    if (t.charCodeAt(t.length - 1) !== 62) return null;
    const l = rtrimChar(t.slice(0, -1), '\\');
    if ((t.length - l.length) % 2 === 0) return null;
  } else {
    const l = findClosingBracket(m[2], '(', ')');
    if (l === -2) return null;
    if (l > -1) {
      const h = (m[0].indexOf('!') === 0 ? 5 : 4) + m[1].length + l;
      m[2] = m[2].substring(0, l);
      m[0] = m[0].substring(0, h).trim();
      m[3] = '';
    }
  }
  const r = rtrimChar(m[0].slice(0, -1), '\\');
  if ((m[0].length - r.length) % 2 === 0) return null;
  let href = m[2].trim();
  const title = m[3] ? m[3].slice(1, -1) : '';
  if (href.charCodeAt(0) === 60) href = href.slice(1, -1);
  return linkOut(
    m,
    href && href.replace(RE_ANY_PUNCT, '$1'),
    (title && title.replace(RE_ANY_PUNCT, '$1')) || null,
    textMode,
    features,
    pos,
  );
}

function refLink(s, pos, textMode, features) {
  Y_REFLINK.lastIndex = pos;
  let m = Y_REFLINK.exec(s);
  if (!m) {
    Y_NOLINK.lastIndex = pos;
    m = Y_NOLINK.exec(s);
    if (!m) return null;
  }
  const off = m[0].charCodeAt(0) === 33 ? 2 : 1;
  if (tagCrossesLabel(s, pos, m[1], off)) return null;
  const ref = links[normLabel(m[2] || m[1])];
  if (!ref) return TEXT_CHAR;
  return linkOut(m, ref.href, ref.title || null, textMode, features, pos);
}

/** The last code point of masked.slice(max(0, l - 2), l), as marked computes it. */
function codePointBefore(masked, l) {
  if (l <= 0) return '';
  const c = masked.charCodeAt(l - 1);
  if (l >= 2 && c >= 0xdc00 && c <= 0xdfff) {
    const h = masked.charCodeAt(l - 2);
    if (h >= 0xd800 && h <= 0xdbff) return masked.slice(l - 2, l);
  }
  return masked[l - 1];
}

// --- emphasis right-delimiter classification ---------------------------------------------
// Character classes of marked's flanking tests: 0 other, 1 whitespace (\s), 2 punctuation or
// symbol (\p{P} or \p{S}).
const ASCII_CLASS = new Uint8Array(128);
for (let c = 0; c < 128; c++) {
  const ch = String.fromCharCode(c);
  ASCII_CLASS[c] = /\s/.test(ch) ? 1 : /[\p{P}\p{S}]/u.test(ch) ? 2 : 0;
}
const RE_PS = /[\p{P}\p{S}]/u;
/** Class of the code point of length len at index i of s. */
function cpClass(s, i, len) {
  const c = s.charCodeAt(i);
  if (c < 128) return ASCII_CLASS[c];
  if (len === 1 && isJsSpace(c)) return 1;
  return RE_PS.test(len === 1 ? s[i] : s.slice(i, i + 2)) ? 2 : 0;
}

/**
 * Which capturing alternative of marked's right-delimiter rule matches the delimiter run
 * s[a, b) together with the code point at bi (bl units long) just before it: 1 to 6, or 0.
 * mode 0: RE_EM_R_UND ('_'), 1: RE_EM_R_AST ('*': a tilde counts as an ordinary character
 * rather than punctuation), 2: RE_DEL_R ('~'). Only modes 1 and 2 have a sixth alternative.
 */
function flankGroup(s, bi, bl, b, mode) {
  const ast = mode === 1;
  let cb = cpClass(s, bi, bl);
  const eos = b >= s.length;
  let ca = -1;
  let al = 1;
  if (!eos) {
    const c = s.charCodeAt(b);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(b + 1);
      if (d >= 0xdc00 && d <= 0xdfff) al = 2;
    }
    ca = cpClass(s, b, al);
  }
  if (ast) {
    if (bl === 1 && s.charCodeAt(bi) === 126) cb = 0; // '~' is "not punctuation" here
    if (!eos && al === 1 && s.charCodeAt(b) === 126) ca = 0;
  }
  if (cb === 2 && (eos || ca === 1)) return 1;
  if (cb === 0 && (eos || ca !== 0)) return 2;
  if (eos) return 0;
  if (cb !== 0 && ca === 0) return 3;
  if (cb === 1 && ca === 2) return 4;
  if (cb === 2 && ca === 2) return 5;
  if (mode !== 0 && cb === 0 && ca === 0) return 6;
  return 0;
}

/**
 * The first alternative of RE_EM_R_AST (`^[^_*]*?__[^_*]*?\*[^_*]*?(?=__)`, and its mirror in
 * RE_EM_R_UND) is anchored: when it matches at `start` it swallows one delimiter that sits
 * between two doubled `other` delimiters. Returns how far it reaches (0 when it does not match).
 */
function hiddenLead(s, start, other, own) {
  const i = nextDelim(s, start);
  if (i === -1 || s.charCodeAt(i) !== other || s.charCodeAt(i + 1) !== other) return 0;
  const j = nextDelim(s, i + 2);
  if (j === -1 || s.charCodeAt(j) !== own) return 0;
  const k = nextDelim(s, j + 1);
  if (k === -1 || s.charCodeAt(k) !== other || s.charCodeAt(k + 1) !== other) return 0;
  return k - start;
}
function nextDelim(s, i) {
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 42 || c === 95) return i;
  }
  return -1;
}

function emStrong(s, pos, ctx, prevChar, textMode, features) {
  Y_EM_L.lastIndex = pos;
  let m = Y_EM_L.exec(s);
  if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null;
  const ch = m[0][0];
  if (s.charCodeAt(pos - 1) !== (ch === '*' ? 42 : 95)) {
    // Masking never produces '*' or '_', so the masked text has no `ch` right before pos either:
    // marked's run start below is pos itself, prevChar stays as given, and its first two
    // rejections (an intraword opener, a punctuation opener after a word) need no mask.
    if (m[4] && isUnicodeAlnum(prevChar)) return null;
    if ((m[1] || m[3]) && prevChar && !isPunctuation(prevChar)) return null;
  }
  const masked = maskedOf(ctx);
  const sameAsPrev = prevChar === ch;
  let l = pos;
  while (l > 0 && masked[l - 1] === ch) l--;
  const before = codePointBefore(masked, l);
  const beforeIsPunct = before === '*' || before === '_' || isPunctuation(before);
  if (l < pos) prevChar = before;
  const prevPunct = l < pos ? beforeIsPunct : isPunctuation(prevChar);
  if (m[4] && isUnicodeAlnum(prevChar)) return null;
  const punctAfter = m[1] || m[3] || '';
  if (punctAfter && prevChar && !prevPunct) return null;
  const lLength = codePoints(m[0]) - 1;
  let delimTotal = lLength;
  let midDelimTotal = 0;
  const runLen = pos - l + lLength;
  const strictLeft = !!before.trim() && (!!punctAfter || (ch === '*' && !beforeIsPunct));
  const closer = lastCloser(ctx, ch);
  const startIn = pos + lLength;
  if (closer < startIn) return null;
  const limit = closer - startIn;
  // marked runs RE_EM_R_AST / RE_EM_R_UND as a global exec loop over the masked text after
  // the opener. Only matches that capture a delimiter run count, and a run is captured whole,
  // together with the code point before it, by the first alternative whose flanking test
  // (on that code point and the one after the run) holds. So: visit each run of `ch` and
  // classify it the same way. (Indexes below are relative to startIn.)
  const ast = ch === '*';
  const code = ast ? 42 : 95;
  const n = masked.length;
  let from = startIn + hiddenLead(masked, startIn, ast ? 95 : 42, code);
  for (;;) {
    const a = masked.indexOf(ch, from);
    if (a === -1) break;
    let b = a + 1;
    while (b < n && masked.charCodeAt(b) === code) b++;
    from = b;
    if (a === startIn) continue; // nothing before the run inside the searched text
    let bl = 1;
    const bc = masked.charCodeAt(a - 1);
    if (bc >= 0xdc00 && bc <= 0xdfff && a - 2 >= startIn) {
      const h = masked.charCodeAt(a - 2);
      if (h >= 0xd800 && h <= 0xdbff) bl = 2;
    }
    if (a - bl - startIn > limit) break;
    const group = flankGroup(masked, a - bl, bl, b, ast ? 1 : 0);
    if (group === 0) continue;
    let rLength = b - a;
    if (group === 3 || group === 4) {
      delimTotal += rLength;
      continue;
    } else if (group >= 5 || strictLeft) {
      if (sameAsPrev && group >= 5) break;
      if (runLen % 3 && !((runLen + rLength) % 3)) {
        midDelimTotal += rLength;
        continue;
      }
    }
    delimTotal -= rLength;
    if (delimTotal > 0) continue;
    rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
    const end = a + rLength;
    if (Math.min(lLength, rLength) % 2) {
      const inner = lexInline(s.slice(pos + 1, end - 1), textMode, features);
      lastEnd = end;
      return textMode ? inner : '<em>' + inner + '</em>';
    }
    const inner = lexInline(s.slice(pos + 2, end - 2), textMode, features);
    lastEnd = end;
    return textMode ? inner : '<strong>' + inner + '</strong>';
  }
  return null;
}

function strike(s, pos, ctx, prevChar, textMode, features) {
  Y_DEL_L.lastIndex = pos;
  let m = Y_DEL_L.exec(s);
  if (!m) return null;
  if ((m[1] || '') && prevChar && !isPunctuation(prevChar)) return null;
  const masked = maskedOf(ctx);
  const lLength = codePoints(m[0]) - 1;
  let delimTotal = lLength;
  const closer = lastCloser(ctx, '~');
  const startIn = pos + lLength;
  if (closer < startIn) return null;
  const limit = closer - startIn;
  // RE_DEL_R as a run scanner (see emStrong): its alternatives capture a run of one or two
  // tildes, always whole, and never a longer run.
  const n = masked.length;
  let from = startIn;
  for (;;) {
    const a = masked.indexOf('~', from);
    if (a === -1) break;
    let b = a + 1;
    while (b < n && masked.charCodeAt(b) === 126) b++;
    from = b;
    if (a === startIn) continue;
    let bl = 1;
    const bc = masked.charCodeAt(a - 1);
    if (bc >= 0xdc00 && bc <= 0xdfff && a - 2 >= startIn) {
      const h = masked.charCodeAt(a - 2);
      if (h >= 0xd800 && h <= 0xdbff) bl = 2;
    }
    if (a - bl - startIn > limit) break;
    if (b - a > 2) continue;
    const group = flankGroup(masked, a - bl, bl, b, 2);
    if (group === 0) continue;
    let rLength = b - a;
    if (rLength !== lLength) continue;
    if (group === 3 || group === 4) {
      delimTotal += rLength;
      continue;
    }
    delimTotal -= rLength;
    if (delimTotal > 0) continue;
    rLength = Math.min(rLength, rLength + delimTotal);
    const end = a + rLength;
    const inner = lexInline(s.slice(pos + lLength, end - lLength), textMode, features);
    lastEnd = end;
    return textMode ? inner : '<del>' + inner + '</del>';
  }
  return null;
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
  linkCount = 0;
  queue = [];
  top = true;
  inLink = false;
  inRawBlock = false;
  linkEmitted = false;
  linkParenPossible = true;
  const tokens = blockTokens(markdown.indexOf('\r') === -1 ? markdown : markdown.replace(/\r\n|\r/g, '\n'), [], false);
  for (let i = 0; i < queue.length; i++) {
    inRawBlock = false;
    const src = queue[i].src;
    queue[i].html = lexInline(src, false, rareFeatures(src));
  }
  const html = renderBlocks(tokens);
  links = null;
  queue = null;
  return html;
}

/**
 * Task boards (SPEC "Later phase: task board"). A board is a note whose first
 * line is the board marker. `# ` headings are columns, `## ` headings are
 * cards, and everything under a card heading is the card's markdown body.
 *
 * Everything here works on the plain text and returns new text. Edits only
 * touch the lines they are about, so the rest of the file stays exactly as it
 * was. No DOM or Svelte code, so the board view, tests and tools can share it.
 */
import { TAG_WORD } from './tags';

export const BOARD_MARKER = '<!-- notes.md:board -->';
export const ARCHIVE_TITLE = 'Archive';
export const NEW_BOARD_TEXT = `${BOARD_MARKER}\n\n# Todo\n\n# Ongoing\n\n# Done\n`;

/** Character offsets into the text, `to` exclusive. */
export interface Span {
  from: number;
  to: number;
}

export interface CardMeta {
  tags: string[];
  /** YYYY-MM-DD, or null. */
  due: string | null;
}

export interface BoardCard {
  title: string;
  /** The heading line, without its line break. */
  heading: Span;
  /** The body without trailing blank lines (empty span right after the heading if none). */
  body: Span;
  /** Heading line up to the next column or card heading (or the end). */
  block: Span;
  meta: CardMeta;
  tasks: { done: number; total: number };
}

export interface BoardColumn {
  title: string;
  heading: Span;
  /** Text between the column heading and its first card. */
  intro: Span;
  block: Span;
  cards: BoardCard[];
  /** The hidden `# Archive` column. */
  archive: boolean;
}

export interface Board {
  /** Text between the marker line and the first column. */
  intro: Span;
  columns: BoardColumn[];
}

/** Is this note a board? The marker must be the first line. */
export function isBoard(text: string): boolean {
  const first = text.replace(/^\uFEFF/, '').split('\n', 1)[0] ?? '';
  return first.trim() === BOARD_MARKER;
}

interface Line {
  from: number;
  /** End of the line's text, before its line break. */
  to: number;
  text: string;
}

function splitLines(text: string, offset = 0): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (;;) {
    const end = text.indexOf('\n', from);
    const to = end === -1 ? text.length : end;
    lines.push({ from: offset + from, to: offset + to, text: text.slice(from, to) });
    if (end === -1) return lines;
    from = end + 1;
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Which lines are inside fenced code (including the fence lines), the way
 * CommonMark sees it: an unclosed fence runs to the end of the text. Also
 * returns the fence left open at the end, if any.
 */
function scanCode(lines: readonly Line[]): { inCode: boolean[]; open: string | null } {
  const inCode: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const fence = FENCE.exec(line.text)?.[1];
    if (open) {
      inCode.push(true);
      // A closing fence: same character, at least as long, nothing after it.
      if (
        fence &&
        fence[0] === open[0] &&
        fence.length >= open.length &&
        line.text.trim() === fence
      ) {
        open = null;
      }
    } else if (
      fence &&
      !(fence[0] === '`' && line.text.slice(line.text.indexOf(fence) + fence.length).includes('`'))
    ) {
      inCode.push(true);
      open = fence;
    } else {
      inCode.push(false);
    }
  }
  return { inCode, open };
}

const codeLines = (lines: readonly Line[]) => scanCode(lines).inCode;

/** The fence a text leaves open at its end, e.g. "```", or null. */
export function openFence(text: string): string | null {
  return scanCode(splitLines(text)).open;
}

/**
 * A column (`# `) or card (`## `) heading. A space must follow the hashes, so
 * typing `#tag` at the start of a line is not a heading.
 */
const BOARD_HEADING = /^ {0,3}(#{1,2})[ \t]/;

function headingLevel(line: string): 1 | 2 | 0 {
  const m = BOARD_HEADING.exec(line);
  return m ? (m[1]!.length as 1 | 2) : 0;
}

/** Heading text without the hashes and an optional closing `##` sequence. */
function headingText(line: string): string {
  return line
    .replace(/^ {0,3}#{1,2}[ \t]+/, '')
    .replace(/[ \t]+#+[ \t]*$/, '')
    .replace(/^#+[ \t]*$/, '')
    .trim();
}

const isBlank = (line: Line) => line.text.trim() === '';

/** From the line after `lines[start]` to the end of the last non-blank line before `end`. */
function contentSpan(lines: readonly Line[], start: number, end: number, textEnd: number): Span {
  const from = start + 1 < lines.length ? lines[start + 1]!.from : textEnd;
  let last = end - 1;
  while (last > start && isBlank(lines[last]!)) last--;
  return { from, to: last > start ? lines[last]!.to : from };
}

export function parseBoard(text: string): Board {
  const lines = splitLines(text);
  const inCode = codeLines(lines);
  const headings: { index: number; level: 1 | 2 }[] = [];
  lines.forEach((line, i) => {
    if (i === 0 && isBoard(text)) return;
    const level = inCode[i] ? 0 : headingLevel(line.text);
    if (level) headings.push({ index: i, level });
  });

  const lineStart = (i: number) => (i < lines.length ? lines[i]!.from : text.length);
  const firstColumn = headings.findIndex((h) => h.level === 1);
  const introStart = isBoard(text) ? 0 : -1;
  const introEnd = firstColumn === -1 ? lines.length : headings[firstColumn]!.index;
  const intro = contentSpan(lines, introStart, introEnd, text.length);

  const columns: BoardColumn[] = [];
  for (let h = Math.max(firstColumn, 0); firstColumn !== -1 && h < headings.length; h++) {
    const head = headings[h]!;
    const line = lines[head.index]!;
    // Where this heading's section ends: the next heading of any level.
    const next = h + 1 < headings.length ? headings[h + 1]!.index : lines.length;
    if (head.level === 1) {
      const title = headingText(line.text);
      let columnEnd = lines.length;
      for (let k = h + 1; k < headings.length; k++) {
        if (headings[k]!.level === 1) {
          columnEnd = headings[k]!.index;
          break;
        }
      }
      columns.push({
        title,
        heading: { from: line.from, to: line.to },
        intro: contentSpan(lines, head.index, next, text.length),
        block: { from: line.from, to: lineStart(columnEnd) },
        cards: [],
        archive: title.toLowerCase() === ARCHIVE_TITLE.toLowerCase(),
      });
    } else {
      const body = contentSpan(lines, head.index, next, text.length);
      const bodyText = text.slice(body.from, body.to);
      columns.at(-1)!.cards.push({
        title: headingText(line.text),
        heading: { from: line.from, to: line.to },
        body,
        block: { from: line.from, to: lineStart(next) },
        meta: parseMeta(bodyText),
        tasks: countTasks(bodyText),
      });
    }
  }
  return { intro, columns };
}

/** The columns the board view shows (all but Archive), with their index in `board.columns`. */
export function visibleColumns(board: Board): { column: BoardColumn; index: number }[] {
  return board.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !column.archive);
}

/** The column whose cards count as done: the last one the board shows. */
export function doneColumnIndex(board: Board): number {
  return visibleColumns(board).at(-1)?.index ?? -1;
}

// ---------------------------------------------------------------- Metadata

const DUE = /^\u{1F4C5}️?$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The tokens of a metadata line, or null if the line is something else. */
function metaTokens(line: string): CardMeta | null {
  const words = line.trim().split(/\s+/);
  if (words.length === 0 || words[0] === '') return null;
  const meta: CardMeta = { tags: [], due: null };
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (TAG_WORD.test(word)) {
      meta.tags.push(word.slice(1));
    } else if (DUE.test(word) && DATE.test(words[i + 1] ?? '')) {
      meta.due = words[++i]!;
    } else {
      return null;
    }
  }
  return meta;
}

/** Index of the metadata line in `lines` (the first non-blank one), or -1. */
function metaLineIndex(lines: readonly Line[]): number {
  const first = lines.findIndex((l) => !isBlank(l));
  return first !== -1 && metaTokens(lines[first]!.text) ? first : -1;
}

/** Tags and due date from a card body's first non-empty line. */
export function parseMeta(body: string): CardMeta {
  const lines = splitLines(body);
  const index = metaLineIndex(lines);
  return index === -1 ? { tags: [], due: null } : metaTokens(lines[index]!.text)!;
}

/** Where the metadata line is in a body, if it has one (for styling it as chips). */
export function metaLineSpan(body: string): Span | null {
  const lines = splitLines(body);
  const index = metaLineIndex(lines);
  return index === -1 ? null : { from: lines[index]!.from, to: lines[index]!.to };
}

/** Set (or with null, remove) the due date in a card body's metadata line. */
export function setDueDate(body: string, date: string | null): string {
  const lines = splitLines(body);
  const index = metaLineIndex(lines);
  const due = date ? `\u{1F4C5} ${date}` : '';
  if (index === -1) {
    if (!due) return body;
    if (body.trim() === '') return due;
    return `${due}\n${isBlank(lines[0]!) ? '' : '\n'}${body}`;
  }
  const line = lines[index]!;
  const kept = line.text
    .trim()
    .replace(/\u{1F4C5}️?\s+\d{4}-\d{2}-\d{2}/u, '')
    .trim()
    .replace(/\s+/g, ' ');
  const next = [kept, due].filter(Boolean).join(' ');
  if (next) return body.slice(0, line.from) + next + body.slice(line.to);
  // Nothing left on the line: remove it and the blank line after it.
  let end = line.to;
  if (body[end] === '\n') end++;
  if (body[end] === '\n') end++;
  return body.slice(0, line.from) + body.slice(end);
}

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/;

/** Checklist items in a body, outside code. */
export function countTasks(body: string): { done: number; total: number } {
  const lines = splitLines(body);
  const inCode = codeLines(lines);
  let done = 0;
  let total = 0;
  lines.forEach((line, i) => {
    const m = inCode[i] ? null : TASK.exec(line.text);
    if (!m) return;
    total++;
    if (m[1] !== ' ') done++;
  });
  return { done, total };
}

// ---------------------------------------------------------------- Card bodies

/**
 * Inserts that keep a card body from starting a new column or card: every
 * `# ` or `## ` line outside code becomes a deeper heading. Typed headings
 * become `### `; pasted ones move down two levels (`#` → `###`, `##` → `####`).
 */
export function headingFixes(
  body: string,
  mode: 'typed' | 'pasted',
): { from: number; insert: string }[] {
  const lines = splitLines(body);
  const inCode = codeLines(lines);
  const fixes: { from: number; insert: string }[] = [];
  lines.forEach((line, i) => {
    if (inCode[i]) return;
    const m = BOARD_HEADING.exec(line.text);
    if (!m) return;
    const hashes = m[1]!.length;
    // Right after the existing hashes (the match ends with the space after them).
    fixes.push({
      from: line.from + m[0].length - 1,
      insert: '#'.repeat(mode === 'pasted' ? 2 : 3 - hashes),
    });
  });
  return fixes;
}

/**
 * The text a card body is saved as: no trailing blank lines (the blank line
 * before the next card stays in the file), and a code block left open is
 * closed, so the cards after it don't turn into code.
 */
export function bodyForFile(body: string): string {
  const trimmed = body.replace(/(?:\n[ \t]*)+$/, '').replace(/^[ \t]+$/, '');
  const fence = openFence(trimmed);
  return fence ? `${trimmed}\n${fence}` : trimmed;
}

/** Replace the text in `span` (a card body or intro) with `body`, keeping the lines around it. */
export function replaceBody(text: string, span: Span, body: string): string {
  const next = bodyForFile(body);
  const before = text.slice(0, span.from);
  const after = text.slice(span.to);
  if (span.from === span.to) {
    if (!next) return text;
    // Was empty. If the heading is the last line, start a new line first.
    const lead = span.from > 0 && text[span.from - 1] !== '\n' ? '\n' : '';
    // Keep a blank line before whatever follows.
    const tail = after.length === 0 ? '' : /^[ \t]*\n/.test(after) ? '\n' : '\n\n';
    return before + lead + next + tail + after;
  }
  if (!next) {
    // Now empty: drop the body's lines along with their line break.
    return before + (after.startsWith('\n') ? after.slice(1) : after);
  }
  return before + next + after;
}

// ---------------------------------------------------------------- Moving lines

/** Put `block` (whole lines) at `at`, with a blank line on each side where text continues. */
function insertBlock(text: string, at: number, block: string): string {
  let piece = block.endsWith('\n') ? block : `${block}\n`;
  const before = text.slice(0, at);
  const after = text.slice(at);
  if (after.length > 0 && !/\n[ \t]*\n$/.test(piece)) piece += '\n';
  // At the end of the file, one line break is enough.
  if (after.length === 0) piece = piece.replace(/\n(?:[ \t]*\n)+$/, '\n');
  let lead = '';
  if (before.length > 0) {
    if (!before.endsWith('\n')) lead = '\n\n';
    else if (!/(^|\n)[ \t]*\n$/.test(before)) lead = '\n';
  }
  return before + lead + piece + after;
}

function removeSpan(text: string, span: Span): { text: string; block: string } {
  return {
    text: text.slice(0, span.from) + text.slice(span.to),
    block: text.slice(span.from, span.to),
  };
}

export interface CardRef {
  /** Index in `board.columns` (Archive included). */
  column: number;
  card: number;
}

/**
 * Move a card's lines (heading and body) to `to.column`, at position
 * `to.card` among that column's other cards.
 */
export function moveCard(text: string, from: CardRef, to: CardRef): string {
  const board = parseBoard(text);
  const card = board.columns[from.column]?.cards[from.card];
  if (!card || !board.columns[to.column]) return text;
  if (from.column === to.column && from.card === to.card) return text;
  const removed = removeSpan(text, card.block);
  const after = parseBoard(removed.text).columns[to.column]!;
  const target = after.cards[to.card];
  const at = target ? target.block.from : after.block.to;
  return insertBlock(removed.text, at, removed.block);
}

/** Move a column (heading, intro and cards) to before the column now at `to` (or to the end). */
export function moveColumn(text: string, from: number, to: number): string {
  const board = parseBoard(text);
  const column = board.columns[from];
  if (!column || from === to) return text;
  const removed = removeSpan(text, column.block);
  const rest = parseBoard(removed.text).columns;
  const target = rest[to];
  const at = target ? target.heading.from : (rest.at(-1)?.block.to ?? removed.text.length);
  return insertBlock(removed.text, at, removed.block);
}

/** One-line card title: no line breaks. */
export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

/** Add a card at the end of a column. Returns the new text and the card's position. */
export function addCard(
  text: string,
  column: number,
  title = 'Untitled',
): { text: string; card: CardRef } {
  const board = parseBoard(text);
  const col = board.columns[column];
  if (!col) return { text, card: { column, card: -1 } };
  const next = insertBlock(text, col.block.to, `## ${cleanTitle(title) || 'Untitled'}\n`);
  return { text: next, card: { column, card: col.cards.length } };
}

/** Change a card's title, keeping its heading marker. */
export function renameCard(text: string, ref: CardRef, title: string): string {
  const card = parseBoard(text).columns[ref.column]?.cards[ref.card];
  const clean = cleanTitle(title);
  if (!card || !clean) return text;
  const line = text.slice(card.heading.from, card.heading.to);
  const prefix = /^ {0,3}##[ \t]+/.exec(line)?.[0] ?? '## ';
  return text.slice(0, card.heading.from) + prefix + clean + text.slice(card.heading.to);
}

/**
 * "Delete" a card: move it to the end of the hidden Archive column, which is
 * added at the end of the file if there is none.
 */
export function archiveCard(text: string, ref: CardRef): string {
  let board = parseBoard(text);
  if (!board.columns[ref.column]?.cards[ref.card]) return text;
  let next = text;
  let archive = board.columns.findIndex((c) => c.archive);
  if (archive === -1) {
    next = insertBlock(text, text.length, `# ${ARCHIVE_TITLE}\n`);
    board = parseBoard(next);
    archive = board.columns.length - 1;
  }
  if (archive === ref.column) return text;
  return moveCard(next, ref, { column: archive, card: board.columns[archive]!.cards.length });
}

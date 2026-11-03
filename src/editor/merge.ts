/**
 * Three-way merge of note text (SPEC "Saving and conflict handling"), and the
 * small edits that turn one text into another. No DOM.
 *
 * The merge compares the text as last loaded (the base) with mine and with
 * theirs, line by line. Changes to different lines are both kept. Where both
 * sides changed the same lines, it looks at the words in them: changes to
 * different words, with at least one unchanged word or space between them,
 * are both kept; anything closer is a conflict.
 */

/** A change to a list of tokens: `start`..`end` of the old list becomes `insert`. */
interface Hunk {
  start: number;
  end: number;
  insert: string[];
}

/** A change to a string, in the positions of the old string. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * Give up on diffs needing more than this many token insertions and
 * deletions (memory grows with its square). Such a merge becomes a conflict.
 */
const MAX_EDITS = 2000;

/** Lines and the line breaks between them, as separate tokens. */
export const lineTokens = (text: string): string[] => text.split(/(\n)/).filter(Boolean);

/** Words, runs of white space, and single other characters. */
export const wordTokens = (text: string): string[] =>
  text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];

/**
 * The changes that turn `a` into `b` (Myers' diff), in order, or null if
 * they would take more than `limit` insertions and deletions.
 */
export function diffTokens(
  a: readonly string[],
  b: readonly string[],
  limit = MAX_EDITS,
): Hunk[] | null {
  // Skip what both start and end with.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let endA = a.length;
  let endB = b.length;
  while (endA > pre && endB > pre && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - pre;
  const m = endB - pre;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ start: pre, end: endA, insert: b.slice(pre, endB) }];
  const A = (i: number) => a[pre + i];
  const B = (i: number) => b[pre + i];

  // v[k] is the furthest x reached on diagonal k (= x - y); one snapshot per
  // number of edits d, holding diagonals -d..d.
  const max = n + m;
  const v = new Int32Array(2 * max + 3);
  const at = (k: number) => k + max + 1;
  const trace: Int32Array[] = [];
  let edits = -1;
  for (let d = 0; d <= max && edits < 0; d++) {
    if (d > limit) return null;
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[at(k - 1)]! < v[at(k + 1)]!) ? v[at(k + 1)]! : v[at(k - 1)]! + 1;
      let y = x - k;
      while (x < n && y < m && A(x) === B(y)) {
        x++;
        y++;
      }
      v[at(k)] = x;
      if (x >= n && y >= m) {
        edits = d;
        break;
      }
    }
    trace.push(v.slice(at(-d), at(d) + 1));
  }

  // Walk back from the end, collecting single-token edits.
  const steps: { x: number; insert?: string }[] = [];
  let x = n;
  let y = m;
  for (let d = edits; d > 0; d--) {
    const prev = trace[d - 1]!;
    const get = (k: number) => prev[k + d - 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && get(k - 1) < get(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    x = prevX;
    y = prevY;
    if (down) steps.push({ x, insert: B(y)! });
    else steps.push({ x });
  }
  steps.reverse();

  // Join neighboring edits into hunks.
  const hunks: Hunk[] = [];
  for (const step of steps) {
    const start = pre + step.x;
    let hunk = hunks.at(-1);
    if (!hunk || hunk.end !== start) {
      hunk = { start, end: start, insert: [] };
      hunks.push(hunk);
    }
    if (step.insert === undefined) hunk.end++;
    else hunk.insert.push(step.insert);
  }
  return hunks;
}

/**
 * Merge my edits and theirs, both made to `base`. Null when they overlap
 * (a conflict the user has to resolve).
 */
export function mergeText(base: string, mine: string, theirs: string): string | null {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  return mergeTokens(lineTokens(base), lineTokens(mine), lineTokens(theirs), false);
}

function mergeTokens(
  base: string[],
  mine: string[],
  theirs: string[],
  words: boolean,
): string | null {
  const ours = diffTokens(base, mine);
  const others = diffTokens(base, theirs);
  if (!ours || !others) return null;
  const hunks = [
    ...ours.map((h) => ({ ...h, mine: true })),
    ...others.map((h) => ({ ...h, mine: false })),
  ].sort((p, q) => p.start - q.start || p.end - q.end);

  const out: string[] = [];
  let pos = 0;
  for (let i = 0; i < hunks.length;) {
    // A group of changes that touch each other.
    const first = hunks[i++]!;
    const group = [first];
    const start = first.start;
    let end = first.end;
    while (i < hunks.length && touches(hunks[i]!, start, end, words)) {
      end = Math.max(end, hunks[i]!.end);
      group.push(hunks[i++]!);
    }
    out.push(base.slice(pos, start).join(''));
    pos = end;
    const minePart = apply(
      base,
      start,
      end,
      group.filter((h) => h.mine),
    );
    const theirPart = apply(
      base,
      start,
      end,
      group.filter((h) => !h.mine),
    );
    if (group.every((h) => h.mine)) out.push(minePart);
    else if (group.every((h) => !h.mine) || minePart === theirPart) out.push(theirPart);
    else if (words) return null;
    else {
      // Both changed these lines: try again word by word.
      const merged = mergeTokens(
        wordTokens(base.slice(start, end).join('')),
        wordTokens(minePart),
        wordTokens(theirPart),
        true,
      );
      if (merged === null) return null;
      out.push(merged);
    }
  }
  out.push(base.slice(pos).join(''));
  return out.join('');
}

/**
 * Whether a change starting at or after `start` belongs with the group
 * `start`..`end`. Lines: when they share a line, or both insert at the same
 * place. Words: also when they are right next to each other.
 */
function touches(hunk: Hunk, start: number, end: number, words: boolean): boolean {
  if (hunk.start < end) return true;
  if (hunk.start > end) return false;
  return words || (hunk.start === hunk.end && start === end);
}

/** The text of `start`..`end` of `base` with `hunks` (in order, inside it) applied. */
function apply(base: string[], start: number, end: number, hunks: Hunk[]): string {
  let text = '';
  let pos = start;
  for (const h of hunks) {
    text += base.slice(pos, h.start).join('') + h.insert.join('');
    pos = h.end;
  }
  return text + base.slice(pos, end).join('');
}

/**
 * Small edits that turn `a` into `b`: changed lines, narrowed down to the
 * changed words, so a cursor elsewhere stays where it was.
 */
export function textEdits(a: string, b: string): TextEdit[] {
  if (a === b) return [];
  const lines = lineTokens(a);
  const hunks = diffTokens(lines, lineTokens(b));
  if (!hunks) return [{ from: 0, to: a.length, insert: b }];
  const offsets = startOffsets(lines);
  const edits: TextEdit[] = [];
  for (const h of hunks) {
    const from = offsets[h.start]!;
    const to = offsets[h.end]!;
    const insert = h.insert.join('');
    const before = wordTokens(a.slice(from, to));
    const inner = diffTokens(before, wordTokens(insert));
    if (!inner) {
      edits.push({ from, to, insert });
      continue;
    }
    const at = startOffsets(before);
    for (const w of inner) {
      edits.push({ from: from + at[w.start]!, to: from + at[w.end]!, insert: w.insert.join('') });
    }
  }
  return edits;
}

/** Where each token starts in the joined string, plus the total length. */
function startOffsets(tokens: string[]): number[] {
  const offsets = [0];
  for (const t of tokens) offsets.push(offsets.at(-1)! + t.length);
  return offsets;
}

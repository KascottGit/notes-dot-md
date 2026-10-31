/**
 * `#tags` in notes and on board cards. Plain text in, offsets out: no
 * CodeMirror or DOM, so the board code and tools can use it too.
 */

/**
 * A `#tag`: letters, digits, `_`, `-` and `/`, not only digits (so `#1` is
 * not a tag). Shared by notes and board cards.
 */
const TAG_BODY = String.raw`(?=[\p{L}\p{N}_/-]*[\p{L}_/-])[\p{L}\p{N}_/-]+`;
/** A whole word that is a tag, e.g. on a card's metadata line. */
export const TAG_WORD = new RegExp(`^#${TAG_BODY}$`, 'u');
/** Tags in running text: at the start or after a space (not `a#b` or `/#anchor`). */
const TAG_IN_TEXT = new RegExp(`(?<=^|\\s)#${TAG_BODY}`, 'gu');

/** Where the tags are in a line of text, as offsets. */
export function findTags(text: string): { from: number; to: number }[] {
  return [...text.matchAll(TAG_IN_TEXT)].map((m) => ({
    from: m.index,
    to: m.index + m[0].length,
  }));
}

/** Filename rules for notes. Pure functions, no Drive calls. */

export const DEFAULT_TITLE = 'Untitled';

/** Characters that are not allowed in a note filename. */
const FORBIDDEN = /[/\\:*?"<>|]/g;
const MARKDOWN_EXT = /\.(md|markdown)$/i;

/** Clean up a title for use as a filename: drop forbidden characters and extra spaces. */
export function sanitizeTitle(title: string): string {
  const clean = title.replace(FORBIDDEN, '').replace(/\s+/g, ' ').trim();
  return clean || DEFAULT_TITLE;
}

/** `My note` → `My note.md` */
export function fileNameForTitle(title: string): string {
  return `${sanitizeTitle(title)}.md`;
}

/** `My note.md` → `My note`. Names without a markdown extension are returned as is. */
export function titleFromFileName(name: string): string {
  return name.replace(MARKDOWN_EXT, '');
}

export function isMarkdownFileName(name: string): boolean {
  return MARKDOWN_EXT.test(name);
}

/**
 * The filename for `title`, with ` (2)`, ` (3)`, ... added if that name is
 * already taken. Comparison ignores case, so files stay distinct on
 * case-insensitive file systems (for example when synced to a laptop).
 */
export function uniqueFileName(title: string, takenNames: Iterable<string>): string {
  const taken = new Set([...takenNames].map((n) => n.toLowerCase()));
  const base = sanitizeTitle(title);
  let name = `${base}.md`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n}).md`;
  return name;
}

/** Quote a value for a Drive `q` search string. */
export function quoteQuery(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

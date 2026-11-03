/**
 * Saved tags: each note or board has its own, with a color each, picked in
 * its Tags list and stored as app properties on its file (SPEC "Tags"). The
 * markdown never changes. Elements that show a tag carry
 * `data-tag="<tag in lower case>"`; one generated style sheet gives each of
 * the open document's saved tags its `--tag-color`.
 */
import { TAG_WORD } from '../editor/tags';

export const TAG_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'gray',
] as const;
export type TagColor = (typeof TAG_COLORS)[number];
/** Lower-case tag (without `#`) → color. */
export type TagColors = Record<string, TagColor>;

export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  gray: 'Gray',
};

const isTagColor = (value: unknown): value is TagColor =>
  typeof value === 'string' && (TAG_COLORS as readonly string[]).includes(value);

/** App property key prefix for a saved tag: `tag.school` = `green`. */
export const TAG_PROPERTY = 'tag.';

/**
 * At most this many saved tags per document. Drive allows 30 app properties
 * per file, and the app uses a few itself (pin, preview, board mark).
 */
export const MAX_SAVED_TAGS = 24;

/** Drive's limit for an app property's key and value together, in bytes. */
const MAX_PROPERTY_BYTES = 124;

/** A document's saved tags and their colors, from its file's app properties. */
export function noteTagColors(appProperties: Record<string, string>): TagColors {
  const colors: TagColors = {};
  for (const [key, value] of Object.entries(appProperties)) {
    if (key.startsWith(TAG_PROPERTY) && isTagColor(value)) {
      colors[key.slice(TAG_PROPERTY.length).toLowerCase()] = value;
    }
  }
  return colors;
}

/** The app property change that sets a saved tag's color, or removes the tag (null). */
export const tagColorProperty = (
  tag: string,
  color: TagColor | null,
): Record<string, string | null> => ({
  [TAG_PROPERTY + tag.toLowerCase()]: color,
});

/** The style sheet that colors tags: one rule per colored tag. */
export function tagColorCss(colors: TagColors): string {
  return Object.entries(colors)
    .map(([tag, color]) => {
      const value = tag.replace(/["\\]/g, '\\$&');
      return `[data-tag="${value}"] { --tag-color: var(--tag-${color}); }`;
    })
    .join('\n');
}

/** The saved tags (the ones with a color), A–Z. */
export function savedTags(colors: TagColors): string[] {
  return Object.keys(colors).sort((a, b) => a.localeCompare(b));
}

/** A color for a newly saved tag: the first one no saved tag has yet. */
export function nextTagColor(colors: TagColors): TagColor {
  const used = new Set(Object.values(colors));
  return (
    TAG_COLORS.find((c) => !used.has(c)) ??
    TAG_COLORS[Object.keys(colors).length % TAG_COLORS.length]!
  );
}

/** Check a tag typed into the Tags list (with or without `#`). */
export function checkTagName(raw: string, colors: TagColors): { tag: string } | { error: string } {
  const tag = raw.trim().replace(/^#/, '').toLowerCase();
  if (!tag) return { error: 'Type a tag.' };
  if (!TAG_WORD.test(`#${tag}`)) {
    return { error: 'Use letters, digits, - _ and /, without spaces (not only digits).' };
  }
  if (tag in colors) return { error: `#${tag} is already saved.` };
  const bytes = new TextEncoder().encode(TAG_PROPERTY + tag + 'yellow').length;
  if (bytes > MAX_PROPERTY_BYTES) return { error: 'That tag is too long to save.' };
  if (Object.keys(colors).length >= MAX_SAVED_TAGS) {
    return { error: `A note can have up to ${MAX_SAVED_TAGS} saved tags.` };
  }
  return { tag };
}

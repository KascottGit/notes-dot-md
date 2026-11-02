/**
 * Tag colors: picked per tag in the Tags list, the same everywhere, stored
 * in the settings file in Drive (SPEC "Tags"). The markdown never changes.
 * Elements that show a tag carry `data-tag="<tag in lower case>"`; one
 * generated style sheet gives each colored tag its `--tag-color`.
 */
import type { DriveClient } from '../drive/client';
import { readSettings, writeSettings } from '../drive/notes';

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

type SettingsJson = Record<string, unknown> & { tagColors?: unknown };

function parse(text: string): SettingsJson {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as SettingsJson)
      : {};
  } catch {
    return {}; // Empty or broken: start over rather than fail.
  }
}

/** The tag colors in a settings file's text; unknown entries are skipped. */
export function parseTagColors(text: string): TagColors {
  const raw = parse(text).tagColors;
  const colors: TagColors = {};
  if (raw && typeof raw === 'object') {
    for (const [tag, color] of Object.entries(raw)) {
      if (isTagColor(color)) colors[tag.toLowerCase()] = color;
    }
  }
  return colors;
}

/** The settings text with one tag's color set (or removed), keeping everything else. */
export function setTagColorIn(text: string, tag: string, color: TagColor | null): string {
  const settings = parse(text);
  const colors: Record<string, unknown> =
    settings.tagColors && typeof settings.tagColors === 'object'
      ? { ...(settings.tagColors as Record<string, unknown>) }
      : {};
  if (color) colors[tag.toLowerCase()] = color;
  else delete colors[tag.toLowerCase()];
  return `${JSON.stringify({ ...settings, tagColors: colors }, null, 2)}\n`;
}

/** The style sheet that colors tags: one rule per colored tag. */
export function tagColorCss(colors: TagColors): string {
  return Object.entries(colors)
    .map(([tag, color]) => {
      const value = tag.replace(/["\\]/g, '\\$&');
      return `[data-tag="${value}"] { --tag-color: var(--tag-${color}); }`;
    })
    .join('\n');
}

export async function loadTagColors(drive: DriveClient, rootId: string): Promise<TagColors> {
  return parseTagColors((await readSettings(drive, rootId)).text);
}

/**
 * Set one tag's color in Drive. Reads the file first and changes only that
 * tag, so colors picked on another device in the meantime are kept.
 * Returns all colors as now stored.
 */
export async function saveTagColor(
  drive: DriveClient,
  rootId: string,
  tag: string,
  color: TagColor | null,
): Promise<TagColors> {
  const { id, text } = await readSettings(drive, rootId);
  const next = setTagColorIn(text, tag, color);
  await writeSettings(drive, rootId, id, next);
  return parseTagColors(next);
}

import { describe, expect, it } from 'vitest';
import {
  fileNameForTitle,
  isMarkdownFileName,
  quoteQuery,
  sanitizeTitle,
  titleFromFileName,
  uniqueFileName,
} from './names';

describe('sanitizeTitle', () => {
  it('strips characters that are not allowed in filenames', () => {
    expect(sanitizeTitle('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('collapses and trims whitespace', () => {
    expect(sanitizeTitle('  Week   12 \n plan ')).toBe('Week 12 plan');
  });

  it('falls back to Untitled', () => {
    expect(sanitizeTitle('')).toBe('Untitled');
    expect(sanitizeTitle(' /:* ')).toBe('Untitled');
  });

  it('keeps unicode', () => {
    expect(sanitizeTitle('Café ☕ æøå')).toBe('Café ☕ æøå');
  });
});

describe('file names', () => {
  it('adds and removes the extension', () => {
    expect(fileNameForTitle('Drive layer')).toBe('Drive layer.md');
    expect(titleFromFileName('Drive layer.md')).toBe('Drive layer');
    expect(titleFromFileName('Old.markdown')).toBe('Old');
    expect(titleFromFileName('notes.txt')).toBe('notes.txt');
  });

  it('recognizes markdown files', () => {
    expect(isMarkdownFileName('a.md')).toBe(true);
    expect(isMarkdownFileName('a.MD')).toBe(true);
    expect(isMarkdownFileName('a.markdown')).toBe(true);
    expect(isMarkdownFileName('a.md.txt')).toBe(false);
  });
});

describe('uniqueFileName', () => {
  it('uses the plain name when free', () => {
    expect(uniqueFileName('Plan', ['Other.md'])).toBe('Plan.md');
  });

  it('adds (2), (3), ... on duplicates, ignoring case', () => {
    expect(uniqueFileName('Plan', ['Plan.md'])).toBe('Plan (2).md');
    expect(uniqueFileName('Plan', ['plan.md', 'Plan (2).md'])).toBe('Plan (3).md');
  });
});

describe('quoteQuery', () => {
  it('escapes quotes and backslashes', () => {
    expect(quoteQuery("Kasper's notes")).toBe("'Kasper\\'s notes'");
    expect(quoteQuery('a\\b')).toBe("'a\\\\b'");
  });
});

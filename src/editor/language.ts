/**
 * The markdown language for the editor: CommonMark + GFM (tables, task
 * lists, strikethrough, autolinks), YAML frontmatter, and syntax
 * highlighting inside fenced code blocks.
 *
 * Built from `markdownLanguage` directly instead of `markdown()`, which
 * always bundles HTML/CSS/JS parsers (~190 kB) for inline HTML.
 */
import { markdownLanguage } from '@codemirror/lang-markdown';
import { Language, LanguageDescription, LanguageSupport, ParseContext } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Parser } from '@lezer/common';
import { parseCode, type MarkdownConfig, type MarkdownParser } from '@lezer/markdown';

/** `---` on the first line, ended by `---` or `...`. */
const FENCE = /^(?:---|\.\.\.)\s*$/;
/** What the second line of frontmatter looks like, so a rule at the top isn't mistaken for it. */
const YAML_START = /^(?:[\w-]+\s*:|---\s*$|#)/;

/** YAML frontmatter at the very top of the document. */
export const Frontmatter: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true }, { name: 'FrontmatterMark' }],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text) || !YAML_START.test(cx.peekLine())) {
          return false;
        }
        const from = cx.lineStart;
        const marks = [cx.elt('FrontmatterMark', from, from + 3)];
        let to = from + line.text.length;
        while (cx.nextLine()) {
          to = cx.lineStart + line.text.length;
          if (FENCE.test(line.text)) {
            marks.push(cx.elt('FrontmatterMark', cx.lineStart, cx.lineStart + 3));
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt('Frontmatter', from, to, marks));
        return true;
      },
    },
  ],
};

/** Find a parser for a fenced code block's info string (```ts), loading it on demand. */
function codeParser(info: string): Parser | null {
  const name = /\S*/.exec(info)?.[0];
  if (!name) return null;
  const found = LanguageDescription.matchLanguageName(languages, name, true);
  if (!found) return null;
  if (found.support) return found.support.language.parser;
  // Not loaded yet: skip highlighting now and re-parse once it arrives.
  return ParseContext.getSkippingParser(found.load());
}

// markdownLanguage.parser is a MarkdownParser; the Language type only says Parser.
const parser = (markdownLanguage.parser as MarkdownParser).configure([
  Frontmatter,
  parseCode({ codeParser }),
]);

export const notesMarkdown = new Language(markdownLanguage.data, parser, [], 'markdown');

export function markdownSupport(): LanguageSupport {
  return new LanguageSupport(notesMarkdown);
}

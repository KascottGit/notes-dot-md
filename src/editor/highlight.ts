/** Colors for code inside fenced blocks, using theme tokens so dark mode works. */
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const codeHighlight = HighlightStyle.define([
  {
    tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.moduleKeyword],
    color: 'var(--code-keyword)',
  },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--code-string)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: 'var(--code-comment)',
    fontStyle: 'italic',
  },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--code-number)' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
    color: 'var(--code-function)',
  },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--code-type)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--code-property)' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

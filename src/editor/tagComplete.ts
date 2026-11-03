/**
 * Tag autocomplete (SPEC "Tags"): typing `#` and a letter suggests the saved
 * tags (the ones given a color in the Tags list) and the tags already in this
 * document, saved ones first, each with its color. Not inside code.
 */
import {
  autocompletion,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { EditorView, tooltips } from '@codemirror/view';
import { NO_TAGS } from './livePreview';

export interface TagSuggestion {
  tag: string;
  /** A saved tag (from the Tags list); these are suggested first. */
  saved: boolean;
}

/** `#` and what's typed of the tag so far, at the start of a line or after a space. */
const TYPED_TAG = /(?:^|\s)#([\p{L}\p{N}_/-]*)$/u;

/** Insert the tag and one space after it (or step over a space that's already there). */
function applyTag(view: EditorView, completion: Completion, from: number, to: number) {
  const spaceAfter = view.state.sliceDoc(to, to + 1) === ' ';
  const insert = spaceAfter ? completion.label : `${completion.label} `;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length + (spaceAfter ? 1 : 0) },
    userEvent: 'input.complete',
    annotations: pickedCompletion.of(completion),
  });
}

/** The completion source. `tags` gives the tags to suggest (read on each `#`). */
export function tagSource(tags: () => readonly TagSuggestion[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const match = TYPED_TAG.exec(line.text.slice(0, context.pos - line.from));
    if (!match) return null;
    const typed = match[1] ?? '';
    // Just `#` could be a heading on its way; wait for a letter (unless asked).
    if (!typed && !context.explicit) return null;
    const from = context.pos - typed.length - 1;
    for (
      let n: SyntaxNode | null = syntaxTree(context.state).resolveInner(from, 1);
      n;
      n = n.parent
    ) {
      if (NO_TAGS.has(n.name)) return null;
    }
    const lower = typed.toLowerCase();
    const options = tags()
      // The tag being typed is itself in the text: don't suggest what's already there.
      .filter((t) => t.tag.toLowerCase() !== lower)
      .map((t): Completion => ({
        label: `#${t.tag}`,
        boost: t.saved ? 1 : 0,
        apply: applyTag,
      }));
    return options.length ? { from, options, validFor: /^#[\p{L}\p{N}_/-]*$/u } : null;
  };
}

/** A dot in the tag's color, before each suggestion. */
function colorDot(completion: Completion): Node {
  const dot = document.createElement('span');
  dot.className = 'cm-tag-dot';
  dot.dataset['tag'] = completion.label.slice(1).toLowerCase();
  return dot;
}

// A full theme (not a base theme), so it wins over the autocomplete's own styles.
const theme = EditorView.theme({
  '.cm-tooltip.cm-tooltip-autocomplete': {
    padding: '4px',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    backgroundColor: 'var(--bg)',
    boxShadow: '0 6px 24px rgb(0 0 0 / 18%)',
    fontFamily: 'var(--font-ui)',
    fontSize: '15px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    maxHeight: '15em',
    fontFamily: 'var(--font-ui)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minHeight: '44px',
    padding: '0 12px',
    borderRadius: '6px',
    color: 'var(--text)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--bg-muted)',
    color: 'var(--text)',
  },
  '.cm-tooltip-autocomplete .cm-completionLabel': { flex: '1', fontFamily: 'var(--font-ui)' },
  '.cm-tooltip-autocomplete .cm-completionMatchedText': {
    textDecoration: 'none',
    fontWeight: '600',
  },
  '.cm-tooltip-autocomplete .cm-completionDetail': {
    marginLeft: '12px',
    color: 'var(--text-muted)',
    fontStyle: 'normal',
    fontSize: '13px',
  },
  '.cm-tag-dot': {
    flex: 'none',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: 'var(--tag-color, var(--accent))',
  },
});

export function tagCompletion(tags: () => readonly TagSuggestion[]): Extension {
  return [
    autocompletion({
      override: [tagSource(tags)],
      icons: false,
      maxRenderedOptions: 8,
      addToOptions: [{ render: colorDot, position: 20 }],
    }),
    // Drawn on the page, not in the editor, so a board card (which clips
    // what sticks out of it) doesn't cut the suggestions off.
    typeof document === 'undefined' ? [] : tooltips({ parent: document.body }),
    theme,
  ];
}

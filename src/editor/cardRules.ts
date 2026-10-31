/**
 * Extra rules for the small editors on board cards (SPEC "Board view").
 * - No `# ` or `## ` lines: those would split the card into a new column or
 *   card. Typed ones become `### `, pasted ones move down two levels.
 * - The metadata line (tags and due date) is drawn as chips. The text stays
 *   as it is; chips are marks only.
 */
import { EditorState, RangeSetBuilder, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, placeholder, type DecorationSet } from '@codemirror/view';
import { headingFixes, metaLineSpan } from './board';

/** The one place the app changes text as it is entered (SPEC "No headings that split a card"). */
export const noBoardHeadings = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const pasted = tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop');
  const fixes = headingFixes(tr.newDoc.toString(), pasted ? 'pasted' : 'typed');
  if (fixes.length === 0) return tr;
  return [tr, { changes: fixes, sequential: true }];
});

const chip = Decoration.mark({ class: 'cm-board-chip' });
const CHIP = /#[^\s#]+|\u{1F4C5}️?\s+\d{4}-\d{2}-\d{2}/gu;

function chips(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const span = metaLineSpan(text);
  if (!span) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const m of text.slice(span.from, span.to).matchAll(CHIP)) {
    const from = span.from + m.index;
    builder.add(from, from + m[0].length, chip);
  }
  return builder.finish();
}

const chipField = StateField.define<DecorationSet>({
  create: chips,
  update: (value, tr) => (tr.docChanged ? chips(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field),
});

const chipTheme = EditorView.baseTheme({
  '.cm-board-chip': {
    padding: '1px 7px',
    borderRadius: '999px',
    backgroundColor: 'var(--bg-muted)',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-ui)',
    fontSize: '0.8125em',
    fontWeight: '500',
  },
});

export function cardRules(hint: string): Extension {
  return [noBoardHeadings, chipField, chipTheme, placeholder(hint)];
}

/**
 * CodeMirror configuration. The document is plain markdown text; rendering
 * (live preview) only adds decorations and never changes how it is stored.
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { deleteMarkupBackward } from '@codemirror/lang-markdown';
import { codeFolding, syntaxHighlighting } from '@codemirror/language';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import { codeHighlight } from './highlight';
import { markdownSupport } from './language';
import { continueList, indentListItem, outdentListItem, shorthandInput } from './lists';
import { livePreview } from './livePreview';

/** Marks changes made by the app (e.g. loading a newer version), not by typing. */
const external = Annotation.define<boolean>();

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  readOnly: boolean;
  /** The user changed the text. */
  onChange: () => void;
  /** Ctrl+S / Cmd+S. */
  onSave: () => void;
  onBlur: () => void;
}

export interface Editor {
  getText(): string;
  /** Replace the whole text without counting as a user edit. Undo still works. */
  setText(text: string): void;
  /** Start over with a new document and an empty undo history. */
  load(doc: string, readOnly: boolean): void;
  focus(): void;
  destroy(): void;
}

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'var(--bg)',
    // At least 16px, or mobile browsers zoom in on focus.
    fontSize: '16px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-ui)',
    lineHeight: '1.6',
  },
  '.cm-content': {
    maxWidth: '760px',
    margin: '0 auto',
    padding: '16px 16px 40vh',
    caretColor: 'var(--accent)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--selection)' },
});

export function createEditor(options: EditorOptions): Editor {
  const editable = new Compartment();

  const makeState = (doc: string, readOnly: boolean) =>
    EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdownSupport(),
        syntaxHighlighting(codeHighlight),
        livePreview(),
        codeFolding({ placeholderText: '…' }),
        EditorView.inputHandler.of((view, from, to, text) => {
          const spec = shorthandInput(view.state, from, to, text);
          if (!spec) return false;
          view.dispatch(spec);
          return true;
        }),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              options.onSave();
              return true;
            },
          },
          // Continue lists and tasks on Enter; Enter on an empty item ends the list.
          { key: 'Enter', run: continueList },
          { key: 'Backspace', run: deleteMarkupBackward },
          { key: 'Tab', run: indentListItem, shift: outdentListItem },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        editable.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'sentences' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external))) {
            options.onChange();
          }
        }),
        EditorView.domEventHandlers({
          blur: () => {
            options.onBlur();
          },
        }),
        theme,
      ],
    });

  const view = new EditorView({
    parent: options.parent,
    state: makeState(options.doc, options.readOnly),
  });

  return {
    getText: () => view.state.doc.toString(),
    setText(text) {
      if (text === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: external.of(true),
      });
    },
    load(doc, readOnly) {
      view.setState(makeState(doc, readOnly));
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

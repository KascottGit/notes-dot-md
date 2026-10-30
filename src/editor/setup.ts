/**
 * CodeMirror configuration. The document is plain markdown text; rendering
 * (live preview) only adds decorations and never changes how it is stored.
 */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { deleteMarkupBackward } from '@codemirror/lang-markdown';
import { codeFolding, syntaxHighlighting } from '@codemirror/language';
import { Annotation, Compartment, EditorState, type StateCommand } from '@codemirror/state';
import { drawSelection, EditorView, keymap, type KeyBinding } from '@codemirror/view';
import {
  toggleBold,
  toggleBulletList,
  toggleChecklist,
  toggleCodeBlock,
  toggleHeading,
  toggleInlineCode,
  toggleItalic,
  toggleLink,
  toggleNumberedList,
  toggleQuote,
  toggleStrikethrough,
} from './commands';
import { codeHighlight } from './highlight';
import { markdownSupport } from './language';
import {
  continueList,
  indentItem,
  moveItemDown,
  moveItemUp,
  outdentItem,
  shorthandInput,
} from './lists';
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
  /** Run a format command on the current selection, keeping focus in the editor. */
  run(command: StateCommand): void;
  focus(): void;
  destroy(): void;
}

/** Format shortcuts (SPEC "Format bar"). Mod is Ctrl, or Cmd on a Mac. */
export const formatKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-Shift-x', run: toggleStrikethrough },
  { key: 'Mod-e', run: toggleInlineCode },
  { key: 'Mod-k', run: toggleLink },
  { key: 'Mod-Alt-1', run: toggleHeading(1) },
  { key: 'Mod-Alt-2', run: toggleHeading(2) },
  { key: 'Mod-Alt-3', run: toggleHeading(3) },
  { key: 'Mod-Shift-8', run: toggleBulletList },
  { key: 'Mod-Shift-7', run: toggleNumberedList },
  { key: 'Mod-Shift-9', run: toggleChecklist },
  { key: 'Mod-Shift-.', run: toggleQuote },
  { key: 'Mod-Alt-c', run: toggleCodeBlock },
];

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'var(--bg)',
    // At least 16px, or mobile browsers zoom in on focus. The serif reads a little small.
    fontSize: '17px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-body)',
    lineHeight: '1.65',
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
          // Same commands as the format bar's move and indent buttons.
          { key: 'Tab', run: indentItem, shift: outdentItem },
          { key: 'Alt-ArrowUp', run: moveItemUp },
          { key: 'Alt-ArrowDown', run: moveItemDown },
          ...formatKeymap, // Before defaultKeymap, which uses Mod-i for something else.
          ...defaultKeymap,
          ...historyKeymap,
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
    run(command) {
      command(view);
      view.focus();
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

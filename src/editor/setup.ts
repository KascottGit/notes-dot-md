/**
 * CodeMirror configuration. The document is plain markdown text; rendering
 * (live preview) only adds decorations and never changes how it is stored.
 */
import { defaultKeymap, history, historyKeymap, toggleComment } from '@codemirror/commands';
import { deleteMarkupBackward } from '@codemirror/lang-markdown';
import { codeFolding, syntaxHighlighting } from '@codemirror/language';
import {
  Annotation,
  Compartment,
  EditorState,
  Prec,
  type Extension,
  type StateCommand,
} from '@codemirror/state';
import { drawSelection, EditorView, keymap, ViewPlugin, type KeyBinding } from '@codemirror/view';
import {
  toggleBold,
  toggleBulletList,
  toggleChecklist,
  toggleCodeBlock,
  insertTable,
  newLineAtEnd,
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
import { pasteImages } from './paste';

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
  onFocus?: () => void;
  /** Any change to the text, typed or not. */
  onDocChange?: () => void;
  /** 'card': the small editor on a board card (no page padding, grows with its text). */
  variant?: 'note' | 'card';
  extensions?: Extension[];
}

export interface Editor {
  getText(): string;
  /** Replace the whole text without counting as a user edit. Undo still works. */
  setText(text: string): void;
  /** Replace the whole text as a user edit (saved, undoable), changing only what differs. */
  edit(text: string): void;
  /** The first line, without reading the whole text. */
  firstLine(): string;
  /** Start over with a new document and an empty undo history. */
  load(doc: string, readOnly: boolean): void;
  /** Run a format command on the current selection, keeping focus in the editor. */
  run(command: StateCommand): void;
  focus(): void;
  destroy(): void;
}

/**
 * CodeMirror's default keys, without Mod-/ (toggle comment, which inserts
 * `<!-- -->` in markdown). On Nordic and German keyboards Shift+7 types `/`,
 * so Ctrl+Shift+7 arrives as Ctrl+/ and would never reach the numbered list.
 */
export const baseKeymap: readonly KeyBinding[] = defaultKeymap.filter(
  (binding) => binding.run !== toggleComment,
);

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
  { key: 'Mod-Alt-t', run: insertTable },
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

/**
 * Tapping or clicking below the last line starts a new line there
 * (`newLineAtEnd`) instead of putting the cursor at the end of the last one.
 */
const tapBelowEnd = ViewPlugin.define((view) => {
  const below = (y: number) => {
    const end = view.lineBlockAt(view.state.doc.length);
    return y > end.bottom + view.documentTop + 4;
  };
  const act = () => {
    view.focus();
    newLineAtEnd(view);
  };
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || view.state.readOnly || !below(event.clientY)) return;
    event.preventDefault();
    act();
  };
  // Touch: a tap, not a scroll. Handled here so the browser doesn't place the caret first.
  let start: { x: number; y: number } | null = null;
  const onTouchStart = (event: TouchEvent) => {
    const t = event.touches[0];
    start = t && event.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const t = event.changedTouches[0];
    const from = start;
    start = null;
    if (!from || !t || view.state.readOnly) return;
    if (Math.hypot(t.clientX - from.x, t.clientY - from.y) > 10 || !below(t.clientY)) return;
    event.preventDefault();
    act();
  };
  const dom = view.scrollDOM;
  dom.addEventListener('mousedown', onMouseDown, true);
  dom.addEventListener('touchstart', onTouchStart, { passive: true });
  dom.addEventListener('touchend', onTouchEnd, { passive: false });
  return {
    destroy() {
      dom.removeEventListener('mousedown', onMouseDown, true);
      dom.removeEventListener('touchstart', onTouchStart);
      dom.removeEventListener('touchend', onTouchEnd);
    },
  };
});

/** Board cards: sized by their text, inside a card box. */
const cardTheme = Prec.high(
  EditorView.theme({
    '&': { height: 'auto', fontSize: '16px', backgroundColor: 'transparent' },
    // Never scroll inside a card. The checkboxes' 44px tap area reaches below
    // the last line and would otherwise make the card body scrollable.
    '.cm-scroller': { lineHeight: '1.55', overflowY: 'hidden' },
    // A little room on the left, or the cursor at the start of a line is cut off.
    '.cm-content': { maxWidth: 'none', margin: '0', padding: '0 12px 2px 3px' },
    '.cm-line': { padding: '0' },
    '.cm-placeholder': { color: 'var(--text-muted)' },
  }),
);

/** The smallest change that turns the document into `text`. */
function minimalChange(doc: string, text: string) {
  let from = 0;
  const max = Math.min(doc.length, text.length);
  while (from < max && doc.charCodeAt(from) === text.charCodeAt(from)) from++;
  let endDoc = doc.length;
  let endText = text.length;
  while (
    endDoc > from &&
    endText > from &&
    doc.charCodeAt(endDoc - 1) === text.charCodeAt(endText - 1)
  ) {
    endDoc--;
    endText--;
  }
  return { from, to: endDoc, insert: text.slice(from, endText) };
}

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
        tapBelowEnd,
        pasteImages,
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
          ...formatKeymap, // Before the defaults, which use Mod-i for something else.
          ...baseKeymap,
          ...historyKeymap,
        ]),
        editable.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'sentences' }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (!update.transactions.some((tr) => tr.annotation(external))) options.onChange();
          options.onDocChange?.();
        }),
        EditorView.domEventHandlers({
          blur: () => {
            options.onBlur();
          },
          focus: () => {
            options.onFocus?.();
          },
        }),
        theme,
        options.variant === 'card' ? cardTheme : [],
        options.extensions ?? [],
      ],
    });

  const view = new EditorView({
    parent: options.parent,
    state: makeState(options.doc, options.readOnly),
  });

  return {
    getText: () => view.state.doc.toString(),
    setText(text) {
      const doc = view.state.doc.toString();
      if (text === doc) return;
      view.dispatch({ changes: minimalChange(doc, text), annotations: external.of(true) });
    },
    edit(text) {
      const doc = view.state.doc.toString();
      if (text === doc) return;
      view.dispatch({ changes: minimalChange(doc, text), userEvent: 'input' });
    },
    firstLine: () => view.state.doc.line(1).text,
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

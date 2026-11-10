/**
 * The outline of a note: its headings, for jumping to them (the Outline menu
 * in the note header, Ctrl+Shift+O). Jumping scrolls the heading to the top
 * and lights its line up for a moment, so the eye finds it.
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { headingText } from './markdown';

export interface Heading {
  /** 1–6. */
  level: number;
  /** Plain text, without markers. */
  text: string;
  /** Where the heading's line starts. */
  from: number;
}

/** The headings, and the one whose section is at the top of the screen (-1: above the first). */
export interface Outline {
  headings: Heading[];
  current: number;
}

const HEADING = /^(?:ATXHeading([1-6])|SetextHeading([12]))$/;
/** Blocks that can hold headings (`> ## Quoted`, a heading in a list item). */
const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);
/** How long the jumped-to line stays lit. */
const FLASH_MS = 1600;

/** The note's headings, in order. Lines in code blocks and `#tags` are not headings. */
export function outline(state: EditorState): Heading[] {
  // The whole note, not just what has been parsed for the screen so far.
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const headings: Heading[] = [];
  tree.iterate({
    enter(node) {
      const match = HEADING.exec(node.name);
      if (!match) return CONTAINERS.has(node.name);
      const line = state.doc.lineAt(node.from);
      // From the heading's own start, so a quote or list marker before it is left out.
      const text = headingText(state.doc.sliceString(node.from, line.to));
      if (text) {
        headings.push({ level: Number(match[1] ?? match[2]), text, from: line.from });
      }
      return false;
    },
  });
  return headings;
}

/** The last heading at or before `pos`; -1 when `pos` is above the first one. */
export function headingAt(headings: readonly Heading[], pos: number): number {
  let found = -1;
  for (let i = 0; i < headings.length && headings[i]!.from <= pos; i++) found = i;
  return found;
}

/**
 * Where `heading` is now. The outline was read when the menu opened; if the
 * text changed since (a newer version came in), go to the same heading,
 * the nearest one with its text and level.
 */
export function findHeading(headings: readonly Heading[], heading: Heading): Heading | null {
  let best: Heading | null = null;
  for (const h of headings) {
    if (h.from === heading.from && h.text === heading.text && h.level === heading.level) return h;
  }
  for (const h of headings) {
    if (h.text !== heading.text || h.level !== heading.level) continue;
    if (!best || Math.abs(h.from - heading.from) < Math.abs(best.from - heading.from)) best = h;
  }
  return best;
}

/** The outline as the reader sees it: the current heading is the one at the top of the editor. */
export function readOutline(view: EditorView): Outline {
  const headings = outline(view.state);
  // A little below the top edge, so a heading just scrolled to counts as current.
  const top = view.scrollDOM.getBoundingClientRect().top + 40;
  const line = view.lineBlockAtHeight(top - view.documentTop);
  return { headings, current: headingAt(headings, line.from) };
}

const flash = StateEffect.define<number | null>();

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(lit, tr) {
    lit = lit.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(flash)) continue;
      lit =
        effect.value === null
          ? Decoration.none
          : Decoration.set(Decoration.line({ class: 'cm-jumped' }).range(effect.value));
    }
    return lit;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const timers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

/**
 * Scroll `heading` to the top of the editor and light it up. With `focus`
 * (a mouse and keyboard), the cursor goes to the end of the heading, ready to
 * type; without (a phone), the keyboard stays closed and the cursor stays.
 */
export function jumpToHeading(view: EditorView, heading: Heading, focus: boolean): void {
  const target = findHeading(outline(view.state), heading);
  if (!target) return;
  const line = view.state.doc.lineAt(target.from);
  view.dispatch({
    ...(focus ? { selection: EditorSelection.cursor(line.to) } : {}),
    effects: [
      EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 16 }),
      flash.of(line.from),
    ],
    userEvent: 'select',
  });
  if (focus) view.focus();
  clearTimeout(timers.get(view));
  timers.set(
    view,
    setTimeout(() => {
      if (view.dom.isConnected) view.dispatch({ effects: flash.of(null) });
    }, FLASH_MS),
  );
}

const flashTheme = EditorView.theme({
  '@keyframes cm-jumped': {
    from: { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' },
    to: { backgroundColor: 'transparent' },
  },
  '.cm-line.cm-jumped': {
    borderRadius: '4px',
    animation: `cm-jumped ${FLASH_MS}ms ease-out`,
  },
});

/** Lights up the line jumped to. */
export function headingJumps(): Extension {
  return [flashField, flashTheme];
}

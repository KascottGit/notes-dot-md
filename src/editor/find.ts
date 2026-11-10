/**
 * Find in note: a small bar above the text (Ctrl+F, or "Find in note" in the
 * note header's menu). It only finds: matches are highlighted and stepped
 * through; the text is never changed.
 *
 * The browser's own find can't do this job: the editor only draws the lines
 * near the screen, so most of a long note isn't on the page to be found.
 */
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import { EditorSelection, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type Panel, type ViewUpdate } from '@codemirror/view';
import { iconSvg, type IconName } from '../ui/icons';

/** Count this many matches at most (a one-letter search in a long note). */
const MAX_COUNT = 999;

const queryFor = (text: string) => new SearchQuery({ search: text, literal: true });

/** Every match of the current query, up to the limit. Exported for tests; needs no DOM. */
export function findMatches(
  state: EditorState,
  text: string,
  limit = MAX_COUNT,
): { from: number; to: number }[] {
  const query = queryFor(text);
  const found: { from: number; to: number }[] = [];
  if (!query.valid) return found;
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done && found.length < limit; next = cursor.next()) {
    found.push({ from: next.value.from, to: next.value.to });
  }
  return found;
}

/** The first match at or after `pos`, else the first one in the note. */
export function matchFrom(
  state: EditorState,
  text: string,
  pos: number,
): { from: number; to: number } | null {
  const all = findMatches(state, text);
  return all.find((m) => m.from >= pos) ?? all[0] ?? null;
}

/** Opened by the app to show a search hit: don't take focus (no keyboard on phones). */
let quiet = false;

function button(icon: IconName, label: string, run: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'cm-find-button';
  el.setAttribute('aria-label', label);
  el.title = label;
  el.append(iconSvg(icon));
  // Keep the cursor in the field while stepping through matches.
  el.addEventListener('mousedown', (e) => e.preventDefault());
  el.addEventListener('click', run);
  return el;
}

function findPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'cm-find';
  const input = document.createElement('input');
  input.className = 'cm-find-input';
  input.type = 'text';
  input.placeholder = 'Find in note';
  input.setAttribute('aria-label', 'Find in note');
  input.setAttribute('main-field', 'true');
  input.setAttribute('enterkeyhint', 'search');
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = getSearchQuery(view.state).search;
  const count = document.createElement('span');
  count.className = 'cm-find-count';
  count.setAttribute('role', 'status');

  const close = () => {
    closeSearchPanel(view);
    view.focus();
  };
  const showCount = () => {
    const text = getSearchQuery(view.state).search;
    if (!text) {
      count.textContent = '';
      return;
    }
    const all = findMatches(view.state, text);
    const { from, to } = view.state.selection.main;
    const at = all.findIndex((m) => m.from === from && m.to === to);
    const total = all.length >= MAX_COUNT ? `${MAX_COUNT}+` : String(all.length);
    count.textContent = all.length === 0 ? 'No matches' : at < 0 ? total : `${at + 1} of ${total}`;
    dom.classList.toggle('none', all.length === 0);
  };

  input.addEventListener('input', () => {
    view.dispatch({ effects: setSearchQuery.of(queryFor(input.value)) });
    goToMatch(view, input.value, view.state.selection.main.from);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(view);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  dom.append(
    input,
    count,
    button('chevronUp', 'Previous match (Shift+Enter)', () => findPrevious(view)),
    button('chevronDown', 'Next match (Enter)', () => findNext(view)),
    button('close', 'Close (Escape)', close),
  );
  showCount();

  return {
    dom,
    top: true,
    mount() {
      if (quiet) return;
      input.focus();
      input.select();
    },
    update(update: ViewUpdate) {
      const text = getSearchQuery(update.state).search;
      if (text !== input.value) input.value = text;
      if (
        update.docChanged ||
        update.selectionSet ||
        getSearchQuery(update.startState).search !== text
      ) {
        showCount();
      }
    },
  };
}

/** Select the first match at or after `pos` and bring it into view. */
function goToMatch(view: EditorView, text: string, pos: number): boolean {
  const match = text ? matchFrom(view.state, text, pos) : null;
  if (!match) return false;
  view.dispatch({
    selection: EditorSelection.single(match.from, match.to),
    effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
    userEvent: 'select.search',
  });
  return true;
}

/**
 * Open the find bar. With `text`, look for that and go to its first match,
 * without taking focus (a note opened from the list's search results).
 */
export function openFind(view: EditorView, text?: string): void {
  if (text === undefined) {
    if (searchPanelOpen(view.state)) {
      const field = view.dom.querySelector<HTMLInputElement>('.cm-find-input');
      field?.focus();
      field?.select();
    } else {
      openSearchPanel(view);
    }
    return;
  }
  quiet = true;
  try {
    openSearchPanel(view);
  } finally {
    quiet = false;
  }
  view.dispatch({ effects: setSearchQuery.of(queryFor(text)) });
  goToMatch(view, text, 0);
}

const findTheme = EditorView.theme({
  '.cm-panels': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-find': {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    maxWidth: '760px',
    margin: '0 auto',
    padding: '4px 8px 4px 16px',
    fontFamily: 'var(--font-ui)',
  },
  '.cm-find-input': {
    flex: '1',
    minWidth: '0',
    height: '36px',
    padding: '0 10px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'inherit',
    // 16px: smaller makes iPhone Safari zoom in on focus.
    fontSize: '16px',
    outline: 'none',
    transition: 'border-color 120ms ease',
  },
  '.cm-find-input:focus': { borderColor: 'var(--accent)' },
  '.cm-find-count': {
    flex: 'none',
    padding: '0 8px',
    color: 'var(--text-muted)',
    fontSize: '13px',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  '.cm-find.none .cm-find-count': { color: 'var(--danger)' },
  '.cm-find-button': {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '44px',
    padding: '0',
    border: '0',
    borderRadius: '8px',
    background: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'background-color 120ms ease, color 120ms ease',
  },
  '.cm-find-button:hover': { backgroundColor: 'var(--bg-muted)', color: 'var(--text)' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--pin) 30%, transparent)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--pin) 65%, transparent)',
  },
});

/** Find in note: the bar, its keys and its looks. */
export function findInNote(): Extension {
  return [
    search({ top: true, createPanel: findPanel }),
    keymap.of([
      {
        key: 'Mod-f',
        run: (view) => {
          openFind(view);
          return true;
        },
        preventDefault: true,
      },
      { key: 'F3', run: findNext, shift: findPrevious, preventDefault: true },
      { key: 'Mod-g', run: findNext, shift: findPrevious, preventDefault: true },
      { key: 'Escape', run: closeSearchPanel },
    ]),
    findTheme,
  ];
}

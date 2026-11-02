/**
 * Images going into a note.
 * - Pasting an image copied from a web page (Copy Image in the browser) gives
 *   `![alt](url)`: the clipboard then holds HTML with just an `<img>`.
 * - Pasting or dropping image data (screenshots, photos) hands the files to
 *   the app, which uploads them and puts each image line at a "spot": a
 *   position that moves along with edits made while the upload runs.
 * Any other paste keeps CodeMirror's plain-text behavior.
 */
import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { imageMarkdown, isLoadable } from './markdown';

/** The images in pasted HTML, when it holds nothing but images. */
function imagesOnly(html: string): { src: string; alt: string }[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.body.textContent?.trim()) return []; // Text with images: paste the text as usual.
  return [...doc.images]
    .map((img) => ({ src: img.getAttribute('src') ?? '', alt: img.getAttribute('alt') ?? '' }))
    .filter((img) => isLoadable(img.src));
}

export const pasteImages = EditorView.domEventHandlers({
  paste(event, view) {
    if (view.state.readOnly || !event.clipboardData) return false;
    const images = imagesOnly(event.clipboardData.getData('text/html'));
    if (!images.length) return false;
    event.preventDefault();
    const text = images.map((img) => imageMarkdown(img.src, img.alt)).join('\n');
    view.dispatch(view.state.replaceSelection(text), {
      userEvent: 'input.paste',
      scrollIntoView: true,
    });
    return true;
  },
});

// ---------------------------------------------------------------- Spots

export const addSpot = StateEffect.define<{ id: number; pos: number }>();
const removeSpot = StateEffect.define<number>();

/** Where pending images go, by id. Positions move with every change (after text typed there). */
export const imageSpots = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map(),
  update(spots, tr) {
    let next = spots;
    if (tr.docChanged) {
      next = new Map([...spots].map(([id, pos]) => [id, tr.changes.mapPos(pos, 1)]));
    }
    for (const effect of tr.effects) {
      if (effect.is(addSpot)) next = new Map(next).set(effect.value.id, effect.value.pos);
      if (effect.is(removeSpot)) {
        next = new Map(next);
        (next as Map<number, number>).delete(effect.value);
      }
    }
    return next;
  },
});

let nextSpot = 1;

export function markSpot(view: EditorView, pos: number): number {
  const id = nextSpot++;
  view.dispatch({ effects: addSpot.of({ id, pos }) });
  return id;
}

export function dropSpot(view: EditorView, id: number): void {
  if (view.state.field(imageSpots).has(id)) view.dispatch({ effects: removeSpot.of(id) });
}

/**
 * How to put an image line at `pos`: on a line of its own, so text around it
 * isn't joined to it. The spot moves past it, so the next image goes after.
 */
export function imageLineChange(
  state: EditorState,
  pos: number,
  line: string,
): { from: number; insert: string } {
  const before = pos > 0 ? state.sliceDoc(pos - 1, pos) : '\n';
  const after = state.sliceDoc(pos, pos + 1);
  return {
    from: pos,
    insert: `${before === '\n' ? '' : '\n'}${line}${after === '' || after === '\n' ? '' : '\n'}`,
  };
}

/** Put an image line at a spot (true), or false if the spot is gone (another note opened). */
export function insertAtSpot(view: EditorView, id: number, line: string): boolean {
  const pos = view.state.field(imageSpots).get(id);
  if (pos === undefined) return false;
  view.dispatch({ changes: imageLineChange(view.state, pos, line), userEvent: 'input.paste' });
  return true;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Pasted or dropped image files go to `onImages`, with a spot where they belong. */
export function imageFiles(onImages: (files: File[], spot: number) => void) {
  const take = (view: EditorView, list: FileList | undefined | null, pos: number) => {
    const files = [...(list ?? [])].filter((f) => IMAGE_TYPES.includes(f.type));
    if (!files.length || view.state.readOnly) return false;
    onImages(files, markSpot(view, pos));
    return true;
  };
  return EditorView.domEventHandlers({
    paste(event, view) {
      // An image from a web page comes with its URL: pasteImages uses that instead.
      if (imagesOnly(event.clipboardData?.getData('text/html') ?? '').length) return false;
      if (!take(view, event.clipboardData?.files, view.state.selection.main.head)) return false;
      event.preventDefault();
      return true;
    },
    drop(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (!take(view, event.dataTransfer?.files, pos ?? view.state.selection.main.head)) {
        return false;
      }
      event.preventDefault();
      return true;
    },
  });
}

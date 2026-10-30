/**
 * Pasting an image copied from a web page (Copy Image in the browser) gives
 * `![alt](url)`. The clipboard then holds HTML with just an `<img>`; any other
 * paste keeps CodeMirror's plain-text behavior. Image data without a URL
 * (screenshots, photos) would need uploading and is not handled yet.
 */
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

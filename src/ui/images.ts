/**
 * Card images (SPEC "Image attachments on cards"): getting them ready for
 * upload, and showing Drive images, which are not public, from memory.
 */
import { drive } from '../drive/client';
import { readFileBlob, uploadImage } from '../drive/notes';

/** Longest side and size above which a photo is scaled down before upload. */
const MAX_SIDE = 2048;
const MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const isImageFile = (file: Blob): boolean => IMAGE_TYPES.includes(file.type);

/** The file's extension for an image type. */
export function imageExtension(type: string): string {
  return { 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[type] ?? 'png';
}

/**
 * The image as it will be uploaded: large photos scaled down to 2048px on
 * the long side and saved as JPEG; anything else unchanged.
 */
export async function prepareImage(file: Blob): Promise<Blob> {
  if (file.type === 'image/gif') return file; // Scaling would drop the animation.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // Can't be decoded here; upload it as it is.
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= MAX_SIDE && file.size <= MAX_BYTES) {
    bitmap.close();
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) return file;
  // JPEG has no transparency: put it on white.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const scaled = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  );
  return scaled ?? file;
}

/** Object URLs of downloaded images, by Drive file id (kept for the session). */
const urls = new Map<string, Promise<string>>();

/** A URL to show a Drive image with, downloaded once. */
export function imageUrl(id: string): Promise<string> {
  let url = urls.get(id);
  if (!url) {
    url = readFileBlob(drive, id).then((blob) => URL.createObjectURL(blob));
    // A failed download is tried again next time.
    url.catch(() => urls.delete(id));
    urls.set(id, url);
  }
  return url;
}

/**
 * Upload an image file (scaled down first when large) to the attachments
 * folder, named after `title` and the time. Returns its Drive file id; the
 * image shows from memory right away.
 */
export async function uploadImageFile(
  folderId: string,
  file: Blob,
  title: string,
): Promise<string> {
  const image = await prepareImage(file);
  const name = title.replace(/[/\\:*?"<>|]+/g, ' ').trim() || 'Image';
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');
  const id = await uploadImage(
    drive,
    folderId,
    `${name} ${stamp}.${imageExtension(image.type)}`,
    image,
  );
  rememberImage(id, image);
  return id;
}

/** The markdown line for an image in Drive. */
export const driveImageLine = (id: string, alt = ''): string =>
  `![${alt}](https://drive.google.com/file/d/${id}/view)`;

/** Show an image right away that was just uploaded from this device. */
export function rememberImage(id: string, image: Blob): void {
  urls.set(id, Promise.resolve(URL.createObjectURL(image)));
}

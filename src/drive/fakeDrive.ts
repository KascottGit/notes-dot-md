/**
 * A tiny in-memory Drive API for unit tests. It understands only the
 * requests drive/notes.ts makes. Never used by the app.
 */
import { createDriveClient, GOOGLE_API } from './client';

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  content: string;
  version: number;
  createdTime: string;
  modifiedTime: string;
  appProperties?: Record<string, string>;
  /** When it was moved to the trash (Drive's `trashedTime`). */
  trashedTime?: string;
  /** Binary content (an uploaded image), served instead of `content`. */
  data?: Blob;
}

interface Call {
  method: string;
  url: URL;
  body: string;
}

export function fakeDrive(initial: Partial<FakeFile>[] = []) {
  const files = new Map<string, FakeFile>();
  const calls: Call[] = [];
  let nextId = 1;
  let clock = 0;

  const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString();

  function add(f: Partial<FakeFile>): FakeFile {
    const time = stamp();
    const file: FakeFile = {
      id: f.id ?? `id${nextId++}`,
      name: f.name ?? 'Untitled',
      mimeType: f.mimeType ?? 'text/markdown',
      parents: f.parents ?? ['root'],
      trashed: f.trashed ?? false,
      content: f.content ?? '',
      version: f.version ?? 1,
      createdTime: f.createdTime ?? time,
      modifiedTime: f.modifiedTime ?? time,
      ...(f.appProperties ? { appProperties: f.appProperties } : {}),
      ...(f.data ? { data: f.data } : {}),
    };
    files.set(file.id, file);
    return file;
  }
  initial.forEach(add);

  function meta(f: FakeFile) {
    const { content: _content, data: _data, version, ...rest } = f; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, version: String(version), capabilities: { canEdit: true } };
  }

  /**
   * Supports `a and b and ...` with: name =, mimeType =, 'x' in parents,
   * trashed = false, `appProperties has { key= and value= }`, and one level
   * of `(a or b)`.
   */
  function matches(f: FakeFile, q: string): boolean {
    // `appProperties has { key='k' and value='v' }` holds an ` and ` of its own.
    const props: [string, string][] = [];
    const rest = q.replace(
      /appProperties has \{ key='(.*?)' and value='(.*?)' \}/g,
      (_all, key: string, value: string) => {
        props.push([unquote(key), unquote(value)]);
        return 'trashed = any';
      },
    );
    if (!props.every(([key, value]) => f.appProperties?.[key] === value)) return false;
    return rest.split(' and ').every((clause) => {
      const c = clause.trim();
      if (c === 'trashed = any') return true;
      if (c.startsWith('(') && c.endsWith(')')) {
        return c
          .slice(1, -1)
          .split(' or ')
          .some((part) => matches(f, part));
      }
      let m: RegExpMatchArray | null;
      if ((m = c.match(/^'(.*)' in parents$/))) return f.parents.includes(unquote(m[1]!));
      if ((m = c.match(/^name = '(.*)'$/))) return f.name === unquote(m[1]!);
      if ((m = c.match(/^mimeType = '(.*)'$/))) return f.mimeType === m[1];
      if (c === 'trashed = false') return !f.trashed;
      if (c === 'trashed = true') return f.trashed;
      if ((m = c.match(/^fullText contains '(.*)'$/))) {
        const word = unquote(m[1]!).toLowerCase();
        return `${f.name} ${f.content}`.toLowerCase().includes(word);
      }
      throw new Error(`fakeDrive: unsupported query clause: ${c}`);
    });
  }

  function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function touch(f: FakeFile) {
    f.version++;
    f.modifiedTime = stamp();
  }

  let offline = false;

  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    // A Blob body (an image upload) is read byte for byte, one character per byte.
    const blob = init?.body instanceof Blob ? init.body : null;
    const body = blob
      ? bytesToString(new Uint8Array(await blob.arrayBuffer()))
      : typeof init?.body === 'string'
        ? init.body
        : '';
    calls.push({ method, url, body });
    if (offline) throw new TypeError('Failed to fetch');
    const path = url.pathname;

    if (method === 'GET' && path === '/drive/v3/files') {
      const q = url.searchParams.get('q') ?? '';
      const list = [...files.values()].filter((f) => matches(f, q));
      if (url.searchParams.get('orderBy') === 'createdTime') {
        list.sort((a, b) => a.createdTime.localeCompare(b.createdTime));
      }
      const size = Number(url.searchParams.get('pageSize') ?? 100);
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      const hasMore = start + size < list.length;
      return json(200, {
        files: list.slice(start, start + size).map(meta),
        ...(hasMore ? { nextPageToken: String(start + size) } : {}),
      });
    }

    let m = path.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m) {
      const f = files.get(m[1]!);
      if (!f) return json(404, { error: { message: 'File not found' } });
      if (method === 'GET') {
        if (url.searchParams.get('alt') === 'media') return new Response(f.data ?? f.content);
        return json(200, meta(f));
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(body || '{}') as Partial<FakeFile> & {
          appProperties?: Record<string, string | null>;
        };
        if (patch.name !== undefined) f.name = patch.name;
        if (patch.trashed !== undefined) {
          f.trashed = patch.trashed;
          if (patch.trashed) f.trashedTime = stamp();
          else delete f.trashedTime;
        }
        if (patch.appProperties) mergeProperties(f, patch.appProperties);
        const add = url.searchParams.get('addParents');
        const remove = url.searchParams.get('removeParents');
        if (remove) f.parents = f.parents.filter((p) => p !== remove);
        if (add) f.parents.push(add);
        touch(f);
        // Like Drive, a modifiedTime in the request is kept as given.
        if (patch.modifiedTime) f.modifiedTime = patch.modifiedTime;
        return json(200, meta(f));
      }
    }

    m = path.match(/^\/drive\/v3\/files\/([^/]+)\/copy$/);
    if (m && method === 'POST') {
      const f = files.get(m[1]!);
      if (!f) return json(404, { error: { message: 'File not found' } });
      const { id: _id, ...original } = f; // eslint-disable-line @typescript-eslint/no-unused-vars
      return json(
        200,
        meta(add({ ...original, ...(JSON.parse(body || '{}') as Partial<FakeFile>) })),
      );
    }

    if (method === 'POST' && path === '/drive/v3/files') {
      return json(200, meta(add(JSON.parse(body) as Partial<FakeFile>)));
    }

    if (method === 'POST' && path === '/upload/drive/v3/files') {
      const type = new Headers(init?.headers).get('Content-Type') ?? '';
      const boundary = type.match(/boundary=(.+)$/)?.[1];
      if (url.searchParams.get('uploadType') !== 'multipart' || !boundary) {
        return json(400, { error: { message: 'Expected a multipart upload' } });
      }
      const { metadata, content, type: partType } = splitMultipart(body, boundary);
      if (blob) {
        const data = new Blob([stringToBytes(content)], { type: partType });
        return json(
          200,
          meta(add({ ...(metadata as Partial<FakeFile>), mimeType: partType, data })),
        );
      }
      return json(200, meta(add({ ...(metadata as Partial<FakeFile>), content })));
    }

    m = path.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (m && method === 'PATCH') {
      const f = files.get(m[1]!);
      if (!f) return json(404, { error: { message: 'File not found' } });
      if (url.searchParams.get('uploadType') === 'multipart') {
        const type = new Headers(init?.headers).get('Content-Type') ?? '';
        const boundary = type.match(/boundary=(.+)$/)?.[1] ?? '';
        const { metadata, content } = splitMultipart(body, boundary);
        const props = (metadata as { appProperties?: Record<string, string | null> }).appProperties;
        if (props) mergeProperties(f, props);
        f.content = content;
      } else {
        f.content = body;
      }
      touch(f);
      return json(200, meta(f));
    }

    return json(400, { error: { message: `fakeDrive: unhandled ${method} ${path}` } });
  };

  const drive = createDriveClient({ getToken: async () => 'token', invalidate: () => {} }, fetchFn);
  return {
    drive,
    /** The fake's fetch, e.g. to stand in for `window.fetch` in a visual check. */
    fetch: fetchFn,
    files,
    calls,
    add,
    baseUrl: GOOGLE_API,
    /** Make every request fail like a dropped network connection. */
    setOffline(value: boolean) {
      offline = value;
    },
  };
}

/** Drive merges appProperties; null deletes a key. */
function mergeProperties(f: FakeFile, changes: Record<string, string | null>) {
  const merged: Record<string, string> = { ...f.appProperties };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  f.appProperties = merged;
}

function splitMultipart(
  body: string,
  boundary: string,
): { metadata: unknown; content: string; type: string } {
  const parts = body.split(`--${boundary}`).slice(1, -1);
  const partBody = (p: string) => p.slice(p.indexOf('\r\n\r\n') + 4, -2);
  const type = /Content-Type: ([^;\r\n]+)/.exec(parts[1]!)?.[1] ?? '';
  return { metadata: JSON.parse(partBody(parts[0]!)), content: partBody(parts[1]!), type };
}

function bytesToString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

function stringToBytes(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function unquote(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

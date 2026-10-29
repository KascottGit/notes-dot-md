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
    };
    files.set(file.id, file);
    return file;
  }
  initial.forEach(add);

  function meta(f: FakeFile) {
    const { content: _content, version, ...rest } = f; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, version: String(version), capabilities: { canEdit: true } };
  }

  /**
   * Supports `a and b and ...` with: name =, mimeType =, 'x' in parents,
   * trashed = false, and one level of `(a or b)`.
   */
  function matches(f: FakeFile, q: string): boolean {
    return q.split(' and ').every((clause) => {
      const c = clause.trim();
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
    const body = typeof init?.body === 'string' ? init.body : '';
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
        if (url.searchParams.get('alt') === 'media') return new Response(f.content);
        return json(200, meta(f));
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(body || '{}') as Partial<FakeFile> & {
          appProperties?: Record<string, string | null>;
        };
        if (patch.name !== undefined) f.name = patch.name;
        if (patch.trashed !== undefined) f.trashed = patch.trashed;
        if (patch.appProperties) {
          // Drive merges appProperties; null deletes a key.
          const merged: Record<string, string> = { ...f.appProperties };
          for (const [key, value] of Object.entries(patch.appProperties)) {
            if (value === null) delete merged[key];
            else merged[key] = value;
          }
          f.appProperties = merged;
        }
        const add = url.searchParams.get('addParents');
        const remove = url.searchParams.get('removeParents');
        if (remove) f.parents = f.parents.filter((p) => p !== remove);
        if (add) f.parents.push(add);
        touch(f);
        return json(200, meta(f));
      }
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
      const parts = body.split(`--${boundary}`).slice(1, -1);
      const partBody = (p: string) => p.slice(p.indexOf('\r\n\r\n') + 4, -2);
      const metadata = JSON.parse(partBody(parts[0]!)) as Partial<FakeFile>;
      return json(200, meta(add({ ...metadata, content: partBody(parts[1]!) })));
    }

    m = path.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (m && method === 'PATCH') {
      const f = files.get(m[1]!);
      if (!f) return json(404, { error: { message: 'File not found' } });
      f.content = body;
      touch(f);
      return json(200, meta(f));
    }

    return json(400, { error: { message: `fakeDrive: unhandled ${method} ${path}` } });
  };

  const drive = createDriveClient({ getToken: async () => 'token', invalidate: () => {} }, fetchFn);
  return {
    drive,
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

function unquote(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

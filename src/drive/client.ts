/**
 * The only place that talks to the Drive API. Adds the auth header and, on a
 * 401, renews the token and retries the request once.
 *
 * Network retries with backoff for saves come with the save logic (M3).
 */
import { auth } from '../auth/google';

export const GOOGLE_API = 'https://www.googleapis.com';

export interface TokenSource {
  getToken(): Promise<string>;
  invalidate(): void;
}

export class DriveError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

export type DriveClient = ReturnType<typeof createDriveClient>;

export function createDriveClient(
  tokens: TokenSource,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
) {
  /**
   * Send a request to a path under https://www.googleapis.com, such as
   * `/drive/v3/files`. The body must be re-sendable (string, Blob or
   * FormData), since a 401 sends it a second time.
   */
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const send = async () => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${await tokens.getToken()}`);
      return fetchFn(GOOGLE_API + path, { ...init, headers });
    };

    let res = await send();
    if (res.status === 401) {
      tokens.invalidate();
      res = await send();
    }
    if (!res.ok) throw new DriveError(res.status, await readError(res));
    return res;
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await request(path, init);
    return (await res.json()) as T;
  }

  return { request, json };
}

/** Google errors look like `{ error: { message } }`; fall back to the status text. */
async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // Not JSON.
  }
  return `Drive request failed (${res.status}${res.statusText ? ` ${res.statusText}` : ''})`;
}

export const drive = createDriveClient(auth);

import { describe, expect, it, vi } from 'vitest';
import { createDriveClient, DriveError, GOOGLE_API, type TokenSource } from './client';

function tokenSource(tokens: string[]): TokenSource & { invalidate: ReturnType<typeof vi.fn> } {
  let i = 0;
  return {
    getToken: vi.fn(async () => tokens[Math.min(i, tokens.length - 1)]!),
    invalidate: vi.fn(() => {
      i++;
    }),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createDriveClient', () => {
  it('sends the bearer token to the Google API base URL', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { ok: true }));
    const drive = createDriveClient(tokenSource(['t1']), fetchFn);

    const body = await drive.json<{ ok: boolean }>('/drive/v3/about?fields=user');

    expect(body).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GOOGLE_API}/drive/v3/about?fields=user`);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer t1');
  });

  it('keeps caller headers', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const drive = createDriveClient(tokenSource(['t1']), fetchFn);

    await drive.request('/x', { method: 'PATCH', headers: { 'Content-Type': 'text/markdown' } });

    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('Content-Type')).toBe('text/markdown');
  });

  it('on 401, renews the token and retries once with the new token', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const tokens = tokenSource(['old', 'new']);
    const drive = createDriveClient(tokens, fetchFn);

    await expect(drive.json('/x')).resolves.toEqual({ ok: true });

    expect(tokens.invalidate).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const retry = (fetchFn.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(new Headers(retry.headers).get('Authorization')).toBe('Bearer new');
  });

  it('gives up after a second 401', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(401, { error: { message: 'Invalid Credentials' } }),
    );
    const drive = createDriveClient(tokenSource(['a', 'b']), fetchFn);

    const err = await drive.request('/x').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DriveError);
    expect((err as DriveError).status).toBe(401);
    expect((err as DriveError).message).toBe('Invalid Credentials');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('turns other errors into DriveError without retrying', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500 }));
    const drive = createDriveClient(tokenSource(['t']), fetchFn);

    const err = await drive.request('/x').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DriveError);
    expect((err as DriveError).status).toBe(500);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not call fetch when no token can be had', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const tokens: TokenSource = {
      getToken: () => Promise.reject(new Error('signed out')),
      invalidate: () => {},
    };
    const drive = createDriveClient(tokens, fetchFn);

    await expect(drive.request('/x')).rejects.toThrow('signed out');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

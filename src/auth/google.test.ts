import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, createAuth, DRIVE_SCOPE } from './google';

type TokenResponse = google.accounts.oauth2.TokenResponse;
type ClientConfigError = google.accounts.oauth2.ClientConfigError;
type OverridableTokenClientConfig = google.accounts.oauth2.OverridableTokenClientConfig;

/** A stand-in for google.accounts.oauth2 that lets each test answer token requests. */
function fakeGis() {
  let config: google.accounts.oauth2.TokenClientConfig | undefined;
  const requests: (OverridableTokenClientConfig | undefined)[] = [];
  const oauth2 = {
    initTokenClient: vi.fn((c: google.accounts.oauth2.TokenClientConfig) => {
      config = c;
      return {
        requestAccessToken: (o?: OverridableTokenClientConfig) => {
          requests.push(o);
        },
      };
    }),
    hasGrantedAllScopes: vi.fn((resp: TokenResponse, scope: string) =>
      resp.scope.split(' ').includes(scope),
    ),
    revoke: vi.fn(),
  };
  return {
    oauth2: oauth2 as unknown as typeof google.accounts.oauth2,
    revoke: oauth2.revoke,
    requests,
    grant(token: string, expiresIn = 3600, scope = DRIVE_SCOPE) {
      config!.callback({
        access_token: token,
        expires_in: String(expiresIn),
        scope,
      } as TokenResponse);
    },
    deny(error = 'access_denied') {
      config!.callback({ error } as TokenResponse);
    },
    fail(type: ClientConfigError['type']) {
      config!.error_callback!({ type, message: type, name: 'Error' });
    },
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

async function setup(opts: { hint?: string } = {}) {
  const gis = fakeGis();
  const storage = memoryStorage(opts.hint ? { 'mdnotes.loginHint': opts.hint } : {});
  let time = 1_000_000;
  const auth = createAuth({
    clientId: 'client-id',
    loadOAuth2: async () => gis.oauth2,
    storage,
    now: () => time,
  });
  await auth.init();
  return {
    auth,
    gis,
    storage,
    advance(ms: number) {
      time += ms;
    },
  };
}

/** Let pending promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

async function signedIn(opts: { hint?: string } = {}) {
  const ctx = await setup(opts);
  const signIn = ctx.auth.signIn();
  ctx.gis.grant('token-1');
  await signIn;
  return ctx;
}

describe('createAuth', () => {
  it('starts signed out and ready after GIS loads', async () => {
    const { auth, gis } = await setup();
    expect(auth.state).toMatchObject({ status: 'signed-out', ready: true, error: null });
    expect(gis.oauth2.initTokenClient).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'client-id', scope: DRIVE_SCOPE }),
    );
  });

  it('reports a missing client id instead of loading GIS', async () => {
    const loadOAuth2 = vi.fn();
    const auth = createAuth({ clientId: '', loadOAuth2 });
    await auth.init();
    expect(loadOAuth2).not.toHaveBeenCalled();
    expect(auth.state.ready).toBe(false);
    expect(auth.state.error).toMatch(/VITE_GOOGLE_CLIENT_ID/);
  });

  it('signs in and caches the token until it expires', async () => {
    const { auth, gis } = await signedIn();
    expect(auth.state.status).toBe('signed-in');

    await expect(auth.getToken()).resolves.toBe('token-1');
    await expect(auth.getToken()).resolves.toBe('token-1');
    expect(gis.requests).toHaveLength(1);
  });

  it('passes the remembered account as login hint', async () => {
    const { gis } = await signedIn({ hint: 'me@example.com' });
    expect(gis.requests[0]).toEqual({ prompt: '', login_hint: 'me@example.com' });
  });

  it('rejects getToken while signed out', async () => {
    const { auth } = await setup();
    await expect(auth.getToken()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('renews an expired token silently, with one request for concurrent callers', async () => {
    const { auth, gis, advance } = await signedIn();
    advance(3600 * 1000);

    const a = auth.getToken();
    const b = auth.getToken();
    await flush();
    expect(gis.requests).toHaveLength(2);
    gis.grant('token-2');

    await expect(Promise.all([a, b])).resolves.toEqual(['token-2', 'token-2']);
    expect(auth.state.status).toBe('signed-in');
  });

  it('renews after invalidate(), as on a 401', async () => {
    const { auth, gis } = await signedIn();
    auth.invalidate();

    const t = auth.getToken();
    await flush();
    gis.grant('token-2');
    await expect(t).resolves.toBe('token-2');
  });

  it('when silent renewal is blocked, waits for the user to sign in again', async () => {
    const { auth, gis } = await signedIn();
    auth.invalidate();

    let result: string | undefined;
    void auth.getToken().then((t) => (result = t));
    await flush();
    gis.fail('popup_failed_to_open');
    await flush();

    expect(auth.state.status).toBe('expired');
    expect(result).toBeUndefined();

    // New callers queue up too, without opening another popup.
    const later = auth.getToken();
    await flush();
    expect(gis.requests).toHaveLength(2);

    const again = auth.signIn();
    gis.grant('token-3');
    await expect(again).resolves.toBe(true);
    await expect(later).resolves.toBe('token-3');
    expect(result).toBe('token-3');
    expect(auth.state.status).toBe('signed-in');
  });

  it('stays expired with a message if signing in again fails', async () => {
    const { auth, gis } = await signedIn();
    auth.invalidate();
    void auth.getToken();
    await flush();
    gis.fail('popup_failed_to_open');
    await flush();

    const again = auth.signIn();
    gis.fail('popup_failed_to_open');
    await expect(again).resolves.toBe(false);
    expect(auth.state.status).toBe('expired');
    expect(auth.state.error).toMatch(/blocked/);
  });

  it('treats a closed popup as a cancel, not an error', async () => {
    const { auth, gis } = await setup();
    const signIn = auth.signIn();
    gis.fail('popup_closed');
    await expect(signIn).resolves.toBe(false);
    expect(auth.state).toMatchObject({ status: 'signed-out', busy: false, error: null });
  });

  it('fails sign-in when Drive access was not granted', async () => {
    const { auth, gis } = await setup();
    const signIn = auth.signIn();
    gis.grant('token', 3600, 'email');
    await expect(signIn).resolves.toBe(false);
    expect(auth.state.status).toBe('signed-out');
    expect(auth.state.error).toMatch(/Drive/);
  });

  it('fails sign-in when the user denies consent', async () => {
    const { auth, gis } = await setup();
    const signIn = auth.signIn();
    gis.deny();
    await expect(signIn).resolves.toBe(false);
    expect(auth.state.error).toBe('access_denied');
  });

  it('remembers the account and forgets it on sign out', async () => {
    const { auth, gis, storage } = await signedIn();
    auth.rememberAccount('me@example.com');
    expect(storage.data.get('mdnotes.loginHint')).toBe('me@example.com');

    auth.signOut();

    expect(gis.revoke).toHaveBeenCalledWith('token-1', expect.any(Function));
    expect(storage.data.has('mdnotes.loginHint')).toBe(false);
    expect(auth.state).toMatchObject({ status: 'signed-out', loginHint: null });
    await expect(auth.getToken()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('never writes the token to storage', async () => {
    const { auth, storage } = await signedIn();
    auth.rememberAccount('me@example.com');
    expect([...storage.data.values()].join()).not.toContain('token-1');
  });

  it('fails waiting callers on sign out', async () => {
    const { auth, gis } = await signedIn();
    auth.invalidate();
    const pending = auth.getToken();
    await flush();
    gis.fail('popup_failed_to_open');
    await flush();

    auth.signOut();
    await expect(pending).rejects.toBeInstanceOf(AuthRequiredError);
  });
});

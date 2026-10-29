import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, createAuth, DRIVE_SCOPE } from './google';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

const REDIRECT_URI = 'https://example.test/notes-dot-md/';

function setup(opts: { hash?: string; hint?: string; session?: Record<string, string> } = {}) {
  let hash = opts.hash ?? '';
  let time = 1_000_000;
  const storage = memoryStorage(opts.hint ? { 'mdnotes.loginHint': opts.hint } : {});
  const session = memoryStorage(opts.session);
  const navigate = vi.fn<(url: string) => void>();
  const revoke = vi.fn<(token: string) => void>();
  const clearHash = vi.fn(() => {
    hash = '';
  });
  const auth = createAuth({
    clientId: 'client-id',
    redirectUri: () => REDIRECT_URI,
    getHash: () => hash,
    clearHash,
    navigate,
    revoke,
    storage,
    session,
    now: () => time,
    randomState: () => 'nonce-1',
  });
  return {
    auth,
    storage,
    session,
    navigate,
    revoke,
    clearHash,
    /** The query of the last Google URL the app navigated to. */
    lastRequest: () => new URL(navigate.mock.calls.at(-1)![0]).searchParams,
    advance(ms: number) {
      time += ms;
    },
  };
}

/** The fragment Google appends when it sends the user back. */
function grantHash(token = 'token-1', scope = DRIVE_SCOPE, state = 'nonce-1') {
  const params = new URLSearchParams({
    access_token: token,
    expires_in: '3599',
    scope,
    state,
    token_type: 'Bearer',
  });
  return `#${params}`;
}

const STARTED = { 'mdnotes.oauthState': 'nonce-1' };

/** A page load right after Google redirected back with a token. */
function signedIn(opts: { hint?: string } = {}) {
  const ctx = setup({ hash: grantHash(), session: STARTED, ...opts });
  ctx.auth.init();
  return ctx;
}

describe('first visit', () => {
  it('shows the sign-in screen without going anywhere', () => {
    const { auth, navigate } = setup();
    auth.init();
    expect(auth.state).toMatchObject({ status: 'signed-out', ready: true, error: null });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a missing client id', () => {
    const auth = createAuth({
      clientId: '',
      redirectUri: () => REDIRECT_URI,
      getHash: () => '',
      clearHash: () => {},
      navigate: vi.fn(),
      revoke: vi.fn(),
    });
    auth.init();
    expect(auth.state.ready).toBe(false);
    expect(auth.state.error).toMatch(/VITE_GOOGLE_CLIENT_ID/);
  });

  it('signIn goes to Google with the right parameters', () => {
    const { auth, session, lastRequest } = setup();
    auth.init();
    auth.signIn();

    const q = lastRequest();
    expect(q.get('client_id')).toBe('client-id');
    expect(q.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(q.get('response_type')).toBe('token');
    expect(q.get('scope')).toBe(DRIVE_SCOPE);
    expect(q.get('state')).toBe('nonce-1');
    expect(q.has('prompt')).toBe(false);
    expect(q.has('login_hint')).toBe(false);
    expect(session.data.get('mdnotes.oauthState')).toBe('nonce-1');
    expect(auth.state.busy).toBe(true);
  });

  it('"Use another account" asks for the account chooser, without a hint', () => {
    const { auth, lastRequest } = setup({
      hint: 'me@example.com',
      session: { 'mdnotes.autoSignIn': '1' },
    });
    auth.init();
    auth.signIn({ selectAccount: true });
    expect(lastRequest().get('prompt')).toBe('select_account');
    expect(lastRequest().has('login_hint')).toBe(false);
  });
});

describe('coming back from Google', () => {
  it('takes the token from the URL and removes it from the address bar', async () => {
    const { auth, clearHash, session } = signedIn();
    expect(clearHash).toHaveBeenCalled();
    expect(auth.state).toMatchObject({ status: 'signed-in', error: null });
    expect(session.data.has('mdnotes.oauthState')).toBe(false);
    await expect(auth.getToken()).resolves.toBe('token-1');
  });

  it('rejects a response whose state does not match (forged redirect)', async () => {
    const { auth } = setup({ hash: grantHash('evil', DRIVE_SCOPE, 'other'), session: STARTED });
    auth.init();
    expect(auth.state.status).toBe('signed-out');
    expect(auth.state.error).toMatch(/verified/);
    await expect(auth.getToken()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('rejects a response when no sign-in was started in this tab', () => {
    const { auth } = setup({ hash: grantHash() });
    auth.init();
    expect(auth.state.status).toBe('signed-out');
  });

  it('requires the Drive scope to be granted', () => {
    const { auth } = setup({ hash: grantHash('t', 'email'), session: STARTED });
    auth.init();
    expect(auth.state.status).toBe('signed-out');
    expect(auth.state.error).toMatch(/Drive/);
  });

  it('shows Google errors', () => {
    const { auth } = setup({ hash: '#error=access_denied&state=nonce-1', session: STARTED });
    auth.init();
    expect(auth.state.status).toBe('signed-out');
    expect(auth.state.error).toMatch(/cancelled/);
  });

  it('never writes the token to storage', () => {
    const { storage, session, auth } = signedIn();
    auth.rememberAccount('me@example.com');
    const stored = [...storage.data.values(), ...session.data.values()].join();
    expect(stored).not.toContain('token-1');
  });
});

describe('returning user', () => {
  it('signs in automatically once, without UI (prompt=none)', () => {
    const { auth, navigate, lastRequest } = setup({ hint: 'me@example.com' });
    auth.init();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(lastRequest().get('prompt')).toBe('none');
    expect(lastRequest().get('login_hint')).toBe('me@example.com');
  });

  it('shows the button quietly when the automatic sign-in needs a click', () => {
    const { auth, navigate } = setup({
      hint: 'me@example.com',
      hash: '#error=interaction_required&state=nonce-1',
      session: { ...STARTED, 'mdnotes.autoSignIn': '1' },
    });
    auth.init();
    expect(navigate).not.toHaveBeenCalled();
    expect(auth.state).toMatchObject({ status: 'signed-out', error: null });
  });

  it('does not retry the automatic sign-in on a reload of the same tab', () => {
    const { auth, navigate } = setup({
      hint: 'me@example.com',
      session: { 'mdnotes.autoSignIn': '1' },
    });
    auth.init();
    expect(navigate).not.toHaveBeenCalled();
    expect(auth.state.status).toBe('signed-out');
  });

  it('allows automatic sign-in again after a successful one', () => {
    const { session } = signedIn({ hint: 'me@example.com' });
    expect(session.data.has('mdnotes.autoSignIn')).toBe(false);
  });
});

describe('expiry and renewal', () => {
  it('caches the token until it expires', async () => {
    const { auth, advance } = signedIn();
    advance(30 * 60_000);
    await expect(auth.getToken()).resolves.toBe('token-1');
  });

  it('marks the session expired and waits instead of failing', async () => {
    const { auth, advance } = signedIn();
    advance(3600 * 1000);
    let settled = false;
    void auth.getToken().then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(auth.state.status).toBe('expired');
    expect(settled).toBe(false);
  });

  it('treats invalidate() (a 401) like expiry', () => {
    const { auth } = signedIn();
    auth.invalidate();
    void auth.getToken();
    expect(auth.state.status).toBe('expired');
  });

  it('renew runs the stash hooks first, then goes to Google without UI', () => {
    const { auth, navigate, lastRequest } = signedIn({ hint: 'me@example.com' });
    const order: string[] = [];
    auth.onBeforeRedirect(() => order.push('stash'));
    navigate.mockImplementation(() => void order.push('navigate'));

    auth.renew();

    expect(order).toEqual(['stash', 'navigate']);
    expect(lastRequest().get('prompt')).toBe('none');
    expect(lastRequest().get('login_hint')).toBe('me@example.com');
  });

  it('still redirects if a stash hook throws', () => {
    const { auth, navigate } = signedIn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    auth.onBeforeRedirect(() => {
      throw new Error('quota');
    });
    auth.renew();
    expect(navigate).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('renews on return only when the token is (nearly) expired', () => {
    const { auth, navigate, advance } = signedIn();
    auth.renewIfExpiring(5 * 60_000);
    expect(navigate).not.toHaveBeenCalled();

    advance(56 * 60_000); // About 3 minutes left.
    auth.renewIfExpiring(5 * 60_000);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('renews on return when already expired', () => {
    const { auth, navigate } = signedIn();
    auth.invalidate();
    void auth.getToken();
    auth.renewIfExpiring(0);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does not renew while signed out', () => {
    const { auth, navigate } = setup();
    auth.init();
    auth.renewIfExpiring(Infinity);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('sign out', () => {
  it('revokes the token and forgets the account', async () => {
    const { auth, revoke, storage } = signedIn();
    auth.rememberAccount('me@example.com');

    auth.signOut();

    expect(revoke).toHaveBeenCalledWith('token-1');
    expect(storage.data.has('mdnotes.loginHint')).toBe(false);
    expect(auth.state).toMatchObject({ status: 'signed-out', loginHint: null });
    await expect(auth.getToken()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('fails requests that were waiting for a renewal', async () => {
    const { auth } = signedIn();
    auth.invalidate();
    const pending = auth.getToken();
    auth.signOut();
    await expect(pending).rejects.toBeInstanceOf(AuthRequiredError);
  });
});

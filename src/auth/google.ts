/**
 * Google sign-in with the OAuth 2.0 redirect flow for browser apps
 * (response_type=token). No popups: they fail in iPhone Safari and in
 * installed PWAs, where the popup can't hand the token back to the page.
 *
 * The access token lives in memory only. It is never written to storage or
 * logs, and it is removed from the URL as soon as the page loads. Stored:
 * the account email (localStorage, login hint) and a one-time `state` value
 * that protects the redirect (sessionStorage).
 */
import { safeLocalStorage, safeSessionStorage, type StorageLike } from '../store/storage';

/**
 * Full Drive access, so notes created by other tools (Claude, rclone, manual
 * uploads) show up too. The app itself only touches the Notes folder.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const LOGIN_HINT_KEY = 'mdnotes.loginHint';
const STATE_KEY = 'mdnotes.oauthState';
/** Set while an automatic (no-click) sign-in is tried, so a failure can't loop. */
const AUTO_KEY = 'mdnotes.autoSignIn';
/** Treat a token as expired a minute early so requests don't race the expiry. */
const EXPIRY_MARGIN_MS = 60_000;
/** Errors from prompt=none that just mean "the user has to click". */
const NEEDS_INTERACTION = new Set(['interaction_required', 'login_required', 'consent_required']);

export type AuthStatus =
  /** Reading the redirect result, or on the way to Google. */
  | 'loading'
  | 'signed-out'
  | 'signed-in'
  /** Was signed in, but the token expired. Renewing reloads the page. */
  | 'expired';

export interface AuthState {
  status: AuthStatus;
  /** True once sign-in can start. */
  ready: boolean;
  /** On the way to Google's sign-in page. */
  busy: boolean;
  /** Email of the last account used, if remembered. */
  loginHint: string | null;
  /** Message to show the user, or null. */
  error: string | null;
}

/** Thrown to callers waiting for a token when the user is or becomes signed out. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'AuthRequiredError';
  }
}

export interface AuthDeps {
  clientId: string;
  /** Where Google sends the user back. Must be an authorized redirect URI. */
  redirectUri: () => string;
  /** The current URL fragment, e.g. `#access_token=...`. */
  getHash: () => string;
  /** Remove the fragment from the address bar and history. */
  clearHash: () => void;
  navigate: (url: string) => void;
  revoke: (token: string) => void;
  /** localStorage: the login hint. */
  storage?: StorageLike | null;
  /** sessionStorage: the redirect `state` and the auto sign-in flag. */
  session?: StorageLike | null;
  now?: () => number;
  randomState?: () => string;
}

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(deps: AuthDeps) {
  const now = deps.now ?? Date.now;
  const storage = deps.storage ?? null;
  const session = deps.session ?? null;
  const randomState = deps.randomState ?? defaultRandomState;

  let state: AuthState = {
    status: 'loading',
    ready: false,
    busy: false,
    loginHint: read(storage, LOGIN_HINT_KEY),
    error: null,
  };
  const listeners = new Set<(s: AuthState) => void>();
  const beforeRedirect = new Set<() => void>();

  let token: { value: string; expiresAt: number } | null = null;
  /** Callers of getToken() waiting while the token is expired. */
  let waiters: Pending<string>[] = [];

  function update(patch: Partial<AuthState>) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  function rejectWaiters() {
    const list = waiters;
    waiters = [];
    for (const w of list) w.reject(new AuthRequiredError());
  }

  /** Go to Google. `none` = no UI, comes straight back if the user already agreed. */
  function redirect(prompt: 'none' | 'select_account' | null) {
    for (const fn of beforeRedirect) {
      try {
        fn(); // e.g. keep unsaved text in the tab
      } catch (err) {
        console.warn('Before sign-in redirect:', err);
      }
    }
    const nonce = randomState();
    write(session, STATE_KEY, nonce);
    const params = new URLSearchParams({
      client_id: deps.clientId,
      redirect_uri: deps.redirectUri(),
      response_type: 'token',
      scope: DRIVE_SCOPE,
      include_granted_scopes: 'true',
      state: nonce,
    });
    if (prompt) params.set('prompt', prompt);
    if (state.loginHint && prompt !== 'select_account') params.set('login_hint', state.loginHint);
    update({ busy: true, error: null });
    deps.navigate(`${AUTH_URL}?${params}`);
  }

  /** Handle `#access_token=...` or `#error=...` after Google sends the user back. */
  function readRedirectResult(params: URLSearchParams) {
    deps.clearHash();
    const expected = read(session, STATE_KEY);
    remove(session, STATE_KEY);
    if (!expected || params.get('state') !== expected) {
      update({ status: 'signed-out', error: "Sign-in couldn't be verified. Please try again." });
      return;
    }

    const error = params.get('error');
    if (error) {
      console.warn('Google sign-in:', error);
      update({
        status: 'signed-out',
        error: NEEDS_INTERACTION.has(error) ? null : describeError(error),
      });
      return;
    }

    const scopes = (params.get('scope') ?? '').split(' ');
    const value = params.get('access_token');
    if (!value || !scopes.includes(DRIVE_SCOPE)) {
      update({
        status: 'signed-out',
        error: 'notes.md needs access to Google Drive to store your notes. Please allow it.',
      });
      return;
    }

    token = {
      value,
      expiresAt: now() + Number(params.get('expires_in') ?? 3600) * 1000 - EXPIRY_MARGIN_MS,
    };
    remove(session, AUTO_KEY);
    update({ status: 'signed-in', error: null });
  }

  return {
    /** Svelte store contract, so components can use `$auth`. */
    subscribe(fn: (s: AuthState) => void): () => void {
      fn(state);
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    get state(): AuthState {
      return state;
    },

    /**
     * Run once on page load. Picks up the token from the redirect, or, for a
     * returning user, goes to Google once without any UI to get a fresh one.
     */
    init(): void {
      if (state.ready) return;
      if (!deps.clientId) {
        update({
          status: 'signed-out',
          error: 'Missing VITE_GOOGLE_CLIENT_ID. Copy .env.example to .env and set it.',
        });
        return;
      }
      update({ ready: true });

      const params = new URLSearchParams(deps.getHash().replace(/^#/, ''));
      if (params.has('access_token') || params.has('error')) {
        readRedirectResult(params);
        return;
      }
      if (state.loginHint && read(session, AUTO_KEY) !== '1') {
        write(session, AUTO_KEY, '1');
        redirect('none');
        return;
      }
      update({ status: 'signed-out' });
    },

    /** Interactive sign-in: goes to Google's page and comes back signed in. */
    signIn(options: { selectAccount?: boolean } = {}): void {
      redirect(options.selectAccount ? 'select_account' : null);
    },

    /** Get a new token. Reloads the page; unsaved text is kept by beforeRedirect hooks. */
    renew(): void {
      redirect('none');
    },

    /**
     * Renew now if the token is expired or will expire within `withinMs`.
     * Called when the user comes back to the app, a good moment for a reload.
     */
    renewIfExpiring(withinMs: number): void {
      if (state.busy) return;
      const expiring = token !== null && token.expiresAt - now() < withinMs;
      if (state.status === 'expired' || (state.status === 'signed-in' && expiring)) {
        redirect('none');
      }
    },

    /** Run `fn` right before leaving for Google. Returns an unsubscribe function. */
    onBeforeRedirect(fn: () => void): () => void {
      beforeRedirect.add(fn);
      return () => beforeRedirect.delete(fn);
    },

    /** Revoke the token, forget the account and fail any waiting requests. */
    signOut(): void {
      if (token) deps.revoke(token.value);
      token = null;
      remove(storage, LOGIN_HINT_KEY);
      remove(session, AUTO_KEY);
      rejectWaiters();
      update({ status: 'signed-out', busy: false, loginHint: null, error: null });
    },

    /** Remember the signed-in account, for the login hint and automatic sign-in. */
    rememberAccount(email: string): void {
      write(storage, LOGIN_HINT_KEY, email);
      update({ loginHint: email });
    },

    /**
     * A valid access token. When it has expired the promise waits (the
     * "session expired" banner offers to renew), so callers never fail
     * just because an hour has passed.
     */
    getToken(): Promise<string> {
      if (token && now() < token.expiresAt) return Promise.resolve(token.value);
      if (state.status === 'signed-out' || state.status === 'loading') {
        return Promise.reject(new AuthRequiredError());
      }
      if (state.status === 'signed-in') update({ status: 'expired' });
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },

    /** Drop the current token, e.g. after the Drive API answered 401. */
    invalidate(): void {
      token = null;
    },
  };
}

function describeError(error: string): string {
  if (error === 'access_denied') return 'Sign-in was cancelled, or Drive access was not allowed.';
  return `Google sign-in failed (${error}). Please try again.`;
}

function defaultRandomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function read(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: StorageLike | null, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Blocked storage (private mode): sign-in still works, just less smoothly.
  }
}

function remove(storage: StorageLike | null, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // See write().
  }
}

export const auth = createAuth({
  // Trimmed: a value pasted with a trailing newline makes Google answer invalid_client.
  clientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim(),
  redirectUri: () => `${window.location.origin}${import.meta.env.BASE_URL}`,
  getHash: () => (typeof window === 'undefined' ? '' : window.location.hash),
  clearHash: () => {
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', pathname + search);
  },
  navigate: (url) => window.location.assign(url),
  revoke: (value) => {
    // Google's revoke endpoint sends no CORS headers; a no-cors POST still works.
    void fetch(REVOKE_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: value }),
    }).catch(() => {});
  },
  storage: safeLocalStorage(),
  session: safeSessionStorage(),
});

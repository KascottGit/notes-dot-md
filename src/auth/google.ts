/**
 * Google sign-in with the Google Identity Services (GIS) token client.
 *
 * The access token lives in memory only. It is never written to storage or logs.
 * The only thing stored is the account email, used as a login hint so the
 * account chooser can be skipped next time.
 */
import { safeLocalStorage, type StorageLike } from '../store/storage';

type OAuth2 = typeof google.accounts.oauth2;

/** The one place the OAuth scope is defined. */
/**
 * Full Drive access, so notes created by other tools (Claude, rclone, manual
 * uploads) show up too. The app itself only touches the Notes folder.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const LOGIN_HINT_KEY = 'mdnotes.loginHint';
/** Treat a token as expired a minute early so requests don't race the expiry. */
const EXPIRY_MARGIN_MS = 60_000;

export type AuthStatus =
  /** GIS is still loading. */
  | 'loading'
  | 'signed-out'
  | 'signed-in'
  /** Was signed in, but the token could not be renewed silently. Needs a click. */
  | 'expired';

export interface AuthState {
  status: AuthStatus;
  /** True once GIS has loaded and sign-in can start. */
  ready: boolean;
  /** A sign-in popup is open or a token request is in flight. */
  busy: boolean;
  /** Email of the last account used, if remembered. */
  loginHint: string | null;
  /** Message to show the user, or null. */
  error: string | null;
}

/** Thrown to callers waiting for a token when the user signs out. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'AuthRequiredError';
  }
}

export interface AuthDeps {
  clientId: string;
  loadOAuth2: () => Promise<OAuth2>;
  storage?: StorageLike | null;
  now?: () => number;
}

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(deps: AuthDeps) {
  const now = deps.now ?? Date.now;
  const storage = deps.storage ?? null;

  let state: AuthState = {
    status: 'loading',
    ready: false,
    busy: false,
    loginHint: readHint(),
    error: null,
  };
  const listeners = new Set<(s: AuthState) => void>();

  let oauth2: OAuth2 | null = null;
  let client: google.accounts.oauth2.TokenClient | null = null;
  let token: { value: string; expiresAt: number } | null = null;
  /** The GIS request currently in flight (GIS handles one at a time). */
  let inflight: Pending<string> | null = null;
  /** Callers of getToken() waiting for a renewed token. */
  let waiters: Pending<string>[] = [];

  function update(patch: Partial<AuthState>) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  function readHint(): string | null {
    try {
      return storage?.getItem(LOGIN_HINT_KEY) ?? null;
    } catch {
      return null;
    }
  }

  function writeHint(value: string | null) {
    try {
      if (value) storage?.setItem(LOGIN_HINT_KEY, value);
      else storage?.removeItem(LOGIN_HINT_KEY);
    } catch {
      // Storage can be blocked (private mode); the hint is only a convenience.
    }
  }

  function onTokenResponse(resp: google.accounts.oauth2.TokenResponse) {
    const pending = inflight;
    inflight = null;
    let failure: Error | null = null;
    if (resp.error) {
      console.warn('Google sign-in: token error', resp.error);
      failure = new Error(resp.error_description || resp.error);
    } else if (!oauth2?.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
      failure = new Error('notes.md needs access to Google Drive to store your notes.');
    }
    if (failure) {
      if (pending) pending.reject(failure);
      else update({ busy: false, error: failure.message });
      return;
    }
    token = {
      value: resp.access_token,
      expiresAt: now() + Number(resp.expires_in) * 1000 - EXPIRY_MARGIN_MS,
    };
    if (pending) pending.resolve(token.value);
    // GIS can report "popup_closed" before the token arrives (the popup looks
    // closed to the opener once Google's pages load), so a token can come
    // after its request already failed. Accept it anyway.
    else completeSignIn(token.value);
  }

  function onClientError(err: google.accounts.oauth2.ClientConfigError) {
    console.warn('Google sign-in:', err.type);
    const pending = inflight;
    inflight = null;
    pending?.reject(err);
  }

  function completeSignIn(value: string) {
    update({ status: 'signed-in', busy: false, error: null });
    flushWaiters({ token: value });
  }

  /** Ask GIS for a token. Opens a popup that closes on its own if consent was already given. */
  function requestToken(selectAccount = false): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!client) {
        reject(new Error('Google sign-in has not loaded yet.'));
        return;
      }
      inflight?.reject(new Error('Superseded by a newer request'));
      inflight = { resolve, reject };
      client.requestAccessToken(
        selectAccount
          ? { prompt: 'select_account' }
          : { prompt: '', login_hint: state.loginHint ?? undefined },
      );
    });
  }

  function flushWaiters(result: { token: string } | { error: unknown }) {
    const list = waiters;
    waiters = [];
    for (const w of list) {
      if ('token' in result) w.resolve(result.token);
      else w.reject(result.error);
    }
  }

  function errorMessage(err: unknown): string | null {
    const type = (err as { type?: string } | null)?.type;
    if (type === 'popup_closed') return null; // The user closed it; not an error.
    if (type === 'popup_failed_to_open') {
      return 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.';
    }
    return err instanceof Error ? err.message : 'Sign-in failed.';
  }

  /** Try to renew the token without a click. If that fails, wait for signIn(). */
  async function renewSilently() {
    update({ busy: true });
    try {
      completeSignIn(await requestToken());
    } catch {
      // Usually the popup was blocked because no click started it.
      // Keep the waiters queued; the "Sign in again" banner calls signIn().
      update({ status: 'expired', busy: false });
    }
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

    async init(): Promise<void> {
      if (state.ready) return;
      if (!deps.clientId) {
        update({
          status: 'signed-out',
          error: 'Missing VITE_GOOGLE_CLIENT_ID. Copy .env.example to .env and set it.',
        });
        return;
      }
      try {
        oauth2 = await deps.loadOAuth2();
        client = oauth2.initTokenClient({
          client_id: deps.clientId,
          scope: DRIVE_SCOPE,
          callback: onTokenResponse,
          error_callback: onClientError,
        });
        update({ status: 'signed-out', ready: true, error: null });
      } catch {
        update({
          status: 'signed-out',
          error: "Couldn't load Google sign-in. Check your connection and reload the page.",
        });
      }
    },

    /**
     * Interactive sign-in. Call it straight from a click handler so the popup
     * is not blocked. Also used by the "Sign in again" banner.
     * Resolves to true on success.
     */
    async signIn(options: { selectAccount?: boolean } = {}): Promise<boolean> {
      const wasExpired = state.status === 'expired';
      update({ busy: true, error: null });
      try {
        completeSignIn(await requestToken(options.selectAccount));
        return true;
      } catch (err) {
        update({
          status: wasExpired ? 'expired' : 'signed-out',
          busy: false,
          error: errorMessage(err),
        });
        return false;
      }
    },

    /** Revoke the token, forget the account and fail any waiting requests. */
    signOut(): void {
      if (token && oauth2) oauth2.revoke(token.value, () => {});
      token = null;
      writeHint(null);
      flushWaiters({ error: new AuthRequiredError() });
      update({ status: 'signed-out', busy: false, loginHint: null, error: null });
    },

    /** Remember the signed-in account so the next sign-in can skip the chooser. */
    rememberAccount(email: string): void {
      writeHint(email);
      update({ loginHint: email });
    },

    /**
     * A valid access token. Renews it when it has expired; if that needs a
     * click, the promise stays pending until the user signs in again.
     */
    getToken(): Promise<string> {
      if (token && now() < token.expiresAt) return Promise.resolve(token.value);
      if (state.status === 'signed-out' || state.status === 'loading') {
        return Promise.reject(new AuthRequiredError());
      }
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
        // Only the first waiter starts a renewal, and only if one could work.
        if (waiters.length === 1 && state.status === 'signed-in') void renewSilently();
      });
    },

    /** Drop the current token, e.g. after the Drive API answered 401. */
    invalidate(): void {
      token = null;
    },
  };
}

let gisPromise: Promise<OAuth2> | null = null;

/** Load the GIS script once. */
export function loadGis(): Promise<OAuth2> {
  gisPromise ??= new Promise<OAuth2>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      const gis = (window as Window & { google?: typeof google }).google;
      if (gis?.accounts?.oauth2) resolve(gis.accounts.oauth2);
      else reject(new Error('Google Identity Services did not initialize'));
    };
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.append(script);
  }).catch((err: unknown) => {
    gisPromise = null; // Allow a retry.
    throw err;
  });
  return gisPromise;
}

export const auth = createAuth({
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
  loadOAuth2: loadGis,
  storage: safeLocalStorage(),
});

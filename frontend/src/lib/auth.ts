/**
 * Session token storage.
 *
 * The token is a short-lived JWT issued by the backend. It lives in
 * localStorage so a page refresh does not force another sign-in.
 */

const TOKEN_KEY = 'salesos.token';

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private browsing / blocked storage: fall back to no stored session.
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Non-fatal: the session just will not survive a refresh.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * Small per-viewer UI preferences (sidebar collapsed, and so on).
 * Wrapped because private browsing and blocked site data make these throw.
 */
export function readPref(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(`salesos.${key}`);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(`salesos.${key}`, value ? '1' : '0');
  } catch {
    /* Non-fatal: the preference just will not survive a refresh. */
  }
}

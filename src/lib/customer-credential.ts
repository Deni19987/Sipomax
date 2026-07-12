// Shared phone-number "credential" storage for the customer portal (/c/$token
// and its /updates/$updateId sub-route). Both must read/write the same
// localStorage entry so unlocking on one page carries over to the other —
// otherwise navigating between them prompts for the phone number twice.
const STORAGE_KEY = (token: string) => `workshop-cust-reg-${token}`;
const STORAGE_EXPIRY_KEY = (token: string) => `workshop-cust-reg-exp-${token}`;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function readCredential(token: string): string | null {
  if (typeof window === "undefined") return null;
  const expiry = localStorage.getItem(STORAGE_EXPIRY_KEY(token));
  if (expiry && Date.now() > Number(expiry)) {
    localStorage.removeItem(STORAGE_KEY(token));
    localStorage.removeItem(STORAGE_EXPIRY_KEY(token));
    return null;
  }
  return localStorage.getItem(STORAGE_KEY(token));
}

export function writeCredential(token: string, cred: string): void {
  localStorage.setItem(STORAGE_KEY(token), cred);
  localStorage.setItem(STORAGE_EXPIRY_KEY(token), String(Date.now() + THIRTY_DAYS_MS));
}

export function clearCredential(token: string): void {
  localStorage.removeItem(STORAGE_KEY(token));
  localStorage.removeItem(STORAGE_EXPIRY_KEY(token));
}

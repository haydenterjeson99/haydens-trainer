// Google Calendar, straight from the browser.
//
// Google Identity Services token flow: needs only the OAuth *client ID*, which
// is not a secret, so this works on a static host with no backend. Tokens are
// held in memory and never persisted.

import { GOOGLE_CLIENT_ID, CALENDAR_ID, GOOGLE_SCOPE } from '../config.js';

const API = 'https://www.googleapis.com/calendar/v3';

let accessToken = null;
let expiresAt = 0;
let tokenClient = null;
const listeners = new Set();

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(isSignedIn());
}

export function isSignedIn() {
  return Boolean(accessToken) && Date.now() < expiresAt;
}

export function signOut() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  expiresAt = 0;
  emit();
}

function gisReady() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    let waited = 0;
    const t = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(t);
        resolve();
      } else if ((waited += 100) > 10000) {
        clearInterval(t);
        reject(new Error('Google Identity Services failed to load.'));
      }
    }, 100);
  });
}

/**
 * @param {boolean} interactive false attempts a silent refresh (no popup).
 */
export async function signIn(interactive = true) {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('VITE_GOOGLE_CLIENT_ID is not set. See the README.');
  }
  await gisReady();

  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPE,
      prompt: interactive ? '' : 'none',
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        accessToken = resp.access_token;
        expiresAt = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
        emit();
        resolve(accessToken);
      },
      error_callback: (err) => reject(new Error(err?.message || 'Google sign-in was cancelled.')),
    });
    tokenClient.requestAccessToken();
  });
}

async function call(path, { method = 'GET', body, params } = {}) {
  if (!isSignedIn()) await signIn(true);

  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    accessToken = null;
    expiresAt = 0;
    emit();
    throw new Error('Google session expired. Sign in again.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Calendar ${method} ${path} failed (${res.status}). ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

const cal = () => encodeURIComponent(CALENDAR_ID);

export async function listEvents({ timeMin, timeMax }) {
  const out = [];
  let pageToken;
  do {
    const page = await call(`/calendars/${cal()}/events`, {
      params: {
        timeMin, timeMax, singleEvents: true, orderBy: 'startTime',
        maxResults: 250, pageToken,
      },
    });
    out.push(...(page.items || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export function patchEvent(eventId, patch) {
  return call(`/calendars/${cal()}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: patch,
    params: { sendUpdates: 'none' },
  });
}

export function insertEvent(event) {
  return call(`/calendars/${cal()}/events`, {
    method: 'POST',
    body: event,
    params: { sendUpdates: 'none' },
  });
}

export function deleteEvent(eventId) {
  return call(`/calendars/${cal()}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
}

/**
 * Week window for the API call. Padded a day either side so the DST offset can
 * never clip a Monday or Sunday; summarise() filters to the exact week by date
 * string afterwards.
 */
export function weekWindow(weekStart) {
  return {
    timeMin: `${addDaysStr(weekStart, -1)}T00:00:00Z`,
    timeMax: `${addDaysStr(weekStart, 8)}T00:00:00Z`,
  };
}

function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return t.toISOString().slice(0, 10);
}

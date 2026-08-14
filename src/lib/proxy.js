// Everything that needs a secret goes through the Cloudflare Worker.
//
// Strava cannot be called from a page at all: its token exchange requires
// client_secret (no PKCE) and api.strava.com sends no CORS headers. The Anthropic
// API needs an API key. Both keys live in Worker env vars, never in this bundle.

import { WORKER_URL } from '../config.js';

export const proxyConfigured = () => Boolean(WORKER_URL);

async function call(path, init = {}) {
  if (!WORKER_URL) throw new Error('VITE_WORKER_URL is not set — Strava and note summaries are off.');
  const res = await fetch(WORKER_URL + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Proxy ${path} failed (${res.status}). ${text.slice(0, 300)}`);
  }
  return res.json();
}

const METERS_PER_MILE = 1609.344;

/**
 * Activities for a date range. The Worker holds the refresh token and mints
 * access tokens itself, so there is no per-user OAuth dance in the browser.
 */
export async function stravaActivities({ after, before }) {
  const params = new URLSearchParams({
    after: String(Math.floor(new Date(after).getTime() / 1000)),
    before: String(Math.floor(new Date(before).getTime() / 1000)),
  });
  const raw = await call(`/strava/activities?${params}`);
  return (raw || []).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.sport_type || a.type,
    discipline: /run/i.test(a.sport_type || a.type || '') ? 'run' : 'bike',
    startLocal: a.start_date_local,
    date: (a.start_date_local || '').slice(0, 10),
    distanceMi: Math.round((a.distance / METERS_PER_MILE) * 10) / 10,
    movingMin: Math.round(a.moving_time / 60),
    elapsedMin: Math.round(a.elapsed_time / 60),
    elevationFt: Math.round(a.total_elevation_gain * 3.28084),
    avgSpeedMph: Math.round((a.average_speed * 2.2369362) * 10) / 10,
    url: `https://www.strava.com/activities/${a.id}`,
  }));
}

/**
 * Ask Claude to turn a rough note about a missed or altered session into a
 * one-line cause. The Worker builds the prompt; this endpoint cannot be used
 * as a general-purpose model proxy.
 */
export async function summariseNote({ session, note, weekContext }) {
  const data = await call('/api/claude', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'session-note',
      session: {
        name: session.name,
        date: session.date,
        status: session.meta.status,
        plannedMi: session.distanceMi,
        actualMi: session.meta.actualMi,
        isGroupRide: session.isGroupRide,
        band: session.band,
      },
      note,
      weekContext,
    }),
  });
  return data.text || '';
}

/** A short read on the week as a whole, from the same fixed-prompt endpoint. */
export async function summariseWeek({ scorecard, notes }) {
  const data = await call('/api/claude', {
    method: 'POST',
    body: JSON.stringify({ kind: 'week-review', scorecard, notes }),
  });
  return data.text || '';
}

// Calendar is the source of truth. This turns raw Google Calendar events into
// the week model the UI renders.
//
// Three categories, per the handoff:
//   session  — a planned workout, title starts with a known session name
//   imported — a synced Strava club event (real riding, no plan metadata)
//   ignored  — daily summaries, sleep blocks, the weekly review
//
// Detection is by title, never by colorId.

import { GROUP_RIDE_TITLES, SESSION_TITLES, PARKS } from '../config.js';
import { parseMeta, stripMeta } from './meta.js';

const DAY_PREFIX = /^(MON|TUE|WED|THU|FRI|SAT|SUN):/;
const SLEEP_PREFIX = /^Sleep\s*[—-]/;
const REVIEW_PREFIX = /^Weekly Plan Review/;
const PLAN_HEADER = /WEEK\s+\d+\s*·\s*BLOCK\s+\d+/i;
const STRAVA_URL = /https?:\/\/(www\.)?strava\.com\/\S+/i;

// "Duck Fleet Recovery Laps — 30 mi / 2:04 · RPE 3 · CENTRAL PARK"
const TITLE_SPLIT = /\s+[—-]\s+/;

export function sessionNameOf(summary = '') {
  const head = summary.split(TITLE_SPLIT)[0].trim();
  return SESSION_TITLES.includes(head) ? head : null;
}

export function classify(ev) {
  const summary = (ev.summary || '').trim();
  const description = ev.description || '';

  if (DAY_PREFIX.test(summary)) return 'summary';
  if (SLEEP_PREFIX.test(summary)) return 'sleep';
  if (REVIEW_PREFIX.test(summary)) return 'review';
  if (sessionNameOf(summary)) return 'session';
  // An event with a Strava URL and no plan header is a synced club event.
  if (STRAVA_URL.test(description) && !PLAN_HEADER.test(description)) return 'imported';
  return 'other';
}

// --- field extraction ------------------------------------------------------

function num(re, text, group = 1) {
  const m = re.exec(text || '');
  return m ? parseFloat(m[group]) : null;
}

export function parseDistanceMi(summary) {
  return num(/(\d+(?:\.\d+)?)\s*mi\b/i, summary);
}

export function parseDurationMin(summary) {
  const m = /\/\s*(\d+):(\d{2})\b/.exec(summary || '');
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

export function parseRpe(text) {
  const m = /RPE\s*(\d+)(?:\s*[-–]\s*(\d+))?/i.exec(text || '');
  if (!m) return null;
  const lo = parseInt(m[1], 10);
  const hi = m[2] ? parseInt(m[2], 10) : lo;
  return { lo, hi };
}

export function parsePace(summary) {
  const m = /(\d+:\d{2})\s*\/\s*mi/i.exec(summary || '');
  return m ? m[1] : null;
}

// "30 mi total = 12 transit + 18 laps" / "30 mi door to door = 12 transit + 18 laps"
export function parseSplit(description) {
  const m = /(\d+(?:\.\d+)?)\s*mi\s+(?:total|door to door)\s*=\s*(\d+(?:\.\d+)?)\s*transit\s*\+\s*(\d+(?:\.\d+)?)\s*laps/i
    .exec(description || '');
  if (!m) return null;
  return { total: parseFloat(m[1]), transit: parseFloat(m[2]), lap: parseFloat(m[3]) };
}

export function parkOf(ev) {
  const hay = `${ev.location || ''} ${ev.summary || ''}`.toLowerCase();
  if (hay.includes('central')) return 'central';
  if (hay.includes('prospect')) return 'prospect';
  return null;
}

function bandOf({ discipline, rpe }) {
  if (discipline === 'run') return 'run';
  if (!rpe) return 'easy';
  if (rpe.hi >= 7) return 'hard';
  if (rpe.hi >= 5) return 'tempo';
  return 'easy';
}

function isoDate(ev) {
  const dt = ev.start?.dateTime || ev.start?.date;
  return dt ? dt.slice(0, 10) : null;
}

// --- session model ---------------------------------------------------------

export function toSession(ev) {
  const summary = ev.summary || '';
  const description = ev.description || '';
  const name = sessionNameOf(summary);
  const discipline = /run/i.test(name || '') ? 'run' : 'bike';

  const distanceMi = parseDistanceMi(summary) ?? 0;
  const rpe = parseRpe(summary) || parseRpe(description);

  // Transit vs lap. Prefer the explicit split line; otherwise infer from the
  // park, and treat a session with no park as starting at the door.
  const split = parseSplit(description);
  const park = parkOf(ev);
  let transitMi = 0;
  let lapMi = distanceMi;
  if (split) {
    transitMi = split.transit;
    lapMi = split.lap;
  } else if (discipline === 'bike' && park) {
    transitMi = PARKS[park].oneWayMi * 2;
    lapMi = Math.max(0, distanceMi - transitMi);
  }

  const contingency = /CONTINGENCY ONLY/i.test(summary) || ev.transparency === 'transparent';

  return {
    id: ev.id,
    kind: 'session',
    name,
    title: summary,
    description,
    date: isoDate(ev),
    start: ev.start?.dateTime || null,
    end: ev.end?.dateTime || null,
    discipline,
    distanceMi,
    durationMin: parseDurationMin(summary) ?? 0,
    rpe,
    pace: parsePace(summary),
    park,
    transitMi: discipline === 'bike' ? transitMi : 0,
    lapMi: discipline === 'bike' ? lapMi : distanceMi,
    isGroupRide: GROUP_RIDE_TITLES.includes(name),
    isPriority: /PRIORITY/i.test(summary),
    contingency,
    // Contingency events are free/transparent and must not count as planned volume.
    countsAsPlanned: !contingency,
    band: bandOf({ discipline, rpe }),
    meta: parseMeta(description),
    body: stripMeta(description),
    location: ev.location || null,
    routeUrl: extractRoute(description),
    colorId: ev.colorId || null,
    htmlLink: ev.htmlLink || null,
  };
}

function extractRoute(description) {
  const m = /Route:\s*(https?:\/\/\S+)/i.exec(description || '');
  return m ? m[1] : null;
}

export function toImported(ev) {
  const description = ev.description || '';
  const url = (STRAVA_URL.exec(description) || [])[0] || null;
  return {
    id: ev.id,
    kind: 'imported',
    name: (ev.summary || '').replace(/\s{2,}/g, ' ').trim(),
    title: ev.summary || '',
    description,
    date: isoDate(ev),
    start: ev.start?.dateTime || null,
    end: ev.end?.dateTime || null,
    distanceMi: num(/~?(\d+(?:\.\d+)?)\s*miles/i, description),
    elevationFt: num(/~?([\d,]+(?:\.\d+)?)\s*ft/i, (description || '').replace(/,/g, '')),
    stravaUrl: url,
    location: ev.location || null,
    htmlLink: ev.htmlLink || null,
  };
}

export function toSleep(ev) {
  const s = ev.summary || '';
  return {
    id: ev.id,
    kind: 'sleep',
    date: isoDate(ev),
    lightsOut: (/lights out\s+([\d:apm]+)/i.exec(s) || [])[1] || null,
    wake: (/wake\s+([\d:apm]+)/i.exec(s) || [])[1] || null,
    hours: (/\((\d+h\d+)\)/.exec(s) || [])[1] || null,
    start: ev.start?.dateTime || null,
    title: s,
    description: ev.description || '',
    htmlLink: ev.htmlLink || null,
  };
}

/**
 * Split a list of raw Google Calendar events into the week model.
 */
export function parseEvents(events = []) {
  const sessions = [];
  const imported = [];
  const sleep = [];
  const ignored = [];

  for (const ev of events) {
    if (ev.status === 'cancelled') continue;
    switch (classify(ev)) {
      case 'session': sessions.push(toSession(ev)); break;
      case 'imported': imported.push(toImported(ev)); break;
      case 'sleep': sleep.push(toSleep(ev)); break;
      default: ignored.push({ id: ev.id, title: ev.summary || '' });
    }
  }

  sessions.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  imported.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  sleep.sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  return { sessions, imported, sleep, ignored };
}

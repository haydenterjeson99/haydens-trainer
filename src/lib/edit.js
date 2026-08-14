// Turn card edits into a Google Calendar PATCH body.
//
// The title carries distance and duration, so editing either has to rewrite the
// title as well — otherwise the parser and the card would disagree on reload.

import { withMeta } from './meta.js';
import { TIMEZONE } from '../config.js';

const hm = (mins) => `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;

export function retitle(title, { distanceMi, durationMin }) {
  let out = title;
  if (distanceMi != null) {
    out = out.replace(/(\d+(?:\.\d+)?)(\s*mi\b)/i, `${round1(distanceMi)}$2`);
  }
  if (durationMin != null) {
    out = out.replace(/(\/\s*)\d+:\d{2}/, `$1${hm(Math.round(durationMin))}`);
  }
  return out;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function shiftIso(iso, newHHMM) {
  // Keep the date and the offset, replace the clock time.
  const m = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2})?(.*)$/.exec(iso || '');
  if (!m) return iso;
  return `${m[1]}T${newHHMM}:00${m[3]}`;
}

/**
 * @param {object} session parsed session
 * @param {object} edits   { startTime, distanceMi, durationMin, body, meta }
 */
export function buildPatch(session, edits) {
  const patch = {};
  const nextDistance = edits.distanceMi ?? session.distanceMi;
  const nextDuration = edits.durationMin ?? session.durationMin;

  if (edits.distanceMi != null || edits.durationMin != null) {
    patch.summary = retitle(session.title, {
      distanceMi: nextDistance,
      durationMin: nextDuration,
    });
  }

  if (edits.startTime) {
    const start = shiftIso(session.start, edits.startTime);
    patch.start = { dateTime: start, timeZone: TIMEZONE };
    const durMs = new Date(session.end) - new Date(session.start);
    const span = Number.isFinite(durMs) && durMs > 0 ? durMs : nextDuration * 60000;
    patch.end = {
      dateTime: new Date(new Date(start).getTime() + span).toISOString(),
      timeZone: TIMEZONE,
    };
  } else if (edits.durationMin != null && session.start) {
    patch.end = {
      dateTime: new Date(new Date(session.start).getTime() + nextDuration * 60000).toISOString(),
      timeZone: TIMEZONE,
    };
  }

  const body = edits.body != null ? edits.body : session.body;
  const meta = { ...session.meta, ...(edits.meta || {}) };
  patch.description = withMeta(body, meta);

  // A skipped session should stop blocking time, but stays on the calendar so
  // the week's shape is still legible on Sunday.
  if (edits.meta?.status === 'skipped') patch.transparency = 'transparent';
  if (edits.meta?.status === 'done' && !session.contingency) patch.transparency = 'opaque';

  return patch;
}

// Phase 5. Reconcile the week against Strava, score it, and generate the next
// one with the group rides rotated.
//
// Governing rule, applied everywhere in this file: a lost ride is lost. Missed
// volume is never rolled forward. That is the mechanism behind the 211-then-41
// oscillation the whole plan exists to stop.

import {
  GROUP_RIDES, PARKS, TIMEZONE, LAP_SPEEDS,
} from '../config.js';
import {
  addDays, isoDay, weekNumberFor, targetsFor, isRecoveryWeek, goodGuysParkFor,
} from './week.js';

const r1 = (n) => Math.round(n * 10) / 10;

// --- reconciliation --------------------------------------------------------

/**
 * Match Strava activities against planned sessions. Same day, same discipline,
 * closest distance wins. Anything left over is unplanned riding, which still
 * counts toward actual volume.
 */
export function reconcile(week, activities = []) {
  const pool = [...activities];
  const matches = [];

  for (const s of week.planned) {
    const i = pool
      .map((a, idx) => ({ a, idx }))
      .filter(({ a }) => a.date === s.date && a.discipline === s.discipline)
      .sort((x, y) => Math.abs(x.a.distanceMi - s.distanceMi) - Math.abs(y.a.distanceMi - s.distanceMi))[0];

    if (!i) {
      matches.push(fromCard(s));
      continue;
    }
    pool.splice(i.idx, 1);
    const ratio = s.distanceMi ? i.a.distanceMi / s.distanceMi : 1;
    matches.push({
      session: s,
      activity: i.a,
      status: ratio >= 0.8 ? 'done' : 'partial',
      ratio: r1(ratio),
    });
  }

  return { matches, unplanned: pool };
}

/**
 * No Strava activity matched. The card is the fallback: if he marked it done or
 * partial, that is what happened, whether or not the ride reached Strava.
 */
function fromCard(s) {
  const meta = s.meta || {};
  if (meta.status !== 'done' && meta.status !== 'partial') {
    return { session: s, activity: null, status: 'skipped', ratio: 0 };
  }
  const distanceMi = meta.actualMi ?? s.distanceMi;
  return {
    session: s,
    activity: {
      name: s.name,
      date: s.date,
      discipline: s.discipline,
      distanceMi,
      movingMin: meta.actualMin ?? s.durationMin,
      fromCard: true,
    },
    status: meta.status,
    ratio: s.distanceMi ? r1(distanceMi / s.distanceMi) : 1,
  };
}

export function buildScorecard(week, { matches, unplanned }) {
  const bikeMatches = matches.filter((m) => m.session.discipline === 'bike');
  const runMatches = matches.filter((m) => m.session.discipline === 'run');

  const actualBike = bikeMatches.reduce((t, m) => t + (m.activity?.distanceMi || 0), 0)
    + unplanned.filter((a) => a.discipline === 'bike').reduce((t, a) => t + a.distanceMi, 0);
  const actualRun = runMatches.reduce((t, m) => t + (m.activity?.distanceMi || 0), 0)
    + unplanned.filter((a) => a.discipline === 'run').reduce((t, a) => t + a.distanceMi, 0);

  const groupMatches = matches.filter((m) => m.session.isGroupRide);
  const weekdayActual = bikeMatches
    .filter((m) => isoDay(m.session.date) <= 5)
    .reduce((t, m) => t + (m.activity?.distanceMi || 0), 0);

  const floor = week.targets?.floor ?? 0;

  return {
    weekNumber: week.weekNumber,
    weekStart: week.weekStart,
    block: week.targets?.block,
    floor,
    target: week.targets?.target,
    plannedBikeMi: week.bikeMi,
    actualBikeMi: r1(actualBike),
    clearedFloor: actualBike >= floor,
    plannedRunMi: week.runMi,
    actualRunMi: r1(actualRun),
    weekdayPlanned: week.weekdayMi,
    weekdayActual: r1(weekdayActual),
    sessionsDone: matches.filter((m) => m.status === 'done' || m.status === 'partial').length,
    sessionsPlanned: matches.length,
    groupRidesDone: groupMatches.filter((m) => m.status !== 'skipped').length,
    groupRidesPlanned: groupMatches.length,
    missed: matches.filter((m) => m.status === 'skipped').map((m) => ({
      name: m.session.name,
      date: m.session.date,
      mi: m.session.distanceMi,
      isGroupRide: m.session.isGroupRide,
      why: m.session.meta.why || m.session.meta.note || '',
    })),
    unplanned: unplanned.map((a) => ({ name: a.name, date: a.date, mi: a.distanceMi, url: a.url })),
  };
}

// --- group ride rotation ---------------------------------------------------

/**
 * Decide next week's group rides.
 *
 * Good Guys always. Duck Fleet Monday most weeks. Plus one of Thursday Night
 * Delight / Friday Coffee Laps, alternating. Never Mid Week Shuffle. Never more
 * than three, and only ever in the shape two-hard-plus-Monday-easy.
 */
export function rotateGroupRides(weekNumber, opts = {}) {
  const {
    lastThirdRide = null,       // 'Rapha Thursday Night Delight' | 'Duck Fleet Coffee Laps'
    sundayConflict = false,     // a race or big day the Sunday before
    sundayBedtimeMissed = false,
    goodGuysCancelled = false,
  } = opts;

  const monday = mondayOfWeek(weekNumber);
  const recovery = isRecoveryWeek(weekNumber);
  const notes = [];
  const rides = [];

  // Tuesday. Never moved, never skipped.
  if (goodGuysCancelled) {
    rides.push({ title: 'Rapha Tuesday Sunset', park: 'central' });
    notes.push('Good Guys cancelled, so Rapha Tuesday Sunset stands in. This is the only case where that substitution is allowed.');
  } else {
    const park = goodGuysParkFor(monday);
    rides.push({ title: 'Good Guys Night Laps', park });
    notes.push(`Good Guys is in ${PARKS[park].name} this week (it alternates). Confirm before you roll.`);
  }

  // Monday. The only easy group ride, and the reason a third is defensible.
  if (recovery) {
    notes.push('Recovery week: Duck Fleet Monday comes off and volume drops about 30% while frequency holds.');
  } else if (sundayConflict) {
    notes.push('Duck Fleet Monday is off. A big Sunday takes Monday with it, and riding it tired is the opposite of a recovery ride. The week still clears the floor without it.');
  } else if (sundayBedtimeMissed) {
    notes.push('Duck Fleet Monday is off because the Sunday 10:00pm lights-out slipped. Do not ride 30 mi on six hours before a work day.');
  } else {
    rides.push({ title: 'Duck Fleet Recovery Laps', park: 'central' });
  }

  // The rotating third. Thursday and Friday are mutually exclusive: 8:45pm home
  // to a 5:05am wake is 6h20, under the 7h minimum, on a tempo session.
  if (!recovery) {
    const third = lastThirdRide === 'Rapha Thursday Night Delight'
      ? 'Duck Fleet Coffee Laps'
      : lastThirdRide === 'Duck Fleet Coffee Laps'
        ? 'Rapha Thursday Night Delight'
        : (weekNumber % 2 === 1 ? 'Rapha Thursday Night Delight' : 'Duck Fleet Coffee Laps');

    const easyOnBoard = rides.some((r) => r.title === 'Duck Fleet Recovery Laps');
    const hardCount = rides.filter((r) => GROUP_RIDES[r.title].band !== 'easy').length;

    // Three rides only as two-hard-plus-one-easy. Three tempo rides is the
    // 211-then-41 pattern.
    if (rides.length < 3 && (easyOnBoard || hardCount < 2)) {
      rides.push({ title: third, park: 'central' });
    } else {
      notes.push(`${third} is off this week — without the easy Monday ride, a third tempo-or-harder group ride would push the week the wrong way.`);
    }
  }

  return { rides, notes, weekNumber, monday };
}

function mondayOfWeek(weekNumber) {
  const planMonday = '2026-08-17';
  return addDays(planMonday, (weekNumber - 1) * 7);
}

// --- week generation -------------------------------------------------------

function doorToDoor(title, park) {
  const g = GROUP_RIDES[title];
  const p = PARKS[park] || PARKS[g.park] || PARKS.central;
  return Math.round(g.lapMi + p.oneWayMi * 2);
}

/**
 * Door-to-door minutes for a group ride: the park's own transit time both ways,
 * plus the laps at the band's speed.
 *
 * Without this the generated group rides carry no duration at all, and every
 * one of them renders as `NaN:NaN` in the title with an unparseable end time —
 * which Google rejects. The solo sessions were never affected because they
 * carry an explicit durationMin, so the gap only ever showed up on the three
 * most important events of the week.
 */
function groupRideDuration(title, park) {
  const g = GROUP_RIDES[title];
  const p = PARKS[park] || PARKS[g.park] || PARKS.central;
  const lapMin = (g.lapMi / (LAP_SPEEDS[g.band] ?? LAP_SPEEDS.easy)) * 60;
  return Math.round(p.oneWayMin * 2 + lapMin);
}

/**
 * Build next week's session list. Never carries missed volume forward — the
 * numbers come from the block target, not from what went wrong last week.
 */
export function generateWeek(weekNumber, opts = {}) {
  const monday = mondayOfWeek(weekNumber);
  const targets = targetsFor(weekNumber);
  if (!targets) throw new Error(`Week ${weekNumber} is outside the 16-week build.`);

  const rotation = rotateGroupRides(weekNumber, opts);
  const sessions = [];

  for (const r of rotation.rides) {
    const g = GROUP_RIDES[r.title];
    const park = r.park || g.park;
    sessions.push({
      name: r.title,
      date: addDays(monday, g.day - 1),
      discipline: 'bike',
      distanceMi: doorToDoor(r.title, park),
      lapMi: g.lapMi,
      transitMi: PARKS[park].oneWayMi * 2,
      rpe: g.rpe,
      band: g.band,
      park,
      isGroupRide: true,
      durationMin: groupRideDuration(r.title, park),
      startTime: g.rollOut,
      groupStart: g.groupStart,
      rollOut: g.rollOut,
      wake: g.wake || null,
      leaveWork: g.leaveWork || null,
      needsCitiBike: Boolean(g.needsCitiBike),
    });
  }

  const has = (t) => sessions.some((s) => s.name === t);
  const scale = targets.isRecoveryWeek ? 0.7 : 1;

  // Wednesday: recovery spin plus the first run. WFH, midday, RPE 2.
  sessions.push(makeSolo({
    name: 'Recovery Spin', date: addDays(monday, 2), park: 'prospect',
    lapMi: Math.round(5 * scale), rpe: [2, 2], band: 'easy', startTime: '12:15', durationMin: 55,
  }));

  const runEach = Math.round((targets.runTarget / 2) * 10) / 10;
  sessions.push(makeRun({ date: addDays(monday, 2), distanceMi: runEach, startTime: '17:45' }));
  sessions.push(makeRun({ date: addDays(monday, 4), distanceMi: runEach, startTime: '17:30' }));

  // Friday contingency, only when Thursday is the group ride that could be missed.
  if (has('Rapha Thursday Night Delight')) {
    sessions.push({
      ...makeSolo({
        name: 'Endurance Ride', date: addDays(monday, 4), park: 'prospect',
        lapMi: 8, rpe: [3, 4], band: 'easy', startTime: '06:50', durationMin: 62,
      }),
      contingency: true,
    });
  }

  // Sunday: the priority session. Never the shock absorber.
  sessions.push(makeSolo({
    name: 'Sunday Ride', date: addDays(monday, 6), park: 'prospect',
    lapMi: Math.round(12 * scale), rpe: [3, 3], band: 'easy', startTime: '09:00', durationMin: 76,
    isPriority: true,
  }));

  // Saturday absorbs the difference. Group rides add miles over the solo sessions
  // they replace, so the long ride is trimmed to keep the week near target rather
  // than overshooting. Clamped — frequency holds even on a heavy week.
  const committed = sessions
    .filter((s) => s.discipline === 'bike' && !s.contingency)
    .reduce((t, s) => t + s.distanceMi, 0);
  const saturdayMi = clamp(roundTo(targets.target - committed, 5), 15, 45);

  sessions.push({
    name: 'Long Ride', date: addDays(monday, 5), discipline: 'bike',
    distanceMi: saturdayMi, lapMi: saturdayMi, transitMi: 0,
    rpe: [3, 3], band: 'easy', park: null, bike: 'Gravel',
    startTime: '08:00', durationMin: Math.round((saturdayMi / 14) * 60),
    isGroupRide: false,
  });

  sessions.sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')));

  const bikeTotal = sessions
    .filter((s) => s.discipline === 'bike' && !s.contingency)
    .reduce((t, s) => t + s.distanceMi, 0);
  const runTotal = sessions
    .filter((s) => s.discipline === 'run')
    .reduce((t, s) => t + s.distanceMi, 0);
  const hardish = sessions
    .filter((s) => s.discipline === 'bike' && !s.contingency && s.band !== 'easy')
    .reduce((t, s) => t + s.distanceMi, 0);

  return {
    weekNumber,
    monday,
    targets,
    sessions,
    rotation,
    totals: {
      bikeMi: bikeTotal,
      runMi: r1(runTotal),
      hardMi: hardish,
      hardShare: bikeTotal ? r1((hardish / bikeTotal) * 100) / 100 : 0,
      transitMi: sessions
        .filter((s) => s.discipline === 'bike' && !s.contingency)
        .reduce((t, s) => t + (s.transitMi || 0), 0),
      overTarget: bikeTotal - targets.target,
      clearsFloor: bikeTotal >= targets.floor,
    },
    dayDesignations: designateDays(sessions),
  };
}

function makeSolo({ name, date, park, lapMi, rpe, band, startTime, durationMin, isPriority = false }) {
  const transitMi = park ? PARKS[park].oneWayMi * 2 : 0;
  return {
    name, date, discipline: 'bike', park,
    lapMi, transitMi, distanceMi: Math.round(lapMi + transitMi),
    rpe, band, startTime, durationMin, isGroupRide: false, isPriority,
  };
}

function makeRun({ date, distanceMi, startTime }) {
  return {
    name: 'Easy Run', date, discipline: 'run', distanceMi, lapMi: distanceMi, transitMi: 0,
    pace: '9:00', band: 'run', startTime, durationMin: Math.round(distanceMi * 10),
    isGroupRide: false,
  };
}

/**
 * A morning ride and a protected evening never share a day: late arrival is
 * repaid with a late departure, so the evening is not actually free.
 */
export function designateDays(sessions) {
  const out = {};
  for (let d = 1; d <= 7; d += 1) {
    if (d === 3 || d === 5) out[d] = 'WFH';
    else if (d >= 6) out[d] = '-';
    else out[d] = 'NORMAL';
  }

  for (const s of sessions) {
    if (s.contingency || s.discipline === 'run') continue;
    const d = isoDay(s.date);
    if (d > 5) continue;
    const morning = (s.startTime || s.rollOut || '12:00') < '11:00';
    if (morning) {
      // Citi Bike buys back the twenty minutes, so the evening stays free.
      out[d] = out[d] === 'WFH' ? 'WFH' : 'LATE OK';
    } else if (out[d] !== 'WFH') {
      out[d] = s.leaveWork === '17:30' ? 'EARLY OUT' : 'LEAVE ON TIME';
    }
  }
  return out;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const roundTo = (n, step) => Math.round(n / step) * step;

// --- calendar event payloads ----------------------------------------------

function nyOffset(dateStr) {
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE, timeZoneName: 'longOffset',
    }).format(new Date(`${dateStr}T12:00:00Z`));
    const m = /GMT([+-]\d{2}:\d{2})/.exec(s);
    if (m) return m[1];
  } catch { /* fall through */ }
  return '-05:00';
}

function at(dateStr, hhmm, addMin = 0) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + addMin;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${dateStr}T${hh}:${mm}:00${nyOffset(dateStr)}`;
}

const COLORS = {
  group: '6', hard: '11', solo: '7', recovery: '2', run: '5',
  contingency: '8', gravel: '10', priority: '6',
};

function colorFor(s) {
  if (s.contingency) return COLORS.contingency;
  if (s.discipline === 'run') return COLORS.run;
  if (s.band === 'hard') return COLORS.hard;
  if (s.isGroupRide) return COLORS.group;
  if (s.isPriority) return COLORS.priority;
  if (s.name === 'Long Ride') return COLORS.gravel;
  if (s.band === 'easy' && s.rpe?.[1] <= 2) return COLORS.recovery;
  return COLORS.solo;
}

function hm(mins) {
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

function titleFor(s) {
  const bits = [`${s.name} — ${s.distanceMi} mi / ${hm(s.durationMin)}`];
  if (s.discipline === 'run') bits.push(`${s.pace}/mi`);
  else if (s.rpe) bits.push(`RPE ${s.rpe[0] === s.rpe[1] ? s.rpe[0] : `${s.rpe[0]}-${s.rpe[1]}`}`);
  if (s.contingency) bits.push('CONTINGENCY ONLY');
  else if (s.isPriority) bits.push('PRIORITY');
  else if (s.park) bits.push(PARKS[s.park].name.toUpperCase());
  else if (s.bike) bits.push(s.bike);
  return bits.join(' · ');
}

/**
 * House rules: no emojis, bulleted timeline first, then two or three short
 * paragraphs, plain text only. The Google Calendar connector escapes HTML, so
 * `<b>` would arrive as literal &lt;b&gt;.
 */
function descriptionFor(s, plan, dayIndex) {
  const lines = [];
  lines.push(`WEEK ${plan.weekNumber} · BLOCK ${plan.targets.block} · Day ${dayIndex}${s.isGroupRide ? ' — GROUP RIDE' : ''}`);
  lines.push('');

  if (s.leaveWork) lines.push(`- Out of the office: ${fmt(s.leaveWork)}`);
  if (s.wake) lines.push(`- Wake: ${fmt(s.wake)}`);
  if (s.rollOut) lines.push(`- Roll out: ${fmt(s.rollOut)}`);
  else lines.push(`- Start: ${fmt(s.startTime)}`);
  if (s.park) lines.push(`- To ${PARKS[s.park].name}: ${PARKS[s.park].oneWayMin} min / ${PARKS[s.park].oneWayMi} mi`);
  if (s.groupStart) lines.push(`- Group start: ${fmt(s.groupStart)}`);
  if (s.lapMi && s.park) {
    lines.push(`- Laps: ${r1(s.lapMi / PARKS[s.park].loopMi)} x ${PARKS[s.park].loopMi} mi loop`);
  }
  lines.push(`- Duration: ${hm(s.durationMin)}`);
  lines.push('');

  if (s.transitMi) {
    lines.push(`${s.distanceMi} mi total = ${s.transitMi} transit + ${s.lapMi} laps.`);
  } else {
    lines.push(`${s.distanceMi} mi, no park transit — starts at the door.`);
  }
  if (s.rpe) lines.push(`RPE ${s.rpe[0] === s.rpe[1] ? s.rpe[0] : `${s.rpe[0]}-${s.rpe[1]}`}.`);
  lines.push('');

  if (s.needsCitiBike) {
    lines.push('Citi Bike to work. Home 8:03am, out the door 8:48am, at your desk 8:58am — your normal arrival, so there is no lateness to pay back and the evening stays free.');
    lines.push('');
    lines.push('Hold the pace. This is the only easy group ride you have. If the group goes, let it go.');
    lines.push('');
  }
  if (s.contingency) {
    lines.push('Only ride this if you missed the Thursday group ride. Otherwise skip it — Friday is a bike rest day.');
    lines.push('');
  }
  if (s.isPriority) {
    lines.push('You ride 24% of Sundays. If everything else this week falls apart, do this one.');
    lines.push('');
  }
  if (s.name === 'Long Ride') {
    lines.push('Saturday is the shock absorber for group-ride volume. Hold back — riding this long because you feel good is what produces a 40-mile week two weeks from now.');
    lines.push('');
  }

  lines.push('Route: —');
  return lines.join('\n');
}

function fmt(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')}${ampm}`;
}

/**
 * A stable id for one session, derived from the week and the session itself so
 * the same session always produces the same id. Google rejects an insert whose
 * iCalUID already exists (409), which is what makes a retry after a half-written
 * week safe: the events already on the calendar are refused, not duplicated.
 */
function uidFor(plan, s) {
  const slug = `${s.name}${s.contingency ? '-contingency' : ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `ht-w${plan.weekNumber}-${s.date.replace(/-/g, '')}-${slug}@haydens-trainer`;
}

/** Turn a generated plan into Google Calendar event bodies, ready to insert. */
export function toCalendarEvents(plan) {
  // Two sessions of the same name on the same day would otherwise share a uid,
  // and the second insert would be refused as a duplicate of the first.
  const seen = new Map();
  return plan.sessions.map((s) => {
    const start = s.rollOut && s.wake ? s.wake : (s.startTime || s.rollOut);
    const dayIndex = isoDay(s.date);
    const base = uidFor(plan, s);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return {
      iCalUID: n === 1 ? base : base.replace('@', `-${n}@`),
      summary: titleFor(s),
      description: descriptionFor(s, plan, dayIndex),
      location: s.park ? `${PARKS[s.park].name}, ${s.park === 'central' ? 'New York' : 'Brooklyn'}, NY` : undefined,
      start: { dateTime: at(s.date, start, s.wake ? -15 : 0), timeZone: TIMEZONE },
      end: { dateTime: at(s.date, start, (s.wake ? -15 : 0) + s.durationMin + 40), timeZone: TIMEZONE },
      colorId: colorFor(s),
      transparency: s.contingency ? 'transparent' : 'opaque',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] },
    };
  });
}

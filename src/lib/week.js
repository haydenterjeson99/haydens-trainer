// Week arithmetic and roll-ups.
//
// Dates are handled as plain YYYY-MM-DD strings taken from the event's own
// -04:00/-05:00 timestamps, so nothing here can drift a day by going through UTC.

import {
  PLAN_START, BLOCKS, RECOVERY_WEEK_OF_BLOCK, RECOVERY_MULTIPLIER,
  GOOD_GUYS_ANCHOR, HARD_SHARE_GUIDE,
} from '../config.js';

const MS_DAY = 86400000;

export function toUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  return fromUTC(toUTC(dateStr) + n * MS_DAY);
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / MS_DAY);
}

/** 1 = Mon ... 7 = Sun, matching the plan's mental model. */
export function isoDay(dateStr) {
  const d = new Date(toUTC(dateStr)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function mondayOf(dateStr) {
  return addDays(dateStr, -(isoDay(dateStr) - 1));
}

export function todayISO(tz = 'America/New_York') {
  // en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// --- block / week identity -------------------------------------------------

export function weekNumberFor(dateStr) {
  const monday = mondayOf(dateStr);
  return Math.floor(daysBetween(mondayOf(PLAN_START), monday) / 7) + 1;
}

export function blockFor(weekNumber) {
  return BLOCKS.find((b) => weekNumber >= b.weeks[0] && weekNumber <= b.weeks[1]) || null;
}

export function weekOfBlock(weekNumber) {
  const block = blockFor(weekNumber);
  if (!block) return null;
  return weekNumber - block.weeks[0] + 1;
}

export function isRecoveryWeek(weekNumber) {
  return weekOfBlock(weekNumber) === RECOVERY_WEEK_OF_BLOCK;
}

/**
 * The numbers to show at the top of the app. Deliberately the *current block's*
 * floor and target, never the 200 endpoint — 200 is not this week's number.
 */
export function targetsFor(weekNumber) {
  const block = blockFor(weekNumber);
  if (!block) return null;
  const wob = weekOfBlock(weekNumber);
  const recovery = isRecoveryWeek(weekNumber);
  const scale = recovery ? RECOVERY_MULTIPLIER : 1;
  return {
    block: block.n,
    blockName: block.name,
    weekOfBlock: wob,
    isRecoveryWeek: recovery,
    floor: Math.round(block.floor * scale),
    target: Math.round(block.target * scale),
    runTarget: block.runTarget[wob - 1] ?? block.runTarget[block.runTarget.length - 1],
    // Weekday is the side the plan is actually trying to move.
    weekdayTarget: Math.round(block.target * 0.72 * scale),
  };
}

/** Good Guys alternates parks. Anchor: 11 Aug 2026 was Prospect. */
export function goodGuysParkFor(dateStr) {
  const weeks = Math.floor(daysBetween(mondayOf(GOOD_GUYS_ANCHOR.date), mondayOf(dateStr)) / 7);
  const even = ((weeks % 2) + 2) % 2 === 0;
  const anchorIsProspect = GOOD_GUYS_ANCHOR.park === 'prospect';
  return even === anchorIsProspect ? 'prospect' : 'central';
}

// --- roll-ups --------------------------------------------------------------

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const r1 = (n) => Math.round(n * 10) / 10;

export function summarise(model, weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = (s) => s.date >= weekStart && s.date <= weekEnd;

  const sessions = model.sessions.filter(inWeek);
  const imported = model.imported.filter(inWeek);
  const sleep = model.sleep.filter(inWeek);

  const planned = sessions.filter((s) => s.countsAsPlanned);
  const contingency = sessions.filter((s) => !s.countsAsPlanned);

  const bike = planned.filter((s) => s.discipline === 'bike');
  const run = planned.filter((s) => s.discipline === 'run');

  const weekday = bike.filter((s) => isoDay(s.date) <= 5);
  const weekend = bike.filter((s) => isoDay(s.date) >= 6);

  const bandMi = { easy: 0, tempo: 0, hard: 0 };
  for (const s of bike) bandMi[s.band] = (bandMi[s.band] || 0) + s.distanceMi;

  const bikeMi = sum(bike.map((s) => s.distanceMi));
  const hardish = bandMi.tempo + bandMi.hard;

  const done = (s) => s.meta.status === 'done' || s.meta.status === 'partial';
  const completedBikeMi = sum(bike.filter(done).map((s) => s.meta.actualMi ?? s.distanceMi));
  const completedRunMi = sum(run.filter(done).map((s) => s.meta.actualMi ?? s.distanceMi));

  const groupRides = sessions.filter((s) => s.isGroupRide);
  const weekNumber = weekNumberFor(weekStart);

  return {
    weekStart,
    weekEnd,
    weekNumber,
    targets: targetsFor(weekNumber),
    sessions,
    planned,
    contingency,
    imported,
    sleep,

    bikeMi: r1(bikeMi),
    runMi: r1(sum(run.map((s) => s.distanceMi))),
    contingencyMi: r1(sum(contingency.map((s) => s.distanceMi))),

    weekdayMi: r1(sum(weekday.map((s) => s.distanceMi))),
    weekendMi: r1(sum(weekend.map((s) => s.distanceMi))),

    transitMi: r1(sum(bike.map((s) => s.transitMi))),
    lapMi: r1(sum(bike.map((s) => s.lapMi))),
    transitShare: bikeMi ? sum(bike.map((s) => s.transitMi)) / bikeMi : 0,

    bandMi: { easy: r1(bandMi.easy), tempo: r1(bandMi.tempo), hard: r1(bandMi.hard) },
    hardShare: bikeMi ? hardish / bikeMi : 0,
    hardShareGuide: HARD_SHARE_GUIDE,

    hours: r1(sum(planned.map((s) => s.durationMin)) / 60),

    completedBikeMi: r1(completedBikeMi),
    completedRunMi: r1(completedRunMi),
    sessionsDone: planned.filter(done).length,
    sessionsPlanned: planned.length,

    groupRides: {
      total: groupRides.length,
      done: groupRides.filter(done).length,
      list: groupRides,
    },
  };
}

/**
 * What the week lands at if a given session is dropped. This is the floor-math
 * table from the plan, computed live rather than hardcoded.
 */
export function floorScenarios(week) {
  const bike = week.planned.filter((s) => s.discipline === 'bike');
  const total = sum(bike.map((s) => s.distanceMi));
  const droppable = bike.filter((s) => s.isGroupRide || s.isPriority);
  return droppable.map((s) => ({
    name: s.name,
    date: s.date,
    without: r1(total - s.distanceMi),
    clearsFloor: total - s.distanceMi >= (week.targets?.floor ?? 0),
  }));
}

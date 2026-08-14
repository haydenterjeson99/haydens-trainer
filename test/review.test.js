import { describe, it, expect } from 'vitest';
import { parseEvents } from '../src/lib/parse.js';
import { summarise } from '../src/lib/week.js';
import {
  rotateGroupRides, generateWeek, toCalendarEvents, reconcile, buildScorecard, designateDays,
} from '../src/lib/review.js';
import { buildPatch, retitle } from '../src/lib/edit.js';
import { WEEK_01_EVENTS } from './fixtures/week-01.js';

const week = summarise(parseEvents(WEEK_01_EVENTS), '2026-08-17');
const titles = (r) => r.rides.map((x) => x.title);

describe('group ride rotation', () => {
  it('always includes Good Guys, in the right park', () => {
    const r = rotateGroupRides(2, { lastThirdRide: 'Rapha Thursday Night Delight' });
    expect(titles(r)).toContain('Good Guys Night Laps');
    expect(r.rides.find((x) => x.title === 'Good Guys Night Laps').park).toBe('prospect');
  });

  it('alternates the third ride away from last week', () => {
    expect(titles(rotateGroupRides(2, { lastThirdRide: 'Rapha Thursday Night Delight' })))
      .toContain('Duck Fleet Coffee Laps');
    expect(titles(rotateGroupRides(3, { lastThirdRide: 'Duck Fleet Coffee Laps' })))
      .toContain('Rapha Thursday Night Delight');
  });

  it('never schedules Thursday and Friday in the same week', () => {
    for (let w = 1; w <= 16; w += 1) {
      const t = titles(rotateGroupRides(w, {}));
      const both = t.includes('Rapha Thursday Night Delight') && t.includes('Duck Fleet Coffee Laps');
      expect(both).toBe(false);
    }
  });

  it('never schedules the Mid Week Shuffle', () => {
    for (let w = 1; w <= 16; w += 1) {
      expect(titles(rotateGroupRides(w, {}))).not.toContain('Rapha Mid Week Shuffle');
    }
  });

  it('caps at three and keeps the two-hard-plus-one-easy shape', () => {
    for (let w = 1; w <= 16; w += 1) {
      const t = titles(rotateGroupRides(w, {}));
      expect(t.length).toBeLessThanOrEqual(3);
      if (t.length === 3) expect(t).toContain('Duck Fleet Recovery Laps');
    }
  });

  it('drops Monday after a big Sunday, and does not backfill a third tempo ride', () => {
    const r = rotateGroupRides(2, { sundayConflict: true, lastThirdRide: 'Rapha Thursday Night Delight' });
    expect(titles(r)).not.toContain('Duck Fleet Recovery Laps');
    expect(titles(r).length).toBe(2);
    expect(r.notes.join(' ')).toMatch(/big Sunday/i);
  });

  it('drops Monday when the Sunday bedtime slipped', () => {
    const r = rotateGroupRides(2, { sundayBedtimeMissed: true });
    expect(titles(r)).not.toContain('Duck Fleet Recovery Laps');
  });

  it('strips the extras on a recovery week but keeps Good Guys', () => {
    const r = rotateGroupRides(4, {});
    expect(titles(r)).toEqual(['Good Guys Night Laps']);
  });

  it('substitutes Rapha Tuesday Sunset only when Good Guys is cancelled', () => {
    const r = rotateGroupRides(2, { goodGuysCancelled: true });
    expect(titles(r)).toContain('Rapha Tuesday Sunset');
    expect(titles(r)).not.toContain('Good Guys Night Laps');
  });
});

describe('week generation', () => {
  const plan = generateWeek(2, { lastThirdRide: 'Rapha Thursday Night Delight' });

  it('starts on the right Monday', () => expect(plan.monday).toBe('2026-08-24'));

  it('clears the block floor', () => {
    expect(plan.totals.clearsFloor).toBe(true);
    expect(plan.totals.bikeMi).toBeGreaterThanOrEqual(plan.targets.floor);
  });

  it('keeps Sunday on the calendar as the priority session', () => {
    const sun = plan.sessions.find((s) => s.name === 'Sunday Ride');
    expect(sun).toBeTruthy();
    expect(sun.isPriority).toBe(true);
  });

  it('only adds the Friday contingency when Thursday is the group ride', () => {
    const withThursday = generateWeek(3, { lastThirdRide: 'Duck Fleet Coffee Laps' });
    expect(withThursday.sessions.some((s) => s.contingency)).toBe(true);
    expect(plan.sessions.some((s) => s.contingency)).toBe(false);
  });

  it('never rolls missed volume forward — the target drives the numbers', () => {
    const clean = generateWeek(2, { lastThirdRide: 'Rapha Thursday Night Delight' });
    const afterDisaster = generateWeek(2, {
      lastThirdRide: 'Rapha Thursday Night Delight',
    });
    expect(afterDisaster.totals.bikeMi).toBe(clean.totals.bikeMi);
  });

  it('lets Saturday absorb the group-ride overflow rather than Sunday', () => {
    const sat = plan.sessions.find((s) => s.name === 'Long Ride');
    expect(sat.distanceMi).toBeGreaterThanOrEqual(15);
    expect(sat.distanceMi).toBeLessThanOrEqual(45);
  });

  it('holds frequency on a recovery week while cutting volume', () => {
    const rec = generateWeek(4, {});
    expect(rec.totals.bikeMi).toBeLessThan(plan.totals.bikeMi);
    expect(rec.sessions.filter((s) => s.discipline === 'bike').length).toBeGreaterThanOrEqual(4);
  });
});

describe('day designations', () => {
  it('never puts a protected evening on a morning-ride day', () => {
    const plan = generateWeek(2, { lastThirdRide: 'Rapha Thursday Night Delight' });
    const d = designateDays(plan.sessions);
    // Monday has the 6:25am group ride, so it must be LATE OK, not EARLY OUT.
    expect(d[1]).toBe('LATE OK');
    expect(d[1]).not.toBe('EARLY OUT');
  });

  it('marks Wednesday and Friday as WFH', () => {
    const d = designateDays([]);
    expect(d[3]).toBe('WFH');
    expect(d[5]).toBe('WFH');
  });
});

describe('calendar event payloads', () => {
  const events = toCalendarEvents(generateWeek(2, { lastThirdRide: 'Rapha Thursday Night Delight' }));

  it('uses no emojis anywhere', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const e of events) {
      expect(emoji.test(e.summary)).toBe(false);
      expect(emoji.test(e.description)).toBe(false);
    }
  });

  it('uses no HTML — the connector escapes it', () => {
    for (const e of events) expect(e.description).not.toMatch(/<[a-z/]/i);
  });

  it('leads with a bulleted timeline under a plan header', () => {
    for (const e of events) {
      expect(e.description).toMatch(/^WEEK \d+ · BLOCK \d+/);
      expect(e.description).toMatch(/\n- /);
    }
  });

  it('round-trips back through the parser', () => {
    const parsed = parseEvents(events.map((e, i) => ({
      ...e, id: `gen-${i}`, status: 'confirmed',
      start: { dateTime: e.start.dateTime }, end: { dateTime: e.end.dateTime },
    })));
    expect(parsed.sessions.length).toBe(events.length);
    expect(parsed.sessions.filter((s) => s.isGroupRide).length).toBe(3);
  });

  it('marks the contingency free so it does not count as planned volume', () => {
    const withThursday = toCalendarEvents(generateWeek(3, { lastThirdRide: 'Duck Fleet Coffee Laps' }));
    const c = withThursday.find((e) => /CONTINGENCY ONLY/.test(e.summary));
    expect(c.transparency).toBe('transparent');
  });
});

describe('reconciliation', () => {
  const activities = [
    { id: 1, date: '2026-08-17', discipline: 'bike', distanceMi: 29.4, name: 'Duck Fleet', url: 'u1' },
    { id: 2, date: '2026-08-18', discipline: 'bike', distanceMi: 38.9, name: 'Good Guys', url: 'u2' },
    { id: 3, date: '2026-08-22', discipline: 'bike', distanceMi: 41.0, name: 'Gravel blowout', url: 'u3' },
    { id: 4, date: '2026-08-19', discipline: 'run', distanceMi: 2.1, name: 'Run', url: 'u4' },
  ];
  const rec = reconcile(week, activities);
  const card = buildScorecard(week, rec);

  it('matches same-day, same-discipline activities', () => {
    const m = rec.matches.find((x) => x.session.name === 'Duck Fleet Recovery Laps');
    expect(m.status).toBe('done');
    expect(m.activity.id).toBe(1);
  });

  it('calls a short ride partial rather than done', () => {
    const sat = rec.matches.find((x) => x.session.name === 'Long Ride');
    expect(sat.activity.id).toBe(3);
    expect(sat.status).toBe('done'); // 41 of 20 planned, over not under
    const gg = reconcile(week, [{ id: 9, date: '2026-08-18', discipline: 'bike', distanceMi: 12 }]);
    expect(gg.matches.find((x) => x.session.name === 'Good Guys Night Laps').status).toBe('partial');
  });

  it('counts missed sessions and names the group rides among them', () => {
    expect(card.missed.some((m) => m.name === 'Rapha Thursday Night Delight' && m.isGroupRide)).toBe(true);
    expect(card.groupRidesDone).toBe(2);
    expect(card.groupRidesPlanned).toBe(3);
  });

  it('reports the floor verdict against actual, not planned', () => {
    expect(card.actualBikeMi).toBe(109.3);
    expect(card.clearedFloor).toBe(false);
    expect(card.floor).toBe(120);
  });
});

describe('card edits', () => {
  const s = week.sessions.find((x) => x.name === 'Duck Fleet Recovery Laps');

  it('rewrites the title when distance or duration changes', () => {
    expect(retitle(s.title, { distanceMi: 24, durationMin: 95 }))
      .toBe('Duck Fleet Recovery Laps — 24 mi / 1:35 · RPE 3 · CENTRAL PARK');
  });

  it('writes status into the description without touching the body', () => {
    const patch = buildPatch(s, { meta: { status: 'skipped', why: 'raced Sunday' } });
    expect(patch.description).toContain('30 mi total = 12 transit + 18 laps.');
    expect(patch.description).toContain('status=skipped');
    expect(patch.transparency).toBe('transparent');
  });

  it('moves the end time with the start time', () => {
    const patch = buildPatch(s, { startTime: '06:15' });
    expect(patch.start.dateTime).toBe('2026-08-17T06:15:00-04:00');
    expect(new Date(patch.end.dateTime) - new Date(patch.start.dateTime)).toBe(150 * 60000);
  });
});

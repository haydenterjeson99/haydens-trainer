import { describe, it, expect } from 'vitest';
import { parseEvents, classify, sessionNameOf } from '../src/lib/parse.js';
import { summarise, floorScenarios, goodGuysParkFor, weekNumberFor, targetsFor } from '../src/lib/week.js';
import { parseMeta, withMeta, stripMeta } from '../src/lib/meta.js';
import { WEEK_01_EVENTS } from './fixtures/week-01.js';

const model = parseEvents(WEEK_01_EVENTS);
const week = summarise(model, '2026-08-17');

describe('classification', () => {
  it('keeps the nine planned sessions and nothing else', () => {
    expect(model.sessions).toHaveLength(9);
  });

  it('skips daily summaries, sleep blocks and the weekly review', () => {
    expect(classify({ summary: 'MON: Duck Fleet Recovery Laps 30 mi' })).toBe('summary');
    expect(classify({ summary: 'Sleep — lights out 10:45pm, wake 7:00am (8h15)' })).toBe('sleep');
    expect(classify({ summary: 'Weekly Plan Review — Week 1 to Week 2' })).toBe('review');
  });

  it('does not mistake a daily summary for a session even though it names one', () => {
    expect(sessionNameOf('MON: Duck Fleet Recovery Laps 30 mi, 6:25am CENTRAL')).toBeNull();
  });

  it('treats a synced Strava club event as its own category', () => {
    expect(model.imported).toHaveLength(1);
    expect(model.imported[0].name).toBe('DAS HEISSE RENNEN Good Guys Racing');
    expect(model.imported[0].distanceMi).toBe(64);
    expect(model.imported[0].elevationFt).toBe(3969);
  });

  it('detects group rides by title, not colorId', () => {
    // colorId 6 is used for both group rides and the Sunday priority session.
    const sunday = model.sessions.find((s) => s.name === 'Sunday Ride');
    const duckFleet = model.sessions.find((s) => s.name === 'Duck Fleet Recovery Laps');
    expect(sunday.colorId).toBe('6');
    expect(duckFleet.colorId).toBe('6');
    expect(sunday.isGroupRide).toBe(false);
    expect(duckFleet.isGroupRide).toBe(true);
  });
});

describe('session fields', () => {
  const s = model.sessions.find((x) => x.name === 'Duck Fleet Recovery Laps');

  it('reads distance, duration and RPE out of the title', () => {
    expect(s.distanceMi).toBe(30);
    expect(s.durationMin).toBe(124);
    expect(s.rpe).toEqual({ lo: 3, hi: 3 });
  });

  it('splits transit from lap miles', () => {
    expect(s.transitMi).toBe(12);
    expect(s.lapMi).toBe(18);
  });

  it('falls back to the park when a description has no split line', () => {
    const gg = model.sessions.find((x) => x.name === 'Good Guys Night Laps');
    expect(gg.transitMi).toBe(12); // Central, 6 mi each way
    expect(gg.lapMi).toBe(27);
  });

  it('treats a ride with no park as starting at the door', () => {
    const long = model.sessions.find((x) => x.name === 'Long Ride');
    expect(long.transitMi).toBe(0);
    expect(long.lapMi).toBe(20);
  });

  it('bands by RPE', () => {
    const band = (n) => model.sessions.find((x) => x.name === n).band;
    expect(band('Good Guys Night Laps')).toBe('hard');
    expect(band('Rapha Thursday Night Delight')).toBe('tempo');
    expect(band('Recovery Spin')).toBe('easy');
    expect(band('Easy Run')).toBe('run');
  });

  it('marks the contingency ride and keeps it out of planned volume', () => {
    const c = model.sessions.find((x) => x.name === 'Endurance Ride');
    expect(c.contingency).toBe(true);
    expect(c.countsAsPlanned).toBe(false);
  });
});

describe('week roll-up reproduces the plan', () => {
  it('158 bike miles', () => expect(week.bikeMi).toBe(158));
  it('4 run miles', () => expect(week.runMi).toBe(4));
  it('118 weekday / 40 weekend', () => {
    expect(week.weekdayMi).toBe(118);
    expect(week.weekendMi).toBe(40);
  });
  it('52 transit miles, 33% of volume', () => {
    expect(week.transitMi).toBe(52);
    expect(week.lapMi).toBe(106);
    expect(Math.round(week.transitShare * 100)).toBe(33);
  });
  it('75 miles tempo or harder, 47%', () => {
    expect(week.bandMi.tempo + week.bandMi.hard).toBe(75);
    expect(Math.round(week.hardShare * 100)).toBe(47);
  });
  it('three group rides', () => expect(week.groupRides.total).toBe(3));
  it('excludes the 16-mile contingency', () => expect(week.contingencyMi).toBe(16));
});

describe('block identity', () => {
  it('places 17 Aug in Block 1 Week 1', () => {
    expect(weekNumberFor('2026-08-17')).toBe(1);
    const t = targetsFor(1);
    expect(t.block).toBe(1);
    expect(t.floor).toBe(120);
    expect(t.target).toBe(140);
    expect(t.runTarget).toBe(4);
  });

  it('drops volume on the recovery week without changing the block', () => {
    const t = targetsFor(4);
    expect(t.isRecoveryWeek).toBe(true);
    expect(t.floor).toBe(84);
    expect(t.target).toBe(98);
  });

  it('shows the current block, not the 200 endpoint', () => {
    expect(targetsFor(5).target).toBe(165);
    expect(targetsFor(13).target).toBe(200);
  });
});

describe('Good Guys park alternation', () => {
  it('follows the 11 Aug 2026 Prospect anchor', () => {
    expect(goodGuysParkFor('2026-08-11')).toBe('prospect');
    expect(goodGuysParkFor('2026-08-18')).toBe('central');
    expect(goodGuysParkFor('2026-08-25')).toBe('prospect');
    expect(goodGuysParkFor('2026-09-01')).toBe('central');
  });
});

describe('floor scenarios', () => {
  const s = floorScenarios(week);
  const without = (n) => s.find((x) => x.name === n).without;

  it('matches the plan table', () => {
    expect(without('Rapha Thursday Night Delight')).toBe(122);
    expect(without('Duck Fleet Recovery Laps')).toBe(128);
    expect(without('Good Guys Night Laps')).toBe(119);
  });

  it('leaves no single group ride load-bearing', () => {
    const groups = s.filter((x) => ['Duck Fleet Recovery Laps', 'Rapha Thursday Night Delight'].includes(x.name));
    expect(groups.every((x) => x.clearsFloor)).toBe(true);
  });
});

describe('meta round-trip', () => {
  it('survives newlines and leaves the human body alone', () => {
    const body = 'WEEK 1 · BLOCK 1\n\n- Roll out: 5:55am\n\nRoute: —';
    const out = withMeta(body, { status: 'skipped', note: 'work ran long\nrain too', why: 'Late meeting' });
    expect(stripMeta(out)).toBe(body);
    const m = parseMeta(out);
    expect(m.status).toBe('skipped');
    expect(m.note).toBe('work ran long\nrain too');
    expect(m.why).toBe('Late meeting');
  });

  it('defaults cleanly when there is no block', () => {
    expect(parseMeta('just a description').status).toBe('planned');
  });

  it('replaces rather than stacks on repeated saves', () => {
    let d = withMeta('body', { status: 'done' });
    d = withMeta(d, { status: 'skipped' });
    expect((d.match(/\[trainer\]/g) || []).length).toBe(1);
    expect(parseMeta(d).status).toBe('skipped');
  });
});

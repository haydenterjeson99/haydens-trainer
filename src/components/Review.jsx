import React, { useState } from 'react';
import { reconcile, buildScorecard, generateWeek, toCalendarEvents } from '../lib/review.js';
import { stravaActivities, summariseWeek, proxyConfigured } from '../lib/proxy.js';
import { addDays } from '../lib/week.js';
import { PARKS } from '../config.js';

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isoDayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const n = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return n === 0 ? 7 : n;
}

export default function Review({ week, onWriteWeek }) {
  const [step, setStep] = useState('idle');
  const [result, setResult] = useState(null);
  const [prose, setProse] = useState('');
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // The Sunday-night bedtime is the single point of failure for the Monday ride,
  // so it is tracked explicitly rather than inferred.
  const [bedtimeHit, setBedtimeHit] = useState(true);
  const [sundayConflict, setSundayConflict] = useState(week.imported.some((i) => isoDayOf(i.date) === 7));

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      let activities = [];
      let usedStrava = false;
      if (proxyConfigured()) {
        try {
          activities = await stravaActivities({
            after: `${week.weekStart}T00:00:00`,
            before: `${addDays(week.weekEnd, 1)}T00:00:00`,
          });
          usedStrava = true;
        } catch (err) {
          // Strava is best-effort. The cards carry enough to score the week.
          setError(`${err.message} Scoring from the cards instead.`);
        }
      }
      const rec = reconcile(week, activities);
      const card = buildScorecard(week, rec);
      setResult({ ...rec, card, usedStrava });
      setStep('scored');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const explain = async () => {
    setBusy(true);
    setError(null);
    try {
      const notes = week.sessions
        .filter((s) => s.meta.note || s.meta.why)
        .map((s) => ({ session: s.name, date: s.date, status: s.meta.status, note: s.meta.note, why: s.meta.why }));
      const text = await summariseWeek({
        scorecard: { ...result.card, sundayBedtimeHit: bedtimeHit },
        notes,
      });
      setProse(text);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const build = () => {
    setError(null);
    try {
      const lastThird = week.sessions.find((s) => s.name === 'Rapha Thursday Night Delight')
        ? 'Rapha Thursday Night Delight'
        : week.sessions.find((s) => s.name === 'Duck Fleet Coffee Laps')
          ? 'Duck Fleet Coffee Laps'
          : null;
      setPlan(generateWeek(week.weekNumber + 1, {
        lastThirdRide: lastThird,
        sundayConflict,
        sundayBedtimeMissed: !bedtimeHit,
      }));
      setStep('planned');
    } catch (err) {
      setError(err.message);
    }
  };

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      await onWriteWeek(toCalendarEvents(plan));
      setStep('written');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const c = result?.card;

  return (
    <section className="review">
      <h2>Weekly review</h2>
      <p className="quiet">
        Sunday 6:00pm. Score the week, then generate the next one. Missed volume never rolls forward.
      </p>

      <div className="review-toggles">
        <label className="check">
          <input type="checkbox" checked={bedtimeHit} onChange={(e) => setBedtimeHit(e.target.checked)} />
          Sunday lights-out held (10:00pm)
        </label>
        <label className="check">
          <input type="checkbox" checked={sundayConflict} onChange={(e) => setSundayConflict(e.target.checked)} />
          Big Sunday — race or long day
        </label>
      </div>

      {step === 'idle' && (
        <button className="btn btn-primary" onClick={run} disabled={busy}>
          {busy ? 'Reading the week' : 'Run the review'}
        </button>
      )}

      {c && (
        <div className="scorecard">
          <div className={`verdict ${c.clearedFloor ? 'good' : 'bad'}`}>
            {c.clearedFloor
              ? `Cleared the floor — ${c.actualBikeMi} mi against ${c.floor}.`
              : `Under the floor — ${c.actualBikeMi} mi against ${c.floor}.`}
          </div>
          {!result.usedStrava && (
            <p className="quiet small">
              Strava proxy not configured, so actuals come from what you marked on the cards.
            </p>
          )}
          <table className="score-table">
            <tbody>
              <tr><td>Bike</td><td>{c.actualBikeMi} / {c.plannedBikeMi} mi</td></tr>
              <tr><td>Weekday</td><td>{c.weekdayActual} / {c.weekdayPlanned} mi</td></tr>
              <tr><td>Run</td><td>{c.actualRunMi} / {c.plannedRunMi} mi</td></tr>
              <tr><td>Sessions</td><td>{c.sessionsDone} / {c.sessionsPlanned}</td></tr>
              <tr className="row-key">
                <td>Group rides</td>
                <td>{c.groupRidesDone} / {c.groupRidesPlanned}</td>
              </tr>
              <tr><td>Sunday bedtime</td><td>{bedtimeHit ? 'held' : 'missed'}</td></tr>
            </tbody>
          </table>

          {c.missed.length > 0 && (
            <div className="missed">
              <h3>Missed</h3>
              <ul>
                {c.missed.map((m) => (
                  <li key={`${m.name}-${m.date}`}>
                    <strong>{DAY[isoDayOf(m.date)]} {m.name}</strong> — {m.mi} mi
                    {m.isGroupRide && <span className="tag tag-group">Group</span>}
                    {m.why && <div className="quiet">{m.why}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {c.unplanned.length > 0 && (
            <div className="missed">
              <h3>Unplanned riding</h3>
              <ul>
                {c.unplanned.map((u) => (
                  <li key={u.url}>{DAY[isoDayOf(u.date)]} {u.name} — {u.mi} mi</li>
                ))}
              </ul>
            </div>
          )}

          {proxyConfigured() && (
            <div className="explain-row">
              <button className="btn btn-quiet" onClick={explain} disabled={busy}>
                {busy ? 'Thinking' : 'Read the week'}
              </button>
              {prose && <p className="why">{prose}</p>}
            </div>
          )}

          {step === 'scored' && (
            <button className="btn btn-primary" onClick={build}>
              Generate Week {week.weekNumber + 1}
            </button>
          )}
        </div>
      )}

      {plan && (
        <div className="plan-preview">
          <h3>Week {plan.weekNumber} · Block {plan.targets.block}</h3>
          <p className="quiet">
            {plan.totals.bikeMi} bike mi / {plan.totals.runMi} run mi · floor {plan.targets.floor} · target {plan.targets.target}
            {plan.totals.overTarget > 0 && ` · ${plan.totals.overTarget} over target`}
          </p>
          <ul className="rotation-notes">
            {plan.rotation.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
          <ul className="plan-list">
            {plan.sessions.map((s) => (
              <li key={`${s.name}-${s.date}`} className={s.contingency ? 'quiet' : ''}>
                <span className="plan-day">{DAY[isoDayOf(s.date)]}</span>
                <span className="plan-name">
                  {s.name}
                  {s.isGroupRide && <span className="tag tag-group">Group</span>}
                </span>
                <span className="plan-mi">{s.distanceMi} mi</span>
                <span className="quiet">{s.park ? PARKS[s.park].name : 'from the door'}</span>
              </li>
            ))}
          </ul>
          {step === 'planned' && (
            <button className="btn btn-primary" onClick={write} disabled={busy}>
              {busy ? 'Writing' : `Write ${plan.sessions.length} events to Training`}
            </button>
          )}
          {step === 'written' && <p className="good">Written to the Training calendar.</p>}
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}

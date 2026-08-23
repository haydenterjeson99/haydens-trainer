import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Summary from './components/Summary.jsx';
import Card from './components/Card.jsx';
import Review from './components/Review.jsx';
import * as gcal from './lib/gcal.js';
import { parseEvents } from './lib/parse.js';
import { summarise, mondayOf, addDays, todayISO, floorScenarios } from './lib/week.js';
import { buildPatch } from './lib/edit.js';
import { summariseNote, proxyConfigured } from './lib/proxy.js';
import { loadPrefs, savePrefs } from './lib/storage.js';
import { GOOGLE_CLIENT_ID, CALENDAR_ID } from './config.js';

const DAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function isoDayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const n = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return n === 0 ? 7 : n;
}

function fmtRange(a, b) {
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const f = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', opts);
  return `${f(a)} – ${f(b)}`;
}

export default function App() {
  const [signedIn, setSignedIn] = useState(gcal.isSignedIn());
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO()));
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [tab, setTab] = useState('week');

  useEffect(() => gcal.onAuthChange(setSignedIn), []);
  useEffect(() => savePrefs(prefs), [prefs]);

  const configured = GOOGLE_CLIENT_ID && CALENDAR_ID;

  const load = useCallback(async () => {
    if (!signedIn) return;
    setLoading(true);
    setError(null);
    try {
      const events = await gcal.listEvents(gcal.weekWindow(weekStart));
      setModel(parseEvents(events));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [signedIn, weekStart]);

  useEffect(() => { load(); }, [load]);

  const week = useMemo(
    () => (model ? summarise(model, weekStart) : null),
    [model, weekStart],
  );

  const signIn = async () => {
    setError(null);
    try {
      await gcal.signIn(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const onSave = async (session, edits) => {
    setBusyId(session.id);
    try {
      await gcal.patchEvent(session.id, buildPatch(session, edits));
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const onSummarise = async (session, note) => summariseNote({
    session,
    note,
    weekContext: week
      ? {
        weekNumber: week.weekNumber,
        floor: week.targets?.floor,
        plannedMi: week.bikeMi,
        groupRides: `${week.groupRides.done} of ${week.groupRides.total}`,
      }
      : null,
  });

  const onWriteWeek = async (events) => {
    for (const ev of events) {
      // Sequential on purpose: Calendar rate-limits bursts, and a half-written
      // week is worse than a slow one.
      try {
        await gcal.insertEvent(ev);
      } catch (err) {
        // Each event carries a deterministic iCalUID, so Google refuses one that
        // is already on the calendar. That is a retry after a failed write
        // finding its own earlier work, not an error — skip it and carry on.
        if (err.status !== 409) throw err;
      }
    }
  };

  if (!configured) {
    return (
      <main className="shell">
        <h1>Trainer</h1>
        <p className="error">
          Not configured. Set VITE_GOOGLE_CLIENT_ID and VITE_CALENDAR_ID, then rebuild. See the README.
        </p>
      </main>
    );
  }

  if (!signedIn) {
    return (
      <main className="shell centered">
        <h1>Trainer</h1>
        <p className="quiet">Block 1 — the only question on Sunday is whether you cleared the floor.</p>
        <button className="btn btn-primary" onClick={signIn}>Connect Google Calendar</button>
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  const byDay = {};
  if (week) {
    for (const s of week.sessions) (byDay[isoDayOf(s.date)] ||= []).push(s);
    for (const i of week.imported) (byDay[isoDayOf(i.date)] ||= []).push(i);
  }

  const scenarios = week ? floorScenarios(week) : [];

  return (
    <main className="shell">
      <header className="top">
        <div className="weeknav">
          <button className="nav" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">‹</button>
          <div className="weeknav-label">
            <div className="weeknav-title">Week {week?.weekNumber ?? '-'}</div>
            <div className="quiet">{fmtRange(weekStart, addDays(weekStart, 6))}</div>
          </div>
          <button className="nav" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">›</button>
        </div>
        <div className="tabs">
          <button className={tab === 'week' ? 'on' : ''} onClick={() => setTab('week')}>Week</button>
          <button className={tab === 'review' ? 'on' : ''} onClick={() => setTab('review')}>Review</button>
        </div>
      </header>

      {loading && <p className="quiet">Loading</p>}
      {error && <p className="error">{error}</p>}

      {week && tab === 'week' && (
        <>
          <Summary week={week} />

          {week.imported.length > 0 && (
            <div className="conflict">
              <div className="conflict-head">Unplanned event on this calendar</div>
              {week.imported.map((i) => (
                <div key={i.id} className="conflict-body">
                  <strong>{i.name}</strong>
                  <div className="quiet">
                    {DAY[isoDayOf(i.date)]}
                    {i.distanceMi ? ` · ~${i.distanceMi} mi` : ''}
                    {i.elevationFt ? ` · ~${i.elevationFt} ft` : ''}
                  </div>
                  <p className="small">
                    Synced club event, not a planned session. It does not count toward planned volume,
                    but it will cost you the same legs.
                  </p>
                  {i.stravaUrl && <a href={i.stravaUrl} target="_blank" rel="noreferrer">Event on Strava</a>}
                </div>
              ))}
            </div>
          )}

          <div className="days">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <section key={d} className="day">
                <h2 className="day-head">{DAY[d]}</h2>
                {(byDay[d] || []).length === 0 && <p className="rest quiet">Rest</p>}
                {(byDay[d] || []).map((item) => (
                  item.kind === 'imported' ? (
                    <article key={item.id} className="card card-imported">
                      <div className="card-head static">
                        <div className="card-main">
                          <div className="card-title">
                            {item.name}
                            <span className="tag tag-imported">Not planned</span>
                          </div>
                          <div className="card-meta">
                            {item.distanceMi && <span>~{item.distanceMi} mi</span>}
                            {item.elevationFt && <span>~{item.elevationFt} ft</span>}
                          </div>
                        </div>
                      </div>
                    </article>
                  ) : (
                    <Card
                      key={item.id}
                      session={item}
                      expanded={prefs.expandedId === item.id}
                      busy={busyId === item.id}
                      onToggle={() => setPrefs((p) => ({ ...p, expandedId: p.expandedId === item.id ? null : item.id }))}
                      onSave={onSave}
                      onSummarise={onSummarise}
                    />
                  )
                ))}
              </section>
            ))}
          </div>

          {scenarios.length > 0 && (
            <section className="scenarios">
              <h2>If you drop one</h2>
              <ul>
                {scenarios.map((s) => (
                  <li key={s.name}>
                    <span>without {s.name}</span>
                    <span className={s.clearsFloor ? 'good' : 'bad'}>
                      {s.without} mi · {s.clearsFloor ? 'clears' : 'below floor'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="quiet small">
                No single session should be load-bearing. If two of these fall below the floor, the week is fragile.
              </p>
            </section>
          )}

          <footer className="foot">
            <label className="check">
              <input
                type="checkbox"
                checked={prefs.showSleep}
                onChange={(e) => setPrefs((p) => ({ ...p, showSleep: e.target.checked }))}
              />
              Show sleep blocks
            </label>
            {prefs.showSleep && (
              <ul className="sleep-list">
                {week.sleep.map((s) => (
                  <li key={s.id}>
                    <span>{DAY[isoDayOf(s.date)]}</span>
                    <span className="quiet">lights out {s.lightsOut} · wake {s.wake} · {s.hours}</span>
                  </li>
                ))}
              </ul>
            )}
            {!proxyConfigured() && (
              <p className="quiet small">Strava proxy not configured — actuals come from the cards.</p>
            )}
            <button className="btn btn-link" onClick={gcal.signOut}>Sign out</button>
          </footer>
        </>
      )}

      {week && tab === 'review' && (
        <Review key={week.weekStart} week={week} onWriteWeek={onWriteWeek} />
      )}
    </main>
  );
}

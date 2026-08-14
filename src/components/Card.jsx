import React, { useState } from 'react';
import { STATUSES } from '../lib/meta.js';
import { proxyConfigured } from '../lib/proxy.js';

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function clock(iso) {
  if (!iso) return '';
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return '';
  const h = Number(m[1]);
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]}${ampm}`;
}

function hhmm(iso) {
  const m = /T(\d{2}:\d{2})/.exec(iso || '');
  return m ? m[1] : '';
}

function isoDayOf(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const n = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return n === 0 ? 7 : n;
}

function hmLabel(mins) {
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

export default function Card({ session: s, expanded, onToggle, onSave, onSummarise, busy }) {
  const [edits, setEdits] = useState({});
  const [note, setNote] = useState(s.meta.note || '');
  const [why, setWhy] = useState(s.meta.why || '');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState(null);

  const set = (k, v) => setEdits((e) => ({ ...e, [k]: v }));
  const status = edits.status ?? s.meta.status;

  const save = async (extra = {}) => {
    setError(null);
    try {
      await onSave(s, {
        startTime: edits.startTime,
        distanceMi: edits.distanceMi != null ? Number(edits.distanceMi) : undefined,
        durationMin: edits.durationMin != null ? Number(edits.durationMin) : undefined,
        body: edits.body,
        meta: {
          status,
          actualMi: edits.actualMi != null ? Number(edits.actualMi) : s.meta.actualMi,
          actualMin: edits.actualMin != null ? Number(edits.actualMin) : s.meta.actualMin,
          note,
          why,
          ...extra,
        },
      });
      setEdits({});
    } catch (err) {
      setError(err.message);
    }
  };

  const explain = async () => {
    setThinking(true);
    setError(null);
    try {
      const text = await onSummarise(s, note);
      setWhy(text);
    } catch (err) {
      setError(err.message);
    } finally {
      setThinking(false);
    }
  };

  return (
    <article className={`card card-${s.band} ${s.contingency ? 'card-contingency' : ''} status-${s.meta.status}`}>
      <button className="card-head" onClick={onToggle} aria-expanded={expanded}>
        <div className="card-when">
          <span className="card-day">{DAY[isoDayOf(s.date)]}</span>
          <span className="card-time">{clock(s.start)}</span>
        </div>
        <div className="card-main">
          <div className="card-title">
            {s.name}
            {s.isGroupRide && <span className="tag tag-group">Group</span>}
            {s.isPriority && <span className="tag tag-priority">Priority</span>}
            {s.contingency && <span className="tag tag-contingency">Contingency</span>}
          </div>
          <div className="card-meta">
            <span>{s.distanceMi} mi</span>
            <span>{hmLabel(s.durationMin)}</span>
            <span>{s.discipline === 'run' ? `${s.pace}/mi` : s.rpe ? `RPE ${s.rpe.lo === s.rpe.hi ? s.rpe.lo : `${s.rpe.lo}-${s.rpe.hi}`}` : ''}</span>
            {s.transitMi > 0 && <span className="quiet">{s.lapMi} lap + {s.transitMi} transit</span>}
          </div>
        </div>
        <div className={`card-status status-chip-${s.meta.status}`}>
          {s.meta.status === 'planned' ? '' : s.meta.status}
        </div>
      </button>

      {expanded && (
        <div className="card-body">
          <div className="field-row">
            <label>
              Status
              <select value={status} onChange={(e) => set('status', e.target.value)}>
                {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </label>
            <label>
              Start
              <input type="time" defaultValue={hhmm(s.start)} onChange={(e) => set('startTime', e.target.value)} />
            </label>
          </div>

          <div className="field-row">
            <label>
              Distance (mi)
              <input type="number" step="0.1" defaultValue={s.distanceMi} onChange={(e) => set('distanceMi', e.target.value)} />
            </label>
            <label>
              Duration (min)
              <input type="number" defaultValue={s.durationMin} onChange={(e) => set('durationMin', e.target.value)} />
            </label>
          </div>

          {(status === 'done' || status === 'partial') && (
            <div className="field-row">
              <label>
                Actual (mi)
                <input type="number" step="0.1" defaultValue={s.meta.actualMi ?? ''} onChange={(e) => set('actualMi', e.target.value)} />
              </label>
              <label>
                Actual (min)
                <input type="number" defaultValue={s.meta.actualMin ?? ''} onChange={(e) => set('actualMin', e.target.value)} />
              </label>
            </div>
          )}

          <label className="field-block">
            What happened
            <textarea
              rows={3}
              placeholder="Rough notes are fine. Work ran late, legs dead from Sunday, rain."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {proxyConfigured() && (
            <div className="explain-row">
              <button className="btn btn-quiet" onClick={explain} disabled={thinking || !note.trim()}>
                {thinking ? 'Thinking' : 'Summarise the cause'}
              </button>
              {why && <p className="why">{why}</p>}
            </div>
          )}

          <details className="raw">
            <summary>Session notes</summary>
            <textarea
              rows={10}
              defaultValue={s.body}
              onChange={(e) => set('body', e.target.value)}
            />
          </details>

          {s.routeUrl && (
            <p className="route"><a href={s.routeUrl} target="_blank" rel="noreferrer">Route</a></p>
          )}

          {error && <p className="error">{error}</p>}

          <div className="card-actions">
            <button className="btn" onClick={() => save()} disabled={busy}>
              {busy ? 'Saving' : 'Save to calendar'}
            </button>
            <button className="btn btn-quiet" onClick={() => save({ status: 'skipped' })} disabled={busy}>
              Mark skipped
            </button>
            {s.htmlLink && (
              <a className="btn btn-link" href={s.htmlLink} target="_blank" rel="noreferrer">Open in Calendar</a>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

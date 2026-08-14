import React from 'react';

const pct = (n) => `${Math.round(n * 100)}%`;

function Bar({ value, max, tone = 'default', floorAt = null }) {
  const width = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const floor = floorAt != null && max ? Math.min(100, (floorAt / max) * 100) : null;
  return (
    <div className={`bar bar-${tone}`}>
      <div className="bar-fill" style={{ width: `${width}%` }} />
      {floor != null && <div className="bar-floor" style={{ left: `${floor}%` }} />}
    </div>
  );
}

function Stat({ label, value, unit, sub, children, size = 'md' }) {
  return (
    <div className={`stat stat-${size}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {children}
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function Summary({ week }) {
  const t = week.targets;
  if (!t) return null;

  const bikeDone = week.completedBikeMi;
  const overGuide = week.hardShare > week.hardShareGuide;

  return (
    <section className="summary">
      <div className="block-head">
        <span className="pill">Block {t.block} · {t.blockName}</span>
        <span className="pill pill-quiet">Week {t.weekOfBlock} of 4</span>
        {t.isRecoveryWeek && <span className="pill pill-warn">Recovery week</span>}
      </div>

      {/* The floor is the only Block 1 metric. It is deliberately the largest
          number on the screen; the target sits under it as context. */}
      <div className="floor-card">
        <div className="floor-top">
          <div className="floor-label">Floor</div>
          <div className="floor-num">{t.floor}<span className="floor-unit">mi</span></div>
        </div>
        <Bar value={bikeDone} max={Math.max(t.target, week.bikeMi)} floorAt={t.floor} tone={bikeDone >= t.floor ? 'good' : 'default'} />
        <div className="floor-foot">
          <span className={bikeDone >= t.floor ? 'good' : ''}>
            {bikeDone} mi ridden
          </span>
          <span className="quiet">
            {bikeDone >= t.floor
              ? `clear by ${Math.round((bikeDone - t.floor) * 10) / 10}`
              : `${Math.round((t.floor - bikeDone) * 10) / 10} to go`}
          </span>
          <span className="quiet">target {t.target} · planned {week.bikeMi}</span>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="Weekday bike" value={week.weekdayMi} unit="mi" sub={`target ${t.weekdayTarget} · weekend ${week.weekendMi}`}>
          <Bar value={week.weekdayMi} max={t.weekdayTarget} />
        </Stat>

        <Stat label="Run" value={week.runMi} unit="mi" sub={`target ${t.runTarget}`}>
          <Bar value={week.completedRunMi} max={t.runTarget} />
        </Stat>

        <Stat label="Sessions" value={`${week.sessionsDone}/${week.sessionsPlanned}`} sub={`${week.hours} h planned`} />

        <Stat label="Group rides" value={`${week.groupRides.done}/${week.groupRides.total}`} sub="the number that predicts the week" />
      </div>

      {/* 33% of volume is transit. A single mileage number hides that. */}
      <div className="split-row">
        <div className="split-head">
          <span>Lap vs transit</span>
          <span className="quiet">{pct(week.transitShare)} transit</span>
        </div>
        <div className="split-bar">
          <div className="seg seg-lap" style={{ flex: week.lapMi || 1 }}>
            <span>{week.lapMi} lap</span>
          </div>
          <div className="seg seg-transit" style={{ flex: week.transitMi || 0.0001 }}>
            <span>{week.transitMi} transit</span>
          </div>
        </div>
        <div className="split-note quiet">Transit is real riding, but it is not the workout.</div>
      </div>

      <div className="split-row">
        <div className="split-head">
          <span>Intensity</span>
          <span className={overGuide ? 'warn' : 'quiet'}>
            {pct(week.hardShare)} tempo or harder{overGuide ? ` · guide is ${pct(week.hardShareGuide)}` : ''}
          </span>
        </div>
        <div className="split-bar">
          <div className="seg seg-easy" style={{ flex: week.bandMi.easy || 0.0001 }}>
            <span>{week.bandMi.easy} easy</span>
          </div>
          <div className="seg seg-tempo" style={{ flex: week.bandMi.tempo || 0.0001 }}>
            <span>{week.bandMi.tempo}</span>
          </div>
          <div className="seg seg-hard" style={{ flex: week.bandMi.hard || 0.0001 }}>
            <span>{week.bandMi.hard}</span>
          </div>
        </div>
        <div className="split-note quiet">Group rides skew this. Everything else stays genuinely easy.</div>
      </div>
    </section>
  );
}

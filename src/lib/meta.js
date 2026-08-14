// The app needs to persist completion state, actuals and miss-notes. It writes
// them into a fenced block at the end of the calendar event description so the
// calendar stays the single source of truth and nothing lives only in the browser.
//
// The human-written body above the fence is never touched.
//
//   [trainer]
//   status=done
//   actualMi=28.4
//   actualMin=118
//   note=got dropped on lap 2\nlegs dead from Sunday
//   why=Sunday race cost Monday's recovery ride
//   [/trainer]

const FENCE = /\n*\[trainer\]\n([\s\S]*?)\n?\[\/trainer\]\s*$/;

export const STATUSES = ['planned', 'done', 'partial', 'skipped', 'moved'];

const DEFAULT_META = {
  status: 'planned',
  actualMi: null,
  actualMin: null,
  note: '',
  why: '',
  stravaId: null,
};

function decode(v) {
  return String(v).replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

function encode(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n');
}

export function parseMeta(description = '') {
  const m = FENCE.exec(description || '');
  if (!m) return { ...DEFAULT_META };
  const out = { ...DEFAULT_META };
  for (const line of m[1].split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const raw = decode(line.slice(eq + 1));
    if (key === 'actualMi' || key === 'actualMin') {
      const n = parseFloat(raw);
      out[key] = Number.isFinite(n) ? n : null;
    } else if (key in out) {
      out[key] = raw;
    }
  }
  if (!STATUSES.includes(out.status)) out.status = 'planned';
  return out;
}

export function stripMeta(description = '') {
  return (description || '').replace(FENCE, '').replace(/\s+$/, '');
}

export function serializeMeta(meta) {
  const m = { ...DEFAULT_META, ...meta };
  const lines = [];
  lines.push(`status=${m.status}`);
  if (m.actualMi != null) lines.push(`actualMi=${m.actualMi}`);
  if (m.actualMin != null) lines.push(`actualMin=${m.actualMin}`);
  if (m.note) lines.push(`note=${encode(m.note)}`);
  if (m.why) lines.push(`why=${encode(m.why)}`);
  if (m.stravaId) lines.push(`stravaId=${m.stravaId}`);
  return `[trainer]\n${lines.join('\n')}\n[/trainer]`;
}

/** Replace (or append) the fenced block, leaving the human body intact. */
export function withMeta(description, meta) {
  const body = stripMeta(description);
  const block = serializeMeta(meta);
  return body ? `${body}\n\n${block}` : block;
}

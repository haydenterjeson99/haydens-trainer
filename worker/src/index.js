/**
 * haydens-trainer-proxy
 *
 * The only server-side piece, and it exists for exactly two reasons:
 *
 *  1. Strava cannot be called from a browser. Its token exchange requires
 *     client_secret and it offers no PKCE, and api.strava.com sends no CORS
 *     headers. Both are hard blocks for a static site.
 *  2. The Anthropic API needs an API key.
 *
 * Every secret lives in Worker env vars. Nothing here is in the public repo.
 *
 * This is deliberately not a general-purpose proxy: the Strava route allows a
 * single read-only endpoint, and the Claude route builds its own prompts, so a
 * leaked Worker URL cannot be turned into a free LLM or a write to the account.
 */

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API = 'https://www.strava.com/api/v3';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

let cachedToken = null;
let cachedExpiry = 0;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!originAllowed(origin, env)) return json({ error: 'Origin not allowed' }, 403, cors);

    const url = new URL(request.url);

    try {
      if (url.pathname === '/strava/activities' && request.method === 'GET') {
        return json(await stravaActivities(url, env), 200, cors);
      }
      if (url.pathname === '/api/claude' && request.method === 'POST') {
        return json(await claude(await request.json(), env), 200, cors);
      }
      if (url.pathname === '/health') {
        return json({ ok: true, strava: Boolean(env.STRAVA_REFRESH_TOKEN), claude: Boolean(env.ANTHROPIC_API_KEY) }, 200, cors);
      }
      return json({ error: 'Not found' }, 404, cors);
    } catch (err) {
      return json({ error: String(err.message || err) }, 502, cors);
    }
  },
};

// --- CORS ------------------------------------------------------------------

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function originAllowed(origin, env) {
  const list = allowedOrigins(env);
  if (list.length === 0) return true; // unset: allow, so /health works before setup
  return list.includes(origin);
}

function corsHeaders(origin, env) {
  const list = allowedOrigins(env);
  const allow = list.length === 0 ? '*' : (list.includes(origin) ? origin : list[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// --- Strava ----------------------------------------------------------------

/**
 * Refresh tokens are long-lived; access tokens last six hours. Caching in the
 * isolate keeps us well inside the 100 req / 15 min limit.
 */
async function stravaAccessToken(env) {
  if (cachedToken && Date.now() < cachedExpiry) return cachedToken;

  for (const k of ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_REFRESH_TOKEN']) {
    if (!env[k]) throw new Error(`${k} is not set on the Worker.`);
  }

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: env.STRAVA_REFRESH_TOKEN,
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed (${res.status}). ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  cachedToken = data.access_token;
  cachedExpiry = (data.expires_at - 120) * 1000;
  return cachedToken;
}

async function stravaActivities(url, env) {
  const token = await stravaAccessToken(env);
  const params = new URLSearchParams({
    after: url.searchParams.get('after') || '0',
    before: url.searchParams.get('before') || String(Math.floor(Date.now() / 1000)),
    per_page: '100',
  });
  const res = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Strava activities failed (${res.status}). ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// --- Claude ----------------------------------------------------------------

const SYSTEM = `You are the analytical layer of a personal endurance training planner for a New York cyclist.

Facts about the plan you must respect:
- The goal of Block 1 is consistency, not volume. The only metric that matters is whether the week cleared its floor.
- His 52-week coefficient of variation is 67%. The failure mode is a huge week followed by a collapsed one.
- Missed volume is NEVER rolled forward. A lost ride is lost.
- Group rides are the strongest predictor of a week holding together, because someone else scheduled them.
- The Sunday-night bedtime is the single point of failure for the Monday morning group ride.

Style rules, absolute:
- No emojis, ever.
- Plain text. No markdown headers, no bold.
- Two or three sentences maximum. This is read on a phone.
- Be specific and causal. Name the mechanism, not the mood.
- Do not be encouraging for its own sake, and do not scold. State what happened and what it costs.`;

async function claude(payload, env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on the Worker.');

  const prompt = buildPrompt(payload);
  if (!prompt) throw new Error('Unknown request kind.');

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-opus-5',
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic call failed (${res.status}). ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { text: (data.content || []).map((c) => c.text || '').join('').trim() };
}

function buildPrompt(p) {
  if (p.kind === 'session-note') {
    const s = p.session || {};
    return [
      'A session did not go to plan. Turn the rough note into one or two sentences naming the actual cause and what it costs the rest of the week.',
      '',
      `Session: ${s.name} on ${s.date}`,
      `Status: ${s.status}`,
      `Planned: ${s.plannedMi} mi${s.actualMi ? `, actual ${s.actualMi} mi` : ''}`,
      `Group ride: ${s.isGroupRide ? 'yes' : 'no'}, intensity band: ${s.band}`,
      p.weekContext ? `Week ${p.weekContext.weekNumber}, floor ${p.weekContext.floor}, planned ${p.weekContext.plannedMi} mi, group rides ${p.weekContext.groupRides}.` : '',
      '',
      `His note: ${String(p.note || '').slice(0, 1200)}`,
    ].filter(Boolean).join('\n');
  }

  if (p.kind === 'week-review') {
    return [
      'Read this week and say what actually happened. Focus on cause: which constraint gave way, and what that predicts for next week. Do not restate the numbers back to him.',
      '',
      JSON.stringify(p.scorecard).slice(0, 3000),
      '',
      'His notes on individual sessions:',
      JSON.stringify(p.notes || []).slice(0, 3000),
    ].join('\n');
  }

  return null;
}

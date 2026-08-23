# Trainer app — outstanding fixes

Handoff written 2026-08-23. Self-contained: a new session needs only this file
and the repo.

**Status, updated 2026-08-23:** Part B is done — all five code fixes are applied
in the working tree, uncommitted. Part A is untouched and is the only thing
still outstanding. Nothing in the app will work end to end until A1-A5 are done,
because the code fixes cannot conjure a Worker URL or the missing secrets.

Repo: `/Users/haydenterjeson/Desktop/haydens-trainer` (GitHub
`haydenterjeson99/haydens-trainer`, deployed to GitHub Pages at
`https://haydenterjeson99.github.io/haydens-trainer/`).

---

## The reported symptom

The Review tab's "Run the review" button failed with:

```
Proxy /strava/activities?after=1786939200&before=1787544000 failed (404).
<!DOCTYPE html> ... <title>Site not found &middot; GitHub Pages</title>
```

**Root cause, confirmed by grepping the deployed bundle:** the GitHub Actions
repository variable `VITE_WORKER_URL` was set to a single space character. In
the shipped JS this appeared as `uo=" ".replace(/\/$/,"")`.

1. `" "` is truthy, so `proxyConfigured()` returned true and the "not set"
   guard in `src/lib/proxy.js:12` was skipped.
2. `fetch(" " + "/strava/activities?...")` — the URL parser strips the leading
   space, leaving a root-relative path.
3. It resolved to `https://haydenterjeson99.github.io/strava/activities?...`,
   which has no Pages site, so GitHub returned its "Site not found" HTML with a
   404. The Cloudflare Worker was never contacted.

---

## Verified infrastructure state (as of this handoff)

The Worker origin is:

```
https://haydens-trainer-proxy.haydenmterjeson.workers.dev
```

(Found in `~/Library/Preferences/.wrangler/logs`.)

Confirmed by direct request:

- Worker is deployed and responding.
- CORS is correct — it returns
  `access-control-allow-origin: https://haydenterjeson99.github.io`, so the
  `ALLOWED_ORIGIN` edit is live on Cloudflare even though `worker/wrangler.toml`
  is still uncommitted locally.
- A bare `curl` with no `Origin` header gets `403 {"error":"Origin not allowed"}`.
  That is correct behavior, not a fault.
- `GET /health` with the right Origin returns `{"ok":true,"strava":false,"claude":false}`.
- `GET /strava/activities` with the right Origin returns
  `{"error":"STRAVA_CLIENT_SECRET is not set on the Worker."}`

So on the Worker: `STRAVA_CLIENT_ID` **is** set. `STRAVA_CLIENT_SECRET`,
`STRAVA_REFRESH_TOKEN`, and `ANTHROPIC_API_KEY` are **not**.

Note: `/health` only checks `STRAVA_REFRESH_TOKEN`, so it can report
`strava:true` while the client secret is still missing. Always confirm with the
activities endpoint, not just `/health`.

---

## Part A — infrastructure (must be done by Hayden, not by Claude)

### A1. Set the repo variable

GitHub repo Settings > Secrets and variables > Actions > **Variables** tab.
Set `VITE_WORKER_URL` to exactly:

```
https://haydens-trainer-proxy.haydenmterjeson.workers.dev
```

Must start with `https://`. No trailing slash. No path. No leading or trailing
whitespace — GitHub preserves it, and that is what caused the original bug.

### A2. Re-run the deploy

Editing a repository variable does **not** trigger a rebuild. The workflow
(`.github/workflows/deploy.yml`) runs only on push to `main` or manual dispatch.

Actions > "Deploy to GitHub Pages" > Run workflow.

Verify the deploy actually shipped a new bundle — the broken one was
`index-CJ9S17wF.js`:

```sh
curl -s https://haydenterjeson99.github.io/haydens-trainer/ | grep -o 'src="[^"]*\.js"'
```

The hash must differ. Then confirm the URL is baked in correctly:

```sh
curl -s https://haydenterjeson99.github.io/haydens-trainer/assets/index-<NEW-HASH>.js | grep -o 'haydens-trainer-proxy[^"]*'
```

### A3. Set the missing Worker secrets

From the `worker/` directory:

```sh
npx wrangler secret put STRAVA_CLIENT_SECRET
```

```sh
npx wrangler secret put ANTHROPIC_API_KEY
```

### A4. STRAVA_REFRESH_TOKEN — read the headwind constraint first

**Do not run `worker/get-refresh-token.sh` without checking this.**

Nothing in this repo can otherwise touch the headwind app: different GitHub
repo, different Pages site, and the Worker is named `haydens-trainer-proxy`, so
`wrangler deploy` and `wrangler secret put` only ever write to that Worker.

The single shared resource is the **Strava API application**. Check the client
ID at <https://www.strava.com/settings/api> against the one headwind uses.

- **Same client ID** — do NOT re-authorize. The authorize URL in
  `worker/GET-STRAVA-REFRESH-TOKEN.md` uses `approval_prompt=force`; exchanging
  a fresh authorization code issues a new refresh token for that athlete+app
  pair and **invalidates the previous one**, so headwind stops refreshing. It
  also requests only `scope=activity:read_all`, and re-authorizing replaces the
  granted scope set, dropping anything else headwind holds (e.g.
  `activity:write`, `profile:read_all`). Instead, reuse headwind's existing
  refresh token — one token works in both places simultaneously:

  ```sh
  npx wrangler secret put STRAVA_REFRESH_TOKEN
  ```

- **Different client ID** — run `get-refresh-token.sh` normally, nothing is at
  risk.

Rate limits are per-application, so sharing one app means sharing a
100-per-15-min / 1000-per-day budget. Not a practical problem: the trainer calls
Strava once per weekly review.

### A5. Verify end to end

```sh
curl -H "Origin: https://haydenterjeson99.github.io" https://haydens-trainer-proxy.haydenmterjeson.workers.dev/health
```

Want `{"ok":true,"strava":true,"claude":true}`. Then:

```sh
curl -H "Origin: https://haydenterjeson99.github.io" "https://haydens-trainer-proxy.haydenmterjeson.workers.dev/strava/activities?after=1786939200&before=1787544000"
```

A JSON array — even an empty one — means it genuinely works.

---

## Part B — code fixes — DONE

All five applied. Details of what actually shipped are under each item; where
the implementation went beyond the sketch below, it is called out.

### B1. `src/config.js` — a blank variable must read as "not set"

Prevents a recurrence of the reported bug. Replace line 8:

```js
export const WORKER_URL = (import.meta.env?.VITE_WORKER_URL ?? '').replace(/\/$/, '');
```

with:

```js
const rawWorkerUrl = (import.meta.env?.VITE_WORKER_URL ?? '').trim().replace(/\/$/, '');
// Blank or whitespace must read as "not set". Anything else resolves relative to
// the Pages origin and 404s against GitHub instead of the Worker.
export const WORKER_URL = /^https?:\/\//.test(rawWorkerUrl) ? rawWorkerUrl : '';
```

### B2. `src/components/Review.jsx` — a Strava failure must not block the review

If `stravaActivities` throws, `run()` bails before `reconcile`, `step` stays
`idle`, and the week cannot be scored at all. Strava should be best-effort.

In `run()`, replace:

```js
      let activities = [];
      if (proxyConfigured()) {
        activities = await stravaActivities({
          after: `${week.weekStart}T00:00:00`,
          before: `${addDays(week.weekEnd, 1)}T00:00:00`,
        });
      }
      const rec = reconcile(week, activities);
      const card = buildScorecard(week, rec);
      setResult({ ...rec, card, usedStrava: proxyConfigured() });
```

with:

```js
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
```

### B3. `src/lib/review.js` — the card fallback does not actually exist

Highest-value fix after the URL. `reconcile` reads only Strava activities and
never looks at `s.meta.status` or `s.meta.actualMi`. With no Strava, every
session scores `skipped` and `actualBikeMi` is 0, so the verdict reads "Under
the floor — 0 mi against 170" even when everything was marked done. Meanwhile
`Review.jsx:134` and the `App.jsx` footer both claim actuals come from the
cards. Today that claim is false — the app misreports the week.

In `reconcile`, replace:

```js
    if (!i) {
      matches.push({ session: s, activity: null, status: 'skipped', ratio: 0 });
      continue;
    }
```

with:

```js
    if (!i) {
      matches.push(fromCard(s));
      continue;
    }
```

Then add directly below `reconcile`:

```js
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
```

### B4. `src/lib/parse.js` — marking a session "skipped" erases the miss

`src/lib/edit.js:71` writes `transparency: 'transparent'` when status is
`skipped`, and `src/lib/parse.js:123` reads any transparent event as a
contingency (`countsAsPlanned: false`). So on reload a skipped ride drops out of
`week.planned`, planned volume silently shrinks, and it vanishes from the missed
list. That inverts the plan's governing rule: the miss must stay visible.

Replace line 123:

```js
  const contingency = /CONTINGENCY ONLY/i.test(summary) || ev.transparency === 'transparent';
```

with:

```js
  const meta = parseMeta(description);
  // A skipped session goes transparent so it stops blocking time. That must not
  // turn it into a contingency, or the miss vanishes from planned volume.
  const contingency = /CONTINGENCY ONLY/i.test(summary)
    || (ev.transparency === 'transparent' && meta.status !== 'skipped');
```

Then in the returned object further down, change
`meta: parseMeta(description),` to just `meta,`.

### B5. Lower priority

- `src/App.jsx:261` — `<Review week={week} />` has no `key`, and Review's
  `sundayConflict` is a one-time `useState` initializer, so arrowing between
  weeks shows the previous week's scorecard with a stale conflict flag. Add
  `key={week.weekStart}`.
- `src/App.jsx:95` — the `insertEvent` loop in `onWriteWeek` has no dedupe. A
  failure partway through followed by a retry writes a duplicate week to the
  Training calendar. Google's `iCalUID` on insert would make re-runs safe.

  Implemented in three pieces, since the sketch only named the idea:

  1. `toCalendarEvents` in `src/lib/review.js` now stamps each event with a
     deterministic `iCalUID` — `ht-w<week>-<yyyymmdd>-<session-slug>@haydens-trainer`
     — plus a counter suffix in the (currently impossible) case of two sessions
     sharing a name and a day, so the second is never silently swallowed.
  2. `call()` in `src/lib/gcal.js` now attaches `err.status` to the thrown error.
     It only carried the status inside the message string before, and matching on
     a substring to decide whether to keep writing would be fragile.
  3. `onWriteWeek` swallows exactly `409` and rethrows everything else. Google
     refuses an insert whose `iCalUID` already exists, so a retry after a
     half-written week finds its own earlier work and skips past it.

  **Known trade-off, by design:** re-running the write for a week that is already
  on the calendar is now a no-op rather than a duplicate — which is the point —
  but it also means a *deliberate* rewrite of the same week will not overwrite
  the events already there. Sessions whose name and date are unchanged keep their
  old distances and times. If you ever want to regenerate a week in place, delete
  that week's events from the Training calendar first.

---

## Verification after the code fixes

Still worth running once node is available:

```sh
npm test
```

Note: node/npm/npx were not available in either session, so `npm test` has still
not been run and no wrangler command was executed. The Part B changes were
instead checked by executing the changed modules under macOS JavaScriptCore
(`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m`):
all five modules parse and load, the card-fallback and skipped-session paths were
exercised against hand-built fixtures and behave as specified, and the generated
iCalUIDs are unique within a week and stable across runs. The existing suite in
`test/` was read and should still pass — the Week 1 fixture carries no `[trainer]`
blocks, so every session's `meta.status` is `planned` and the card fallback
returns exactly the old `skipped` result. Everything in "Verified
infrastructure state" was confirmed over HTTPS with curl; everything in Part B
was confirmed by reading the source, not by running it.

## Files touched, for reference

- `src/config.js` (B1)
- `src/components/Review.jsx` (B2)
- `src/lib/review.js` (B3)
- `src/lib/parse.js` (B4)
- `src/App.jsx` (B5)

Uncommitted at handoff time: `worker/wrangler.toml` (modified — the
`ALLOWED_ORIGIN` fix, already deployed to Cloudflare but not committed),
`worker/get-refresh-token.sh` and `worker/package-lock.json` (untracked).

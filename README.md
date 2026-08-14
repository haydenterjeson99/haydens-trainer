# haydens-trainer

A glance-and-go view of the training week, read from and written back to a Google
Calendar called `Training`. Static React on GitHub Pages, no backend for the app
itself. Phase 4 and 5 of the Automated Endurance Training Planner.

The calendar is the source of truth. Nothing about a session lives only in the
browser — completion, actuals and notes are written back into the event
description, so the same state shows up on every device.

---

## What it does

**Week view.** Summary stats at the top: the block's **floor** as the largest
number on the screen, with the target underneath as context. Clearing the floor
is the only Block 1 metric, so it gets the visual weight. Below it: weekday bike
miles against target, run miles, sessions done, and group rides hit.

**Lap miles and transit miles are shown separately.** Roughly a third of Week 1's
volume is getting to and from the parks. A single mileage number hides that.

**Intensity split** — easy / tempo / hard, with the 80/20 guide called out when
the week runs past it. Group rides skew this hard, so it is worth seeing.

**Workout cards**, one per session, grouped by day. Group rides are flagged
**by title, not colorId** — colorId `6` does double duty for group rides and the
Sunday priority session, so colour is not a reliable signal.

Cards are editable: time, distance, duration, notes, and a status of
planned / done / partial / skipped / moved. **Every edit writes straight back to
Google Calendar.**

**Imported club events are their own category.** A Strava club event synced onto
the calendar (`DAS HEISSE RENNEN  Good Guys Racing`) has no plan metadata and
does not match a session name, so it is not counted as planned volume — but it is
surfaced on the week view, because a 64-mile race should not sit invisibly next
to a 5:30am alarm. Detection: a `strava.com` URL in the description and no
`WEEK n · BLOCK n` header.

**If you drop one** — live floor math showing what the week lands at without each
group ride. If two of them fall below the floor, the week is fragile.

**Review tab** — Phase 5. Pulls the last 7 days from Strava, reconciles against
plan, scores the week, and generates the next one with the group rides rotated.
Missed volume is never rolled forward.

---

## The one piece of server

Strava cannot be called from a static page, for two independent reasons:

1. Its token exchange **requires `client_secret`** and it offers no PKCE, so
   there is no browser-safe OAuth flow.
2. `api.strava.com` **sends no CORS headers**, so even a valid token cannot be
   used from a page.

So there is one Cloudflare Worker (`worker/`), and it also carries the Anthropic
API key for the note summariser. Both keys live in Worker env vars and never
touch this repository. The Worker is deliberately narrow: the Strava route
exposes one read-only endpoint, and the Claude route builds its own prompts
server-side, so a leaked Worker URL cannot become a free LLM or a write to the
Strava account.

Google Calendar needs no proxy — Google Identity Services works with a client ID
alone and the Calendar API sends CORS headers.

---

## Setup

### 1. Google Cloud OAuth client

1. <https://console.cloud.google.com> → new project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **OAuth consent screen** → External. Add yourself as a test user. Leaving it
   in Testing mode is fine; this app only ever uses short-lived access tokens.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
5. Under **Authorised JavaScript origins**, add:
   - `https://YOUR-GITHUB-USERNAME.github.io`
   - `http://localhost:5173`

   Leave **Authorised redirect URIs** empty. The token flow uses `postMessage`,
   not a redirect.
6. Copy the Client ID. It is not a secret and is meant to ship in the bundle.

Scope requested: `https://www.googleapis.com/auth/calendar.events` — events only,
no calendar creation or deletion.

### 2. Cloudflare Worker

```sh
cd worker
npm install
```

Edit `wrangler.toml` and set `ALLOWED_ORIGIN` to your Pages origin.

Get the Strava refresh token — see [`worker/GET-STRAVA-REFRESH-TOKEN.md`](worker/GET-STRAVA-REFRESH-TOKEN.md).
Then push the secrets and deploy:

```sh
npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put STRAVA_REFRESH_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Check it:

```sh
curl https://haydens-trainer-proxy.YOUR-SUBDOMAIN.workers.dev/health
```

The Anthropic key comes from <https://console.anthropic.com>. The summariser
calls are capped at 300 output tokens, so they cost fractions of a cent.

The app runs fine with `VITE_WORKER_URL` unset — Strava and the summariser switch
off, and actuals come from what you mark on the cards.

### 3. Deploy the app

In the repo: **Settings → Pages → Source: GitHub Actions.**

Then **Settings → Secrets and variables → Actions → Variables**, add:

| Variable | Value |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | from step 1 |
| `VITE_CALENDAR_ID` | `3d019ffc...@group.calendar.google.com` |
| `VITE_WORKER_URL` | your Worker URL, or leave unset |

These are **Variables, not Secrets** — none of them are secret, and Actions
Secrets are not available to the build in a way that would help anyway.

Push to `main`. The workflow runs the tests, builds, and deploys.

### 4. Local dev

```sh
npm install
cp .env.example .env.local   # fill in your values
npm run dev                   # http://localhost:5173
npm test
```

---

## How the calendar is parsed

Workout events are the ones whose title starts with a known session name:

`Duck Fleet Recovery Laps`, `Duck Fleet Coffee Laps`, `Good Guys Night Laps`,
`Rapha Thursday Night Delight`, `Rapha Tuesday Sunset`, `Rapha Mid Week Shuffle`,
`Easy Ride`, `Recovery Spin`, `Endurance Ride`, `Long Ride`, `Sunday Ride`,
`Easy Run`.

Title format carries the numbers:

```
Duck Fleet Recovery Laps — 30 mi / 2:04 · RPE 3 · CENTRAL PARK
```

Descriptions carry the transit split:

```
30 mi total = 12 transit + 18 laps.
```

When that line is absent, transit is inferred from the location (Central 12 mi
round trip, Prospect 8) and a session with no park is treated as starting at the
door.

Skipped: `MON:`/`TUE:`/… daily summaries, `Sleep —` blocks, `Weekly Plan Review`.
Sleep blocks are parsed and shown separately behind a toggle, never counted as
sessions. Events marked `CONTINGENCY ONLY` are free/transparent and do not count
toward planned volume.

**No emoji prefixes are used or expected.** They were removed from the calendar.

### App state in event descriptions

The app appends a fenced block at the end of a description and never touches the
human-written body above it:

```
[trainer]
status=done
actualMi=28.4
actualMin=118
note=got dropped on lap 2, legs dead from Sunday
why=Sunday race cost Monday's recovery ride
[/trainer]
```

`localStorage` holds view preferences only.

---

## Group ride rotation

Encoded in `src/lib/review.js` and enforced by tests:

- **Good Guys every week, always.** Park alternates; anchored to 11 Aug 2026 =
  Prospect, so the app computes it rather than assuming.
- **Duck Fleet Monday most weeks.** Dropped automatically on a recovery week,
  after a big Sunday, or when the Sunday 10:00pm lights-out slipped.
- **Plus one of** Thursday Night Delight / Friday Coffee Laps, alternating.
  Never both — 8:45pm home to a 5:05am wake is 6h20.
- **Never** Rapha Mid Week Shuffle.
- **Never more than three, and only as two-hard-plus-one-easy.** If Monday comes
  off, the third ride comes off with it rather than being backfilled with another
  tempo session.

A morning ride and a protected evening never share a day: a late arrival is
repaid with a late departure, so the evening is not actually free.

---

## Tests

```sh
npm test
```

57 tests. The parser suite runs against a fixture captured from the live calendar
and asserts the week reconciles to the plan exactly — 158 bike miles, 4 run, 118
weekday / 40 weekend, 52 transit (33%), 75 tempo-or-harder (47%), three group
rides. The generator suite checks the rotation rules hold for all 16 weeks, that
generated events contain no emojis and no HTML, and that they round-trip back
through the parser.

---

## Known gaps

- **Strava matching is same-day and same-discipline.** A ride logged after
  midnight lands on the wrong day.
- **The Sunday bedtime is a manual toggle** in the review. There is no sleep data
  source.
- **The generator does not know about holidays.** Mon 7 Sep 2026 is Labor Day.
- **Daylight is not modelled.** Sunset moves ~1.5 min/day and kills the Thursday
  evening slot by Block 2; sunrise does the same to the Monday morning slot.
  Both bite around Week 5.

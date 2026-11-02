# Enjoy the Journey 🚙

**Don't just get from A to B — enjoy the journey.**

Enjoy the Journey is a road-trip planner that turns a long drive into days full of great stops.
Tell it where you start, where you're going, what you love doing (disc golf, hikes, breweries,
museums, hot springs…) and where you like to sleep. It splits the drive into days that still make
real progress, finds the best-rated places along each day's route, fits them into a realistic
timeline (meals at mealtime, outdoor stops in daylight, never driving after dark) and ends every
night at a hotel, campground or Airbnb/VRBO.

Then you take over: swap, add, remove, reorder, lock or re-time any stop, and the timeline
re-routes and re-times itself.

---

## Quick start

```bash
cp .env.example .env          # add your Google Maps keys (optional, see below)
docker compose up -d --build
```

Open **http://localhost:3004** (or `http://<server-ip>:3004`).

Without a Google key the app runs in **demo mode**: places, ratings and routes are synthetic, so you
can try the whole flow end to end. Add a key to plan with real places.

| Service | What it does |
| ------- | ------------ |
| `web`   | nginx serving the React app, proxies `/api` to the API. Published on `WEB_PORT` (default `3004`). |
| `api`   | Node.js/Fastify API: the planner, Google Maps integration, trip storage. Internal only. |
| `db`    | PostgreSQL 17 storing trips (named volume `journey-db`). Internal only. |

## Google Maps setup

Yes, you need a Google Maps Platform API key for real data. In the
[Google Cloud console](https://console.cloud.google.com/google/maps-apis):

1. Create (or pick) a project with billing enabled.
2. Enable these APIs:
   - **Places API (New)**: finds activities, restaurants and lodging, with ratings and opening hours
   - **Routes API**: drive times and route geometry
   - **Maps JavaScript API**: the interactive map in the browser
3. Create keys:
   - **Server key** → `GOOGLE_MAPS_API_KEY`. Restrict it to *Places API (New)* and *Routes API*. It never reaches the browser.
   - **Browser key** → `GOOGLE_MAPS_BROWSER_KEY`. Restrict it to *Maps JavaScript API* plus an HTTP-referrer restriction for your site's URL.
     If you leave it empty, the app shows a simplified schematic map instead.
4. Optionally create a **Map ID** (Map Management) → `GOOGLE_MAPS_MAP_ID`. If you don't, Google's `DEMO_MAP_ID` is used.
5. `docker compose up -d` again to pick up the new `.env`.

**Cost notes.** The planner asks Google for ratings and opening hours (that's how it avoids 3-star
restaurants and closed museums), so place searches are billed at the *Text Search Enterprise* SKU.
Typical usage per generated plan:

| Trip | Place searches | Route calls |
| ---- | -------------- | ----------- |
| 1 day, 3 activities | ~5 | ~3 |
| 2 days, 4 activities | ~14 | ~5 |
| 4 days, 4 activities | ~50 | ~9 |

Editing a day costs one route call. "Fresh ideas" / "Re-plan day" cost about one day's worth of
searches. Identical requests are reused for `CACHE_TTL_MINUTES` (default 6 hours), and
`PLANS_PER_HOUR_PER_IP` limits how often plans can be generated. Set a budget alert and quotas in
Google Cloud, and check [current pricing](https://mapsplatform.google.com/pricing/).

## Configuration

All settings are environment variables (see [.env.example](.env.example)):

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `GOOGLE_MAPS_API_KEY` | – | Server key (Places API (New) + Routes API). |
| `GOOGLE_MAPS_BROWSER_KEY` | – | Browser key for the interactive map. |
| `GOOGLE_MAPS_MAP_ID` | `DEMO_MAP_ID` | Map ID for the vector map / advanced markers. |
| `DATA_SOURCE` | `auto` | `auto` (Google if a key is set), `google` or `demo`. |
| `WEB_PORT` | `3004` | Published port for the web app. |
| `POSTGRES_PASSWORD` | – | Database password (internal to the compose network). |
| `CACHE_TTL_MINUTES` | `360` | Reuse identical Google responses for this long (`0` disables). |
| `PLANS_PER_HOUR_PER_IP` | `60` | Rate limit for plan / re-plan / regenerate requests. |
| `LOG_LEVEL` | `info` | API log level. |

> The app has no user accounts. If you expose it to the internet, put it behind authentication
> (for example an access list in nginx-proxy-manager) so nobody can spend your Google quota.

## Using it

**Plan:** origin → destination → activities (at least one) → lodging type (required) → schedule &
pace → review. Activities form a **ranked list** (drag or ↑ ↓ to reorder, most important first).
When a day can't fit everything, the planner goes down the list in order and picks the best-rated
spot it can fit for each. Each activity can be *once per trip*, *2–3 times per trip* (about every other
day, spread across the trip), *once a day* or *up to twice a day*, and has an adjustable "time
there". You can also cap **activities per day** (meals don't count). You can also type in your own activity
(e.g. "bookstores").

**Planning mode** (the trip page):

- **Timeline** for each day: departure, every drive (with built-in fuel/rest breaks), arrival and
  departure for each stop, free-time gaps, sunset, and the night's check-in. Times show in each
  stop's local time zone, and time-zone changes are labelled.
- **Swap** a stop for top-rated alternatives nearby, or search for something specific.
- **Add a stop** anywhere: pick from your activities and meals, search freely ("pie", "hot springs"),
  or look up an exact place you found on Google ("I know where I want to go").
- **Edit** a stop's duration, set a *start no earlier than* time (reservations, tee times), add notes.
- **Reorder, remove, lock.** Locked stops survive regeneration. Anything you edit is locked
  automatically.
- **Change the departure time** for any day.
- **✨ Fresh ideas** replaces a day's unlocked stops with different suggestions. **↻ Re-plan day**
  rebuilds the day around your locked stops.
- **Trip settings** changes any input (route, activities, lodging, pace) and re-plans the whole trip.
- Warnings explain problems in plain language ("Likely closed at 6:10 PM", "You'd be driving after
  dark — sunset is 5:03 PM"), so you can fix them yourself.
- **Add to calendar** (`.ics`) and **Print** for a paper itinerary.
- **Dark mode:** use the ☀️/🌙 switch in the header. It follows your device setting until you pick
  one, then remembers your choice. Printing always uses the light theme.

## How the planner thinks

The planner lives in [apps/api/src/planner](apps/api/src/planner). Every knob is in
[tuning.ts](apps/api/src/planner/tuning.ts), so the algorithm can be adjusted without touching the
logic.

1. **Route & day count:** route origin → destination. Each day gets a driving budget: the smaller
   of your max driving hours and the travel window (start time → arrive-by, or sunset if you avoid
   night driving) minus meals and a minimum amount of fun for your pace. Days = drive ÷ budget.
2. **Nights first, so you make progress:** lodging is chosen near each even split of the drive. It
   picks the best-rated lodging of your type inside a window around that point and penalizes
   deviating from it and detours. For Airbnb/VRBO (which aren't on Google Maps) it finds a good town
   for the night and links Airbnb and VRBO searches for the right dates.
3. **Candidates along each day:** it routes between that day's start and end, then searches *along
   the route* for each activity. It searches for restaurants only where you could plausibly be at
   mealtime. Each place gets a position along the drive and an estimated detour.
4. **Greedy fill with a real timeline:** going down your ranked activity list, it tries the best
   remaining candidate for each activity (highest Bayesian-adjusted rating, shortest detour) and
   keeps it only if the *whole* day still works and the daily activity limit isn't reached:
   - meals start inside their windows (lunch 11–2, dinner 5–8…), at a well-rated restaurant that's
     open, near where you'll be at mealtime;
   - places are open for the entire visit (it will wait a little if they open soon);
   - outdoor activities end before sunset;
   - you reach tonight's lodging by your arrive-by time, and before dark if you chose that;
   - no place is visited twice, and per-day / per-trip activity limits are respected.

   If a stop doesn't fit at its typical length, it tries the shorter length (e.g. 9 holes instead
   of 18). Candidates also earn a bonus for breaking up long stretches of driving, so stops spread
   along the route instead of clustering in the biggest town (usually the one you start from).
5. **Accurate timing:** each final day is routed through all its stops for real drive times, and
   the timeline (including warnings) is computed with the same scheduling code the planner used.
6. **Repair:** planning uses estimated detours (straight-line distance), which can be badly off on
   mountain roads. If the real routing breaks a day (late arrival, closed, after dark), the stop
   whose detour was most underestimated gets its real detour recorded, and the day is re-planned.
   This costs one extra route call per round, up to 2 rounds per day.

## Project structure

```
apps/
  api/                 Fastify API (TypeScript)
    src/planner/       the planning algorithm (tuning.ts = all knobs)
    src/providers/     Google Places/Routes clients, demo data provider, caching
    src/geo/           route profiles, projections, time zones, sunset, opening hours
    src/services/      trip service (create/edit/regenerate/replan), iCalendar export
    src/routes/        HTTP endpoints
    src/db/            Postgres + in-memory trip repositories
    test/              unit, planner-invariant and API tests (vitest)
  web/                 React + Vite single-page app
    src/wizard/        new-trip steps
    src/trip/          timeline, stop cards, swap/add/edit modals, settings
    src/map/           Google map + schematic fallback
packages/
  shared/              domain types, zod schemas, activity catalog, polyline codec
docker/nginx.conf      web server + API proxy
Dockerfile             multi-stage build (targets: api, web); runs the test suites
docker-compose.yml     db + api + web
```

## Development

Requires Node.js 22+.

```bash
npm install
npm run dev         # shared (watch) + API on :4000 (in-memory storage, demo data) + web on :5173
npm test            # API + web test suites
npm run typecheck
```

The API reads the same environment variables. Set `DATABASE_URL` to use Postgres; otherwise trips
are kept in memory.

## Known limitations

- **Airbnb/VRBO** have no public API. Rental nights link to Airbnb and VRBO searches for the chosen
  town and dates.
- Drive times are **traffic-unaware** (typical conditions), plus automatic rest breaks.
- Duration estimates come from the activity catalog (a disc golf round is about 3h; it falls back
  to about 2h). Adjust per stop in planning mode, or change the defaults in
  [catalog.ts](packages/shared/src/catalog.ts).

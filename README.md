# Ireland Weather

An automated Irish weather site: live rain radar, temperature and wind across
Irish towns, current conditions, a 24-hour strip and a 7-day forecast, plus
Met Éireann warnings. Everything updates on its own.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer (the LTS installer is fine
on Windows, Mac or Linux). There are no other dependencies.

```
npm start            # live data, open http://localhost:8080
npm run mock         # made-up data, works offline
npm test             # quick checks
```

Set `PORT` to use a different port. Other devices on your network can reach
the site at `http://<this machine's IP>:8080`.

## Put it online (Render, free)

1. Sign in at [render.com](https://render.com) with GitHub.
2. Choose **New > Web Service** and pick this repository.
3. Settings: Runtime **Node**, Build command `npm install`, Start command
   `npm start`, Instance type **Free**.
4. Create the service. Render sets `PORT` itself and gives you a
   `https://<name>.onrender.com` address; add your own domain later under
   **Settings > Custom Domains**.

Each push to `main` redeploys automatically. Free services sleep after about
15 minutes without visitors, so the first visit after a quiet spell takes
around 30 seconds to wake up; a paid instance avoids that.

## Where the data comes from

| What | Source | Terms |
| --- | --- | --- |
| Forecasts, current conditions | Met Éireann forecast API | CC BY 4.0 plus Met Éireann's condition that public sites also show its warnings |
| Warnings | Met Éireann warnings feed | Shown unchanged, expired ones removed |
| Rain radar | RainViewer (for now) | Free API is personal/educational use only, max zoom 7, last 2 hours |
| Base map | OpenFreeMap (MapLibre) | Free, no key, attribution required |

The server caches everything (forecasts 30 min, town summary 15 min,
warnings and radar 5 min) and keeps serving the last good copy if a source
is briefly down.

**Before going public with ads**, switch radar away from RainViewer. The
plan is to add a Met Éireann radar provider in `lib/radar.js` (their radar
is open data under CC BY 4.0) and set `RADAR_PROVIDER=meteireann`.

## Layout

```
server.js            web server and /api/* routes
lib/metForecast.js   Met Éireann forecast fetch and XML parsing
lib/warnings.js      Met Éireann warnings
lib/radar.js         radar providers (RainViewer today)
lib/towns.js         towns shown on the map
public/              the page itself (HTML, CSS, JS)
test/                tests and mock data
```

Ad slots are already in the page (`.ad-slot`, hidden for now).

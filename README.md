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

The repo includes a `render.yaml`, so Render can set everything up in one go.

1. Sign in at [render.com](https://render.com) with GitHub.
2. Choose **New > Blueprint**, pick this repository and click **Apply**.
   This creates a free Node web service called `irish-weather` (Frankfurt,
   Node 22, `npm install` / `npm start`) and adds the custom domain
   `weather.techx1.com`. Render sets `PORT` itself.
3. At your DNS provider for `techx1.com`, add a record:
   **Type** `CNAME`, **Name/Host** `weather`, **Value/Target**
   `irish-weather.onrender.com` (use the exact `.onrender.com` address
   Render shows), TTL automatic or 300.
4. In Render open the service, **Settings > Custom Domains**, and click
   **Verify** next to `weather.techx1.com`. Render then issues a free HTTPS
   certificate automatically, usually within minutes.

Without the Blueprint: **New > Web Service**, pick the repo, Runtime **Node**,
Build `npm install`, Start `npm start`, Instance type **Free**, then add the
domain under **Settings > Custom Domains**.

Each push to `main` redeploys automatically. Free services sleep after about
15 minutes without visitors, so the first visit after a quiet spell takes
around 30 to 60 seconds to wake up; the Starter instance (about $7/month)
stays awake.

## Where the data comes from

| What | Source | Terms |
| --- | --- | --- |
| Forecasts, current conditions | Met Éireann forecast API | CC BY 4.0 plus Met Éireann's condition that public sites also show its warnings |
| Written forecasts (Ireland and the four provinces: today, tonight, tomorrow) | Met Éireann open data text feeds (`Open_Data/json/National.json`, `Leinster.json`, …) | CC BY 4.0; cached 30 min. If a feed is down, a plainer summary is written from the Met Éireann point forecast for a town in that area, and labelled as such |
| Warnings | Met Éireann warnings feed | Shown unchanged, expired ones removed |
| Rain radar | RainViewer (for now) | Free API is personal/educational use only, max zoom 7, last 2 hours |
| Temperature, wind and cloud map layers, values under the cursor | Open-Meteo, a 0.5° grid of 130 points over Ireland | CC BY 4.0; free API is non-commercial only and counts each point as a call (10,000 a day), cached 30 min |
| Base map | OpenFreeMap "bright" style (MapLibre) | Free, no key, attribution required |
| Town search | Built-in town list, then OpenStreetMap Nominatim | Free, max 1 request a second (the server queues and caches searches for a week) |

The server caches everything (forecasts 30 min, town summary 15 min,
warnings and radar 5 min) and keeps serving the last good copy if a source
is briefly down.

**Before going public with ads**, switch radar away from RainViewer and
move the Open-Meteo grid (`lib/grid.js`) to a paid Open-Meteo plan. The
plan is to add a Met Éireann radar provider in `lib/radar.js` (their radar
is open data under CC BY 4.0) and set `RADAR_PROVIDER=meteireann`.

## Layout

```
server.js            web server and /api/* routes
lib/metForecast.js   Met Éireann forecast fetch and XML parsing
lib/warnings.js      Met Éireann warnings
lib/radar.js         radar providers (RainViewer today)
lib/grid.js          Open-Meteo grid for the temperature, wind and cloud layers
lib/textForecast.js  Met Éireann written forecasts, province lookup, fallback text
lib/towns.js         towns shown on the map, with their province
lib/geocode.js       town search (any place on the island of Ireland)
public/              the page itself (HTML, CSS, JS)
test/                tests and mock data
```

Ad slots are already in the page (`.ad-slot`, hidden for now).

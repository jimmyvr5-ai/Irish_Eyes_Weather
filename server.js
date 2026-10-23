// Irish weather site: serves the front end and a small JSON API that fetches,
// caches and tidies data from Met Éireann and the radar provider.
//
//   node server.js            live data
//   node server.js --mock     made-up data, for working offline

const http = require('http');
const fs = require('fs');
const path = require('path');

const towns = require('./lib/towns');
const { cached } = require('./lib/cache');
const { fetchForecast, parseForecastXml } = require('./lib/metForecast');
const { fetchWarnings, normalise } = require('./lib/warnings');
const { getProvider } = require('./lib/radar');
const geocode = require('./lib/geocode');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MOCK = process.env.MOCK === '1' || process.argv.includes('--mock');
const RADAR_PROVIDER = process.env.RADAR_PROVIDER || 'rainviewer';

const MIN = 60 * 1000;
const PUBLIC_DIR = path.join(__dirname, 'public');

let mock;
if (MOCK) mock = require('./test/mockData');

const loadForecast = (lat, lon) =>
  MOCK ? Promise.resolve(parseForecastXml(mock.forecastXml(lat, lon))) : fetchForecast(lat, lon);
const loadWarnings = () => (MOCK ? Promise.resolve(normalise(mock.warnings())) : fetchWarnings());
const loadPlaces = (q) => (MOCK ? Promise.resolve([]) : geocode.nominatim(q));
const loadRadar = () => (MOCK ? Promise.resolve(mock.radar()) : getProvider(RADAR_PROVIDER)());

function forecastFor(lat, lon) {
  const key = `fc:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return cached(key, 30 * MIN, () => loadForecast(lat, lon));
}

// The hour nearest to now, used as "current conditions".
function currentHour(hourly) {
  const now = Date.now();
  return hourly.reduce(
    (best, h) =>
      !best || Math.abs(Date.parse(h.time) - now) < Math.abs(Date.parse(best.time) - now) ? h : best,
    null
  );
}

// Fetch a few towns at a time so we stay polite to the Met Éireann API.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch (err) {
        console.warn(`[towns] ${items[idx].name}: ${err.message}`);
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

async function townsNow() {
  return cached('towns', 15 * MIN, async () => {
    const rows = await mapLimit(towns, 4, async (t) => {
      const fc = await forecastFor(t.lat, t.lon);
      return { ...t, now: currentHour(fc.hourly) };
    });
    return rows.filter(Boolean);
  });
}

const routes = {
  '/api/towns': async () => townsNow(),
  '/api/warnings': async () => cached('warnings', 5 * MIN, loadWarnings),
  '/api/radar': async () => cached('radar', 5 * MIN, loadRadar),
  // Free-text place search, e.g. /api/search?q=ballyjamesduff
  '/api/search': async (q) => {
    const text = String(q.get('q') || '').trim().slice(0, 80);
    if (text.length < 2) return [];
    const local = geocode.localMatches(text);
    let remote = [];
    try {
      remote = await cached(`geo:${text.toLowerCase()}`, 7 * 24 * 60 * MIN, () => loadPlaces(text));
    } catch (err) {
      console.warn(`[search] ${text}: ${err.message}`);
      if (!local.length) throw Object.assign(new Error('Place search is unavailable just now'), { status: 502 });
    }
    return geocode.dedupe([...local, ...remote]);
  },
  '/api/forecast': async (q) => {
    let lat = parseFloat(q.get('lat'));
    let lon = parseFloat(q.get('lon'));
    const town = towns.find((t) => t.id === q.get('town'));
    if (town) ({ lat, lon } = town);
    // Rough bounding box for the island of Ireland.
    if (!(lat >= 51.2 && lat <= 55.6 && lon >= -11 && lon <= -5.2)) {
      const err = new Error('Location must be in Ireland');
      err.status = 400;
      throw err;
    }
    const fc = await forecastFor(lat, lon);
    return {
      location: town ? town.name : String(q.get('name') || '').slice(0, 80) || null,
      lat,
      lon,
      now: currentHour(fc.hourly),
      hourly: fc.hourly.filter((h) => Date.parse(h.time) >= Date.now() - 60 * MIN).slice(0, 48),
      daily: fc.daily.slice(0, 7),
    };
  },
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = routes[url.pathname];
  if (!route) return serveStatic(req, res, decodeURIComponent(url.pathname));
  try {
    sendJson(res, 200, await route(url.searchParams));
  } catch (err) {
    console.error(`[api] ${url.pathname}: ${err.message}`);
    sendJson(res, err.status || 502, { error: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Irish weather site on http://localhost:${PORT}${MOCK ? ' (mock data)' : ''}`);
    // Warm the cache so the first visitor does not wait.
    townsNow().catch((e) => console.warn(`[warmup] ${e.message}`));
  });
}

module.exports = { server };

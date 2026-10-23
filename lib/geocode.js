// Place search for any town, village or townland on the island of Ireland.
// Known towns from lib/towns.js answer instantly; everything else goes to
// OpenStreetMap's Nominatim, limited to the island and to one request a
// second as its usage policy asks.

const towns = require('./towns');

// Rough bounding box for the island of Ireland (same as the forecast check).
const BOX = { south: 51.2, north: 55.6, west: -11, east: -5.2 };
const inIreland = (lat, lon) => lat >= BOX.south && lat <= BOX.north && lon >= BOX.west && lon <= BOX.east;

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function localMatches(q) {
  const n = norm(q);
  return towns
    .filter((t) => norm(t.name).startsWith(n))
    .map((t) => ({ id: t.id, name: t.name, detail: '', lat: t.lat, lon: t.lon }));
}

// Nominatim allows one request a second; queue calls so we never go faster.
let lastCall = 0;
async function politeFetch(url) {
  const wait = Math.max(0, lastCall + 1100 - Date.now());
  lastCall = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return fetch(url, {
    headers: {
      'User-Agent': 'IrelandWeather/0.1 (https://github.com/jimmyvr5-ai/Irish_Eyes_Weather)',
      'Accept-Language': 'en',
    },
  });
}

// Prefer real settlements over shops, roads and the like.
const PLACE_RANK = { city: 0, town: 1, village: 2, suburb: 3, hamlet: 4, locality: 5, isolated_dwelling: 6 };

async function nominatim(q) {
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '10',
    countrycodes: 'ie,gb',
    viewbox: `${BOX.west},${BOX.north},${BOX.east},${BOX.south}`,
    bounded: '1',
  });
  const res = await politeFetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return parseNominatim(await res.json());
}

function parseNominatim(rows) {
  return rows
    .map((r) => {
      const a = r.address || {};
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      const name = a.city || a.town || a.village || a.hamlet || a.suburb || r.name || String(r.display_name).split(',')[0];
      const county = a.county || a.state_district || a.state || '';
      return { name, detail: county, lat, lon, rank: PLACE_RANK[r.addresstype] ?? 9 };
    })
    .filter((p) => Number.isFinite(p.lat) && inIreland(p.lat, p.lon))
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank, ...p }) => p);
}

// Merge results, dropping near-duplicates (same name within ~5 km).
function dedupe(list) {
  const out = [];
  for (const p of list) {
    const dup = out.some((o) => norm(o.name) === norm(p.name) && Math.abs(o.lat - p.lat) < 0.05 && Math.abs(o.lon - p.lon) < 0.08);
    if (!dup) out.push(p);
  }
  return out.slice(0, 8);
}

module.exports = { nominatim, parseNominatim, localMatches, dedupe, inIreland };

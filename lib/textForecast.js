// Written forecasts: Met Éireann's national forecast and the one for each
// province, from the open data feeds. Each feed is a list of one-key objects:
//   { forecasts: [{ regions: [{ region }, { issued }, { today }, { tonight }, { tomorrow }, { outlook }] }] }
// If the feeds cannot be reached, a plainer forecast is written from the
// Met Éireann point forecast for a town in the area (see fromHourly).

const FEED = 'https://www.met.ie/Open_Data/json';
const PROVINCES = ['Leinster', 'Munster', 'Connacht', 'Ulster'];

const COUNTY_PROVINCE = {
  Carlow: 'Leinster', Dublin: 'Leinster', Kildare: 'Leinster', Kilkenny: 'Leinster', Laois: 'Leinster',
  Longford: 'Leinster', Louth: 'Leinster', Meath: 'Leinster', Offaly: 'Leinster', Westmeath: 'Leinster',
  Wexford: 'Leinster', Wicklow: 'Leinster',
  Clare: 'Munster', Cork: 'Munster', Kerry: 'Munster', Limerick: 'Munster', Tipperary: 'Munster', Waterford: 'Munster',
  Galway: 'Connacht', Leitrim: 'Connacht', Mayo: 'Connacht', Roscommon: 'Connacht', Sligo: 'Connacht',
  Cavan: 'Ulster', Donegal: 'Ulster', Monaghan: 'Ulster', Antrim: 'Ulster', Armagh: 'Ulster', Down: 'Ulster',
  Fermanagh: 'Ulster', Londonderry: 'Ulster', Derry: 'Ulster', Tyrone: 'Ulster',
};

// Province of a place: from a county named in its description (search
// results carry e.g. "County Cavan"), else from the nearest known town.
function provinceFor({ lat, lon, detail } = {}, towns = []) {
  const words = String(detail || '').match(/[A-Za-z]+/g) || [];
  for (const w of words) if (COUNTY_PROVINCE[w]) return COUNTY_PROVINCE[w];
  let best = null;
  let bestD = Infinity;
  for (const t of towns) {
    if (!t.province) continue;
    const d = (t.lat - lat) ** 2 + ((t.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best ? best.province : 'Leinster';
}

const LABELS = { today: 'Today', tonight: 'Tonight', tomorrow: 'Tomorrow', outlook: 'Outlook' };
const label = (k) => LABELS[k] || k.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// Flatten the feed into { region, issued, sections: [{ key, title, text }] }.
// Unknown keys (e.g. "this_evening") are kept, in feed order.
function parseFeed(body) {
  const rows = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'string') rows.push([k, x]);
        else walk(x);
      }
    }
  };
  walk(body);
  const out = { region: null, issued: null, sections: [], source: 'met' };
  for (const [k, v] of rows) {
    const key = k.toLowerCase();
    const text = v.replace(/\s+/g, ' ').trim();
    if (key === 'region') out.region = text;
    else if (key === 'issued') out.issued = text;
    else if (text) out.sections.push({ key, title: label(key), text });
  }
  if (!out.sections.length) throw new Error('Text forecast feed had no forecast text');
  return out;
}

async function fetchText(region) {
  // A stalled request would otherwise leave the cards on "Loading" for good.
  const res = await fetch(`${FEED}/${region}.json`, { headers: { 'User-Agent': 'irish-weather-site' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Met Éireann ${region} forecast HTTP ${res.status}`);
  const fc = parseFeed(await res.json());
  fc.region = fc.region || region;
  return fc;
}

// ---------- fallback written from hourly point data ----------

const DIRS = { N: 'northerly', NE: 'northeasterly', E: 'easterly', SE: 'southeasterly', S: 'southerly', SW: 'southwesterly', W: 'westerly', NW: 'northwesterly' };
const dirWord = (deg) => (deg == null ? '' : DIRS[['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8]]);

function windWords(kmh) {
  if (kmh < 12) return 'light';
  if (kmh < 29) return 'moderate';
  if (kmh < 39) return 'fresh';
  if (kmh < 50) return 'strong';
  return 'gale-force';
}

const localHour = (iso) => Number(new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/Dublin', hour: '2-digit', hourCycle: 'h23' }));
const localDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });

function describe(hours, night) {
  const rain = hours.reduce((s, h) => s + (h.precipitation || 0), 0);
  const wet = hours.filter((h) => (h.precipitation || 0) >= 0.1).length / hours.length;
  const cloud = hours.reduce((s, h) => s + (h.cloudiness ?? 50), 0) / hours.length;
  const thunder = hours.some((h) => /Thunder/.test(h.symbol || ''));
  const temps = hours.map((h) => h.temperature).filter(Number.isFinite);
  const speeds = hours.map((h) => h.windSpeedKmh).filter(Number.isFinite);
  const gust = Math.max(0, ...hours.map((h) => h.windGustKmh).filter(Number.isFinite));
  // Wind direction averaged as a vector.
  let u = 0;
  let v = 0;
  for (const h of hours) {
    if (!Number.isFinite(h.windDirection)) continue;
    u += Math.sin((h.windDirection * Math.PI) / 180);
    v += Math.cos((h.windDirection * Math.PI) / 180);
  }
  const dir = u || v ? ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360 : null;

  let sky;
  if (rain >= 8 && wet > 0.5) sky = 'Wet, with rain for much of the time, heavy at times';
  else if (wet > 0.5) sky = 'Cloudy with outbreaks of rain';
  else if (wet > 0.15) sky = night ? 'Showers or spells of rain, with some clear intervals' : 'A mix of sunny spells and showers';
  else if (wet > 0) sky = night ? 'Mostly dry with just the odd shower' : 'Mostly dry with a few passing showers';
  else if (cloud > 75) sky = 'Dry but rather cloudy';
  else if (cloud > 40) sky = night ? 'Dry with clear spells' : 'Dry with sunny spells';
  else sky = night ? 'Dry and mostly clear' : 'Dry and bright with plenty of sunshine';
  if (thunder) sky += ', with a risk of thunder';

  const parts = [`${sky}.`];
  if (temps.length) {
    parts.push(night
      ? `Lowest temperatures of around ${Math.round(Math.min(...temps))}°C.`
      : `Highest temperatures of around ${Math.round(Math.max(...temps))}°C.`);
  }
  if (speeds.length) {
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const words = `${windWords(mean)} ${dirWord(dir)}`.trim();
    parts.push(`${words[0].toUpperCase()}${words.slice(1)} winds${gust >= 50 ? `, with gusts up to ${Math.round(gust)} km/h` : ''}.`);
  }
  return parts.join(' ');
}

// Split the hours into today (until 6pm), tonight (6pm to 6am) and tomorrow
// (6am to 6pm), in Irish time, and describe each.
function fromHourly(hourly, region, now = Date.now()) {
  const future = hourly.filter((h) => Date.parse(h.time) >= now - 30 * 60 * 1000);
  if (!future.length) throw new Error('No hourly data for text forecast');
  const today = localDate(new Date(now).toISOString());
  const nightStart = future.findIndex((h) => localDate(h.time) === today && localHour(h.time) >= 18 || localDate(h.time) > today);
  const ns = nightStart < 0 ? future.length : nightStart;
  const dayStart = future.findIndex((h, i) => i >= ns && localDate(h.time) > today && localHour(h.time) >= 6);
  const ds = dayStart < 0 ? future.length : dayStart;
  const de = future.findIndex((h, i) => i >= ds && localHour(h.time) >= 18);
  const groups = [
    ['today', 'Today', future.slice(0, ns), false],
    ['tonight', 'Tonight', future.slice(ns, ds), true],
    ['tomorrow', 'Tomorrow', future.slice(ds, de < 0 ? ds + 12 : de), false],
  ];
  return {
    region,
    issued: null,
    source: 'auto',
    sections: groups.filter(([, , hrs]) => hrs.length).map(([key, title, hrs, night]) => ({ key, title, text: describe(hrs, night) })),
  };
}

module.exports = { PROVINCES, COUNTY_PROVINCE, provinceFor, parseFeed, fetchText, fromHourly };

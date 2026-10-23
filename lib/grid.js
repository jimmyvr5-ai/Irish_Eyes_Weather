// A coarse grid of current conditions over Ireland, used to colour the map
// for the temperature, wind and cloud layers and to read off values under the
// cursor. One Open-Meteo request covers every grid point.
//
// Open-Meteo's free API is for non-commercial use (and counts each point as
// one call, 10,000 a day), so the grid is kept small and cached. Before the
// site goes public with ads, take a paid Open-Meteo plan or swap the source.

// Points every 0.5°: 10 rows by 13 columns, a little beyond the coast.
const GRID = { south: 51.25, north: 55.75, west: -11, east: -5, step: 0.5 };

function gridPoints(g = GRID) {
  const lats = [];
  const lons = [];
  for (let lat = g.south; lat <= g.north + 1e-9; lat += g.step) lats.push(+lat.toFixed(4));
  for (let lon = g.west; lon <= g.east + 1e-9; lon += g.step) lons.push(+lon.toFixed(4));
  return { lats, lons };
}

function openMeteoUrl(g = GRID) {
  const { lats, lons } = gridPoints(g);
  const la = [];
  const lo = [];
  // Row by row, south to north, west to east.
  for (const lat of lats) for (const lon of lons) { la.push(lat); lo.push(lon); }
  const q = new URLSearchParams({
    latitude: la.join(','),
    longitude: lo.join(','),
    current: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover',
    hourly: 'precipitation',
    forecast_hours: '2',
    timeformat: 'unixtime',
    wind_speed_unit: 'kmh',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// Open-Meteo answers with one object per point (or a single object for one
// point). Turn that into flat arrays the browser can interpolate.
function parseOpenMeteo(body, g = GRID, now = Date.now()) {
  const rows = Array.isArray(body) ? body : [body];
  const { lats, lons } = gridPoints(g);
  if (rows.length !== lats.length * lons.length) {
    throw new Error(`Grid: expected ${lats.length * lons.length} points, got ${rows.length}`);
  }
  const out = { lats, lons, time: null, temperature: [], windSpeed: [], windGust: [], windDirection: [], rain: [], cloud: [] };
  for (const p of rows) {
    const c = p.current || {};
    out.time = out.time ?? (c.time ? c.time * 1000 : null);
    out.temperature.push(r1(c.temperature_2m));
    out.windSpeed.push(r1(c.wind_speed_10m));
    out.windGust.push(r1(c.wind_gusts_10m));
    out.windDirection.push(Number.isFinite(c.wind_direction_10m) ? Math.round(c.wind_direction_10m) : null);
    out.cloud.push(Number.isFinite(c.cloud_cover) ? Math.round(c.cloud_cover) : null);
    // Hourly precipitation is the total for the hour ending at each time, so
    // the first time after now is the rain falling this hour, in mm/h.
    const t = p.hourly?.time || [];
    const i = t.findIndex((s) => s * 1000 > now);
    out.rain.push(r1(i >= 0 ? p.hourly.precipitation[i] : null));
  }
  return out;
}

async function fetchGrid() {
  const res = await fetch(openMeteoUrl(), { headers: { 'User-Agent': 'ireland-weather (local)' } });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  return parseOpenMeteo(await res.json());
}

module.exports = { GRID, gridPoints, openMeteoUrl, parseOpenMeteo, fetchGrid };

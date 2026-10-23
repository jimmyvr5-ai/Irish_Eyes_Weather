// Met Éireann point forecast API (CC BY 4.0, credit Met Éireann).
// The API returns met.no-style XML: "instant" rows (from == to) carry
// temperature, wind, humidity and pressure; "period" rows (from < to)
// carry precipitation and a weather symbol for that period.

const API = 'http://openaccess.pf.api.met.ie/metno-wdb2ts/locationforecast';

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function child(body, name) {
  const m = body.match(new RegExp(`<${name}\\b([^>]*?)/?>`));
  return m ? attrs(m[1]) : null;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseForecastXml(xml) {
  const instants = new Map();
  const periods = [];

  for (const m of xml.matchAll(/<time\b([^>]*)>([\s\S]*?)<\/time>/g)) {
    const t = attrs(m[1]);
    const body = m[2];
    if (t.from === t.to) {
      const temp = child(body, 'temperature');
      const dir = child(body, 'windDirection');
      const speed = child(body, 'windSpeed');
      const gust = child(body, 'windGust');
      const hum = child(body, 'humidity');
      const pres = child(body, 'pressure');
      const cloud = child(body, 'cloudiness');
      instants.set(t.from, {
        time: t.from,
        temperature: num(temp?.value),
        windDirection: num(dir?.deg),
        windDirectionName: dir?.name ?? null,
        windSpeedKmh: speed ? Math.round(num(speed.mps) * 3.6) : null,
        beaufort: num(speed?.beaufort),
        windGustKmh: gust ? Math.round(num(gust.mps) * 3.6) : null,
        humidity: num(hum?.value),
        pressure: num(pres?.value),
        cloudiness: num(cloud?.percent),
      });
    } else {
      const precip = child(body, 'precipitation');
      const sym = child(body, 'symbol');
      periods.push({
        from: t.from,
        to: t.to,
        hours: (Date.parse(t.to) - Date.parse(t.from)) / 3600000,
        precipitation: num(precip?.value),
        precipitationProbability: num(precip?.probability),
        symbol: sym?.id ?? null,
        symbolNumber: num(sym?.number),
      });
    }
  }

  // Attach the shortest period that starts at each instant (normally 1 hour).
  const hourly = [];
  for (const inst of instants.values()) {
    const p = periods
      .filter((x) => x.from === inst.time)
      .sort((a, b) => a.hours - b.hours)[0];
    hourly.push({
      ...inst,
      precipitation: p?.precipitation ?? null,
      precipitationProbability: p?.precipitationProbability ?? null,
      symbol: p?.symbol ?? null,
    });
  }
  hourly.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return { hourly, daily: summariseDays(hourly) };
}

function irishDate(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
}

function irishHour(iso) {
  return Number(
    new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/Dublin', hour: '2-digit', hour12: false })
  );
}

function summariseDays(hourly) {
  const days = new Map();
  for (const h of hourly) {
    const d = irishDate(h.time);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(h);
  }
  const out = [];
  for (const [date, hours] of days) {
    const temps = hours.map((h) => h.temperature).filter((v) => v != null);
    const winds = hours.map((h) => h.windSpeedKmh).filter((v) => v != null);
    const gusts = hours.map((h) => h.windGustKmh).filter((v) => v != null);
    const rain = hours.reduce((s, h) => s + (h.precipitation ?? 0), 0);
    // Pick the symbol nearest midday as the day's headline symbol.
    const withSym = hours.filter((h) => h.symbol);
    const midday = withSym.sort(
      (a, b) => Math.abs(irishHour(a.time) - 13) - Math.abs(irishHour(b.time) - 13)
    )[0];
    out.push({
      date,
      min: temps.length ? Math.min(...temps) : null,
      max: temps.length ? Math.max(...temps) : null,
      windMaxKmh: winds.length ? Math.max(...winds) : null,
      gustMaxKmh: gusts.length ? Math.max(...gusts) : null,
      rainTotal: Math.round(rain * 10) / 10,
      symbol: midday?.symbol ?? null,
    });
  }
  return out;
}

async function fetchForecast(lat, lon) {
  const url = `${API}?lat=${lat.toFixed(4)};long=${lon.toFixed(4)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'irish-weather-site' } });
  if (!res.ok) throw new Error(`Met Éireann forecast HTTP ${res.status}`);
  return parseForecastXml(await res.text());
}

module.exports = { fetchForecast, parseForecastXml };

const test = require('node:test');
const assert = require('node:assert');

const { parseForecastXml } = require('../lib/metForecast');
const { normalise } = require('../lib/warnings');
const geocode = require('../lib/geocode');
const grid = require('../lib/grid');
const mock = require('./mockData');

test('parses Met Éireann forecast XML into hourly and daily data', () => {
  const fc = parseForecastXml(mock.forecastXml(53.35, -6.26));
  assert.strictEqual(fc.hourly.length, 24 * 7);
  const h = fc.hourly[0];
  assert.strictEqual(typeof h.temperature, 'number');
  assert.strictEqual(typeof h.windSpeedKmh, 'number');
  assert.ok(h.symbol, 'hour has a weather symbol from its period row');
  assert.ok(fc.daily.length >= 7);
  for (const d of fc.daily) assert.ok(d.max >= d.min);
});

test('drops expired warnings and names counties', () => {
  const list = normalise(mock.warnings());
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual(list[0].regions, ['Clare', 'Galway', 'Kerry', 'Mayo']);
});

test('place search keeps Irish settlements and drops the rest', () => {
  const rows = [
    { lat: '53.95', lon: '-7.12', addresstype: 'village', name: 'Ballyjamesduff', address: { village: 'Ballyjamesduff', county: 'County Cavan' } },
    { lat: '51.50', lon: '-0.12', addresstype: 'city', name: 'London', address: { city: 'London' } },
    { lat: '53.30', lon: '-6.20', addresstype: 'shop', name: 'Ballyjamesduff Stores', address: { suburb: 'Ranelagh', county: 'Dublin' } },
  ];
  const out = geocode.parseNominatim(rows);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], { name: 'Ballyjamesduff', detail: 'County Cavan', lat: 53.95, lon: -7.12 });
  assert.strictEqual(geocode.localMatches('kilk')[0].name, 'Kilkenny');
  assert.strictEqual(geocode.dedupe([...geocode.localMatches('Cork'), { name: 'Cork', lat: 51.9, lon: -8.47 }]).length, 1);
});

test('turns Open-Meteo grid points into map fields', () => {
  const { lats, lons } = grid.gridPoints();
  assert.strictEqual(lats[0], 51.25);
  assert.strictEqual(lons.at(-1), -5);
  const url = new URL(grid.openMeteoUrl());
  assert.strictEqual(url.searchParams.get('latitude').split(',').length, lats.length * lons.length);
  const g = grid.parseOpenMeteo(mock.openMeteoGrid(lats, lons));
  assert.strictEqual(g.temperature.length, lats.length * lons.length);
  assert.ok(g.temperature[0] > g.temperature.at(-1), 'south warmer than north in mock');
  assert.ok(g.rain.some((r) => r > 0));
  assert.throws(() => grid.parseOpenMeteo([{}]));
});

test('API serves towns, forecast and warnings in mock mode', async () => {
  process.env.MOCK = '1';
  delete require.cache[require.resolve('../server')];
  const { server } = require('../server');
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const towns = await (await fetch(`${base}/api/towns`)).json();
    assert.ok(towns.length > 20);
    assert.strictEqual(typeof towns[0].now.temperature, 'number');

    const fc = await (await fetch(`${base}/api/forecast?town=galway`)).json();
    assert.strictEqual(fc.location, 'Galway');
    assert.ok(fc.hourly.length > 0 && fc.daily.length === 7);

    const named = await (await fetch(`${base}/api/forecast?lat=53.95&lon=-7.12&name=Ballyjamesduff`)).json();
    assert.strictEqual(named.location, 'Ballyjamesduff');

    const found = await (await fetch(`${base}/api/search?q=gal`)).json();
    assert.strictEqual(found[0].name, 'Galway');
    assert.deepStrictEqual(await (await fetch(`${base}/api/search?q=g`)).json(), []);

    const bad = await fetch(`${base}/api/forecast?lat=40&lon=0`);
    assert.strictEqual(bad.status, 400);

    const g = await (await fetch(`${base}/api/grid`)).json();
    assert.strictEqual(g.windSpeed.length, g.lats.length * g.lons.length);

    const warnings = await (await fetch(`${base}/api/warnings`)).json();
    assert.strictEqual(warnings.length, 1);

    const page = await fetch(`${base}/`);
    assert.match(await page.text(), /Ireland Weather/);

    const escape = await fetch(`${base}/..%2fserver.js`);
    assert.notStrictEqual(escape.status, 200);
  } finally {
    server.close();
  }
});

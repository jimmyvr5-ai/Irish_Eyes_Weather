// Made-up data in the same shapes as the real feeds, for MOCK=1 and tests.

function forecastXml(lat, lon) {
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  const symbols = ['Sun', 'LightCloud', 'PartlyCloud', 'Cloud', 'LightRainSun', 'LightRain', 'Rain', 'Drizzle', 'RainThunder'];
  const seed = Math.abs(Math.round(lat * 100 + lon * 37));
  let rows = '';
  for (let i = 0; i < 24 * 7; i++) {
    const t = new Date(start.getTime() + i * 3600000);
    const t2 = new Date(t.getTime() + 3600000);
    const hour = t.getUTCHours();
    const temp = (9 + 4 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + (seed % 5) - 2 + Math.sin(i / 30)).toFixed(1);
    const mps = (4 + ((seed + i) % 9)).toFixed(1);
    const gust = (Number(mps) * 1.6).toFixed(1);
    const deg = (200 + ((seed + i * 3) % 90)).toFixed(1);
    const sym = symbols[(seed + Math.floor(i / 5)) % symbols.length];
    const rain = /Rain|Drizzle/.test(sym) ? (((seed + i) % 7) / 4).toFixed(1) : '0.0';
    const iso = (d) => d.toISOString().replace('.000', '');
    rows += `
    <time datatype="forecast" from="${iso(t)}" to="${iso(t)}">
      <location altitude="10" latitude="${lat}" longitude="${lon}">
        <temperature id="TTT" unit="celsius" value="${temp}"/>
        <windDirection id="dd" deg="${deg}" name="SW"/>
        <windSpeed id="ff" mps="${mps}" beaufort="4" name="Moderat bris"/>
        <windGust id="ff_gust" mps="${gust}"/>
        <globalRadiation value="0.0" unit="W/m^2"/>
        <humidity value="${80 + (i % 15)}.0" unit="percent"/>
        <pressure id="pr" unit="hPa" value="1012.${i % 10}"/>
        <cloudiness id="NN" percent="${(seed + i * 7) % 100}.0"/>
        <dewpointTemperature id="TD" unit="celsius" value="6.1"/>
      </location>
    </time>
    <time datatype="forecast" from="${iso(t)}" to="${iso(t2)}">
      <location altitude="10" latitude="${lat}" longitude="${lon}">
        <precipitation unit="mm" value="${rain}" minvalue="0.0" maxvalue="${rain}" probability="${rain === '0.0' ? 5 : 70}"/>
        <symbol id="${hour >= 19 || hour < 7 ? 'Dark_' : ''}${sym}" number="3"/>
      </location>
    </time>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<weatherdata xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" created="${start.toISOString()}">
  <meta><model name="harmonie" termin="${start.toISOString()}"/></meta>
  <product class="pointData">${rows}
  </product>
</weatherdata>`;
}

function warnings() {
  const now = Date.now();
  return [
    {
      id: '2.49.0.1.372.0.mock1',
      type: 'Wind',
      severity: 'Moderate',
      certainty: 'Likely',
      level: 'Yellow',
      issued: new Date(now - 3 * 3600000).toISOString(),
      updated: new Date(now - 3 * 3600000).toISOString(),
      onset: new Date(now + 6 * 3600000).toISOString(),
      expiry: new Date(now + 18 * 3600000).toISOString(),
      headline: 'Wind warning for Clare, Galway, Kerry, Mayo',
      description: 'Southwest winds will reach mean speeds of 50 to 65 km/h with gusts of 90 to 110 km/h, higher in exposed areas. (Sample warning: mock data.)',
      regions: ['EI03', 'EI10', 'EI11', 'EI20'],
      status: 'Warning',
    },
    {
      id: 'expired-one',
      type: 'Rain',
      level: 'Yellow',
      onset: new Date(now - 30 * 3600000).toISOString(),
      expiry: new Date(now - 6 * 3600000).toISOString(),
      headline: 'Expired warning that should not be shown',
      regions: ['EI07'],
    },
  ];
}

function radar() {
  return { provider: 'mock', attribution: 'Mock radar', maxZoom: 7, frames: [] };
}

// Open-Meteo's multi-point answer for the map grid: smooth made-up fields,
// warmer in the south, windier in the west, a band of rain in the middle.
function openMeteoGrid(lats, lons) {
  const now = Math.floor(Date.now() / 3600000) * 3600;
  const rows = [];
  for (const lat of lats) {
    for (const lon of lons) {
      rows.push({
        latitude: lat,
        longitude: lon,
        current: {
          time: now,
          temperature_2m: 16 - (lat - 51.25) * 1.5 + Math.sin(lon) * 1.2,
          wind_speed_10m: 12 + (-5 - lon) * 5,
          wind_gusts_10m: 20 + (-5 - lon) * 8,
          wind_direction_10m: 225 + (lat - 53.5) * 10,
          cloud_cover: Math.min(100, Math.max(0, 40 + (lat - 53.5) * 30 + (-6 - lon) * 8)),
        },
        hourly: {
          time: [now, now + 3600],
          precipitation: [0, Math.max(0, 2 - Math.abs(lat - 53.5) * 2)],
        },
      });
    }
  }
  return rows;
}

// Same shape as https://www.met.ie/Open_Data/json/National.json
function textFeed(region) {
  return {
    forecasts: [{
      regions: [
        { region },
        { issued: new Date().toISOString().replace(/\.\d+Z$/, 'Z') },
        { today: `Sunny spells and scattered showers across ${region}. Highest temperatures of 10 to 13 degrees.` },
        { tonight: 'Dry at first, then rain spreading from the west. Lowest temperatures of 4 to 7 degrees.' },
        { tomorrow: 'Wet and windy in the morning, brighter with showers later. Highs of 12 to 14 degrees.' },
        { outlook: region === 'National' ? 'Staying unsettled into next week.' : '' },
      ],
    }],
  };
}

module.exports = { forecastXml, warnings, radar, openMeteoGrid, textFeed };

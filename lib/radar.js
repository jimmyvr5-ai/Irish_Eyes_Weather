// Radar providers. Each returns the same shape so the front end does not care
// where frames come from:
//   { provider, attribution, maxZoom, frames: [{ time, tiles }] }
//
// RainViewer's free API is for personal and educational use only, so it is
// fine for local testing but should be replaced by the Met Éireann radar
// provider before the site goes public with ads.

async function rainviewer() {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!res.ok) throw new Error(`RainViewer HTTP ${res.status}`);
  const data = await res.json();
  const past = data.radar?.past ?? [];
  return {
    provider: 'rainviewer',
    attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
    maxZoom: 7,
    frames: past.map((f) => ({
      time: f.time * 1000,
      // 256px tiles, colour scheme 2 (Universal Blue), smoothed, snow shown.
      tiles: `${data.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
    })),
  };
}

const providers = { rainviewer };

function getProvider(name) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown radar provider "${name}"`);
  return p;
}

module.exports = { getProvider };

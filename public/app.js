// Front end: map with radar and town markers, forecast panel, warnings.

const IRELAND = { center: [-7.9, 53.45], zoom: 6 };
// "bright" is OpenFreeMap's colourful style (green land, blue sea); positron was greyscale.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';
const DUBLIN = { id: 'dublin', name: 'Dublin', lat: 53.3498, lon: -6.2603 };
const TZ = 'Europe/Dublin';

const state = {
  layer: 'radar',
  towns: [],
  markers: [],
  place: loadPlace(),
  pin: null,
  radar: null,
  frame: 0,
  playing: null,
  grid: null,
  pointer: null,
};

// ---------- helpers ----------

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

// The place whose forecast is showing: { id?, name, lat, lon }. Known towns
// carry an id; places found by search or "my location" only have coordinates.
function loadPlace() {
  try {
    const p = JSON.parse(localGet('place'));
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) return p;
  } catch { /* fall through */ }
  return DUBLIN;
}

async function api(path) {
  const res = await fetch(path);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-IE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtHour = (iso) => new Date(iso).toLocaleTimeString('en-IE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtDay = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IE', { timeZone: TZ, weekday: 'short' });
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-IE', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' });
const round = (v) => (v == null ? '–' : Math.round(v));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Met Éireann symbol ids look like "PartlyCloud", "Dark_LightRainSun", "RainThunder".
function symbol(id) {
  if (!id) return { icon: '·', text: '' };
  const night = id.startsWith('Dark_');
  const s = id.replace(/^Dark_/, '');
  const has = (w) => s.includes(w);
  let icon, text;
  if (has('Thunder')) { icon = '⛈️'; text = 'Thunder'; }
  else if (has('Snow')) { icon = '🌨️'; text = 'Snow'; }
  else if (has('Sleet')) { icon = '🌨️'; text = 'Sleet'; }
  else if (has('Rain') || has('Drizzle')) {
    icon = has('Sun') ? (night ? '🌧️' : '🌦️') : '🌧️';
    text = has('Drizzle') ? 'Drizzle' : has('Light') ? 'Light rain' : has('Sun') ? 'Showers' : 'Rain';
  }
  else if (has('Fog')) { icon = '🌫️'; text = 'Fog'; }
  else if (s === 'Cloud') { icon = '☁️'; text = 'Cloudy'; }
  else if (has('PartlyCloud')) { icon = night ? '☁️' : '⛅'; text = 'Partly cloudy'; }
  else if (has('LightCloud')) { icon = night ? '🌙' : '🌤️'; text = 'Mostly clear'; }
  else if (has('Sun')) { icon = night ? '🌙' : '☀️'; text = night ? 'Clear' : 'Sunny'; }
  else { icon = '☁️'; text = s; }
  return { icon, text };
}

function tempColour(t) {
  const stops = [[-5, '#5b4bd1'], [0, '#3b82d6'], [5, '#2bb3c0'], [10, '#3fae5a'], [15, '#d8b416'], [20, '#ef8a1f'], [25, '#d93a2b']];
  if (t == null) return '#777';
  for (let i = stops.length - 1; i >= 0; i--) if (t >= stops[i][0]) return stops[i][1];
  return stops[0][1];
}

// Smooth colour ramps for the gridded map layers: [value, [r, g, b]].
const RAMPS = {
  temp: { unit: '°C', stops: [[-5, [91, 75, 209]], [0, [59, 130, 214]], [5, [43, 179, 192]], [10, [63, 174, 90]], [15, [216, 180, 22]], [20, [239, 138, 31]], [25, [217, 58, 43]]] },
  // Clear sky is see-through; thicker cloud is whiter and more opaque.
  cloud: { unit: '%', alpha: true, stops: [[0, [240, 244, 248]], [50, [215, 222, 230]], [100, [150, 160, 172]]] },
  wind: { unit: 'km/h', stops: [[0, [190, 225, 245]], [15, [59, 160, 214]], [30, [63, 174, 90]], [45, [216, 180, 22]], [60, [239, 138, 31]], [80, [217, 58, 43]], [110, [140, 40, 140]]] },
};

function rampColour(ramp, v) {
  const s = ramp.stops;
  if (v <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i][0]) {
      const f = (v - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return s[i - 1][1].map((c, k) => Math.round(c + (s[i][1][k] - c) * f));
    }
  }
  return s[s.length - 1][1];
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

function windColour(kmh) {
  if (kmh == null) return '#777';
  if (kmh >= 75) return '#d93a2b';
  if (kmh >= 50) return '#ef8a1f';
  if (kmh >= 30) return '#d8b416';
  return '#3b82d6';
}

// ---------- map ----------

const map = new maplibregl.Map({
  container: 'map',
  style: MAP_STYLE,
  center: IRELAND.center,
  zoom: IRELAND.zoom,
  minZoom: 5,
  maxZoom: 11,
  maxBounds: [[-16, 49.5], [1, 57.5]],
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

function renderMarkers() {
  state.markers.forEach((m) => m.remove());
  state.markers = [];
  if (state.layer === 'radar') return;
  for (const t of state.towns) {
    const n = t.now || {};
    const el = document.createElement('div');
    el.className = 'marker' + (t.id === state.place.id ? ' selected' : '');
    el.title = t.name;
    if (state.layer === 'temp') {
      el.style.background = tempColour(n.temperature);
      el.textContent = `${round(n.temperature)}°`;
    } else if (state.layer === 'cloud') {
      el.style.background = n.cloudiness == null ? '#777' : n.cloudiness >= 70 ? '#6b7682' : n.cloudiness >= 30 ? '#8fa3b5' : '#3b82d6';
      el.textContent = `${round(n.cloudiness)}%`;
    } else {
      el.style.background = windColour(n.windGustKmh ?? n.windSpeedKmh);
      // Wind direction is where it blows FROM, so point the arrow downwind.
      const rot = (n.windDirection ?? 0) + 180;
      el.innerHTML = `<span class="arrow" style="transform:rotate(${rot}deg)">↑</span>${round(n.windSpeedKmh)}`;
    }
    el.addEventListener('click', () => selectPlace(t));
    state.markers.push(new maplibregl.Marker({ element: el }).setLngLat([t.lon, t.lat]).addTo(map));
  }
}

// ---------- gridded layers (temperature, wind) ----------

// Value of one grid field at a point, blending the four surrounding grid
// points. Returns null outside the grid or where data is missing.
function gridValue(g, field, lat, lon) {
  const step = g.lats[1] - g.lats[0];
  const fi = (lat - g.lats[0]) / step;
  const fj = (lon - g.lons[0]) / step;
  if (fi < 0 || fj < 0 || fi > g.lats.length - 1 || fj > g.lons.length - 1) return null;
  const i0 = Math.min(Math.floor(fi), g.lats.length - 2);
  const j0 = Math.min(Math.floor(fj), g.lons.length - 2);
  const di = fi - i0;
  const dj = fj - j0;
  const vals = g[field];
  const at = (i, j) => vals[i * g.lons.length + j];
  let sum = 0;
  let wsum = 0;
  for (const [i, j, w] of [[i0, j0, (1 - di) * (1 - dj)], [i0, j0 + 1, (1 - di) * dj], [i0 + 1, j0, di * (1 - dj)], [i0 + 1, j0 + 1, di * dj]]) {
    const v = at(i, j);
    if (v == null || w === 0) continue;
    sum += v * w;
    wsum += w;
  }
  return wsum > 0 ? sum / wsum : null;
}

// Wind direction is blended as a vector so that 350° and 10° average to 0°.
function prepareGrid(g) {
  g.windU = g.windSpeed.map((s, k) => (s == null || g.windDirection[k] == null ? null : s * Math.sin((g.windDirection[k] * Math.PI) / 180)));
  g.windV = g.windSpeed.map((s, k) => (s == null || g.windDirection[k] == null ? null : s * Math.cos((g.windDirection[k] * Math.PI) / 180)));
  return g;
}

function windAt(g, lat, lon) {
  const speed = gridValue(g, 'windSpeed', lat, lon);
  if (speed == null) return null;
  const u = gridValue(g, 'windU', lat, lon);
  const v = gridValue(g, 'windV', lat, lon);
  const dir = u == null || v == null ? null : ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
  return { speed, gust: gridValue(g, 'windGust', lat, lon), dir };
}

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unMercY = (y) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

// Paint a field onto a canvas covering the grid. The map stretches the image
// linearly in Web Mercator, so rows are spaced in Mercator, not in latitude.
function paintField(g, field, ramp) {
  const W = 240;
  const H = 300;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const west = g.lons[0];
  const east = g.lons[g.lons.length - 1];
  const yN = mercY(g.lats[g.lats.length - 1]);
  const yS = mercY(g.lats[0]);
  for (let y = 0; y < H; y++) {
    const lat = unMercY(yN + ((yS - yN) * (y + 0.5)) / H);
    for (let x = 0; x < W; x++) {
      const lon = west + ((east - west) * (x + 0.5)) / W;
      const v = gridValue(g, field, lat, lon);
      if (v == null) continue;
      const [r, gr, b] = rampColour(ramp, v);
      const k = (y * W + x) * 4;
      img.data[k] = r;
      img.data[k + 1] = gr;
      img.data[k + 2] = b;
      img.data[k + 3] = ramp.alpha ? Math.round(40 + 215 * Math.min(1, Math.max(0, v / 100))) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

const FIELD_FOR = { temp: 'temperature', wind: 'windSpeed', cloud: 'cloud' };

function drawField() {
  const g = state.grid;
  const field = FIELD_FOR[state.layer];
  const legend = document.getElementById('legend');
  if (!field) {
    legend.hidden = true;
    if (map.getLayer('field')) map.setLayoutProperty('field', 'visibility', 'none');
    return;
  }
  const ramp = RAMPS[state.layer];
  const stops = ramp.stops;
  legend.hidden = false;
  document.getElementById('legendLo').textContent = `${stops[0][0]}`;
  document.getElementById('legendHi').textContent = `${stops[stops.length - 1][0]} ${ramp.unit}`;
  document.getElementById('legendBar').style.background =
    `linear-gradient(to right, ${stops.map(([, c]) => `rgb(${c.join(',')})`).join(',')})`;
  if (!g || !map.isStyleLoaded()) return;
  const url = paintField(g, field, ramp);
  const n = g.lats[g.lats.length - 1];
  const s = g.lats[0];
  const w = g.lons[0];
  const e = g.lons[g.lons.length - 1];
  const coordinates = [[w, n], [e, n], [e, s], [w, s]];
  const src = map.getSource('field');
  if (src) {
    src.updateImage({ url, coordinates });
  } else {
    map.addSource('field', { type: 'image', url, coordinates });
    // Under the first label layer, so town and road names stay readable.
    const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    map.addLayer({ id: 'field', type: 'raster', source: 'field', paint: { 'raster-opacity': 0.55, 'raster-fade-duration': 0 } }, firstLabel);
  }
  map.setPaintProperty('field', 'raster-opacity', ramp.alpha ? 0.85 : 0.55);
  map.setLayoutProperty('field', 'visibility', 'visible');
}

async function loadGrid() {
  try {
    state.grid = prepareGrid(await api('/api/grid'));
  } catch (err) {
    console.error(err);
    return;
  }
  drawField();
  updateReadout();
}

// ---------- readout under the cursor ----------

function updateReadout() {
  const box = document.getElementById('readout');
  const p = state.pointer;
  if (!p) { box.hidden = true; return; }
  const g = state.grid;
  const valueEl = document.getElementById('readoutValue');
  const labelEl = document.getElementById('readoutLabel');
  if (!g) {
    box.hidden = false;
    valueEl.textContent = '…';
    labelEl.textContent = 'Loading map data';
    return;
  }
  let value;
  let label;
  if (state.layer === 'temp') {
    const t = gridValue(g, 'temperature', p.lat, p.lng);
    if (t != null) {
      value = `${Math.round(t)}<span class="unit">°C</span>`;
      label = 'Temperature now';
    }
  } else if (state.layer === 'wind') {
    const w = windAt(g, p.lat, p.lng);
    if (w) {
      // Arrow points downwind; the name says where it blows from.
      const arrow = w.dir == null ? '' : `<span class="arrow" style="transform:rotate(${w.dir + 180}deg)">↑</span>`;
      value = `${arrow}${Math.round(w.speed)}<span class="unit">km/h</span>`;
      label = `Wind${w.dir == null ? '' : ` from the ${compass(w.dir)}`}${w.gust == null ? '' : ` · gusts ${Math.round(w.gust)} km/h`}`;
    }
  } else if (state.layer === 'cloud') {
    const c = g.cloud ? gridValue(g, 'cloud', p.lat, p.lng) : null;
    if (c != null) {
      value = `${Math.round(c)}<span class="unit">%</span>`;
      label = c < 15 ? 'Clear sky now' : c < 60 ? 'Cloud cover now · some breaks' : 'Cloud cover now';
    }
  } else {
    const r = gridValue(g, 'rain', p.lat, p.lng);
    if (r != null) {
      const mm = r < 0.05 ? '0' : r < 10 ? r.toFixed(1) : Math.round(r);
      value = `${mm}<span class="unit">mm/h</span>`;
      label = r < 0.05 ? 'No rain forecast this hour' : 'Rain this hour (forecast)';
    }
  }
  box.hidden = value == null;
  if (value != null) {
    valueEl.innerHTML = value;
    labelEl.textContent = label;
  }
}

let readoutFrame = 0;
function trackPointer(e) {
  state.pointer = e.lngLat;
  if (readoutFrame) return;
  readoutFrame = requestAnimationFrame(() => { readoutFrame = 0; updateReadout(); });
}
map.on('mousemove', trackPointer);
map.on('click', trackPointer); // touch screens have no hover
map.getCanvasContainer().addEventListener('mouseleave', () => { state.pointer = null; updateReadout(); });

// ---------- radar ----------

function radarLayerId(i) { return `radar-${i}`; }

function setupRadar(radar) {
  state.radar = radar;
  document.getElementById('radarCredit').innerHTML = radar.attribution;
  radar.frames.forEach((f, i) => {
    map.addSource(radarLayerId(i), {
      type: 'raster',
      tiles: [f.tiles],
      tileSize: 256,
      maxzoom: radar.maxZoom,
    });
    map.addLayer({
      id: radarLayerId(i),
      type: 'raster',
      source: radarLayerId(i),
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 0 }, 'raster-fade-duration': 0 },
    });
  });
  const slider = document.getElementById('frame');
  slider.max = Math.max(0, radar.frames.length - 1);
  showFrame(radar.frames.length - 1);
}

// Only the frame on screen (plus the next one while playing, so it is ready)
// is switched on. Layers that are merely transparent still download and draw
// every tile, so with ~13 radar frames each pan or zoom used to fetch and
// render 13 sets of tiles, which is what made the map slow to move.
function showFrame(i) {
  const r = state.radar;
  if (!r || !r.frames.length) {
    document.getElementById('frameTime').textContent = 'No radar';
    return;
  }
  state.frame = i;
  const n = r.frames.length;
  const next = state.playing ? (i + 1) % n : -1;
  r.frames.forEach((_, j) => {
    const on = state.layer === 'radar' && (j === i || j === next);
    const id = radarLayerId(j);
    map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    map.setPaintProperty(id, 'raster-opacity', on && j === i ? 0.75 : 0);
  });
  document.getElementById('frame').value = i;
  document.getElementById('frameTime').textContent = fmtTime(r.frames[i].time);
}

function togglePlay() {
  const btn = document.getElementById('play');
  if (state.playing) {
    clearInterval(state.playing);
    state.playing = null;
    btn.textContent = '▶';
    showFrame(state.frame);
    return;
  }
  btn.textContent = '⏸';
  state.playing = setInterval(() => {
    const n = state.radar?.frames.length || 1;
    showFrame((state.frame + 1) % n);
  }, 600);
}

function setLayer(layer) {
  state.layer = layer;
  document.querySelectorAll('.layers button').forEach((b) => b.classList.toggle('on', b.dataset.layer === layer));
  document.getElementById('radarBar').hidden = layer !== 'radar';
  if (layer !== 'radar' && state.playing) togglePlay();
  showFrame(state.frame);
  drawField();
  renderMarkers();
  updateReadout();
}

// ---------- forecast panel ----------

async function selectPlace(place, { fly = true } = {}) {
  state.place = { id: place.id, name: place.name, detail: place.detail, lat: place.lat, lon: place.lon };
  localSet('place', JSON.stringify(state.place));
  document.getElementById('search').value = '';
  renderMarkers();
  if (!state.pin) {
    const el = document.createElement('div');
    el.className = 'pin';
    state.pin = new maplibregl.Marker({ element: el, anchor: 'bottom' });
  }
  state.pin.setLngLat([place.lon, place.lat]).addTo(map);
  if (fly) map.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.getZoom(), 8), speed: 1.4 });
  const q = place.id
    ? `town=${encodeURIComponent(place.id)}`
    : `lat=${place.lat}&lon=${place.lon}&name=${encodeURIComponent(place.name || '')}`;
  loadText();
  await loadForecast(`/api/forecast?${q}`);
}

// ---------- written forecasts ----------

function renderText(el, fc, heading) {
  if (!fc) return;
  const issued = fc.issued ? `Issued ${fmtWhen(fc.issued)} by Met Éireann` : '';
  el.innerHTML = `
    <h2>${esc(heading)}</h2>
    ${issued ? `<p class="issued">${esc(issued)}</p>` : ''}
    ${fc.sections.map((s) => `<h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>`).join('')}
    ${fc.source === 'auto' ? `<p class="note">Met Éireann's written forecast is unavailable just now, so this summary was made from the forecast for ${esc(fc.basedOn || 'a nearby town')}.</p>` : ''}`;
}

let textSeq = 0;
async function loadText() {
  const p = state.place;
  const q = p.id
    ? `town=${encodeURIComponent(p.id)}`
    : `lat=${p.lat}&lon=${p.lon}&detail=${encodeURIComponent(p.detail || '')}`;
  const seq = ++textSeq;
  const nat = document.getElementById('textNational');
  const reg = document.getElementById('textRegional');
  try {
    const t = await api(`/api/text?${q}`);
    if (seq !== textSeq) return;
    renderText(nat, t.national, 'Ireland forecast');
    renderText(reg, t.regional, `${t.province} forecast`);
  } catch (err) {
    if (seq !== textSeq) return;
    nat.innerHTML = `<h2>Ireland forecast</h2><p class="error">Could not load the written forecast: ${esc(err.message)}</p>`;
    reg.innerHTML = '<h2>Provincial forecast</h2><p class="muted">Unavailable just now.</p>';
  }
}

// ---------- town search ----------

const search = {
  input: document.getElementById('search'),
  list: document.getElementById('results'),
  items: [],
  active: -1,
  timer: null,
  seq: 0,
};

function showResults(items, note) {
  search.items = items;
  search.active = items.length ? 0 : -1;
  const html = items.map((p, i) => `
    <li role="option" id="res-${i}" data-i="${i}"${i === 0 ? ' class="active" aria-selected="true"' : ''}>
      ${esc(p.name)}${p.detail ? `<span class="detail">${esc(p.detail)}</span>` : ''}
    </li>`).join('');
  search.list.innerHTML = html || (note ? `<li class="note">${esc(note)}</li>` : '');
  const open = Boolean(html || note);
  search.list.hidden = !open;
  search.input.setAttribute('aria-expanded', String(open));
}

function closeResults() {
  search.list.hidden = true;
  search.input.setAttribute('aria-expanded', 'false');
}

function moveActive(step) {
  if (!search.items.length) return;
  search.active = (search.active + step + search.items.length) % search.items.length;
  search.list.querySelectorAll('li').forEach((li, i) => {
    li.classList.toggle('active', i === search.active);
    li.setAttribute('aria-selected', String(i === search.active));
  });
}

async function runSearch(text) {
  const seq = ++search.seq;
  try {
    const items = await api(`/api/search?q=${encodeURIComponent(text)}`);
    if (seq !== search.seq) return; // a newer search has started
    showResults(items, `No place called "${text}" found in Ireland`);
  } catch (err) {
    if (seq === search.seq) showResults([], err.message);
  }
}

function pick(i) {
  const p = search.items[i];
  if (!p) return;
  closeResults();
  search.input.blur();
  selectPlace(p);
}

search.input.addEventListener('input', () => {
  clearTimeout(search.timer);
  const text = search.input.value.trim();
  if (text.length < 2) { search.seq++; closeResults(); return; }
  search.timer = setTimeout(() => runSearch(text), 350);
});
search.input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
  else if (e.key === 'Escape') closeResults();
});
document.getElementById('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = search.input.value.trim();
  if (text.length < 2) return;
  // Enter before the suggestions arrive: search now, then take the best match.
  if (search.list.hidden || !search.items.length) {
    clearTimeout(search.timer);
    await runSearch(text);
  }
  pick(Math.max(0, search.active));
});
search.list.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) { e.preventDefault(); pick(Number(li.dataset.i)); }
});
search.input.addEventListener('blur', () => setTimeout(closeResults, 150));

async function loadForecast(url) {
  const cur = document.getElementById('current');
  try {
    const fc = await api(url);
    renderForecast(fc);
  } catch (err) {
    cur.innerHTML = `<p class="error">Could not load the forecast: ${esc(err.message)}</p>`;
  }
}

function renderForecast(fc) {
  const n = fc.now || {};
  const s = symbol(n.symbol);
  document.getElementById('current').innerHTML = `
    <div class="place">${esc(fc.location || 'Your location')}</div>
    <div class="updated">Forecast for ${n.time ? fmtWhen(n.time) : '–'}</div>
    <div class="big"><span class="sym">${s.icon}</span><span class="temp">${round(n.temperature)}°</span><span class="desc">${esc(s.text)}</span></div>
    <dl class="stats">
      <div><dt>Wind</dt><dd>${round(n.windSpeedKmh)} km/h ${esc(n.windDirectionName || '')}</dd></div>
      <div><dt>Gusts</dt><dd>${round(n.windGustKmh)} km/h</dd></div>
      <div><dt>Rain (next hour)</dt><dd>${n.precipitation ?? '–'} mm</dd></div>
      <div><dt>Humidity</dt><dd>${round(n.humidity)}%</dd></div>
      <div><dt>Pressure</dt><dd>${round(n.pressure)} hPa</dd></div>
      <div><dt>Cloud</dt><dd>${round(n.cloudiness)}%</dd></div>
    </dl>`;

  document.getElementById('hourly').innerHTML = fc.hourly.slice(0, 24).map((h) => `
    <div class="hour">
      <div>${fmtHour(h.time)}</div>
      <div class="s" title="${esc(symbol(h.symbol).text)}">${symbol(h.symbol).icon}</div>
      <div class="t">${round(h.temperature)}°</div>
      <div class="r">${h.precipitation ? `${h.precipitation} mm` : '&nbsp;'}</div>
      <div class="w">${round(h.windSpeedKmh)} km/h</div>
    </div>`).join('');

  document.getElementById('daily').innerHTML = fc.daily.map((d) => `
    <div class="day">
      <span class="name">${fmtDay(d.date)}</span>
      <span class="s" title="${esc(symbol(d.symbol).text)}">${symbol(d.symbol).icon}</span>
      <span class="extra">${d.rainTotal ? `${d.rainTotal} mm · ` : ''}gusts ${round(d.gustMaxKmh)} km/h</span>
      <span class="range">${round(d.max)}°<span class="lo">${round(d.min)}°</span></span>
    </div>`).join('');
}

// ---------- warnings ----------

async function loadWarnings() {
  const box = document.getElementById('warnings');
  try {
    const list = await api('/api/warnings');
    box.hidden = list.length === 0;
    box.innerHTML = list.map((w) => {
      const lvl = esc((w.level || 'yellow').toLowerCase());
      return `
      <details class="warning ${lvl}">
        <summary><span class="badge ${lvl}">${esc(w.level)}</span>${esc(w.headline)}</summary>
        <div class="meta">
          ${esc(w.type)} · Severity: ${esc(w.severity)} · Certainty: ${esc(w.certainty)}<br>
          Valid ${esc(fmtWhen(w.onset))} to ${esc(fmtWhen(w.expiry))} · Issued ${esc(fmtWhen(w.issued))}<br>
          Areas: ${esc(w.regions.join(', '))}
        </div>
        <p>${esc(w.description)}</p>
      </details>`;
    }).join('');
  } catch (err) {
    box.hidden = false;
    box.innerHTML = `<div class="warning"><span class="error">Could not load Met Éireann warnings. Check <a href="https://www.met.ie/warnings" target="_blank" rel="noopener">met.ie/warnings</a>.</span></div>`;
  }
}

// ---------- start ----------

async function loadTowns() {
  state.towns = await api('/api/towns');
  renderMarkers();
}

document.querySelectorAll('.layers button').forEach((b) => b.addEventListener('click', () => setLayer(b.dataset.layer)));
document.getElementById('play').addEventListener('click', togglePlay);
document.getElementById('frame').addEventListener('input', (e) => showFrame(Number(e.target.value)));
document.getElementById('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (p) => selectPlace({ name: 'Your location', lat: p.coords.latitude, lon: p.coords.longitude }),
    () => alert('Could not get your location.')
  );
});

loadWarnings();
selectPlace(state.place, { fly: state.place.id !== DUBLIN.id });
loadTowns().catch((e) => console.error(e));
loadGrid();
map.on('load', () => {
  drawField();
  api('/api/radar').then(setupRadar).catch((e) => {
    console.error(e);
    document.getElementById('frameTime').textContent = 'Radar unavailable';
  });
});

// Keep things fresh while the page is open.
setInterval(loadWarnings, 5 * 60 * 1000);
setInterval(loadText, 30 * 60 * 1000);
setInterval(() => loadTowns().catch(() => {}), 15 * 60 * 1000);
setInterval(loadGrid, 15 * 60 * 1000);
setInterval(() => {
  if (!state.radar) return;
  api('/api/radar').then((r) => {
    state.radar.frames.forEach((_, i) => { map.removeLayer(radarLayerId(i)); map.removeSource(radarLayerId(i)); });
    setupRadar(r);
  }).catch(() => {});
}, 10 * 60 * 1000);

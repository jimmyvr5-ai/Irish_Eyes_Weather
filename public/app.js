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
  renderMarkers();
}

// ---------- forecast panel ----------

async function selectPlace(place, { fly = true } = {}) {
  state.place = { id: place.id, name: place.name, lat: place.lat, lon: place.lon };
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
  await loadForecast(`/api/forecast?${q}`);
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
map.on('load', () => {
  api('/api/radar').then(setupRadar).catch((e) => {
    console.error(e);
    document.getElementById('frameTime').textContent = 'Radar unavailable';
  });
});

// Keep things fresh while the page is open.
setInterval(loadWarnings, 5 * 60 * 1000);
setInterval(() => loadTowns().catch(() => {}), 15 * 60 * 1000);
setInterval(() => {
  if (!state.radar) return;
  api('/api/radar').then((r) => {
    state.radar.frames.forEach((_, i) => { map.removeLayer(radarLayerId(i)); map.removeSource(radarLayerId(i)); });
    setupRadar(r);
  }).catch(() => {});
}, 10 * 60 * 1000);

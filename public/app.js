// Front end: map with radar and town markers, forecast panel, warnings.

const IRELAND = { center: [-7.9, 53.45], zoom: 6 };
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const TZ = 'Europe/Dublin';

const state = {
  layer: 'radar',
  towns: [],
  markers: [],
  selected: localGet('town') || 'dublin',
  radar: null,
  frame: 0,
  playing: null,
};

// ---------- helpers ----------

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

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
    el.className = 'marker' + (t.id === state.selected ? ' selected' : '');
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
    el.addEventListener('click', () => selectTown(t.id));
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
      paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 0 }, 'raster-fade-duration': 0 },
    });
  });
  const slider = document.getElementById('frame');
  slider.max = Math.max(0, radar.frames.length - 1);
  showFrame(radar.frames.length - 1);
}

function showFrame(i) {
  const r = state.radar;
  if (!r || !r.frames.length) {
    document.getElementById('frameTime').textContent = 'No radar';
    return;
  }
  state.frame = i;
  r.frames.forEach((_, j) => {
    const visible = state.layer === 'radar' && j === i;
    map.setPaintProperty(radarLayerId(j), 'raster-opacity', visible ? 0.75 : 0);
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

async function selectTown(id) {
  state.selected = id;
  localSet('town', id);
  document.getElementById('town').value = id;
  renderMarkers();
  await loadForecast(`/api/forecast?town=${encodeURIComponent(id)}`);
}

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
  const sel = document.getElementById('town');
  sel.innerHTML = [...state.towns].sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  if (!state.towns.some((t) => t.id === state.selected)) state.selected = 'dublin';
  sel.value = state.selected;
  renderMarkers();
}

document.querySelectorAll('.layers button').forEach((b) => b.addEventListener('click', () => setLayer(b.dataset.layer)));
document.getElementById('play').addEventListener('click', togglePlay);
document.getElementById('frame').addEventListener('input', (e) => showFrame(Number(e.target.value)));
document.getElementById('town').addEventListener('change', (e) => selectTown(e.target.value));
document.getElementById('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (p) => loadForecast(`/api/forecast?lat=${p.coords.latitude}&lon=${p.coords.longitude}`),
    () => alert('Could not get your location.')
  );
});

loadWarnings();
selectTown(state.selected);
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

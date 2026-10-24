import {
  buildGrid, toMeters, mapsSearchUrl, rankColor, computeMetrics,
  parseMapsInput, findRank, toCsv, fidToCid,
} from './grid.js';
import { scrapeMapsResults, readPlacePage } from './scraper.js';
import { BRAND } from './config.js';
import * as lead from './lead.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['keyword', 'bizName', 'bizLink', 'lat', 'lng', 'size', 'dist', 'unit', 'depth', 'zoom', 'hl', 'gl', 'delayMin', 'delayMax'];

const state = {
  pins: [],
  scan: null,        // config of the scan currently shown
  target: { name: '', fid: '', placeId: '', lat: null, lng: null },
  running: false,
  cancelled: false,
  resumeResolve: null,
  selected: null,
  centreSource: 'business',
  lookupSeq: 0,
};

// ---------- storage ----------
const store = {
  async get(key, fallback) {
    try { return (await chrome.storage.local.get(key))[key] ?? fallback; } catch { return fallback; }
  },
  set(key, value) { return chrome.storage.local.set({ [key]: value }); },
};

function readConfig() {
  const num = (id) => parseFloat($(id).value);
  return {
    keyword: $('keyword').value.trim(),
    bizName: $('bizName').value.trim(),
    lat: num('lat'), lng: num('lng'),
    size: +$('size').value,
    dist: num('dist'), unit: $('unit').value,
    depth: +$('depth').value, zoom: +$('zoom').value,
    hl: $('hl').value.trim() || 'en', gl: $('gl').value.trim().toLowerCase(),
    delayMin: num('delayMin') || 3, delayMax: num('delayMax') || 7,
  };
}

async function saveSettings() {
  const s = {};
  FIELDS.forEach((f) => { s[f] = $(f).value; });
  s.centreSource = state.centreSource;
  s.target = state.target;
  s.centreLabel = $('centreLabel').dataset.label || '';
  await store.set('settings', s);
}

async function loadSettings() {
  const s = await store.get('settings', null);
  if (s) {
    FIELDS.forEach((f) => { if (s[f] != null) $(f).value = s[f]; });
    if (!['3', '5'].includes($('size').value)) $('size').value = '3';
    if (s.centreSource) state.centreSource = s.centreSource;
    if (s.target) state.target = s.target;
    if (s.centreLabel) $('centreLabel').dataset.label = s.centreLabel;
  }
}

// ---------- map ----------
let map; let markers = [];

function initMap() {
  map = L.map('map').setView([20.5937, 78.9629], 5);
  // Satellite only. openstreetmap.org rejects extension pages (no Referer) and CARTO's raster tiles need a key,
  // so use Esri's keyless imagery. If tiles fail anyway, fall back to a plain grid background.
  const layer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Tiles © Esri',
  });
  let tileErrors = 0;
  layer.on('tileerror', () => {
    if (++tileErrors > 6) $('map').classList.add('no-tiles');
  });
  layer.on('tileload', () => { tileErrors = 0; $('map').classList.remove('no-tiles'); });
  layer.addTo(map);
  map.on('click', (e) => {
    if (state.running) return;
    setCentre(e.latlng.lat, e.latlng.lng, 'Point chosen on map', 'manual');
  });
}

function setCentre(lat, lng, label, source) {
  const old = readConfig();
  const moved = !centreOk(old) || Math.abs(old.lat - lat) > 1e-7 || Math.abs(old.lng - lng) > 1e-7;
  $('lat').value = +lat.toFixed(7);
  $('lng').value = +lng.toFixed(7);
  setSource(source ?? state.centreSource);
  const el = $('centreLabel');
  el.dataset.label = label || '';
  renderCentreLabel();
  // Re-selecting the same center must not wipe results that are on screen.
  onConfigChange(moved);
}

function renderCentreLabel() {
  const el = $('centreLabel');
  const c = readConfig();
  el.textContent = centreOk(c)
    ? `Center: ${el.dataset.label || 'custom point'} (${c.lat.toFixed(5)}, ${c.lng.toFixed(5)})`
    : 'Center not set yet';
}

const SOURCE_NAMES = { business: 'Business location', search: 'Searched place', mine: 'My location', manual: 'Custom point' };

function setSource(src) {
  state.centreSource = src;
  document.querySelectorAll('#centreSeg button').forEach((b) => b.classList.toggle('active', b.dataset.src === src));
  document.querySelectorAll('.src-panel').forEach((p) => { p.hidden = p.dataset.panel !== src; });
}

function pickSource(src) {
  setSource(src);
  if (src === 'business') {
    if (state.target.lat != null) setCentre(state.target.lat, state.target.lng, state.target.address || state.target.name || SOURCE_NAMES.business, 'business');
    else $('bizInfo').className = 'note err', $('bizInfo').textContent = 'No location known for this business yet. Paste its Google Maps link in step 2, or pick another center option.';
  } else if (src === 'mine') {
    useMyLocation();
  }
  saveSettings();
}

function centreOk(c) { return Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180; }

function pinIcon(p) {
  const found = p.status === 'done';
  const text = !found ? '' : (p.rank ?? `${state.scan?.depth ?? 20}+`);
  const bg = found ? `background:${rankColor(p.rank)}` : '';
  const sel = state.selected === p.index ? ' active' : '';
  return L.divIcon({
    className: '',
    html: `<div class="pin ${found ? '' : 'pending'}${sel}" style="${bg}">${text}</div>`,
    iconSize: [34, 34], iconAnchor: [17, 17],
  });
}

function drawPins(fit = false) {
  markers.forEach((m) => m.remove());
  markers = state.pins.map((p) => {
    const m = L.marker([p.lat, p.lng], { icon: pinIcon(p) }).addTo(map);
    m.on('click', () => selectPin(p.index));
    return m;
  });
  if (fit && state.pins.length) {
    map.fitBounds(L.latLngBounds(state.pins.map((p) => [p.lat, p.lng])).pad(0.3));
  }
}

function refreshPin(p) { markers[p.index]?.setIcon(pinIcon(p)); }

function previewGrid(fit = false) {
  if (state.running || state.scan) return;
  const c = readConfig();
  if (!centreOk(c) || !(c.dist > 0)) { state.pins = []; drawPins(); return; }
  state.pins = buildGrid(c.lat, c.lng, c.size, toMeters(c.dist, c.unit));
  drawPins(fit);
}

// Only a change to the grid itself (center, size, spacing) replaces the results on screen
// with a fresh preview; keyword, name and other edits leave them alone (saved scans are in History).
function onConfigChange(gridChanged = true) {
  if (gridChanged) {
    if (!state.running && state.scan) { state.scan = null; state.selected = null; resetDetail(); updateMetrics(); }
    previewGrid(true);
  }
  updateEstimate();
  saveSettings();
}

function updateEstimate() {
  const c = readConfig();
  const n = c.size * c.size;
  const avg = (c.delayMin + c.delayMax) / 2 + 8;
  $('estimate').textContent = `${n} pins · about ${Math.ceil((n * avg) / 60)} min`;
}

// ---------- results / metrics ----------
function updateMetrics() {
  const depth = state.scan?.depth ?? readConfig().depth;
  const m = computeMetrics(state.pins, depth);
  const f = (v, d = 1) => (v == null ? '–' : (+v.toFixed(d)).toString());
  $('mArp').textContent = f(m.arp);
  $('mAtrp').textContent = f(m.atrp);
  $('mSolv').textContent = m.solv == null ? '–' : `${Math.round(m.solv)}%`;
  $('mFound').textContent = m.scanned ? `${m.found}/${m.scanned}` : '–';
  m.buckets.forEach((n, i) => { $(`b${i}`).textContent = n; });
  $('bar').style.width = `${state.pins.length ? (m.scanned / state.pins.length) * 100 : 0}%`;
  $('exportCsv').disabled = !m.scanned;
}

function resetDetail() {
  state.selected = null;
  const box = $('detail');
  box.replaceChildren();
  const p = document.createElement('div');
  p.className = 'empty';
  p.textContent = 'Click a pin on the map to see the full ranked list for that spot.';
  box.append(p);
}

function selectPin(index) {
  const prev = state.selected;
  state.selected = index;
  if (prev != null && state.pins[prev]) refreshPin(state.pins[prev]);
  const p = state.pins[index];
  refreshPin(p);

  const box = $('detail');
  box.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = `Pin row ${p.row + 1}, column ${p.col + 1}`;
  const coords = document.createElement('div');
  coords.className = 'hint';
  coords.textContent = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  box.append(h, coords);

  const badge = document.createElement('span');
  badge.className = 'badge';
  const depth = state.scan?.depth ?? 20;
  if (p.status !== 'done') {
    badge.style.background = '#9ca3af';
    badge.textContent = 'Not scanned yet';
  } else {
    badge.style.background = rankColor(p.rank);
    badge.textContent = p.rank == null ? `Not in top ${depth}` : `Your rank: #${p.rank}`;
  }
  box.append(badge);
  if (p.note) {
    const n = document.createElement('div');
    n.className = 'hint';
    n.textContent = p.note;
    box.append(n);
  }

  if (p.url) {
    const a = document.createElement('a');
    a.href = p.url; a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = 'Open this search in Google Maps';
    const wrap = document.createElement('div');
    wrap.className = 'hint';
    wrap.append(a);
    box.append(wrap);
  }

  const ol = document.createElement('ol');
  p.items.forEach((it, i) => {
    const li = document.createElement('li');
    li.textContent = it.name;
    if (p.rank === i + 1) li.className = 'me';
    if (it.rating) {
      const s = document.createElement('small');
      s.textContent = ` ★${it.rating}${it.reviews ? ` (${it.reviews})` : ''}`;
      li.append(s);
    }
    ol.append(li);
  });
  box.append(ol);
}

function setStatus(text) { $('status').textContent = text; }

function exportCsv() {
  if (!state.scan) return;
  const csv = toCsv({ keyword: state.scan.keyword, depth: state.scan.depth, pins: state.pins });
  const safe = state.scan.keyword.replace(/[^\w]+/g, '-').toLowerCase();
  const date = new Date(state.scan.date || Date.now()).toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `geo-grid_${safe}_${date}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- business / location inputs ----------
let lookupTimer;

function parseBusiness() {
  const parsed = parseMapsInput($('bizLink').value);
  const typed = $('bizName').value.trim();
  const prev = state.target;
  const same = parsed.fid && prev.fid === parsed.fid;
  if (!typed || state.nameAuto) {
    // An auto-filled name follows the link; a name the user typed is never overwritten.
    const auto = parsed.name || (same ? prev.name : '');
    $('bizName').value = auto;
    state.nameAuto = !!auto;
  }
  state.target = {
    ...parsed,
    name: $('bizName').value.trim(),
    lat: parsed.lat ?? (same ? prev.lat : null),
    lng: parsed.lng ?? (same ? prev.lng : null),
    address: same ? prev.address : '',
  };
  state.lookupError = '';
  describeBusiness();
  clearTimeout(lookupTimer);
  if (state.target.fid && state.target.lat == null) lookupTimer = setTimeout(lookupBusiness, 600);
  else autoCentreFromBusiness();
}

function describeBusiness() {
  const t = state.target;
  const el = $('bizInfo');
  el.className = 'note';
  if (state.lookingUp) el.textContent = 'Looking up this business on Google Maps…';
  else if (state.lookupError) { el.className = 'note err'; el.textContent = `${state.lookupError} Matching will use the name instead; choose a center in step 3.`; }
  else if (t.fid) {
    el.className = 'note ok';
    el.textContent = `✓ Exact match by ID${t.address ? ` · ${t.address}` : ''}${t.lat != null ? ' · location found' : ''}`;
  } else el.textContent = 'Matching by name only. Paste the business\'s Maps link, Place ID or CID for exact matching and automatic location.';
}

function autoCentreFromBusiness() {
  const t = state.target;
  if (t.lat == null || state.running) return;
  const unset = !centreOk(readConfig());
  if (state.centreSource === 'business' || unset) {
    setCentre(t.lat, t.lng, t.address || t.name || SOURCE_NAMES.business, 'business');
  }
}

async function lookupBusiness() {
  const t = state.target;
  if (!t.fid || state.running) return;
  const seq = ++state.lookupSeq;
  state.lookingUp = true;
  describeBusiness();
  let win;
  try {
    win = await chrome.windows.create({ url: 'about:blank', type: 'popup', width: 1100, height: 800, focused: false });
    const tabId = win.tabs[0].id;
    await navigate(tabId, `https://www.google.com/maps?cid=${fidToCid(t.fid)}&hl=en`);
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: readPlacePage });
    if (seq !== state.lookupSeq) return;
    const info = parseMapsInput(result.href);
    if (info.lat == null) throw new Error('Google did not open a business page for this ID.');
    Object.assign(state.target, { lat: info.lat, lng: info.lng, address: result.address });
    if (result.name && (!$('bizName').value.trim() || state.nameAuto)) {
      $('bizName').value = result.name;
      state.nameAuto = true;
      state.target.name = result.name;
    }
  } catch (e) {
    if (seq === state.lookupSeq) state.lookupError = `Couldn't look up this business (${e.message}).`;
  } finally {
    if (win) chrome.windows.remove(win.id).catch(() => {});
    if (seq === state.lookupSeq) {
      state.lookingUp = false;
      describeBusiness();
      autoCentreFromBusiness();
      saveSettings();
    }
  }
}

async function searchAddress() {
  const q = $('addr').value.trim();
  if (!q) return;
  const box = $('addrResults');
  box.textContent = 'Searching…';
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`);
    const rows = await r.json();
    box.replaceChildren();
    if (!rows.length) { box.textContent = 'No places found. Try a nearby city or a shorter name.'; return; }
    rows.forEach((row) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = row.display_name;
      b.onclick = () => {
        setCentre(+row.lat, +row.lon, row.display_name.split(',').slice(0, 2).join(',').trim(), 'search');
        box.replaceChildren();
      };
      box.append(b);
    });
  } catch (e) {
    box.textContent = `Search failed: ${e.message}`;
  }
}

function useMyLocation() {
  const msg = $('mineMsg');
  msg.className = 'note';
  msg.textContent = 'Detecting…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      msg.className = 'note ok';
      msg.textContent = 'Location detected.';
      setCentre(pos.coords.latitude, pos.coords.longitude, SOURCE_NAMES.mine, 'mine');
    },
    (err) => {
      msg.className = 'note err';
      msg.textContent = err.code === 1
        ? 'Location permission was denied for this extension.'
        : 'Your computer could not determine its location (check that Location Services is on for Chrome). Use "Search place" or click the map instead.';
    },
    { enableHighAccuracy: false, timeout: 15000 },
  );
}

// ---------- scan engine ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function navigate(tabId, url) {
  return new Promise((resolve, reject) => {
    let started = false;
    const done = (fn, arg) => { chrome.tabs.onUpdated.removeListener(onUpdated); clearTimeout(timer); fn(arg); };
    const onUpdated = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') started = true;
      if (started && info.status === 'complete') done(resolve);
    };
    const timer = setTimeout(() => done(reject, new Error('Page load timed out')), 40000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url }).catch((e) => done(reject, e));
  });
}

function waitForUser(message) {
  $('alertText').textContent = message;
  $('alert').hidden = false;
  return new Promise((resolve) => { state.resumeResolve = resolve; }).then(() => { $('alert').hidden = true; });
}

async function scrapePin(tabId, pin, cfg) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (state.cancelled) return null;
    pin.url = mapsSearchUrl({ keyword: cfg.keyword, lat: pin.lat, lng: pin.lng, zoom: cfg.zoom, hl: cfg.hl, gl: cfg.gl });
    await navigate(tabId, pin.url);
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: scrapeMapsResults, args: [cfg.depth] });

    if (result.status === 'captcha' || result.status === 'consent') {
      const msg = result.status === 'captcha'
        ? 'Google is asking for a CAPTCHA. Solve it in the scan window, then click Resume.'
        : 'Google shows a consent page. Accept it in the scan window, then click Resume.';
      await waitForUser(msg);
      continue;
    }
    if (result.status === 'empty' && attempt < 1) { await sleep(2000); continue; }
    return result;
  }
  return { status: 'empty', items: [] };
}

async function startScan() {
  const cfg = readConfig();
  parseBusiness();
  if (!cfg.keyword) return setStatus('Enter a keyword.');
  if (!state.target.name && !state.target.fid && !state.target.placeId) return setStatus('Enter your business name or a Maps link.');
  if (!centreOk(cfg)) return setStatus('Set a center location (search a place, enter coordinates or click the map).');
  if (!(cfg.dist > 0)) return setStatus('Enter a distance greater than zero.');
  if (cfg.delayMax < cfg.delayMin) cfg.delayMax = cfg.delayMin;

  state.scan = { ...cfg, date: Date.now(), target: { ...state.target } };
  state.pins = buildGrid(cfg.lat, cfg.lng, cfg.size, toMeters(cfg.dist, cfg.unit));
  state.selected = null;
  resetDetail();
  state.running = true;
  state.cancelled = false;
  $('cta').hidden = true;
  setRunning(true);
  drawPins(true);
  updateMetrics();

  let win;
  try {
    win = await chrome.windows.create({ url: 'about:blank', type: 'popup', width: 1280, height: 900, focused: false });
    const tabId = win.tabs[0].id;

    for (const pin of state.pins) {
      if (state.cancelled) break;
      setStatus(`Scanning pin ${pin.index + 1} of ${state.pins.length}…`);
      const result = await scrapePin(tabId, pin, cfg);
      if (!result) break;
      pin.items = result.items;
      pin.rank = findRank(result.items, state.target);
      pin.status = 'done';
      pin.note = result.status === 'empty' ? 'no results' : '';
      refreshPin(pin);
      updateMetrics();
      if (pin.index < state.pins.length - 1 && !state.cancelled) {
        await sleep((cfg.delayMin + Math.random() * (cfg.delayMax - cfg.delayMin)) * 1000);
      }
    }
  } catch (e) {
    setStatus(`Scan stopped: ${e.message}. If you closed the scan window, start again.`);
    state.cancelled = true;
  } finally {
    if (win) chrome.windows.remove(win.id).catch(() => {});
    state.running = false;
    setRunning(false);
    $('alert').hidden = true;
  }

  const m = computeMetrics(state.pins, cfg.depth);
  if (m.scanned) await saveHistory();
  if (m.scanned && !state.cancelled) await afterCompletedScan();
  if (state.cancelled) setStatus(`Stopped after ${m.scanned} of ${state.pins.length} pins.`);
  else setStatus(`Done. ARP ${m.arp == null ? '–' : m.arp.toFixed(1)}, SoLV ${Math.round(m.solv ?? 0)}%. Click a pin to see the full list.`);
}

// ---------- branding and lead capture ----------
function applyBrand() {
  document.querySelectorAll('[data-brand-name]').forEach((el) => { el.textContent = BRAND.name; });
  document.querySelectorAll('[data-brand-link]').forEach((el) => { el.href = BRAND.url; });
  $('ctaText').textContent = BRAND.ctaText;
  $('ctaBtn').textContent = BRAND.ctaButton;
  $('ctaBtn').href = BRAND.url;
  $('leadTitle').textContent = BRAND.promptTitle;
  $('leadText').textContent = BRAND.promptText;
  $('leadPrivacy').href = BRAND.privacyUrl;
}

function openLeadModal() {
  $('leadErr').textContent = '';
  $('leadModal').hidden = false;
  $('leadEmail').focus();
}

async function afterCompletedScan() {
  $('cta').hidden = false;
  const s = await lead.recordScan(store);
  if (lead.shouldPrompt(s)) openLeadModal();
}

function initLead() {
  applyBrand();
  lead.flushPending(store).catch(() => {});
  $('leadForm').onsubmit = async (e) => {
    e.preventDefault();
    const res = await lead.submitLead(store, {
      email: $('leadEmail').value,
      name: $('leadName').value,
      website: $('leadWebsite').value,
      consent: $('leadConsent').checked,
      honeypot: $('leadHp').value,
    }, { version: chrome.runtime.getManifest().version });
    if (!res.ok) { $('leadErr').textContent = res.error; return; }
    $('leadModal').hidden = true;
    setStatus('Thanks! You are all set.');
  };
  $('leadSkip').onclick = async () => { await lead.skipPrompt(store); $('leadModal').hidden = true; };
}

function setRunning(on) {
  $('start').disabled = on;
  $('stop').disabled = !on;
}

function stopScan() {
  state.cancelled = true;
  state.resumeResolve?.();
}

// ---------- history ----------
async function saveHistory() {
  const list = await store.get('history', []);
  const slim = state.pins.map(({ index, row, col, lat, lng, status, rank, note, url, items }) => ({
    index, row, col, lat, lng, status, rank, note, url,
    items: items.map(({ name, href, fid, placeId, rating, reviews }) => ({ name, href, fid, placeId, rating, reviews })),
  }));
  list.unshift({ id: String(state.scan.date), scan: state.scan, pins: slim });
  await store.set('history', list.slice(0, 50));
}

async function renderHistory() {
  const list = await store.get('history', []);
  const box = $('historyList');
  box.replaceChildren();
  if (!list.length) { box.textContent = 'No saved scans yet.'; return; }
  list.forEach((h) => {
    const m = computeMetrics(h.pins, h.scan.depth);
    const row = document.createElement('div');
    row.className = 'hist-row';
    const info = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = `${h.scan.keyword} · ${h.scan.bizName || h.scan.target.name}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${new Date(h.scan.date).toLocaleString()} · ${h.scan.size}×${h.scan.size} @ ${h.scan.dist}${h.scan.unit} · ARP ${m.arp == null ? '–' : m.arp.toFixed(1)} · SoLV ${Math.round(m.solv ?? 0)}%`;
    info.append(title, meta);
    const btns = document.createElement('div');
    btns.className = 'btns';
    const open = document.createElement('button');
    open.textContent = 'Open';
    open.onclick = () => openHistory(h);
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = async () => { await store.set('history', list.filter((x) => x.id !== h.id)); renderHistory(); };
    btns.append(open, del);
    row.append(info, btns);
    box.append(row);
  });
}

function openHistory(h) {
  showView('scan');
  state.scan = h.scan;
  state.pins = h.pins;
  state.target = h.scan.target;
  state.selected = null;
  resetDetail();
  ['keyword', 'bizName', 'lat', 'lng', 'size', 'dist', 'unit', 'depth', 'zoom', 'hl', 'gl'].forEach((k) => { $(k).value = h.scan[k] ?? ''; });
  setSource(h.scan.target?.fid ? 'business' : 'manual');
  $('centreLabel').dataset.label = 'Saved scan';
  renderCentreLabel();
  drawPins(true);
  updateMetrics();
  setStatus(`Saved scan from ${new Date(h.scan.date).toLocaleString()}.`);
}

function showView(name) {
  $('view-scan').hidden = name !== 'scan';
  $('view-history').hidden = name !== 'history';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'history') renderHistory();
  else map.invalidateSize();
}

// ---------- wiring ----------
async function init() {
  initMap();
  await loadSettings();
  setSource(state.centreSource);
  renderCentreLabel();
  resetDetail();
  parseBusiness();
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => showView(t.dataset.view); });
  const GRID_FIELDS = ['lat', 'lng', 'size', 'dist', 'unit'];
  FIELDS.forEach((f) => $(f).addEventListener('input', () => onConfigChange(GRID_FIELDS.includes(f))));
  $('bizLink').addEventListener('input', parseBusiness);
  $('bizName').addEventListener('input', () => {
    state.nameAuto = false;
    state.target.name = $('bizName').value.trim();
  });
  $('lat').addEventListener('input', () => { setSource('manual'); $('centreLabel').dataset.label = 'Typed coordinates'; renderCentreLabel(); });
  $('lng').addEventListener('input', () => { setSource('manual'); $('centreLabel').dataset.label = 'Typed coordinates'; renderCentreLabel(); });
  document.querySelectorAll('#centreSeg button').forEach((b) => { b.onclick = () => pickSource(b.dataset.src); });
  $('addrBtn').onclick = searchAddress;
  $('addr').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchAddress(); });
  $('useMine').onclick = useMyLocation;
  $('start').onclick = startScan;
  $('stop').onclick = stopScan;
  $('resume').onclick = () => state.resumeResolve?.();
  $('exportCsv').onclick = exportCsv;
  initLead();
  previewGrid(true);
  updateEstimate();
  updateMetrics();
}

init();

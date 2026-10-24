// Pure helpers: grid math, rank colours, metrics, Maps link parsing and business matching.

export const METERS_PER_DEG_LAT = 111320;

export function toMeters(value, unit) {
  if (unit === 'km') return value * 1000;
  if (unit === 'mi') return value * 1609.344;
  return value;
}

// Rows run north -> south, columns west -> east. Even sizes straddle the centre.
export function buildGrid(lat, lng, size, stepMeters) {
  const dLat = stepMeters / METERS_PER_DEG_LAT;
  const dLng = stepMeters / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  const mid = (size - 1) / 2;
  const pins = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      pins.push({
        index: pins.length,
        row,
        col,
        lat: round(lat + (mid - row) * dLat),
        lng: round(lng + (col - mid) * dLng),
        status: 'pending',
        rank: null,
        items: [],
      });
    }
  }
  return pins;
}

const round = (n) => Math.round(n * 1e9) / 1e9;

export function mapsSearchUrl({ keyword, lat, lng, zoom = 15, hl = 'en', gl = '' }) {
  const params = new URLSearchParams({ hl });
  if (gl) params.set('gl', gl);
  return `https://www.google.com/maps/search/${encodeURIComponent(keyword).replace(/%20/g, '+')}/@${lat},${lng},${zoom}z?${params}`;
}

export function rankColor(rank) {
  if (rank == null) return '#ef4444';
  if (rank <= 3) return '#22c55e';
  if (rank <= 10) return '#eab308';
  if (rank <= 15) return '#f97316';
  return '#ef4444';
}

export function rankBucket(rank) {
  if (rank == null) return 3;
  if (rank <= 3) return 0;
  if (rank <= 10) return 1;
  if (rank <= 15) return 2;
  return 3;
}

// ARP: mean rank where found. ATRP: not-found counts as depth+1. SoLV: % of pins in the top 3.
export function computeMetrics(pins, depth) {
  const done = pins.filter((p) => p.status === 'done');
  const found = done.filter((p) => p.rank != null);
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return {
    scanned: done.length,
    total: pins.length,
    found: found.length,
    arp: mean(found.map((p) => p.rank)),
    atrp: mean(done.map((p) => (p.rank == null ? depth + 1 : p.rank))),
    solv: done.length ? (done.filter((p) => p.rank != null && p.rank <= 3).length / done.length) * 100 : null,
    buckets: [0, 1, 2, 3].map((b) => done.filter((p) => rankBucket(p.rank) === b).length),
  };
}

// Accepts "lat,lng", a Google Maps URL, a feature id (0x..:0x..) or a ChIJ place id.
export function parseMapsInput(text) {
  const out = { name: '', fid: '', placeId: '', lat: null, lng: null };
  const s = (text || '').trim();
  if (!s) return out;

  const plain = s.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (plain) return { ...out, lat: +plain[1], lng: +plain[2] };

  let decoded = s;
  try { decoded = decodeURIComponent(s); } catch { /* keep raw */ }

  const fid = decoded.match(/0x[0-9a-f]+:0x[0-9a-f]+/i);
  if (fid) out.fid = fid[0].toLowerCase();
  const pid = decoded.match(/ChIJ[\w-]{10,}/);
  if (pid) out.placeId = pid[0];
  if (!out.fid && out.placeId) out.fid = placeIdToFid(out.placeId);

  const name = decoded.match(/\/maps\/place\/([^/@?]+)/);
  if (name) out.name = name[1].replace(/\+/g, ' ').trim();

  const pin = decoded.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const view = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const at = pin || view;
  if (at) { out.lat = +at[1]; out.lng = +at[2]; }
  return out;
}

// A ChIJ… place id is a tiny protobuf wrapping the same two 64-bit numbers as the
// 0x…:0x… feature id that Maps result links carry, so one can be converted to the other.
export function placeIdToFid(placeId) {
  try {
    const bin = atob(placeId.replace(/-/g, '+').replace(/_/g, '/'));
    if (bin.length < 20 || bin.charCodeAt(0) !== 0x0a || bin.charCodeAt(2) !== 0x09 || bin.charCodeAt(11) !== 0x11) return '';
    const word = (offset) => {
      let hex = '';
      for (let i = 7; i >= 0; i--) hex += bin.charCodeAt(offset + i).toString(16).padStart(2, '0');
      return `0x${hex.replace(/^0+(?=.)/, '')}`;
    };
    return `${word(3)}:${word(12)}`;
  } catch {
    return '';
  }
}

// Google's numeric "cid" is the second half of the feature id in decimal.
export const fidToCid = (fid) => BigInt(fid.split(':')[1]).toString();

// Ids found inside a Maps result link.
export function idsFromHref(href) {
  let h = href || '';
  try { h = decodeURIComponent(h); } catch { /* keep raw */ }
  return {
    fid: (h.match(/0x[0-9a-f]+:0x[0-9a-f]+/i) || [''])[0].toLowerCase(),
    placeId: (h.match(/ChIJ[\w-]{10,}/) || [''])[0],
  };
}

export const normalizeName = (s) =>
  (s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// An id decides when both sides have one; otherwise fall back to the name
// ("Ksoft Solution" still matches a listing called "Ksoft Solutions").
export function isTargetMatch(item, target) {
  const itemFid = item.fid || idsFromHref(item.href).fid;
  const itemPid = item.placeId || idsFromHref(item.href).placeId;
  if (target.fid && itemFid) return target.fid === itemFid;
  if (target.placeId && itemPid) return target.placeId === itemPid;

  const a = normalizeName(item.name);
  const b = normalizeName(target.name);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a));
}

export function findRank(items, target) {
  const i = items.findIndex((it) => isTargetMatch(it, target));
  return i === -1 ? null : i + 1;
}

export function toCsv({ keyword, depth, pins }) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Rank', 'Latitude,Longitude', 'URL', ...Array.from({ length: depth }, (_, i) => i + 1), 'Status']
    .map(esc).join(',');
  const rows = pins.map((p) => [
    p.rank ?? `${depth}+`,
    `${p.lat},${p.lng}`,
    p.url || '',
    ...Array.from({ length: depth }, (_, i) => p.items[i]?.name || ''),
    p.status === 'done' ? (p.note || 'ok') : p.status,
  ].map(esc).join(','));
  return [head, ...rows].join('\n');
}

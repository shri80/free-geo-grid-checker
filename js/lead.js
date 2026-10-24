// Lead capture: soft email prompt rule, submission to a webhook and an offline retry queue.
// `st` is a storage object with get(key, fallback) and set(key, value), so this can run outside Chrome.
import { LEAD_WEBHOOK_URL, PROMPT_EVERY } from './config.js';

const KEY = 'leadState';
const blank = () => ({ scanCount: 0, lastPromptCount: 0, lead: null, pending: [] });

export const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((e || '').trim());

export function shouldPrompt(s) {
  if (s.lead) return false;
  return s.scanCount >= PROMPT_EVERY && s.scanCount - s.lastPromptCount >= PROMPT_EVERY;
}

export async function loadState(st) {
  return { ...blank(), ...(await st.get(KEY, {})) };
}

export async function recordScan(st) {
  const s = await loadState(st);
  s.scanCount += 1;
  await st.set(KEY, s);
  return s;
}

export async function skipPrompt(st) {
  const s = await loadState(st);
  s.lastPromptCount = s.scanCount;
  await st.set(KEY, s);
}

async function post(payload, fetchFn) {
  if (!LEAD_WEBHOOK_URL) throw new Error('webhook not configured');
  // text/plain keeps this a "simple" request, which Apps Script accepts without a preflight.
  const r = await fetchFn(LEAD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`webhook returned ${r.status}`);
}

// Returns { ok, error? }. A failed send is queued, and the visitor still counts as a lead locally.
export async function submitLead(st, form, { fetchFn = fetch, version = '' } = {}) {
  const email = (form.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!form.consent) return { ok: false, error: 'Please tick the consent box to continue.' };
  if (form.honeypot) return { ok: true }; // bots fill hidden fields; pretend it worked

  const s = await loadState(st);
  const payload = {
    email,
    name: (form.name || '').trim(),
    website: (form.website || '').trim(),
    source: 'geo-grid-extension',
    scanCount: s.scanCount,
    version,
    ts: new Date().toISOString(),
  };
  s.lead = { email, ts: payload.ts };
  try {
    await post(payload, fetchFn);
  } catch {
    s.pending.push(payload);
  }
  await st.set(KEY, s);
  return { ok: true };
}

export async function flushPending(st, fetchFn = fetch) {
  const s = await loadState(st);
  if (!s.pending.length || !LEAD_WEBHOOK_URL) return;
  const left = [];
  for (const p of s.pending) {
    try { await post(p, fetchFn); } catch { left.push(p); }
  }
  s.pending = left;
  await st.set(KEY, s);
}

// Injected into a Maps place page (opened via ?cid=…) to read the business name, address and final URL.
export async function readPlacePage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (/\/maps\/place\//.test(location.href) && /!3d-?\d/.test(location.href) && document.querySelector('h1')) break;
    await sleep(500);
  }
  const address = (document.querySelector('button[data-item-id="address"]')?.innerText || '').replace(/^[^\wऀ-ॿ]+/, '').trim();
  return { href: location.href, name: (document.querySelector('h1')?.innerText || '').trim(), address };
}

// Injected into a Google Maps search tab with chrome.scripting.executeScript.
// It is serialised, so it must stay self-contained (no imports or outer references).
// All Google DOM selectors live here so they are easy to fix when Maps changes.
export async function scrapeMapsResults(maxResults) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const blocked = () => {
    if (/consent\.google\./.test(location.href)) return 'consent';
    if (/\/sorry\//.test(location.href) || document.querySelector('form#captcha-form, iframe[src*="recaptcha"]')) return 'captcha';
    return '';
  };

  const idsOf = (href) => {
    let h = href || '';
    try { h = decodeURIComponent(h); } catch { /* keep raw */ }
    return {
      fid: (h.match(/0x[0-9a-f]+:0x[0-9a-f]+/i) || [''])[0].toLowerCase(),
      placeId: (h.match(/ChIJ[\w-]{10,}/) || [''])[0],
    };
  };

  const collect = (feed) => {
    const out = [];
    const seen = new Set();
    feed.querySelectorAll('a[href*="/maps/place/"]').forEach((a) => {
      const name = (a.getAttribute('aria-label') || '').trim();
      if (!name || seen.has(a.href)) return;
      const card = a.closest('.Nv2PK') || a.parentElement;
      if (card && /^\s*(Sponsored|Ad)\s*$/m.test(card.innerText || '')) return;
      seen.add(a.href);
      const label = card?.querySelector('span[role="img"]')?.getAttribute('aria-label') || '';
      out.push({
        name,
        href: a.href,
        ...idsOf(a.href),
        rating: +((label.match(/(\d(?:\.\d)?)/) || [])[1] || 0) || null,
        reviews: +(((label.match(/([\d,]+)\s*Reviews?/i) || [])[1] || '').replace(/,/g, '')) || null,
      });
    });
    return out;
  };

  const t0 = Date.now();
  let feed = null;
  while (Date.now() - t0 < 25000) {
    if (blocked()) return { status: blocked(), items: [] };
    feed = document.querySelector('div[role="feed"]');
    if (feed && feed.querySelector('a[href*="/maps/place/"]')) break;
    // Maps jumps straight to the place when the search has a single hit.
    if (!feed && /\/maps\/place\//.test(location.href) && document.querySelector('h1')) {
      const name = document.querySelector('h1').innerText.trim();
      return { status: 'ok', items: [{ name, href: location.href, ...idsOf(location.href), rating: null, reviews: null }] };
    }
    await sleep(500);
  }
  if (blocked()) return { status: blocked(), items: [] };
  if (!feed) return { status: 'empty', items: [] };

  let last = 0;
  let stalls = 0;
  while (Date.now() - t0 < 60000) {
    const n = collect(feed).length;
    if (n >= maxResults) break;
    if (/reached the end/i.test((feed.innerText || '').slice(-400))) break;
    feed.scrollTo(0, feed.scrollHeight);
    await sleep(1200);
    if (n === last) { if (++stalls >= 3) break; } else { stalls = 0; last = n; }
  }
  return { status: 'ok', items: collect(feed).slice(0, maxResults) };
}

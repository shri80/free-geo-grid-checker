# Free Geo Grid Tracker

![Free Geo Grid Tracker screenshot](docs/screenshot.png)

Chrome extension (Manifest V3) that checks where a business ranks in Google Maps results across a grid of coordinates.

## Install
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** and pick this folder.
3. Click the extension icon; the tool opens in a tab.

## Use
1. Enter the keyword and the client's business name. Pasting the business's Google Maps URL (or a `0x…:0x…` / `ChIJ…` id) matches by id and also lets you use **Business location** as the center.
2. Set the center: search any city or address, enter lat/lng, use your current location, or click the map. This works for clients in other cities.
3. Pick grid size and distance between pins, then **Start scan**. A background window visits each pin's Maps search URL (`/maps/search/<keyword>/@lat,lng,15z`), reads the ranked results and finds your business.
4. Click a pin to see the full ranked list. **Export CSV** or reopen past scans from **History**.

## Metrics
- **ARP**: average rank over pins where the business was found.
- **ATRP**: average rank counting "not found" as depth + 1.
- **SoLV**: share of pins ranking in the top 3.

## Notes
- If Google shows a CAPTCHA or consent page the scan pauses; solve it in the scan window and click **Resume**.
- Keep delays at 3 s or more. Scraping Google is against its terms; use responsibly.
- All Google selectors live in `js/scraper.js`; fix them there if Maps changes its markup.
- `js/grid.js` holds the pure logic (grid math, parsing, matching, metrics, CSV).

## Lead capture (GMB Briefcase)
- After the 3rd completed scan the tool asks for an email (name and website optional, with a consent checkbox). **Maybe later** re-asks after 3 more scans. Nothing is locked either way.
- A "Try GMB Briefcase" banner appears after every completed scan and a "Powered by" footer is always shown.
- Setup: create a Google Sheet, paste `docs/lead-webhook.gs` into Apps Script, deploy as a web app (access: Anyone), and put its URL in `LEAD_WEBHOOK_URL` in `js/config.js`. Until it is set, leads are kept locally and sent once it is.
- Brand text and links (including the privacy policy URL) live in `js/config.js`; check they point to real pages.
- Before a Web Store listing: publish a privacy policy that lists the data sent (email, name, website, scan count).

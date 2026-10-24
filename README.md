# Free Geo Grid Checker

![Free Geo Grid Checker screenshot](docs/screenshot.png)

Free Chrome extension (Manifest V3) that checks where a business ranks in local Maps search results across a grid of locations.

## Features
- 3×3 (9 pins) and 5×5 (25 pins) grids with adjustable spacing (km, meters or miles).
- Results depth of 10, 20, 30 or 40 listings per pin.
- Interactive map showing the rank at every pin; click a pin for the full ranked list.
- Match your business by name, Maps link, Place ID or CID.
- Set the center four ways: business location, searched place, your current location, or map click / coordinates. Works for clients in other cities.
- Metrics: ARP, ATRP and SoLV (see below).
- Language and country settings, map zoom, and adjustable delay between pins.
- Stop and Resume, including after a CAPTCHA or consent page.
- Export CSV and reopen past scans from History.

## Install
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** and pick this folder.
3. Click the extension icon; the tool opens in a tab.

## Use
1. Enter the keyword and the client's business name. Pasting the business's Maps URL (or a `0x…:0x…` / `ChIJ…` id) matches by id and also lets you use **Business location** as the center.
2. Set the center: search any city or address, enter lat/lng, use your current location, or click the map.
3. Pick grid size and distance between pins, then **Start scan**. A background window checks each pin's local search results and finds your business.
4. Click a pin to see the full ranked list. **Export CSV** or reopen past scans from **History**.

## Metrics
- **ARP**: average rank over pins where the business was found.
- **ATRP**: average rank counting "not found" as depth + 1.
- **SoLV**: share of pins ranking in the top 3.

## Notes
- If a CAPTCHA or consent page appears, the scan pauses; solve it in the scan window and click **Resume**.
- Keep delays at 3 s or more and use the tool responsibly. Results come from public search pages and may differ from what a user sees on their own device.
- Page-reading selectors live in `js/scraper.js`; update them there if the page markup changes.
- `js/grid.js` holds the pure logic (grid math, parsing, matching, metrics, CSV).

/**
 * Lead webhook for the Free Geo Grid Tracker extension.
 *
 * Setup:
 * 1. Create a Google Sheet; in Extensions > Apps Script paste this file.
 * 2. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 3. Copy the web app URL into LEAD_WEBHOOK_URL in js/config.js.
 */
const SHEET_NAME = 'Leads';
const HEADERS = ['Timestamp', 'Email', 'Name', 'Website', 'Source', 'Scans', 'Version'];
const MAX_PER_MINUTE = 30; // crude flood guard across all visitors

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const email = String(data.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ ok: false, error: 'bad email' });

    const cache = CacheService.getScriptCache();
    const n = Number(cache.get('rate') || 0);
    if (n >= MAX_PER_MINUTE) return json({ ok: false, error: 'rate limited' });
    cache.put('rate', String(n + 1), 60);

    const sheet = getSheet();
    const emails = sheet.getRange(2, 2, Math.max(sheet.getLastRow() - 1, 1), 1).getValues().flat();
    if (emails.indexOf(email) === -1) {
      sheet.appendRow([
        new Date(), email, clip(data.name), clip(data.website),
        clip(data.source), Number(data.scanCount) || 0, clip(data.version),
      ]);
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

const clip = (v) => String(v || '').slice(0, 200);
const json = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

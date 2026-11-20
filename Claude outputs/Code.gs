/**
 * LOGISTICS DESK — Google Sheet sync              Jain Wire Netting Corporation · EKM
 * Script version 3.1 (after pasting: run installTriggers once if never done - see the note under SCRIPT_VERSION)
 *
 * This script turns this Google Sheet into the shared store for Logistics Desk.
 * The order tabs keep the same layout as the PENDING ORDERS sheet:
 *
 *     A          B          C                     D      E         F
 *     03-10-2026
 *                Local      APCON AMBALAMUGAL                                  <- party row (bold)
 *                           GI Concertina Coil    190    8         1520        <- item rows
 *
 *   An order going to one of the party's sites has a "Delivery - <place>" row right under the
 *   party row (3.0). Its routes (column B) are the site's, and the block sits in the site's tab.
 *                           RBT                   41     5         205
 *
 * You can type orders straight into these tabs exactly like you do now. The tool picks
 * them up on its next sync. Column H holds a hidden ID for each item line. Never type in
 * column H, and never copy a row's ID onto another row.
 *
 * Other tabs used by the tool:
 *   MASTERS   routes, sheet tabs, vehicle types, vehicle numbers, drivers,
 *             route combinations, settings (edit here or in the tool)
 *   PARTIES   party, routes, place, pincode, location link, map spot (lat,lng) - edit here or
 *             in the tool. A delivery location is a row named "PARTY @ PLACE".
 *   _DATA     the tool's own data. Hidden. DO NOT EDIT. Column A: holds, due dates, stock,
 *             plan…; column B: Plan log; column C: Upload log (2.4 - each saved on its own).
 * Any other tab (e.g. REQUIREMENTS FOR OFFICE) is never read or touched.
 *
 * SETUP — the full steps are in the setup guide. In short:
 *   1. Put a long random key (letters and numbers, 20+ characters) in Project Settings (gear,
 *      left side) → Script Properties → Add script property: Property SECRET, Value = the key.
 *      (3.2) Set once, it stays when you paste a new Code.gs - nothing to type on line 37.
 *      The old way (the key on the SECRET line below) still works if no property is set.
 *   2. Run setupSheet once (select it in the toolbar, press Run, allow access).
 *   3. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.
 *   4. Paste the web app URL and the key into Logistics Desk → Master Data → Google Sheet sync.
 */

const SECRET = 'CHANGE-THIS-TO-A-LONG-RANDOM-KEY'; // only used when Script Properties has no SECRET
// 3.2: the key lives in Project Settings → Script Properties (SECRET), so it never has to be
// typed into the code; the line above is the fallback for a script set up the old way.
function theKey() {
  try { const k = PropertiesService.getScriptProperties().getProperty('SECRET'); if (k && String(k).trim()) return String(k).trim(); } catch (err) {}
  return SECRET;
}

// Order tabs created by setupSheet (same as the PENDING ORDERS sheet). Edit before running
// setupSheet if you like; afterwards the list lives in MASTERS → SHEET TABS.
const DEFAULT_TABS = ['THRISSUR', 'CHERTHALA/ALPY', 'KOTTAYAM', 'TVM', 'IDUKKI', 'LOCAL'];

const SCRIPT_VERSION = '3.3.1';
/* 3.3 — order note: a party name typed in the sheet with a note in brackets at the end,
 *  "ABC TRADERS (tomorrow need)", is read as party ABC TRADERS with the order note "tomorrow need";
 *  the cell is cleaned up and the note goes into column G of the party row. Column G of a party row
 *  is that order's note (field `onote` on each of its lines). A name that is itself a known party
 *  (PARTIES tab), e.g. "XYZ (KOLLAM)", is left alone. Needs tool 3.8 (older tools would drop it). */
/* 3.2 — the key can live in Project Settings → Script Properties (SECRET) instead of line 37, so
 *  pasting a new Code.gs no longer needs the key typed in. Nothing else changed. */
/* 3.1 — only the version check changed: saving needs tool 3.1, because 3.1 keeps a note of lines
 *  deleted in the tool (for "Find missing orders") and an older tool would drop that note.
 * 3.0 — delivery locations and map spots:
 *  - Order tabs: a "Delivery - <place>" row (col C, no numbers) under a party row means that
 *    party's order for that site; it is read as the party "PARTY @ PLACE" and written back the
 *    same way. Other rows are read exactly as before.
 *  - PARTIES gets column F, MAP SPOT ("lat,lng"), used by the tool's route links.
 *  - Saving needs tool 3.0 (older tools would drop map spots and delivery rows). */
/* 2.4 — smaller saves and syncs:
 *  - _DATA is kept in three parts, each with its own fingerprint: column A = everything else,
 *    B = Plan log, C = Upload log. A save writes only the part that changed (a 2.4 tool also SENDS
 *    only that part), and a 2.4 tool asking "what changed?" gets back only the changed parts and
 *    order tabs instead of the whole sheet. The old one-column layout is read as before and moves
 *    to the new layout on the next save. Tools 2.3 keep working (they send and get everything). */
/* 2.3 — no silent overwrites:
 *  - Before a save rewrites an order tab, the tab is read and compared with the copy the device
 *    based its change on. If it differs (changed by another script, an add-on, or anything the edit
 *    trigger can't see), nothing is written: the device gets the fresh sheet, merges, saves again.
 *  - The remembered sheet version is trusted for at most TRUST_MIN minutes since the last full read.
 *  - Saving needs tool 2.3 or newer (older tools could lose data when merging). Older copies get a
 *    "reload the page" message; their changes stay on that device until it is reloaded.
 *  - Clashes and lines removed by hand are noted in the ACCESS LOG (WHAT = CLASH / REMOVED). */
const MIN_TOOL = '3.8', TRUST_MIN = 10;
/* 2.1 — faster sync:
 *  - "Anything new?" checks (pull with a known version) and pings are answered without waiting
 *    for the script lock, so they never queue behind a slow save.
 *  - Run installTriggers ONCE (select it in the toolbar → Run → allow). It adds a sheet trigger
 *    that marks "something changed" for any edit, including deleted / inserted rows, so the check
 *    no longer has to measure every tab. Without it everything still works, just slower.
 *  - A device on 2.1 sends only the parts that changed (masters, parties, the order tabs that
 *    changed, _DATA); only those are written and read back. Older devices still send everything. */
const CACHE_KEY = 'ld_state', CACHE_SECS = 900; // remembered sheet version - see fastState()
const ORDER_HEAD = ['DATE', 'ROUTES', 'PARTY / ITEM', 'QTY', 'UNIT WT', 'TOTAL WT', 'REMARK', 'ID'];
const ID_COL = 8;            // column H
const NO_TAB = 'NO TAB';     // orders that have no sheet tab in the tool
const MASTERS = 'MASTERS', PARTIES = 'PARTIES', DATA = '_DATA';
const CHUNK = 40000;         // characters per _DATA cell (a cell holds max 50,000)

/* ===================== web app ===================== */

function doGet() {
  return out({ ok: true, app: 'Logistics Desk sync', version: SCRIPT_VERSION });
}

function doPost(e) {
  TABS_MEMO = null; PUSH_START = 0; EXPECT_T = null;
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'Bad request' }); }
  const KEY = theKey();
  if (!KEY || KEY.indexOf('CHANGE-THIS') === 0) return out({ ok: false, error: 'Set the key first: Project Settings → Script Properties → SECRET' });
  if (req.key !== KEY) { accessLog(req, 'WRONG KEY', 'someone tried to connect or sync with a wrong key'); return out({ ok: false, error: 'Wrong key' }); }
  // quick answers that never wait for the lock: a ping, and "nothing new since your version".
  // Reading the remembered version without the lock is safe - at worst it is a moment old and
  // the next check catches up.
  try {
    const ss0 = SpreadsheetApp.getActiveSpreadsheet();
    // 2.1.1: the sheet's own address, so the tool's "Open the Google Sheet" link needs no typing
    if (req.action === 'ping') accessLog(req, req.connect ? 'Connected' : 'Opened the tool', '');
    if (req.action === 'ping') return out({ ok: true, name: ss0.getName(), url: ss0.getUrl(), version: SCRIPT_VERSION, trigger: triggerOn() });
    if (req.action === 'pull' && req.known) {
      const f0 = fastState(ss0);
      if (f0 && f0.version === req.known) return out({ ok: true, same: true, version: f0.version });
    }
  } catch (err) {}
  const lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (err) { return out({ ok: false, busy: true, error: 'Sheet busy, try again' }); }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (req.action === 'ping') {
      return out({ ok: true, name: ss.getName(), version: SCRIPT_VERSION });
    }
    if (req.action === 'pull') {
      // fast path: nothing typed in the sheet since the last sync and the device already has
      // this version - answer without reading the sheet at all
      const fast = fastState(ss);
      if (req.known && fast && fast.version === req.known) return out({ ok: true, same: true, version: fast.version });
      const st = readAll(ss);
      if (req.known && req.known === st.version) return out({ ok: true, same: true, version: st.version });
      if (!req.known) accessLog(req, 'First sync', 'downloaded everything from the sheet');
      // 2.4: a device that says which parts it has gets only the ones that changed
      if (req.known && req.have && req.have.m === st.hashes.m) return out(changedOnly(st, req.have));
      return out({ ok: true, version: st.version, empty: st.empty, model: st.model, hashes: st.hashes });
    }
    if (req.action === 'push') {
      if (!toolAtLeast(req.app, MIN_TOOL)) {
        oldToolNote(req);
        return out({ ok: false, old: true, error: 'This copy of Logistics Desk (' + (req.app ? 'v' + req.app : 'an older version') + ') is too old to save to the sheet. Reload the page to get the new version - your changes stay on this device and are sent after the reload.' });
      }
      // anything typed in the sheet from here on is checked again right before each tab is written
      PUSH_START = req.force ? 0 : Date.now();
      const fast = fastState(ss);
      let st = null, hashes = null, version = '';
      EXPECT_T = null;
      if (fast) { hashes = fast.hashes; version = fast.version; }
      else if (req.force) {
        // "replace the sheet with this device" must work even when _DATA can't be read
        try { st = readAll(ss); hashes = st.hashes; version = st.version; }
        catch (err) { if (!err.ld) throw err; keepDamagedData(ss); st = null; }
      }
      else { st = readAll(ss); hashes = st.hashes; version = st.version; }
      // someone (the sheet, or another device) changed things since this device last synced
      if (!req.force && version !== req.baseVersion) {
        if (!st) st = readAll(ss);
        if (!st.empty && st.version !== req.baseVersion) return out({ ok: false, conflict: true, version: st.version, model: st.model, hashes: st.hashes });
      }
      // 2.3: each order tab must still hold what this version says, right before it is rewritten
      // (only needed when the version came from memory - a sheet read just now is already current)
      if (!req.force && fast && !st) EXPECT_T = hashes.t;
      // 2.1.2: a row typed in the sheet while this save is being written must not be wiped.
      // writeOrderSheet stops (UNSEEN) if it finds one; the device then gets the fresh sheet,
      // merges it with its own changes and saves again.
      let wrote;
      try { wrote = req.parts && !req.force ? writeParts(ss, req.model, req.parts) : writeAll(ss, req.model); }
      catch (err) {
        if (!err.unseen || req.force) throw err;
        SpreadsheetApp.flush(); TABS_MEMO = null;
        const st2 = readAll(ss); // gives the new rows their IDs
        return out({ ok: false, conflict: true, version: st2.version, model: st2.model, hashes: st2.hashes });
      }
      SpreadsheetApp.flush();
      // read back only what was written; untouched parts keep their hashes
      // read back only what was written; masters are always re-read and a tab that is new to the
      // list is read too (readAll does both), so a masters change no longer means reading everything
      const after = readAll(ss, !hashes ? null : { hashes: hashes, wrote: wrote });
      if (req.force) accessLog(req, 'REPLACED THE SHEET', 'Admin → "Replace the sheet with this device" (or first fill)');
      else logSave(req);
      // 2.3: clashes met while merging, and lines / entries / parties taken out by hand
      (Array.isArray(req.events) ? req.events : []).slice(0, 3).forEach(ev => {
        if (ev && (ev.what === 'CLASH' || ev.what === 'REMOVED')) accessLog(req, ev.what, ev.details);
      });
      return out({ ok: true, version: after.version, hashes: after.hashes });
    }
    return out({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return out({ ok: false, damaged: !!(err && err.ld), error: err && err.ld ? err.message : String(err && err.stack || err) });
  } finally {
    lock.releaseLock();
  }
}

// the parts of the sheet whose fingerprint differs from what the device has (masters always -
// they are small and tell the device the tab list)
function changedOnly(st, have) {
  const H = st.hashes, m = st.model, d = splitData(m.data), parts = { data: {}, tabs: {} };
  if (have.p !== H.p) parts.parties = m.parties;
  if (have.d !== H.d) parts.data.rest = d.rest;
  if (have.dl !== H.dl) parts.data.log = d.log === undefined ? null : d.log;
  if (have.du !== H.du) parts.data.uploads = d.uploads === undefined ? null : d.uploads;
  Object.keys(H.t).forEach(t => {
    if (have.t && have.t[t] === H.t[t]) return;
    const tab = t === NO_TAB ? '' : t;
    parts.tabs[t] = m.orders.filter(o => (o.tab || '') === tab);
  });
  return { ok: true, version: st.version, partial: true, hashes: H, masters: m.masters, parts: parts };
}

function out(obj) {
  if (obj && typeof obj === 'object') obj.sv = SCRIPT_VERSION;
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== one-time setup ===================== */

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const m = readMasters(ss);
  if (!m.tabs.length) m.tabs = DEFAULT_TABS.slice();
  if (!Object.keys(m.settings).length) m.settings = { mapStart: '', mapRegion: 'Kerala', mapReturn: true, tsvFormula: true };
  m.tabs.forEach(t => prepOrderSheet(getOrMake(ss, t)));
  writeMasters(ss, m);
  if (!ss.getSheetByName(PARTIES)) writeParties(ss, {});
  const d = getOrMake(ss, DATA);
  if (!String(d.getRange(1, 1).getValue())) d.getRange(1, 1).setValue('DO NOT EDIT — Logistics Desk data');
  d.hideSheet();
  SpreadsheetApp.getUi && safeAlert('Logistics Desk: sheet is ready. Now deploy it as a web app (see the setup guide).');
}

// Forgot the Logistics Desk admin PIN? Select resetAdminPin in the toolbar and press Run.
// The PIN goes back to 1010 on every device after their next sync.
function resetAdminPin() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = readData(ss);
  data.adminPin = '';
  writeData(ss, data);
  try { CacheService.getScriptCache().remove(CACHE_KEY); } catch (e) {}
  safeAlert('Admin PIN is back to 1010. Open Logistics Desk and let it sync.');
}

// row 1 is always the header; a tab that starts straight with data gets a row inserted above it
function ensureHeader(sh) {
  if (String(sh.getRange(1, 1).getValue()).trim().toUpperCase() === 'DATE') {
    if (String(sh.getRange(1, 7).getValue()).trim() === '') sh.getRange(1, 7).setValue('REMARK').setFontWeight('bold');
    return;
  }
  if (sh.getLastRow() >= 1) sh.insertRowBefore(1);
  sh.getRange(1, 1, 1, ORDER_HEAD.length).setValues([ORDER_HEAD]).setFontWeight('bold');
}

function safeAlert(msg) { try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); } }

function prepOrderSheet(sh) {
  ensureHeader(sh);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 110); sh.setColumnWidth(2, 90); sh.setColumnWidth(3, 330);
  sh.setColumnWidth(4, 90); sh.setColumnWidth(5, 90); sh.setColumnWidth(6, 100); sh.setColumnWidth(7, 220);
  try { sh.hideColumns(ID_COL); } catch (e) {}
}

/* ===================== reading ===================== */

/* The version is built from one hash per part (masters, parties, _DATA, each order tab), so
   after a push only the parts that were written need reading back. When `partial` is given
   (hashes from before + what was written), unwritten parts reuse their old hash and no model
   is returned. */
function readAll(ss, partial) {
  const H = { m: '', p: '', d: '', t: {} };
  const masters = readMasters(ss);
  H.m = md5(JSON.stringify(masters));
  const keep = partial && partial.hashes;
  const parties = keep && !partial.wrote.parties ? null : readParties(ss);
  H.p = parties ? md5(JSON.stringify(parties)) : keep.p;
  const orders = [];
  const tabNames = masters.tabs.slice();
  tabNames.push(NO_TAB);
  const seen = {}, ids = {};
  tabNames.forEach(t => {
    const sh = findSheet(ss, t);
    if (!sh || seen[sh.getName()]) return;
    seen[sh.getName()] = true;
    if (keep && !partial.wrote.tabs[sh.getName()] && keep.t[t] !== undefined) { H.t[t] = keep.t[t]; return; }
    const list = readOrderSheet(ss, sh, t === NO_TAB ? '' : t, ids);
    H.t[t] = md5(JSON.stringify(list));
    list.forEach(o => orders.push(o));
  });
  const dp = keep && !dataWritten(partial.wrote.data) ? null : readDataParts(ss);
  let data = null;
  if (dp) {
    H.d = md5(JSON.stringify(dp.rest)); H.dl = md5(JSON.stringify(dp.log === undefined ? null : dp.log)); H.du = md5(JSON.stringify(dp.uploads === undefined ? null : dp.uploads));
    data = joinData(dp);
  } else { H.d = keep.d; H.dl = keep.dl; H.du = keep.du; }
  const version = md5([H.m, H.p, H.d, H.dl, H.du].concat(Object.keys(H.t).map(k => k + '=' + H.t[k])).join('|'));
  saveState(ss, version, H, !keep);
  if (keep) return { version: version, hashes: H };
  const model = { orders: orders, parties: parties, masters: masters, data: data };
  const empty = !orders.length && !Object.keys(parties).length && !Object.keys(data).length &&
    !masters.routes.length && !masters.vehTypes.length && !masters.vehicles.length && !masters.drivers.length;
  return { model: model, version: version, empty: empty, hashes: H };
}

/* ---------- fast path ----------
   The last known version is kept in the script cache with a fingerprint of every tab's size.
   Typing in the sheet clears it (onEdit below); adding or deleting rows changes the
   fingerprint; it also expires after 15 minutes. While it holds, a sync answers without
   reading the whole sheet. */
function fingerprint(ss) {
  return tabList(ss).filter(s => s.getName() !== ACCESS).map(s => s.getName() + ':' + s.getLastRow() + ':' + s.getLastColumn()).join('|');
}
function saveState(ss, version, hashes, full) {
  // with the change trigger installed the tab sizes aren't needed (and cost a call per tab)
  // ft = when everything was last read for real (a save only re-reads the parts it wrote)
  try {
    const cache = CacheService.getScriptCache();
    let ft = Date.now();
    if (!full) { try { const old = JSON.parse(cache.get(CACHE_KEY) || 'null'); ft = old && old.ft ? old.ft : 0; } catch (e) { ft = 0; } }
    cache.put(CACHE_KEY, JSON.stringify({ v: version, h: hashes, f: triggerOn() ? '' : fingerprint(ss), t: Date.now(), ft: ft }), CACHE_SECS);
  } catch (e) {}
}
function fastState(ss) {
  try {
    const cache = CacheService.getScriptCache();
    const raw = cache.get(CACHE_KEY); if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c.h || c.h.dl === undefined) return null; // remembered by an older script version
    let edited = 0;
    try { edited = Number(PropertiesService.getDocumentProperties().getProperty('ld_edit') || 0); } catch (err) {}
    if (edited >= (c.t || 0)) return null; // changed in the sheet after this was remembered
    // 2.3: some changes never fire a trigger (another script, an add-on) - read everything again
    // at least every TRUST_MIN minutes
    if (Date.now() - (c.ft || 0) > TRUST_MIN * 60000) return null;
    // with the change trigger installed every edit (rows added or deleted too) sets ld_edit, so
    // there is no need to measure every tab; without it, compare every tab's size as before
    if (!triggerOn() && c.f !== fingerprint(ss)) return null;
    cache.put(CACHE_KEY, raw, CACHE_SECS); // still right - keep remembering it (same time stamp)
    return { version: c.v, hashes: c.h };
  } catch (e) { return null; }
}
// is the installed change trigger there? Checked at most every 10 minutes.
function triggerOn() {
  try {
    const cache = CacheService.getScriptCache();
    const k = cache.get('ld_trig_ok'); if (k) return k === '1';
    const on = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'onSheetChange');
    cache.put('ld_trig_ok', on ? '1' : '0', 600);
    return on;
  } catch (e) { return false; }
}
// Run this ONCE from the Apps Script editor (select installTriggers → Run → allow access).
// Safe to run again: it never adds a second copy.
function installTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'onSheetChange').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onChange().create();
  try { CacheService.getScriptCache().remove('ld_trig_ok'); CacheService.getScriptCache().remove(CACHE_KEY); } catch (e) {}
  safeAlert('Logistics Desk: change trigger installed. Syncing is now faster.');
}
// installed by installTriggers: any change in the sheet (typing, pasting, rows or tabs added or
// deleted) makes the next sync read the sheet fresh
function onSheetChange(e) { onEdit(e); }
// runs by itself whenever someone types in the sheet - the next sync then reads it fresh.
// Two separate marks, so either one is enough to notice the edit.
function onEdit(e) {
  try { if (e && e.range && e.range.getSheet().getName() === ACCESS) return; } catch (err) {} // notes in the access log aren't order edits
  try { CacheService.getScriptCache().remove(CACHE_KEY); } catch (err) {}
  try { PropertiesService.getDocumentProperties().setProperty('ld_edit', String(Date.now())); } catch (err) {}
}

// Same rules as pasting into the tool: the date and route carry down; a row with text but no
// qty / unit wt / total wt is a party; a row with text and any of those is an item of that party.
// 3.3: "ABC TRADERS (tomorrow need)" -> name + note; every trailing bracket is split
function splitPartyNote(ss, text) {
  const t = String(text || '').trim();
  const m = t.match(/^(.*?\S)\s*[(\[]([^()\[\]]+)[)\]]\s*$/);
  if (!m) return null;
  const inner = splitPartyNote(ss, m[1]); // two brackets: "ABC (urgent) (sat morning)"
  return inner ? { name: inner.name, note: inner.note + '; ' + m[2].trim() } : { name: m[1].trim(), note: m[2].trim() };
}
function readOrderSheet(ss, sh, tab, ids) {
  const last = sh.getLastRow();
  if (last < 1) return [];
  const rng = sh.getRange(1, 1, last, ID_COL);
  const vals = rng.getValues(), disp = rng.getDisplayValues();
  const tz = ss.getSpreadsheetTimeZone();
  const res = [], newIds = [], fixes = [];
  let party = null, base = null, date = '', route = '', onote = '';
  for (let i = 0; i < vals.length; i++) {
    if (i === 0 && String(vals[0][0]).trim().toUpperCase() === 'DATE') continue; // header row
    const v = vals[i];
    const d = v[0] instanceof Date ? Utilities.formatDate(v[0], tz, 'dd-MM-yyyy') : String(disp[i][0]).trim();
    const r = cell(v[1]), text = cell(v[2]), n1 = cell(v[3]), n2 = cell(v[4]), n3 = cell(v[5]);
    if (d) date = d;
    if (r) route = r;
    if (!text) continue;
    if (n1 === '' && n2 === '' && n3 === '') {
      const site = base ? deliverySite(text) : '';   // 3.0: "Delivery - Kallara" under the party
      if (site) { party = base + SITE_SEP + site; continue; }
      let name = text, note = cell(v[6]);            // 3.3: column G of the party row = order note
      const sp = splitPartyNote(ss, text);
      if (sp) { name = sp.name; note = note && note.toUpperCase() !== sp.note.toUpperCase() ? note + '; ' + sp.note : (note || sp.note); fixes.push([i + 1, name, note]); }
      base = party = name.toUpperCase(); onote = note; continue;
    }
    if (!party) { base = party = text.toUpperCase(); onote = ''; continue; }
    let id = cell(v[ID_COL - 1]);
    // no ID = typed in the sheet; an ID seen before = a row copied along with its hidden ID
    if (!id || ids[id]) { id = newId(); newIds.push([i + 1, id]); }
    ids[id] = true;
    const o = { id: id, tab: tab, date: date, party: party, item: text, qty: n1, unit: n2, weight: n3, remark: cell(v[6]), route: route };
    if (onote) o.onote = onote;
    res.push(o);
  }
  // 3.3: the bracket comes off the name and the note goes to column G of that party row
  fixes.forEach(f => { sh.getRange(f[0], 3).setValue(f[1]); sh.getRange(f[0], 7).setValue(f[2]); });
  // a line typed straight into the sheet gets its ID now, so it keeps it from here on.
  // All IDs go in with one write of column H (80 pasted lines = 1 call, not 80).
  if (newIds.length) {
    const col = vals.map(r => [r[ID_COL - 1] === null || r[ID_COL - 1] === undefined ? '' : r[ID_COL - 1]]);
    newIds.forEach(p => { col[p[0] - 1][0] = p[1]; });
    sh.getRange(1, ID_COL, col.length, 1).setValues(col);
  }
  return res;
}

// 3.0 delivery locations - same rules as the tool
const SITE_SEP = ' @ ';
const DELIVERY_RE = /^(?:delivery\s*(?:to\b|at\b|[-–:])|site\s*(?:at\b|[-–:]))\s*[-–:]?\s*(.+)$/i;
function deliverySite(text) { const m = String(text || '').trim().match(DELIVERY_RE); return m ? String(m[1]).toUpperCase().replace(/\s+/g, ' ').trim() : ''; }
function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()); }
function splitSite(p) { const s = String(p || ''), i = s.lastIndexOf(SITE_SEP); return i > 0 ? { base: s.slice(0, i), site: s.slice(i + SITE_SEP.length) } : { base: s, site: '' }; }

function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd-MM-yyyy');
  return String(v).trim();
}

function newId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function readMasters(ss) {
  const m = { routes: [], tabs: [], vehTypes: [], vehicles: [], drivers: [], phones: {}, combos: [], settings: {} };
  const sh = ss.getSheetByName(MASTERS);
  if (!sh || sh.getLastRow() < 1) return m;
  const vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getValues();
  const head = vals[0].map(h => String(h).trim().toUpperCase());
  const col = name => head.indexOf(name);
  const list = c => { const outL = []; if (c < 0) return outL;
    for (let i = 1; i < vals.length; i++) { const x = cell(vals[i][c]); if (x) outL.push(x); } return outL; };
  m.routes = list(col('ROUTES'));
  m.tabs = list(col('SHEET TABS'));
  m.vehicles = list(col('VEHICLE NUMBERS'));
  m.drivers = list(col('DRIVERS'));
  const dc = col('DRIVERS'), pc = col('DRIVER PHONE');
  if (dc >= 0 && pc >= 0) for (let i = 1; i < vals.length; i++) {
    const d = cell(vals[i][dc]), ph = cell(vals[i][pc]); if (d && ph) m.phones[d] = ph;
  }
  const vt = col('VEHICLE TYPE'), vc = col('CAPACITY KG');
  if (vt >= 0) for (let i = 1; i < vals.length; i++) {
    const n = cell(vals[i][vt]); if (n) m.vehTypes.push({ name: n, cap: Number(cell(vals[i][vc])) || 0 });
  }
  const cn = col('ROUTE COMBINATION'), cr = col('COMBINATION ROUTES'), cx = col('EXCLUDE');
  if (cr >= 0) for (let i = 1; i < vals.length; i++) {
    const rs = splitList(cell(vals[i][cr])); if (!rs.length) continue;
    m.combos.push({ name: cn >= 0 ? cell(vals[i][cn]) : '', routes: rs, xroutes: cx >= 0 ? splitList(cell(vals[i][cx])) : [] });
  }
  const sk = col('SETTING'), sv = col('VALUE');
  if (sk >= 0) for (let i = 1; i < vals.length; i++) {
    const k = cell(vals[i][sk]); if (!k) continue;
    const key = SETTING_KEYS[k.toUpperCase()]; if (!key) continue;
    const val = cell(vals[i][sv]);
    m.settings[key] = BOOL_SETTINGS[key] ? /^(yes|y|true|1|on)$/i.test(val) : val;
  }
  return m;
}

const SETTING_ROWS = [['mapStart', 'Map start (godown address)'], ['mapRegion', 'Add to every place'],
  ['mapReturn', 'End route back at start'], ['tsvFormula', 'Weight as formula']];
const SETTING_KEYS = {}; SETTING_ROWS.forEach(r => { SETTING_KEYS[r[1].toUpperCase()] = r[0]; });
const BOOL_SETTINGS = { mapReturn: true, tsvFormula: true };

function splitList(s) { return String(s || '').split(/[,/+]| and /i).map(x => x.trim()).filter(String); }

function readParties(ss) {
  const p = {};
  const sh = ss.getSheetByName(PARTIES);
  if (!sh || sh.getLastRow() < 2) return p;
  const vals = sh.getRange(1, 1, sh.getLastRow(), 6).getValues();
  for (let i = 1; i < vals.length; i++) {
    const name = cell(vals[i][0]); if (!name) continue;
    p[name] = { routes: splitList(cell(vals[i][1])), place: cell(vals[i][2]), pincode: cell(vals[i][3]), loc: cell(vals[i][4]), pin: cell(vals[i][5]) };
  }
  return p;
}

/* 2.4: _DATA in three parts - A = everything else, B = Plan log (data.log), C = Upload log
   (data.uploads). Each part is JSON split down its own column in CHUNK-sized cells. */
function splitData(data) {
  const rest = Object.assign({}, data || {}), out = { rest: rest, log: rest.log, uploads: rest.uploads };
  delete rest.log; delete rest.uploads;
  return out;
}
function joinData(p) {
  const d = Object.assign({}, p.rest);
  if (p.log !== undefined) d.log = p.log;
  if (p.uploads !== undefined) d.uploads = p.uploads;
  return d;
}
function dataWritten(w) { return w === true || !!(w && (w.rest || w.log || w.uploads)); }
function dataText(vals, c) { return vals.map(r => { const v = r[c]; return v === null || v === undefined ? '' : String(v); }).join(''); }
function readDataParts(ss) {
  const out = { rest: {}, log: undefined, uploads: undefined };
  const sh = ss.getSheetByName(DATA);
  if (!sh || sh.getLastRow() < 2) return out;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  // damaged data must never be read as "no data" - that would wipe the log, plan and stock on
  // every device. Stop instead, so nothing is written until it is fixed.
  const parse = t => { try { return JSON.parse(t); } catch (e) {
    const err = new Error('The hidden _DATA tab in the sheet is damaged, so nothing was synced. Fix: in the sheet, undo the last change (File → Version history), or in the tool open Admin → "Replace the sheet with this device".');
    err.ld = true; throw err; } };
  const a = dataText(vals, 0), b = dataText(vals, 1), c = dataText(vals, 2);
  if (a) { const s = splitData(parse(a)); out.rest = s.rest; out.log = s.log; out.uploads = s.uploads; } // before 2.4 everything was in A
  if (b) out.log = parse(b);
  if (c) out.uploads = parse(c);
  return out;
}
function readData(ss) { return joinData(readDataParts(ss)); }
// before a device replaces damaged _DATA, its raw text is kept in a separate hidden tab
function keepDamagedData(ss) {
  const sh = ss.getSheetByName(DATA); if (!sh || sh.getLastRow() < 1) return;
  const vals = sh.getRange(1, 1, sh.getLastRow(), 3).getValues();
  const name = '_DATA damaged ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd-MM-yyyy HH:mm');
  const bk = getOrMake(ss, name);
  bk.getRange(1, 1, vals.length, 3).setNumberFormat('@').setValues(vals);
  try { bk.hideSheet(); } catch (e) {}
}

/* ===================== writing ===================== */

function writeAll(ss, model) {
  const masters = model.masters || {};
  const parties = model.parties || {};
  const orders = model.orders || [];
  // every tab an order uses is kept in the tab list, so it is read back on the next sync
  const tabs = (masters.tabs || []).slice();
  orders.forEach(o => { if (o.tab && !tabs.some(t => t.toUpperCase() === o.tab.toUpperCase())) tabs.push(o.tab); });
  masters.tabs = tabs;
  const wrote = { masters: writeMasters(ss, masters), parties: writeParties(ss, parties), data: false, tabs: {} };
  const byTab = {};
  orders.forEach(o => { const t = o.tab || NO_TAB; (byTab[t] = byTab[t] || []).push(o); });
  const targets = tabs.slice();
  if (byTab[NO_TAB] || findSheet(ss, NO_TAB)) targets.push(NO_TAB);
  targets.forEach(t => {
    const key = Object.keys(byTab).find(k => k.toUpperCase() === t.toUpperCase());
    const sh = writeOrderSheet(ss, t, key ? byTab[key] : [], parties);
    if (sh) wrote.tabs[sh.getName()] = true;
  });
  wrote.data = writeData(ss, model.data || {});
  return wrote;
}

// 2.1: only the parts the device says changed. parts = {masters, parties, data: true/false,
// tabs: [tab names, '' = no tab]}. The model carries masters and parties always (order tabs
// need party routes), the orders of the listed tabs only, and data only when it changed.
function writeParts(ss, model, parts) {
  const masters = model.masters || {}, parties = model.parties || {}, orders = model.orders || [];
  const wrote = { masters: false, parties: false, data: false, tabs: {} };
  if (parts.masters) wrote.masters = writeMasters(ss, masters);
  if (parts.parties) wrote.parties = writeParties(ss, parties);
  (parts.tabs || []).forEach(t => {
    const name = t || NO_TAB;
    const list = orders.filter(o => (o.tab || NO_TAB).toUpperCase() === name.toUpperCase());
    const sh = writeOrderSheet(ss, name, list, parties);
    if (sh) wrote.tabs[sh.getName()] = true;
  });
  if (parts.data) wrote.data = writeData(ss, model.data || {}, parts.dataParts || null);
  return wrote;
}

// true when the sheet already holds exactly this grid (so writing it again can be skipped)
function sameGrid(sh, grid) {
  if (sh.getLastRow() !== grid.length) return false;
  const w = Math.max(sh.getLastColumn(), grid[0].length);
  const cur = sh.getRange(1, 1, grid.length, w).getValues();
  for (let i = 0; i < grid.length; i++) for (let j = 0; j < w; j++) {
    const a = grid[i][j] === undefined || grid[i][j] === null ? '' : grid[i][j];
    if (String(cur[i][j]) !== String(a)) return false;
  }
  return true;
}

let PUSH_START = 0; // when the save being written began (0 = not checking, e.g. a forced replace)
let EXPECT_T = null; // 2.3: {tab: hash} the device's version had for each order tab
// true when the tab no longer holds what the device's version had (changed without any trigger)
function tabMoved(ss, sh, tab) {
  if (!PUSH_START || !EXPECT_T) return false;
  const key = Object.keys(EXPECT_T).find(k => k.toUpperCase() === String(tab).toUpperCase());
  if (key === undefined) return false; // a tab new to the list - nothing to compare with
  const list = readOrderSheet(ss, sh, key === NO_TAB ? '' : key, {});
  return md5(JSON.stringify(list)) !== EXPECT_T[key];
}
function toolAtLeast(v, min) {
  const a = String(v || '0').split('.').map(Number), b = String(min).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return true;
}
// one ACCESS LOG row per old device per 6 hours, not one per retry
function oldToolNote(req) {
  try {
    const cache = CacheService.getScriptCache(), k = 'ld_old_' + clip(req.dev || '?', 40);
    if (cache.get(k)) return;
    cache.put(k, '1', 21600);
    accessLog(req, 'OLD TOOL', 'save refused - tool v' + (req.app || 'older than 2.2') + ', needs ' + MIN_TOOL + ' (reload the page on that device)');
  } catch (e) {}
}
// Rows the device can't know about: an item row with no ID (typed in the sheet and not yet picked
// up), or anything typed in the sheet after this save began (onEdit / the change trigger stamp it).
function unseenRows(sh, vals) {
  if (!PUSH_START) return false;
  try { if (Number(PropertiesService.getDocumentProperties().getProperty('ld_edit') || 0) >= PUSH_START) return true; } catch (e) {}
  // same rules as readOrderSheet: a row only counts as an item once there is a party above it
  let party = false;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (!cell(v[2])) continue;
    const nums = cell(v[3]) !== '' || cell(v[4]) !== '' || cell(v[5]) !== '';
    if (!nums || !party) { party = true; continue; }
    if (!cell(v[ID_COL - 1])) return true;
  }
  return false;
}
function writeOrderSheet(ss, tab, orders, parties) {
  let sh = findSheet(ss, tab);
  if (!sh) { if (!orders.length) return null; sh = newTab(ss, tab); prepOrderSheet(sh); }
  else ensureHeader(sh);
  // look at what is in the tab right now, just before rewriting it
  const lastNow = sh.getLastRow();
  if (lastNow > 1 && unseenRows(sh, sh.getRange(2, 1, lastNow - 1, ID_COL).getValues())) {
    const e = new Error('rows typed in the sheet during this save'); e.unseen = true; throw e;
  }
  if (tabMoved(ss, sh, tab)) { const e = new Error('tab changed outside the tool'); e.unseen = true; throw e; }
  const rows = [], partyRows = [];
  let prev = null;
  orders.forEach(o => {
    const k = o.date + '|' + o.party;
    if (k !== prev) {
      rows.push([o.date || '', '', '', '', '', '', '', '']);
      const pr = parties[o.party] || {}, sp = splitSite(o.party);
      const note = orders.filter(x => x.date + '|' + x.party === k).map(x => x.onote || '').find(Boolean) || '';
      rows.push(['', (pr.routes || []).join(', '), sp.base, '', '', '', note, '']); // 3.3: G = order note
      partyRows.push(rows.length + 1);
      if (sp.site) rows.push(['', '', 'Delivery - ' + titleCase(sp.site), '', '', '', '', '']);
      prev = k;
    }
    const r = rows.length + 2; // sheet row of this item (row 1 is the header)
    const q = num(o.qty), u = num(o.unit), w = num(o.weight);
    // total weight as a formula when it really is qty x unit wt, so editing the qty in the
    // sheet updates the weight; otherwise the weight exactly as entered
    const useF = typeof q === 'number' && typeof u === 'number' && typeof w === 'number' && Math.abs(q * u - w) < 0.01;
    rows.push(['', '', o.item, q, u, useF ? '=D' + r + '*E' + r : w, o.remark || '', o.id]); // G = remark
  });
  const last = Math.max(sh.getLastRow(), 1);
  // only rewrite the tab when something in it actually changed
  if (last - 1 === rows.length && rows.length) {
    const cur = sh.getRange(2, 1, rows.length, ID_COL);
    const f = cur.getFormulas(), v = cur.getValues();
    let same = true;
    for (let i = 0; i < rows.length && same; i++) for (let j = 0; j < ID_COL && same; j++) {
      const now = f[i][j] || v[i][j];
      if (String(now) !== String(rows[i][j])) same = false;
    }
    if (same) return null;
  }
  if (last > 1) {
    sh.getRange(2, 1, last - 1, ID_COL).clearContent();
    sh.getRange(2, 3, last - 1, 1).setFontWeight('normal');
  }
  if (!rows.length) return sh;
  sh.getRange(2, 1, rows.length, 1).setNumberFormat('@'); // dates stay as typed text, not reformatted
  sh.getRange(2, 1, rows.length, ID_COL).setValues(rows);
  if (partyRows.length) sh.getRangeList(partyRows.map(r => 'C' + r)).setFontWeight('bold');
  return sh;
}

function num(s) {
  const t = String(s === undefined || s === null ? '' : s).trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

function writeMasters(ss, m) {
  const sh = getOrMake(ss, MASTERS);
  const head = ['ROUTES', '', 'SHEET TABS', '', 'VEHICLE TYPE', 'CAPACITY KG', '', 'VEHICLE NUMBERS', '', 'DRIVERS', 'DRIVER PHONE',
    'ROUTE COMBINATION', 'COMBINATION ROUTES', 'EXCLUDE', '', 'SETTING', 'VALUE'];
  const settings = m.settings || {};
  const cols = {
    0: (m.routes || []), 2: (m.tabs || []), 7: (m.vehicles || []), 9: (m.drivers || []),
  };
  const vts = m.vehTypes || [], combos = m.combos || [];
  const n = Math.max(1, (m.routes || []).length, (m.tabs || []).length, vts.length, (m.vehicles || []).length,
    (m.drivers || []).length, combos.length, SETTING_ROWS.length);
  const grid = [head];
  for (let i = 0; i < n; i++) {
    const row = head.map(() => '');
    Object.keys(cols).forEach(c => { if (cols[c][i] !== undefined) row[+c] = cols[c][i]; });
    if (vts[i]) { row[4] = vts[i].name; row[5] = Number(vts[i].cap) || 0; }
    if ((m.drivers || [])[i] !== undefined) row[10] = (m.phones || {})[m.drivers[i]] || '';
    if (combos[i]) { row[11] = combos[i].name || ''; row[12] = (combos[i].routes || []).join(', '); row[13] = (combos[i].xroutes || []).join(', '); }
    if (SETTING_ROWS[i]) {
      const key = SETTING_ROWS[i][0], val = settings[key];
      row[15] = SETTING_ROWS[i][1];
      row[16] = BOOL_SETTINGS[key] ? (val ? 'YES' : 'NO') : (val || '');
    }
    grid.push(row);
  }
  if (sameGrid(sh, grid)) return false;
  sh.clearContents();
  sh.getRange(1, 1, grid.length, head.length).setNumberFormat('@').setValues(grid);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  return true;
}

function writeParties(ss, parties) {
  const sh = getOrMake(ss, PARTIES);
  const names = Object.keys(parties).sort();
  const grid = [['PARTY', 'ROUTES', 'PLACE', 'PINCODE', 'LOCATION LINK', 'MAP SPOT']];
  names.forEach(nm => { const p = parties[nm] || {};
    grid.push([nm, (p.routes || []).join(', '), p.place || '', p.pincode || '', p.loc || '', p.pin || '']); });
  if (sameGrid(sh, grid)) return false;
  sh.clearContents();
  sh.getRange(1, 1, grid.length, 6).setNumberFormat('@').setValues(grid);
  sh.getRange(1, 1, 1, 6).setFontWeight('bold');
  sh.setFrozenRows(1);
  return true;
}

// which = {rest, log, uploads}: the parts the device sent (2.4); none given = all of them.
// A part is only rewritten when its text changed. Returns {rest, log, uploads} = what was written.
function writeData(ss, data, which) {
  const sh = getOrMake(ss, DATA);
  const s = splitData(data), want = which || { rest: true, log: true, uploads: true };
  const last = sh.getLastRow();
  const cur = last > 1 ? sh.getRange(2, 1, last - 1, 3).getValues() : [];
  const now = [dataText(cur, 0), dataText(cur, 1), dataText(cur, 2)];
  // the old one-column layout: when column A is rewritten, a Plan log / Upload log still living
  // inside it moves to its own column first (unless this save brings its own)
  if (want.rest && now[0]) {
    try { const old = splitData(JSON.parse(now[0]));
      if (old.log !== undefined && !now[1] && !(want.log && s.log !== undefined)) { s.log = old.log; want.log = true; }
      if (old.uploads !== undefined && !now[2] && !(want.uploads && s.uploads !== undefined)) { s.uploads = old.uploads; want.uploads = true; }
    } catch (e) {}
  }
  const wrote = { rest: false, log: false, uploads: false };
  [['rest', 0], ['log', 1], ['uploads', 2]].forEach(kc => {
    const k = kc[0], c = kc[1];
    if (!want[k] || (k !== 'rest' && s[k] === undefined)) return;
    const txt = JSON.stringify(s[k]);
    if (now[c] === txt) return;
    const chunks = [];
    for (let i = 0; i < txt.length; i += CHUNK) chunks.push([txt.slice(i, i + CHUNK)]);
    if (cur.length) sh.getRange(2, c + 1, cur.length, 1).clearContent();
    sh.getRange(2, c + 1, chunks.length, 1).setNumberFormat('@').setValues(chunks);
    wrote[k] = true;
  });
  if (dataWritten(wrote)) {
    if (String(sh.getRange(1, 2).getValue()) !== 'Plan log') sh.getRange(1, 1, 1, 3).setValues([['DO NOT EDIT — Logistics Desk data', 'Plan log', 'Upload log']]);
    try { if (!sh.isSheetHidden()) sh.hideSheet(); } catch (e) {}
  }
  return wrote;
}

/* ===================== access log (2.2) =====================
   The ACCESS LOG tab: who opened the tool, saved, or tried a wrong key, from which device.
   Only this script writes it (one row added, or the device's latest save row updated); the tool
   never reads it and nothing is ever deleted. Clear old rows by hand whenever you like. */
const ACCESS = 'ACCESS LOG', ACCESS_HEAD = ['TIME', 'DEVICE', 'WHAT', 'DETAILS', 'TOOL VERSION', 'BROWSER'];
const SAVE_MERGE_MIN = 10; // saves from one device within 10 minutes share one row
function accessSheet(ss) {
  let sh = findSheet(ss, ACCESS);
  if (!sh) {
    sh = newTab(ss, ACCESS);
    sh.getRange(1, 1, 1, ACCESS_HEAD.length).setValues([ACCESS_HEAD]).setFontWeight('bold');
    try { sh.setFrozenRows(1); sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 140); sh.setColumnWidth(3, 140); sh.setColumnWidth(4, 420); } catch (e) {}
  }
  return sh;
}
function stamp(ss, t) { return Utilities.formatDate(t || new Date(), ss.getSpreadsheetTimeZone(), 'dd-MM-yyyy HH:mm:ss'); }
function clip(v, n) { return String(v === undefined || v === null ? '' : v).replace(/[\r\n\t]+/g, ' ').slice(0, n); }
function accessLog(req, what, details) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    accessSheet(ss).appendRow([stamp(ss), clip(req.dev || '(no name — older tool)', 40), what, clip(details, 300), clip(req.app, 12), clip(req.ua, 40)]);
  } catch (e) {}
}
// a save: one row per device per 10 minutes - "6 saves 01:10–01:18 · masters, KOTTAYAM, data"
function logSave(req) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(), cache = CacheService.getScriptCache(), now = new Date();
    const dev = clip(req.dev || '(no name — older tool)', 40);
    const p = req.parts;
    const dpart = p && p.data ? (p.dataParts ? [p.dataParts.log && 'Plan log', p.dataParts.uploads && 'Upload log', p.dataParts.rest && 'data (holds, stock…)'] : ['data (log, holds…)']) : [];
    const what = p ? [p.masters && 'masters', p.parties && 'parties'].concat(dpart, (p.tabs || []).map(t => t || 'NO TAB')).filter(Boolean) : ['everything (check)'];
    const key = 'ld_acc_' + dev, last = JSON.parse(cache.get(key) || 'null'), sh = accessSheet(ss);
    // the remembered row must still be this device's save row (rows may have been deleted by hand)
    const chk = last && now.getTime() - last.t0 < SAVE_MERGE_MIN * 60000 ? sh.getRange(last.row, 2, 1, 2).getValues()[0] : null;
    if (chk && String(chk[0]) === dev && String(chk[1]) === 'Saved') {
      last.n++; what.forEach(w => { if (last.parts.indexOf(w) < 0) last.parts.push(w); });
      const span = Utilities.formatDate(new Date(last.t0), ss.getSpreadsheetTimeZone(), 'HH:mm') + '–' + Utilities.formatDate(now, ss.getSpreadsheetTimeZone(), 'HH:mm');
      sh.getRange(last.row, 4, 1, 3).setValues([[clip(last.n + ' saves ' + span + ' · ' + last.parts.join(', '), 300), clip(req.app, 12), clip(req.ua, 40)]]);
    } else {
      sh.appendRow([stamp(ss, now), dev, 'Saved', clip(what.join(', '), 300), clip(req.app, 12), clip(req.ua, 40)]);
      cache.put(key, JSON.stringify({ row: sh.getLastRow(), t0: now.getTime(), n: 1, parts: what }), SAVE_MERGE_MIN * 60);
      return;
    }
    cache.put(key, JSON.stringify(last), SAVE_MERGE_MIN * 60);
  } catch (e) {}
}

/* ===================== helpers ===================== */

function findSheet(ss, name) {
  const want = String(name).trim().toUpperCase();
  return tabList(ss).find(s => s.getName().trim().toUpperCase() === want) || null;
}

function getOrMake(ss, name) { return findSheet(ss, name) || newTab(ss, name); }
// the list of tabs is asked for once per call (each ask is a round trip to the sheet)
let TABS_MEMO = null;
function tabList(ss) { return TABS_MEMO || (TABS_MEMO = ss.getSheets()); }
function newTab(ss, name) { const sh = ss.insertSheet(name); TABS_MEMO = null; return sh; }

function md5(s) {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  return b.map(x => ((x + 256) % 256).toString(16).padStart(2, '0')).join('');
}

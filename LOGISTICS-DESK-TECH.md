# Logistics Desk — technical reference (sync, data model, all versions up to v4.2)

The standalone tool `logistics-desk.html` is served as `index.html` from GitHub Pages (jainwireindia.github.io/logistics-desk/). It syncs with a Google Sheet through the Apps Script `Code.gs`, which is bound to that sheet. The old Claude artifact version was retired at v1.1. The web app URL is pre-filled in the tool (`DEFAULT_SYNC_URL`). The key is never stored in the file.

## Sheet layout
- **Order tabs** (listed in MASTERS → SHEET TABS; default THRISSUR, CHERTHALA/ALPY, KOTTAYAM, TVM, IDUKKI, LOCAL) use the same layout as the PENDING ORDERS EKM sheet.
  - Row 1 is the header: `DATE | ROUTES | PARTY / ITEM | QTY | UNIT WT | TOTAL WT | REMARK | ID`.
  - Below it come a date row (column A), then a party row (routes in B, party in C, in bold), then the item rows.
  - Item rows: C item, D qty, E unit wt, F total wt, G remark, H line ID (hidden column). F is written as `=D*E` when it equals qty × unit wt.
  - Orders with no tab go to a `NO TAB` tab. Other tabs are never touched.
- **MASTERS**: column blocks found by their header:
  - ROUTES
  - SHEET TABS
  - VEHICLE TYPE + CAPACITY KG
  - VEHICLE NUMBERS
  - DRIVERS
  - ROUTE COMBINATION + COMBINATION ROUTES + EXCLUDE
  - SETTING + VALUE
- **PARTIES**: PARTY | ROUTES | PLACE | PINCODE | LOCATION LINK. The location link is reserved for the WhatsApp feature.
- **_DATA** (hidden): JSON of everything else, split into 40k-character cells. It holds the log, plan, upload log, holds and due dates (as partyExtra), orderMeta, stock, stockOut, stockMeta, notes and dupOk.

## Protocol
- POST JSON (text/plain, so no preflight) with `{key, action}`.
- Actions:
  - `ping`
  - `pull {known}`: returns `same` if the version is unchanged.
  - `push {baseVersion, model, force}`: returns `conflict` plus the sheet model when the sheet changed since baseVersion.
- The script reads the sheet with the same rules as the tool's paste parser, and assigns IDs to new or copied rows.
- LockService guards each call.
- Any script change needs Deploy → Manage deployments → New version.

## Tool side
- The sync URL and key are stored per device (IndexedDB `lpb:synccfg`). The base snapshot is in `lpb:syncbase`.
- Sync runs 1.2 s after a local save, on open, on focus or coming back online, and every 30 s while the page is visible. It skips while the user is typing.
- 3-way merge against the base:
  - Orders, log, uploads and plan lanes merge by ID.
  - Parties, settings and stock maps merge by key.
  - Lists merge by add/remove.
  - On a true clash, this device wins.
- Lines typed in the sheet are recorded in the Upload log as "from sheet". Old-sheet imports are tagged "old sheet".
- First connect: an empty sheet is filled from the device; an empty device takes the sheet; if both have data, the user picks.
- IDs come from `uid()` (time + random), so devices never collide.

## v1.2 additions
- **Order remark** (`o.remark`) comes from column G. It is shown as an amber tag, never printed or copied, and can only be edited in the sheet.
- **Import old sheet (.xlsx)** is in Add Orders. It uses a built-in zip/XML reader. Each tab goes into the paste box and through the normal duplicate check.
- **Responsive header badges**: icon + long label on wide screens, icon + short label at ≤980px, icon only at ≤640px. The sync icon spins while syncing and the badge pulses when a sync lands.

## v1.3 additions (04-10-2026)
- **Menu**: Dashboard → Logistics → **Reports** (Party history, Vehicle trips, Driver trips, Day-wise, Stock required) → Master (Master Data, Upload log). Stock required moved from Master to Reports.
- **Reports** are built from the Plan log, one trip per log entry:
  - Confirmed entries count the qty marked gone, taken from the saved snapshot.
  - Open entries count the loaded qty and are shown as NOT CONFIRMED (they can be hidden with a checkbox).
  - Filters: period (7/30/90 days, this month, last month, everything), a find box, and an "Item contains" search. "Copy lines" gives TSV: DATE | PARTY | ITEM | QTY | KG | VEHICLE | DRIVER | STATUS.
  - Clearing the Plan log clears the history.
- **Current stock** replaces the old "stock ready" baseline.
  - Paste item + qty from Excel. The item is the first cell with letters and the qty is the last number on the line. Items are matched to order items by name, ignoring spaces and case; exact names only.
  - A new figure resets the item: stockOut is deleted and `stockMeta[key] = {at, zeroAt, unit, label}`.
  - Plan log apply stamps `g.appliedAt` and calls refreshZero, which sets `zeroAt` when the item hits 0 and clears it when stock comes back.
  - Reopen does not give stock back for an item that got a newer figure after the apply.
  - The Dashboard "N items out of stock" card shows the out-since date and days, highlighted from 4 days.
- **Sync speed**:
  - Version is now a hash of per-part hashes (masters, parties, _DATA, each order tab).
  - The script cache keeps the version, the part hashes and a fingerprint (every tab's last row and column) for 15 minutes.
  - The `onEdit` simple trigger clears the cache and stamps a document property, so the next sync reads the sheet fresh.
  - A pull that matches the cache answers without reading the sheet.
  - Push skips the conflict read when the cache matches, skips rewriting MASTERS, PARTIES or _DATA when unchanged, and re-reads only the parts it wrote.
  - The client syncs 1.2 s after a save and checks every 30 s while visible.
- **Phones**: cards scroll sideways inside themselves and `.row` items stack, so the page no longer gets wider than the screen.

## v1.4 additions (04-10-2026)
- **Menu**: a full-height drawer that slides in from the left and scrolls by itself. Each group heading (Logistics / Reports / Master) folds its group, remembered per device in localStorage `ld:navshut`. Master now has **Setup** (sync, backup download, vehicle numbers + drivers with WhatsApp numbers, route library, vehicle types, sheet tabs, route combinations), **Parties & map** (Maps route settings + party table with place, pincode and **location link** `p.loc`), Upload log, and **Admin 🔒**.
- **Admin**: Clear data, Restore from backup and Change PIN, behind a 4-digit PIN (default 1010).
  - `S.adminPin` holds a hash (`p1:` FNV) and syncs through `_DATA.adminPin`; an empty value means 1010.
  - Admin unlocks for 10 minutes and locks again on leaving the view.
  - Code.gs `resetAdminPin()` (run in the Apps Script editor) sets it back to 1010.
- **Undo / redo**: two buttons next to ☰, no keyboard shortcut.
  - A snapshot of S (minus `open` flags) is taken on every save, up to 40 steps back.
  - `applyModel` (sheet data coming in) clears the history.
- **WhatsApp to driver** on each Plan log entry, with a Copy text button.
  - The text lists stops in delivery order, each with place, `p.loc` (or a Maps search link) and items × qty, then the full-route Maps link.
  - It opens `wa.me/<phone>`. A 10-digit number gets 91 added in front.
  - Phones live in `S.fleet.phones` and sync to the MASTERS `DRIVER PHONE` column, beside DRIVERS.
- **Hold reason and until date**: `parties[p].holdInfo[batchKey] = {reason, until(iso), at}`. Hold opens a form with quick reasons. After the until date the batch counts as free (`holdLapsed`), and the Dashboard lists it under "Hold ended" with Hold longer / Release.
- **Stock required** has a Show filter: All / Out of stock only / Short or out / No stock figure yet.
- **Dashboard**: paired tiles — parties/items added today, parties/items on hand, on plan/not placed, 2+/5+ days old.
- **Vehicle & driver trips**: one report tab with a By vehicle / By driver toggle.
- **Phone Build Plan**: each column is screen-wide and snaps into place; jump chips (Waiting / each vehicle with % full) stick at the top; the guard bar is one scrolling line. Phone CSS sits at the end of the style block so it wins over the desktop rules.

## v1.5 – v1.6 additions (04-10-2026)
- **Prev / Next** buttons (`#stepNav`) sit at the right of the bar under the header, on the four Logistics steps only.
- **Parties & map → WhatsApp**: pick a driver once at the top of the table, then tap WhatsApp on a party to send its name, place and location (`partyLocText`).
- **Home-screen app**: the site folder also holds `manifest.webmanifest`, `sw.js` (network-first, caches same-origin GETs only, never the sheet calls), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and `apple-touch-icon.png`. The service worker registers only over https.
- **Remark editing**: Orders edit mode (✎) has a remark input under each item; it syncs to column G.
- **Day summary**: a Plan log row (date + "send to" number, kept in `S.summaryPhone` and synced via `_DATA`) sends a WhatsApp summary — vehicles, driver, parties, kg and % per vehicle, plus a not-confirmed note. Day-wise report rows also have a WA button.
- **Due today / tomorrow** section on the Dashboard (`dueSoonBatches`), under Past due date.
- **Download Excel** (Final plan) builds an .xlsx with no library (stored zip + CRC32):
  - Rows 1–2 and column A are left empty; each plan sits in B..F with thin borders on every cell.
  - The plan title and party rows are bold, with one blank row between plans.
  - F is `=D*E` when "Weight as formula" is on and qty and unit wt are plain numbers.

## v1.6.1 (04-10-2026) — sync no longer hangs
- `syncCall` uses an AbortController: 30 s for ping/pull, 60 s for push. A timeout shows "The sheet is slow to answer — will retry shortly." and retries after 15 s.
- A sync still marked busy after 90 s is dropped and restarted. Coming back to the app (visibilitychange) or going online aborts a request older than 12 s.
- The 30-second background check is silent (no spinning badge) when nothing changed on this device.
- Cause: a request stalled by phone sleep or weak signal never settled, so `syncBusy` stayed true and blocked every later sync. Code.gs unchanged.

## v1.7 (04-10-2026) — publish plan + reliability (Code.gs 1.7, needs a new deployment)
- **Build Plan is a private draft per device.** `S.plan` (lanes, poolFilter) is saved on the device but no longer synced. `_DATA.plan` now holds the published plan `S.planPub = {lanes, by, at}`. `S.planSeen = {at, lanes}` is the published plan this device last took in; `S.planMine` is the `at` of this device's own last publish; `S.planNotice` is the open warning. The device name is per device in localStorage `ld:device` (Setup → sync card), defaulting to Phone/PC.
- **Publish plan** button in the bar on Build Plan and Final plan (`paintPubBar`, `publishPlan`). "Add this plan to the log" publishes automatically. "Use the published plan" drops the device's draft.
- **Incoming publish** (`takePublishedPlan`, called from applyModel):
  - A device whose draft is unchanged and who didn't make the plan on screen follows it.
  - Otherwise every vehicle the other device changed or added (compared with planSeen) is appended as a copy with `l.from = {by, at}`, shown as a FROM <DEVICE> tag. The usual "party also on another vehicle" warning flags overlaps, and a red notice explains it.
  - In mergeModels, plan moves as one piece; if both sides published, the newer `at` wins.
- **No sheet call for plan-only saves:** a sync started by the save timer is skipped when `toModel()` equals the base.
- **Damaged _DATA:**
  - `readData` throws (`err.ld`) instead of returning {}, and doPost returns `{damaged: true, error}`.
  - A force push (Admin → "Replace the sheet with this device") still works; the damaged text is kept first in a hidden tab "_DATA damaged dd-MM-yyyy HH:mm".
- **New sheet-row IDs** are written as one column-H `setValues`.
- **Save race:** a `stateRev` counter makes flushSave clear `dirty` only if nothing changed during the write, and re-saves otherwise.
- **Numbers:** `parseNum` and the new `wtNum` (all total-weight sums) read "1,250" / "1,25,000".
- **Merges:** parties and partyExtra merge field by field when both sides changed (`m3rec` / `m3recs`).
- **Undo:** history is capped at about 6M characters (always keeping at least 5 steps), on top of 40 steps.
- **sw.js:** CACHE `logistics-desk-v2`; only `./` and `index.html` must be cached, icons are optional.

## v1.8 – v1.9.2 (06/07-10-2026) — Code.gs unchanged (still 1.7), sw.js unchanged
1.8 base below; 1.8.1 12-hour file name time; 1.8.2 Type an order folded; 1.9 Google Sheet link; 1.9.1 first-sync fix + sync report; 1.9.2 header Prev/Next + sheet-link protection.
- **Old-sheet import removed** (button, zip/XML reader, `impBook`/`paintImport`). Old upload entries with `src:'file'` still show the "old sheet" tag.
- **Type an order** card on Add orders, folded until its heading is clicked (`#manToggle`, stays open while typing several orders) (`paintManual`, called from paintOrders when the orders view is on):
  - Sheet tab, order date (masked, defaults to today), party (datalist of `S.parties`; uppercased), route pills, item lines (item datalist from orders + log snapshots), qty, unit wt, total wt, remark.
  - Total wt = `manWeight(qty, unit)`: qty × unit wt; a "25kg" qty with no unit wt counts as 25. Typing in Total marks it `data-typed` and stops the auto value.
  - Picking a known item fills its last unit wt. A saved party fills its routes and its usual tab (`partyTab`). The party note only reacts to a different name (`manLastParty`), so a pill tap right after typing isn't lost.
  - Enter on the last line adds a line. Save → `addOrderRows(rows, tab, note, #manNote, {src:'typed'})`.
- **`addOrderRows`** is the shared add flow (duplicate pick-and-tick panel, commit, recordUpload, save) used by both the paste box and the form; `opts.onAdded` clears the box/form, `opts.cancelMsg` is the cancel text. Upload log tags `src:'typed'` as **typed**.
- **Dashboard See more:** containers marked `data-clip` (Possible plans table, Out of stock table, Short on stock list, each Needs-attention `.asec`, By sheet tab, Vehicles). `clipDash` hides rows past `DASH_SHOW` (5), never just one row, with a "See N more / Show less" button; open sections are kept in `dashMore` until reload. Combo detail rows are `tr.cdet` and follow their row. Orders on hand is not clipped.
- **Header Logistics button** `#logiBtn`: opens `lastLogiStep()` (localStorage `ld:lastlogi`, one of orders/plan/out/log; default orders). Shown outside Logistics only; inside a Logistics step `#stepNav` (‹ Prev · n/4 · Next ›) sits in the header in its place (moved out of the guard bar; labels hidden ≤1180px). Phone: icons only.
- **Final plan:** Download CSV removed. Each plan has **Download Excel** (`data-xlsxlane` → `exportPlanXlsx([l])`). File name from `planXlsxName(lanes)`: `For Jain Wire Ekm Loading <unique routes, or vehicle name> DD-MM-YY hhmm.xlsx` (12-hour hhmm with no am/pm, so 2:15 pm = 0215; characters Windows forbids replaced by "-").
- **Day-wise:** `tripHtml(t, showParty, noDate)` lists parties in delivery order (`deliveryOrder(g)`: `laneSnap.stops`, else `g.stops` reversed; `tripParties(t)`), header `<vehicle no> (type) · Driver: <name> · kg`. Applies to every report's trip detail; the day view leaves out the repeated date.
- **WhatsApp day summary** (`daySummaryText`, used by Plan log and Day-wise WA): `*DD-MM-YYYY Loading Plan*`, then per vehicle `*<vehicle no>* · Driver: <name>` and the party names in delivery order. No items, weights or numbers.
- **Google Sheet link:** Setup → sync card field `#sheetLink` (must start with https://docs.google.com/spreadsheets/). Stored as `S.sheetLink` in `_DATA.sheetLink`, so it syncs to every device and is never in the public file. A device on v1.7 leaves `sheetLink` out of its push and so blanked it in the sheet; mergeModels now treats a missing (undefined) remote `sheetLink` as "keep ours" and the next v1.8 sync writes it back (a real removal sends '' and still goes through). Add orders shows "Open the Google Sheet ↗" (new tab) in place of the old Admin → Clear data hint, or a prompt to add the link in Setup.
- **First sync on a new device** (`syncFull`, on while `firstSync` runs): the one call that brings the whole sheet down gets 120 s instead of 30 s, the stuck guard waits 150 s, and coming back to the page does not cancel it. Setup shows "First sync — fetching everything from the sheet…". Cause found 06-10-2026: a new PC never finished its first full pull (over 30 s on real Apps Script, or cancelled on returning to the tab), and each retry started the same full pull again.
- **Copy sync report** (Setup, next to Connect; works before connecting too): app version, device, browser, URL tail, key length (never the key), state, first sync done or not, device counts, and the last 40 sheet calls with time taken, size and error (`syncLog`, `syncReport`).
- **Upload log copy** (`uploadTsv`): lines grouped by date + party with a blank line between parties; a date+party+item+qty line already copied from an earlier upload is left out (lines carry `_u` = upload id in Copy all shown; repeats inside one upload stay).


## v1.9.5 (07-10-2026) — single deliveries. Code.gs unchanged (1.7)
- **`applyLogEntry(g)`**: the Apply-delivery body moved out of the button handler (snapshot, shrink/remove lines, stockOut delta, refreshZero, clear plan loadQty, resolved=true). Used by the button and by godown collections.
- **Line picker** (`linePickHtml`, `readLinePick`): the party's lines not already in an open log entry (`freeLinesOf` / `linesInOpenLogs`), ticked by default, qty editable. A changed qty becomes `loadQty[id]` on the stop, so the existing loaded-qty logic (`logLoad`, `goneOf`, `logBase`, balance on apply) handles part deliveries.
- **+ Add a party** (open, non-godown entries; state `logAdd`): party from a datalist of parties with free lines; delivery position select (First / After X / last). `addPartyToLog` inserts into `g.stops` (loading order = delivery reversed) and `g.laneSnap.stops` (delivery order, so driver WhatsApp, Day-wise and "edit again in Build Plan" agree). A party already on the vehicle gets the lines added to its stop. New stops carry `added:<date>` → ADDED tag.
- **Godown collected** (Orders/Dashboard party card, state `godownForm` = party|batchKey): `godownCollect` pushes `{vehicle:'Godown collection', godown:true, title:'Godown collection — PARTY date', stops:[one]}` and applies it at once. Plan log shows a GODOWN tag and hides vehicle/driver, WhatsApp and Build Plan buttons; Reopen works as for any entry.
- **Reports**: `vehLabel` → "Godown collection"; trip header "Godown collection · kg". **Day summary**: godown parties listed last under `*Godown collection*`.

## v1.9.6 (07-10-2026) — Plan log weights. Code.gs unchanged (1.7)
- `logKg(g)` → {loaded, gone, byParty}. Loaded = loaded qty (`logLoad`) or ordered qty; gone = `goneOf` clamped to `logBase` (open entry) or `lineQtyOut` from the snapshot (cleared entry). `lineKg(o,q)` = q × unit wt, else weight × q / ordered qty, else the weight.
- Shown: entry header "loaded … · gone …" (`kgT`: kg, plus tonnes from 1,000 kg), "N kg gone" beside each party, and a `.logsum` line above the list totalling the entries shown by the search/filter. Every gone-qty edit already repaints the log, so the weights follow.

## v1.9.7 (07-10-2026) — Cancel order. Code.gs unchanged (1.7)
- Party card button **Cancel order** (state `cancelForm` = party|batchKey) opens a red panel with this batch's lines not in an open log entry (`linePickHtml`), the qty box = qty cancelled (default all), a reason (`CANCEL_REASONS` chips). "Remove" stays for mistakes and records nothing.
- `cancelLines(party, pick, reason)`: full → line removed; part → qty shrinks (unit suffix kept), weight = keep × unit wt or scaled. Plan `loadQty` for those lines is cleared and empty stops dropped. Each line adds `{id, at, time, party, item, qty, unit, kg, origQty, date, tab, reason, full}` to **`S.cancels`**.
- Sync: `_DATA.cancels`; mergeModels merges it by id (`m3ids`); a remote without the key (older version) keeps ours, and applyModel keeps the local list when the key is missing.
- Party history (`repCancels` filtered by period / find party / item contains): parties with only cancellations are listed; new **Cancelled** column; `cancelHtml` adds CANCELLED blocks by day in the expanded row; summary tile "N kg · N cancelled lines"; Copy lines adds rows with STATUS "cancelled — reason".

## v2.0 (07-10-2026) — sync safety. Code.gs unchanged (1.7)
Cause found (reproduced in t_v20.js on v1.9.7): `syncNow` took `local=toModel()` before the network call and `adopt(version, remote, local)` merged that stale copy, then `applyModel` replaced S — anything saved while the sheet was answering was overwritten; the redraw also cleared a box being typed in; and `firstSync` on an empty device did a plain `applyModel(remote)`, dropping what was added during its (up to 2 min) pull.
- **`adopt(version, remote)`** no longer takes `local`. It runs `waitForTyping()` (holds while a key was pressed in the last `TYPE_QUIET` = 2.5 s or a `.qin` box is open, up to `TYPE_WAIT_MAX` = 2 min, refreshing `syncStarted` so the stuck guard doesn't fire), `commitTyping()` (dispatches `change` on the focused text box if its value differs from its default, so its own handler saves it; returns a `focusMark`), `flushSave`, then merges `mergeModels(syncBase.model, toModel() /*fresh*/, remote)`, and after `renderAll` calls `focusBack(mark)` to put the cursor back at the end of the box.
- **`firstSync(start, wasEmpty)`**: `start` = model when the sync began, `wasEmpty` decided then (not after the pull). Empty device: wait for typing, commit, and if anything changed since `start`, apply `mergeModels(start, now, remote)` instead of the plain sheet data; `syncBase` = the sheet, so the additions are sent on the next sync. A brand-new sheet is filled from `toModel()` taken after the pull.
- **Restore points**: `keepRestorePoint(why, force)` stores `{at, why, orders, parties, log, snap: JSON of S}` in IndexedDB `lpb:restore` (last `RESTORE_MAX` = 12; skipped if identical to the previous one within 3 min). Taken before every adopt that applies sheet changes, before a first-sync merge, before "Use the sheet's data", before restoring a backup file or a restore point. Admin → Restore points (`paintRestorePoints`): Download (backup JSON format) or Restore this (`restoreState`, shared with Restore from backup; the next sync sends it to the sheet).

## v2.1 (07-10-2026) — sync speed. **Code.gs 2.1 — new deployment, then run `installTriggers` once**
Evidence: Paul's sync report 07-10 (polls "same" 4–11 s, pushes 10–27 s, 4 over 60 s, 2 Google 404 pages, 8 pulls "cancelled (page left)"). Reproduced with `t_load.js` + `gas_timed.js` (900 ms + 140 ms per sheet call, lock-taking calls queue, work continues after the client gives up): v2.0/Code 1.7 → 15 of 20 PC calls cancelled, polls 8.3 s avg. v2.1 + trigger → 0 cancelled, polls 1.8 s, pushes 3.9 s; without the trigger polls 6.2 s, pushes 14.6 s; with 15–20 % Google error pages all devices still end equal.
**Code.gs**
- `doPost`: `ping` and `pull` with a matching `known` answered before `waitLock` (fastState from cache; a moment-stale answer is harmless). Every reply carries `sv` (script version) via `out()`.
- Change detection: `installTriggers()` adds an installable `onChange` trigger → `onSheetChange` → same as `onEdit` (clears cache, stamps `ld_edit`), so row inserts/deletes are seen too. `triggerOn()` (cached 10 min) → fastState skips `fingerprint()` and saveState stores `f:''`. Without the trigger the old fingerprint check stays.
- fastState re-puts the cache on a hit (same `t`), so steady polling keeps the fast path alive past 15 min.
- `writeParts(ss, model, parts)` for `push` with `parts = {masters, parties, data, tabs:[…]}`: only those are written; masters + parties always come in the model (tabs print party routes). Readback is always partial now (`readAll` re-reads masters and reads any tab new to the list). Old clients (no `parts`) → `writeAll` as before.
- `tabList(ss)` memo (reset per call / on `newTab`): `findSheet` no longer asks for the tab list once per tab.
- Cost per push with the trigger (simulator, real data): one phone number 10 sheet calls (was 113), one order line 18, one note 13.
**Tool**
- `changedParts(base, local)`: masters / parties / data by stable compare; a tab is changed when its lines differ or a party on it changed routes. `slimModel` sends masters, parties, changed tabs' orders, data only if changed. Used only when `syncSV ≥ 2.1` (learned from any reply); every 15th push sends everything as a check (`everything (check)` in the report).
- Limits `LIMIT_PULL` 45 s, `LIMIT_PUSH` 90 s, `LIMIT_FULL` 120 s; stuck guard = push limit + 30 s. `syncCallAt/syncCallLimit` (pings excluded).
- visibilitychange: a running call is only aborted if older than its limit (phone slept). A deliberately dropped call (`e.dropped`) resyncs at once; other errors back off via `retryDelay` (busy/Google page → 3–5 s twice, then 15/30/60/120 s + jitter), and a queued `syncAgain` no longer cuts the back-off short.
- Google error page (non-JSON while connected) → `e.busy`; `{busy:true}` → friendly message + quick retry. Connect retries a non-JSON ping 3× before blaming the URL.
- Poll loop every 25–35 s (jitter). After opening, a lock-free ping records the script version and trigger state; Setup shows "paste the new Code.gs" (script < 2.1) or "run installTriggers once" hints; the sync report shows `script 2.1 · change trigger on` and the parts each push sent.

## v2.1.1 (08-10-2026) — sheet link from the script. Code.gs 2.1.1 (new deployment)
- Checked the live sheet (Drive export of LOGISTICS DESK EKM): `_DATA` has the `sheetLink` key but it is `''` — the sheet records it, but a device without the link had replaced it (a force/"send this device's data" push or a restore carries a blank).
- Code.gs: `ping` returns `url: ss.getUrl()` (lock-free, key required).
- Tool: `syncCall` stores `j.url` from a ping in `syncCfg.sheetUrl` (per device, IndexedDB). `sheetUrl()` = `S.sheetLink` (typed in Setup, still synced) || `syncCfg.sheetUrl`. The Add orders link and the Setup note (`paintSheetLinkNote`) use it; after opening, the lock-free ping refreshes it.

## Code.gs 2.1.2 (08-10-2026) — rows typed in the sheet during a save. Tool unchanged (2.1.1)
- How tool edits and sheet edits meet (unchanged, verified in t_manual.js): the push carries `baseVersion`; if the sheet changed since, the script answers `conflict` + the sheet model, the tool 3-way merges (its own edits + the sheet's new rows / changed cells; on the very same field the device wins) and pushes again. Lines typed in the sheet get IDs on that read and appear in the Upload log as "from sheet".
- Gap fixed: between the version check and writing a tab, a row typed by hand was overwritten (tab is cleared and rewritten). `PUSH_START` is set when a non-forced push starts; `writeOrderSheet` reads the tab just before writing and `unseenRows()` returns true for an item row with no ID (same party-before-item rule as `readOrderSheet`) or when `ld_edit` ≥ `PUSH_START`. It throws `unseen`; doPost catches it, flushes, `readAll` (assigns IDs) and returns `conflict` + model, so the tool merges and saves again. Forced replace (`force`) skips the check. Cost: +1 read per written tab (one order line: 18 → 20 sheet calls).

## v2.2 (08-10-2026) — ACCESS LOG. Code.gs 2.2 (new deployment)
- Every request now carries `dev` (device name from Setup / `ld:device`), `app` (APP_VERSION) and `ua` (`shortUA()`, e.g. "Chrome · Windows"); Connect sends `ping` with `connect:true`.
- Code.gs `accessLog(req, what, details)` appends to tab **ACCESS LOG** (created on first use; TIME · DEVICE · WHAT · DETAILS · TOOL VERSION · BROWSER):
  - `WRONG KEY` (before the key check returns), `Connected` / `Opened the tool` (ping), `First sync` (pull without `known`), `REPLACED THE SHEET` (force push, incl. first fill of an empty sheet).
  - `logSave(req)` for a successful normal push: one row per device per `SAVE_MERGE_MIN` = 10 min; the cache key `ld_acc_<device>` remembers {row, t0, n, parts}; later saves update DETAILS to "N saves HH:mm–HH:mm · parts…" — only if that row still reads <device> · Saved (rows deleted by hand → a new row, nothing overwritten). `everything (check)` = the every-15th full push.
- Never logged: polls ("anything new?"), pulls that bring changes. Keys are never written.
- The log is excluded from `fingerprint()`, never read by `readAll`, and `onEdit` ignores edits made in it, so it never slows syncing or causes a re-read. The script never deletes rows; clear old ones by hand.
- Cost: about +3 sheet calls on the first save of a 10-minute stretch, +2 after (one phone number with the trigger: 10 → 13).

## v2.3 (08-10-2026) — sync data-loss fixes + clash list. Code.gs 2.3 (new deployment; upload index.html first)
- **Open/closed not synced:** `noOpen(log)` strips `open` from log entries in `toModel`, `bare` and on all three sides in `mergeModels`; `applyModel` keeps this screen's open entry by id. (In 2.2 opening an entry changed it, so whole-record merge wiped other devices' edits to it.)
- **Field-level record merge:** `m3ids(b,l,r,keyFn,name)` — a record changed on both sides goes through `m3fields` (each field via `m3`; a field that is a map on both sides, e.g. qtyGone / loadQty / notes, via `m3map` key by key). Removed on one side + edited on the other → kept (as before), noted. Used for orders, log, uploads, cancels; parties / partyExtra were already field-level (`m3recs`).
- **Clash collector:** `MC` array during `mergeModels`; `m3(b,l,r,p)` pushes `{where,kept,lost}` when both changed to different values (this device wins). Readable names via `ordName/logName/upName/cxName`, `FIELD_NAMES`, `lineName(orderId)`. Published plan (newer wins) and Admin PIN (value never shown) are noted too. `mergeModels` returns `{model,fromSheet,clashes}`.
- `recordClashes(list,from)` (adopt + firstSync): IndexedDB `lpb:clashes` (last 300, values clipped 120), a flash, and `clashNote` for the sheet. Admin card **Sync clashes** (`paintClashes`, Copy as TSV, Clear).
- **Events to ACCESS LOG:** push carries `events:[{what:'CLASH'|'REMOVED',details}]` (max 3 used). `removals(base,local)` = order lines gone from base minus those in an applied log entry's `snapshot` and those matched to a new cancel (party+item+origQty); plus removed log entries and parties; `removedText()`. `clashNote` is cleared after an ok push that carried it.
- **Big-delete check** in `pushMerging`: `bigDelete(rx,base)` — lines ≥10 & ≥50% of base, log ≥3 & ≥50%, parties ≥10 & ≥50% → `syncHold`, error with `e.hold` (no retry scheduled), red box in Setup (`#syncHold`, `paintHold`): "Get the sheet's data back" (restore point, full pull, `applyModel`, new base) / "Yes, delete them" (armConfirm → `bigOk`). Badge "Sync stopped — check Setup". `bigOk=Date.now()` on Admin Clear (one or all) and `restoreState` → allowed for 10 min.
- **Empty device with a base:** `initSync` drops `syncBase` when the device has no data but the base has orders/parties/log → normal first sync of an empty device (takes the sheet).
- **Code.gs 2.3:**
  - `MIN_TOOL='2.3'`: push from an older tool (or none sent) → `{ok:false, old:true, error:'…Reload the page…'}`; pull/ping still allowed. `oldToolNote` writes one `OLD TOOL` row per device per 6 h (cache `ld_old_<dev>`).
  - `EXPECT_T` = the remembered per-tab hashes when the push's version came from `fastState` (not when the sheet was just read); `tabMoved()` re-reads the tab (`readOrderSheet` with the masters spelling of the tab and a fresh ids map) right before `writeOrderSheet` rewrites it; a different hash → `unseen` → conflict + fresh model (device merges and retries). Cost: +1–2 calls per written tab.
  - `saveState(ss,v,h,full)` keeps `ft` = time of the last FULL read (partial reads after a push carry the old `ft`); `fastState` returns null when `ft` is older than `TRUST_MIN`=10 min → full read.
  - Push success also writes `CLASH` / `REMOVED` rows from `req.events`.
- Tests: `t_loss.js` (5 loss cases; all fail on 2.2, pass on 2.3), `t_v23.js`; `t_fast.js` calls now send `app:'2.3'`; `t_v21` case 11 now expects a 2.0 tool's save to be refused.

## v2.4 (12-10-2026) — three-part _DATA, changed-parts-only sync. Code.gs 2.4 (new deployment)
- **Storage:** `_DATA` column A = data minus `log`/`uploads` ("rest"), B = `data.log`, C = `data.uploads`; each JSON chunked down its own column (CHUNK 40000); row 1 headers. `readDataParts` (old layout: everything in A → split on read; B/C win when present; any bad JSON → `err.ld`), `joinData`, `splitData`, `readData` = joined. `writeData(ss,data,which)` writes only the parts in `which` whose text changed; when A is rewritten and B/C are empty, a log/uploads still inside the old A moves to its column first. `keepDamagedData` copies A:C.
- **Hashes:** `H.d` (rest), `H.dl` (log), `H.du` (uploads) + masters/parties/tabs; version = md5 of all. `fastState` ignores a cache without `h.dl` (older script). `dataWritten(w)` for partial re-reads.
- **Push:** `changedParts` adds `dataParts {rest,log,uploads}`; `slimModel` sends only those data keys when the script is 2.4+; `writeParts` passes `parts.dataParts` to `writeData`. Push ok / conflict answers carry `hashes`; `syncBase.hashes` is stored on every base change (push ok, adopt, first sync, choices, replace, get-back).
- **Pull:** a 2.4 tool sends `have: syncBase.hashes`; when masters match, the script answers `changedOnly()` = `{partial:true, version, hashes, masters, parts:{parties?, data:{rest?,log?,uploads?}, tabs:{tab:[orders]}}}`. `assemble(base,r)` rebuilds the full sheet model from `syncBase.model` + changed parts (orders by tab key, `NO TAB` = ''); returns null (→ full pull) if a base order sits on a tab the sheet doesn't list. Masters changed → full model.
- `mergeModels`: `fromSheet` skips order ids already in the remote Upload log (no duplicate "from sheet" uploads).
- **Slimming:** `slimOldLog()` on load: resolved entries with `appliedAt` older than `SLIM_DAYS`=7 get `laneSnap={name,cap,slim:true,stops:[{party}]}` (deliveryOrder / driverText / report capacity unchanged); `logBackToPlan` copes with missing routes/xroutes/title.
- Sync report: "Data size: Plan log … · Upload log … · the rest …" and "(changed parts only)" on partial pulls; push parts list Plan log / Upload log / data.
- Note: the sheet may keep old `open` flags inside the Plan log column until the log next changes — every tool strips them (noOpen).

## v2.4.1 (12-10-2026) — possible repeat. Tool only
- `classifyPaste` (paste box, Type an order): after the exact checks (`dupKey` = party|item|qty|date → "Already in Orders", "Repeated in this paste", "Already delivered"), a line whose `repKey` (party|item|qty, no date, no tab) matches an order on hand, a delivered snapshot line, or an earlier line of the same paste, with dates `nearDays` (≤ `REPEAT_DAYS`=3; blank date = today; delivered also compares the log entry's createdAt) → why = "Possible repeat — …". It joins `dupes`, so the picker shows it unticked. `dupOk` is unaffected (repeat keys never reach count > 1).

## v2.5 + Order to Sheet v5.6 (12-10-2026) — the tray. Code.gs unchanged
- **Shared keys** (localStorage, origin jainwireindia.github.io): `jw-tray-v1` = `{batches:[{id,at,dev,app,lines,kg,tabs:[{tab,text,lines,kg}]}]}` written ONLY by Order to Sheet; `jw-tray-receipts-v1` = `{receipts:{batchId:{status:'added'|'rejected',added,skipped,tabs,skippedLines,reason,at,by,app}}}` written ONLY by Logistics Desk; heartbeats `jw-ots-seen` / `jw-ld-seen` `{v,at}` (on open, every 60 s, on focus). Both listen to the `storage` event.
- **Order to Sheet v5.6:** `sendCheck()` (unsent blocks; problems = NEEDS REVIEW, orange party/item rows incl. kg check, empty item, no qty); `ledgerText(block)` = the same lines as `copyGroupLedger`; batch written, read back, only then `markSent(dateRow,id)` (class `oea-sent`, inputs disabled, `data-sent`); tray pruning: answered > 3 days or unanswered > 30 days. `findMatchingBlockEnd` skips sent blocks; `regroupTable` keeps `sent`; `paintSentHeaders`; `paintTrayList` (+ "Unlock to fix and send again" for rejected); clear prompt counts not-sent / not-taken-in blocks. kg-check rows get a **qty OK** button. Working table kept in `oea-working-table-v1` (`snapTable` / `restoreWorkingTable`, MutationObserver + input/change, 400 ms debounce; removed when the table is empty). Added `<meta charset="utf-8">`.
- **Logistics Desk 2.5:** `#trayCard` (Add orders), `#trayDash`, menu badge; `paintTray()` from `refresh()` (skipped while a batch's duplicate picker is open). `trayCheck(b)` = `parsePaste(text, tab)` per tab; mismatch of lines, or kg by more than 1 → blocked. Unknown tab → `trayOpen.tabFor`. `trayTabQuestions(rows)` → party on hand here only under other tab(s) → radio answers required. **Add all** → `addOrderRows(rows, null, …, {src:'ots', extra:{batch}})` — `tab=null` = several tabs, one Upload log entry per tab; `onAdded` writes the receipt; `onCancel`. `batchTaken(id)` = receipt or an upload with that batch id. Reject needs a reason. Setup card "Order to Sheet on this computer" (`otsSeenText`).

## v3.0 (17-10-2026) — delivery locations + map spots. Code.gs 3.0 (new deployment, upload index.html first)
- **Key:** `siteKey(base,site)` = `BASE @ SITE` (both upper case, `SITE_SEP=' @ '`); `siteOf(p)` → `{base,site}`; `deliverySite(text)` with `DELIVERY_RE` = `delivery -|:|to|at …` or `site at|-|: …` (not "DELIVERY HUB…"). Display: `pnameHtml(p)` (base + blue "Delivery - Place" tag), `pnameText(p)`, `siteLine(p)`, `titleCase`. `sitesOf(base)`.
- **Paste reader / tray:** a no-number row under a party matching `deliverySite` switches the current party to the site key; routes column B carries as before (goes onto the site record). `commitPasteRows` sets `homeTab` on a site record and creates the base party record if missing.
- **Code.gs 3.0:** `readOrderSheet` same rule (`base`, `SITE_SEP`); `writeOrderSheet` writes party row (base name, routes of the site record) + `Delivery - Title` row; `readParties`/`writeParties` 6 columns (+ `MAP SPOT` → `pin`); `MIN_TOOL='3.0'`.
- **Model:** `PARTY_SHEET_FIELDS` + `pin`; `data.districts` (route → district, `m3map`, 'District of route'); `homeTab` in partyExtra. `cascadeSites` on rename/merge; `mergeParty` now keeps `loc`, `pin`, `homeTab`.
- **Dashboard:** `noSiteRoute` → "Delivery location with no route" section first (route pills); generic no-route list leaves sites out; no-place list leaves out parties with a spot.
- **Type an order:** `#manSite` + `#manSiteList` (locations of the typed party); `manSiteChanged()` fills tab (`homeTab`) + routes; Add needs routes for a location; row party = `siteKey`.
- **Outputs:** `laneTsv` / `laneRows` add a "Delivery - X" row under the party row (party row = base name); `driverText`, `partyLocText`, `daySummaryText` likewise.
- **Maps:** `parsePin(v)` (coords; last `!3d!4d`; `q/query/ll/destination/center=`; `@lat,lng`); `pinOf(p)` = pin field or coords in `loc`; `partyLocation(p)` = pin, else place (or site name) + pincode + `districtOf(p)` + region; `laneMapRoute` adds `MAP_DRIVING` and returns `approx`; `openLaneMap` flashes missing/approximate stops; `mapsUrl`/WhatsApp use `pinUrl`. **Route from Maps:** `readRouteLink(url)` (path segments; data tokens `!4m..!4m..` then `!1m<n>` blocks with `!1d lng !2d lat`; mode `!3e`), `matchRouteLink(lane,link)` (godown skipped; spot within 1.5 km, else same first place word, then contains), `openRoutePanel(laneId)` (`#rlPanel`): table, "Use this delivery order" (`lane.stops=m.order`), "Save the ticked spots" (only checked, only on press). Buttons `data-lroute` on Build plan and Final plan.
- **Order to Sheet v5.7 spec (for the reader chat):** recognise "site at <place>" / "delivery to <place>"; party master keeps per-party locations `{name, tab, possibleRoutes, aliases}`; known location → its tab + routes; new/without tab or routes → orange + NEEDS ATTENTION "PARTY — delivery to PLACE: set its tab and routes", Send blocked; the block files under the location's tab; never merged with the party's other blocks; output rows: date / party (col B = location's routes, col C = party) / `Delivery - Place` (col C only) / items; tray line counts = item lines only.


## v3.1 (19-10-2026) — Orders tab, Find missing orders, outside-the-tool vehicles, one map box. Code.gs 3.1 (MIN_TOOL only)
- **Menu:** `#mainMenu` top-level `data-v="orders"` (class `mdash`, label "Orders"); `STEPS` / `LOGI_STEPS` = plan, out, log; step bar "n/3"; `lastLogiStep()` default `plan`. Texts "Add orders" → "Orders".
- **Tool deletions noted:** `dropOrders(pred)` replaces every plain `S.orders=S.orders.filter(...)` delete (party block Remove, duplicate copy, item ×, party Delete, Upload log delete) and calls `noteDeleted(ids)` → `S.delNote[id]='dd-mm-yyyy'` (item lines only; newest `DEL_NOTE_CAP`=3000). Cancels and Plan log applies are not notes (they have their own records). Synced: `data.delNote` in `toModel`; merge = `m3map` ('Deleted in the tool'), and when either side lacks the key the union of base/remote/local is kept (an older copy never wipes it); `applyModel` takes it. Code.gs stores it in `_DATA` column A like any other key (generic). MIN_TOOL 3.1 because a 3.0 tool's `toModel` would drop the key.
- **Find missing orders** (`#missCard` in Upload log; `findMissing(days)`; `missState`; `paintMissing()`): uploaded lines (u.day within the period, `dmyKey`) whose ID is not in Orders, not in any log stop's `orderIds`, not in `delNote`, and whose `contentKey(party,item,date)` is not in Orders, any log `snapshot`, or `S.cancels`. Default all ticked. **Put back** = `putBackLines(ls)` (same id/party/item/qty/unit/weight/date/tab, addedOn today, party record made if gone, delNote entry removed). **Record as gone…** opens the outside form with `missing` lines; on save they are put back and applied in one go (so the log entry's `snapshot` has them and Orders ends unchanged).
- **Vehicle sent outside the tool** (`#outOpen` / `#outBox` in the Plan log card; `outForm`; `paintOutsideForm()` runs after `paintLog` via `PAINT.log`): date (text dd-mm-yyyy, `parseDate`), vehicle (required, datalist of vehicle types), vehicle no. / driver (datalists), party filter + tab filter over `outFreeParties()` (free lines = not in an open log entry), party tick → `linePickHtml(freeLinesOf(p), ids)`; `readLinePick` per party (qty edits allowed). `recordOutside(v, picks)` → `{id, title:'<veh> — <date> (outside the tool)', vehicle, outside:true, createdAt:date, vehicleNo, driver, stops (loading order = picks reversed), qtyGone:{}, notes:{}}` → `applyLogEntry` (resolved, snapshot, stock out) like Godown collected; Reopen undoes it.
- **Maps:** Parties & map column "Map link or spot" = one input `data-pmap`: empty → loc='' pin=''; plain coordinates → pin, loc=''; anything else → loc=value, pin=parsePin(value) ('' for a short link). `mapsUrl(p)`: pin → spot search; else an http(s) `loc` is returned as it is (Google opens the shop from a short link); else name search. Route links (`partyLocation`) unchanged — a short link can't go into a directions URL, so it stays "no exact spot". Filter `linknospot`.
- **Spot import** (`#spotCard`): `spotNeedList()` = parties with `loc` and no `pinOf`; Copy = `PARTY\tLINK` lines (exact keys, `@` sites included). Paste back → `readSpotPaste()` (party by exact key or `normName`; spot = last cell after the party that holds coordinates or a long link with them) → preview (`spotRows`, not found / no spot / same as saved / replaces / "outside Kerala?" when lat not 8–13) → "Save the ticked spots" sets `pin` (synced to PARTIES MAP SPOT as before).
- **MapSpotFinder.gs 1.0** (separate Google Sheet "Map spot finder", Extensions → Apps Script, `@OnlyCurrentDoc`): menu Map spots → Find spots / Set up this sheet / Clear; columns PARTY | LINK | SPOT | NOTE (text format). `spotOf(link)`: coordinates in the link itself, else follow redirects one hop at a time (`followRedirects:false`, desktop UA, ≤8 hops) checking each address, else the final page (`!3d!4d`, `markers=`, `center=` of the og:image static map, `[null,null,lat,lng]`, `/@lat,lng`); consent page / 4xx / errors explained in NOTE; outside Kerala (8–13 N, 74–78 E) flagged "CHECK". 5-minute run guard (press again to continue; rows with a spot are skipped), 0.4 s between links. Tested only with a mocked UrlFetchApp — real Google answers may differ (try a few links first).

## v3.2 (19-10-2026) — exact spots one by one. Tool only (Code.gs stays 3.1)
- Real links tested 19-10 (redirect read with a fetch that does not follow): a desktop share link → `/maps/place/…/@lat,lng…!3d…!4d…` (the finder reads it); phone shares `…?g_st=aw/awb` → `/maps/place/NAME,+ADDRESS/data=!4m2!3m1!1s0x…:0x…` = place ID only, and the page has no coordinates without JavaScript → the finder notes "no spot on the map page".
- `#spotQStart` / `#spotQ` in `#spotCard`; `spotQ = {list: spotNeedList(), i, saved, skipped, msg, cls, last:{party, pin, prev}}`; `paintSpotQueue()`; `sqTakeText(txt)` → `parsePin` → `S.parties[p].pin`, save, next; `#sqTake` uses `navigator.clipboard.readText()` only on the button press (permission asked once by the browser; refusal → use the paste box `#sqPaste`, read on input). Messages: empty clipboard, still the short link, place link without pin, other text; outside 8–13 N / 74–78 E warned; Undo restores the previous pin and returns to that party.

## v3.2.1 (24-10-2026) — header undo, outside form, route link read-back. Tool only (Code.gs stays 3.1)
- **Header:** `.undobar` (undo/redo) moved into `.hbadges` before `#saveBadge`, with a divider on its right.
- **Outside form:** `F.pick[p] = {ids:Set, qty:{id:text}}`; `[data-lpq]` input writes `F.pick[p].qty`; `linePickHtml(lines, ticked, qtys)` (3rd arg optional, other callers unchanged). Picked parties render first in `.ofsel` ("Selected · n parties"); `.ofparties` lists `outFreeParties()` minus picked, filtered by text/tab. `paintOutsideForm` restores `window.scrollY` and `.ofparties` scrollTop after repaint.
- **Route read-back:** `laneMapRoute` returns `sent:[{party,text}]` (the text put in the URL = `partyLocation`); `openLaneMap` → `rememberMapSent(laneId, sent)` into localStorage `jw-ld-mapsent-v1` `{laneId:{at,list}}` (newest 60). `matchRouteLink(lane, link, sentList, manual)`: pass 0 = sent text equal to the segment (`rlNorm`) or sent coordinates within 0.3 km of the link point; then the old passes (spot within 1.5 km, same head word, contains); then **changed stops**: leftover parties vs free segments scored by neighbours (party before/after in the sent order vs matched stop before/after the segment), best ≥1 taken, one-and-one paired; parties sent as the same text follow; `changed:true`. `manual` {stopIdx: segIdx | -1} applied last and only moves those rows (a party whose segment you give away becomes unmatched). Panel `paint()` re-renders on each pick: changed rows yellow (`.rlchg`) with a select (`[data-rlpick]`) and note "changed in Google Maps / your pick · the tool sent: …", spot checkbox unticked; leftover parties listed with the sent text and a select; a note when nothing was remembered on this device (matching by name only).

## v3.3 (01-11-2026) — Stock required "In vehicle". Tool only (Code.gs stays 3.1)
- `stockGroups(lines)`: optional line list (default `S.orders`); a line with `_lane` keeps its party per vehicle (party key `party\u0001lane`, `p.lane`). `shortageItems()` and everything else still call it with no argument (whole Orders).
- `stockMode` 'tab' | 'route' | **'veh'**; `stockVehs` (lane ids, empty = all); `vehLanes()` = `S.plan.lanes` with any `stopItems`; `vehStockLines()` = `stopLines(st)` of each stop (edited `loadQty` applied, `exclude` respected) tagged `_lane: lane.name`. Pills `[data-sveh]` with `laneWeight`. Switching mode clears all three pill sets. `#stockHint` text per mode; header "Qty in vehicle"; detail rows show `pnameHtml` + `.tag.vehtag` (vehicle); "enough for this load".
- `stockLast = {list, veh, vehs}` set by `paintStock`; `stockText()` copies it (first line "In vehicle: …" in the vehicle view). `gotoView('stock')` always repaints (Build plan edits only invalidate plan/dash/out).

## v3.3.1 (02-11-2026) — close safety. Tool only (Code.gs stays 3.1)
- `syncUnsent` (declared with `dirty`): set true in `markDirty()` when `syncCfg`; recomputed in `setSyncState('ok')` as `!same(toModel(), syncBase.model)`; cleared by the two silent paths in `syncNow` (timer / poll found nothing the sheet keeps). `paintSyncBadge`: when `syncUnsent && syncBase` shows class `dirty` "Not sent to sheet yet" / short "Unsent" (click already = `syncNow('manual')`).
- `beforeunload` warns when `dirty||saving` or (`syncCfg && !syncFirst && (syncUnsent||syncBusy||syncState.s==='err'||!syncBase)`). `visibilitychange` (hidden) and `pagehide`: `flushSave()` then `syncNow('hide')` if unsent and not busy. Test `t_v331.js` (gas_mock, offline route).

## v3.4 (04-11-2026) — search like Tally. Tool only (Code.gs stays 3.1)
- Helpers after `esc()`: `_srchWords(text)` (lower case, accents off, `- / , ( ) + : ; | _ * & \ # @` → space, `' ’ \` .` removed so "S.N." = "SN", the word "and" dropped, runs of single letters joined: "s n" → "sn"; cached, 6000 entries), `nameSearch(q)` → `test(text)` or `null` for an empty box: every query word must match some word of the text by prefix, or (3+ letters) occur in the text run together, or (5+ letters) be one letter off (`_near`: wrong / missing / extra / swapped) a word or word prefix. `itemSearch(q)` → words made of `[a-z0-9./x]` (× and * = x), every typed word must occur in the run-together item text.
- Used by: `poolParties` (`#poolSearch`), `paintOrders` (`ordQuery`; the `q||ordTabs` count line still uses the raw text), `paintRoutes` (`#pSearch`), `paintLog` (`#logSearch`: one joined string of title, vehicle, vehicle no, driver, date and every stop's party), `repFiltered` / `repCancels` (`#repFind` = `nameSearch`, `#repItem` = `itemSearch`), `paintUploads` and `#upCopyAll` (`#upSearch`: party by `nameSearch` or item by `itemSearch`; `qn` replaces `q`), `paintStock` (`#stockSearch` on `g.label`), outside-vehicle form `#ofQ`.
- No re-ranking: lists keep their order. Test `t_v34.js` (matcher cases + each box on screen). Tests that open old builds (`v17.html`, `v20.html`, `old23.html`) were rebuilt from the saved v1.8 / v2.0 / v2.3 files after the container reset.


## v3.4.1 (09-11-2026) — Excel for iPhone, Clear log. Tool only (Code.gs stays 3.1)
- `buildPlanXlsx`: text cells `t="s"` with an index into `xl/sharedStrings.xml` (`sst` / `sstIx` / `sstCount` inside the function; `sIdx(v)`), numbers and formulas unchanged (formula keeps its cached `<v>`). Added `<dimension ref="B3:F{last}">`, `docProps/core.xml` + `docProps/app.xml`, Content_Types overrides for sharedStrings/core/app, `_rels/.rels` rId2/rId3, workbook rels rId3 → sharedStrings. Cause: iOS Quick Look does not render `inlineStr` cells.
- Plan log: `[data-logclear]` button on `!g.resolved` entries where `live.length < allIds.length` (some `orderIds` no longer in `S.orders`). Confirm via `armConfirm`; sets `g.resolved=true, g.cleared=true, g.snapshot=[], g.stockDelta=null, g.appliedAt=Date.now()`. Orders and stock untouched; Reopen (snapshot `[]` is truthy) just sets it open again.
- Test `t_v341.js`. `t_v16.js` needs `site/` (index.html + sw.js + manifest + icons); tests also need sw.js/manifest/icons next to index.html (else 404 console errors in t_v12/t_v13).

## v3.4.2 (14-11-2026) — Find missing: nothing ticked. Tool only (Code.gs stays 3.1)
- `#missFind` and `refindMissing` start with `tick:new Set()` (was every id). Header checkbox `#missAll` ticks/unticks the whole list. `t_v31.js` updated (3a, 3a2, 3c).

## v3.5 (14-11-2026) — icon side menu. Tool only (Code.gs stays 3.1)
- Each `nav button[data-v]` = `<span class="mi" [data-n]><svg 24x24 stroke icon></span><span class="ml">label</span>` + `title`. `data-n` (1/2/3 on the Logistics steps) drawn by `.mi[data-n]::after`. Header label (`#curView`) still reads `b.textContent` (SVGs carry no text); `.traybadge` still appended to the Orders button.
- CSS (before the phone rules): `@media (min-width:641px)`: nav always visible, 58 px wide, `.open` = 270 px overlay with shade; collapsed hides `.ml/.mglabel/.mver`, shows shut groups' buttons, tray badge as a corner dot; `.guardbar` and `main` get a 58 px left margin (`main` uses `max(58px, (100% - 1500px)/2)`).
- Phones (≤640): `nav.peek:not(.open)` = the same 58 px strip. Touch: start within 22 px of the left edge and move right >35 px → `navPeek(true)`; when peeked, swipe left >35 px → hide; a click outside the nav or picking an entry hides; `setMenu(true)` removes peek. Vertical moves ignored.
- Test `t_v35.js`.

## v3.6 + Code.gs 3.2 (14-11-2026)
- **Code.gs 3.2:** `theKey()` = Script Properties `SECRET` (trimmed) else the `SECRET` const; doPost compares `req.key` with it; message "Set the key first: Project Settings → Script Properties → SECRET" when neither is set. `gas_mock.js`: `makeEnv({keepSecret})`, `env.sprops`, `getScriptProperties`. Test `t_gs32.js`.
- **Sheets:** `isSheet12(item)` (a size run of 4+ parts joined by x/×, second-to-last = 12, last a number); `laneSheets(l)` sums `stopLines` qty; `sheetCapGuess(name)` (benz/bharat/1xT → 350, eicher/6.5 → 300, jayo → 250, electric → 200); `sheetCapOf(name)` = `S.sheetCap[name]` (0 = no limit) else the guess; `laneSheetCap(l)` via `laneTypeOf`. Lane head `.sheetwarn` (`.lwarn.bad`) / `.sheetinfo`. Setup `[data-vtsheet]` inputs in `#vtList`. `S.sheetCap` in `_DATA` (toModel data, MAPS merge 'Max sheets per vehicle', applyModel).
- **Party contact/note:** `S.parties[p].phone`, `.note` (go through `partyExtra`, no sheet column). `partyPhone(p)`, `partyNote(p)` fall back to `siteOf(p).base`; `pnoteHtml(p)` appended by `pnameHtml` (so every screen using it shows the note); Orders edit mode adds it after the rename input; `.opl` line gets `.pphone` tel link. `driverText` / `partyLocText` add 📞 / 📝 lines. Parties table: `textarea.pnamein[data-rename]` (2 rows, Enter = save, whitespace collapsed), `.pextra` with `[data-pphone]` / `[data-pnote]`.
- **Order date:** edit mode `.odatein[data-bdate]` (masked) → all orders with that party+tab+date get the new date; `setHold` / `setDue` moved to the new batch key.
- **Send to plan:** `pullIntoLane(l)` (shared with `[data-lpull]`), `fitVehType(kg)`; Possible plans column `.csend` with `[data-cveh]` select + `[data-csend]`; lane `{name:freeLaneName, cap, title:combo name, routes, xroutes}`.
- Test `t_v36.js`; `t_v34.js` reads textareas too.

## v3.6.1 (17-11-2026) — xlsx made Excel-complete for iPhone Quick Look (unconfirmed)
- `buildPlanXlsx`: + `xl/theme/theme1.xml` (compact Office theme; rels rId4, content-type override), fonts with `<color theme="1"/>` + `<scheme val="minor"/>`, `<dxfs/>` + `<tableStyles/>`, workbook `<fileVersion>` `<workbookPr defaultThemeVersion>` sized `<workbookView>`, sheet `tabSelected`, `<sheetFormatPr defaultRowHeight="15"/>`, `<row spans="2:6">`, full `docProps/app.xml`; formula `<v>` only when numeric (commas stripped). ZIP still stored (no compression).
- Review 17-11 (tsc --checkJs: no undefined names in either tool). Open findings reported to Paul, not yet changed: mergeParty drops phone/note; Send to plan / Pull also take out-of-stock lines that Possible plans leaves out of its kg; fitVehType ignores the sheet limit; phone icon strip tap-through; party note prints on the Final plan print.

## v3.6.2 (17-11-2026) — Logistics menu colours, note screen-only
- Logistics `.mgroup` gets class `mlogi`: background #e3f3e8, radius 10px; buttons/label `var(--green-dk)`; hover white; `.on` solid green-dk with white text; `.mi[data-n]::after` green-dk with white digit (border = panel colour; inverted on `.on`). Amber `--amber` is now used only by the Orders `.traybadge`.
- `@media print{ .pnote{display:none!important} }`. Test `t_v362.js`.

## v3.7 (18-11-2026) — party filter chips, Build plan selection mode
- `#pFilter` select removed. `PFILTERS=[[key,label,fn(n,today),notLabel]]`; `pfState{key:1|-1}` in localStorage `jw-ld-pfilters-v1` (try/catch); `partyFilterOk(n,today)` = every set filter matches (1) or not (-1); `paintPartyFilters(all,shown)` draws `.pfchip[data-pf]` buttons (cycle off→1→-1→off) + `#pfCount` + `#pfClear`.
- Selection: `selMode`, `selSet` (Set of party names), `selTarget`; `partyCard` adds `.selmode` / `.picked` / `.selbox`, drops `draggable` and the `[data-sendto]` buttons when selecting; `wireCards` gives pool cards an onclick toggle (ignores a, input, select, textarea, button, .qedit) that updates the card in place + `paintSelBar()`. `#selToggle` in the pool head. `paintSelBar()` (fixed `#selBar`, removed off Build plan; also called from `gotoView`): prunes parties no longer waiting, sums `unplacedWeight`, options `new:<type>` + existing lanes, default `fitVehType(kg)`; Add puts each picked party (pool screen order) on the lane with `unplacedItems` / `excludeForUnplaced` (same as the → vehicle button). `body.selpad` adds room under the page. Test `t_v37.js` (incl. CDP touch scroll does not pick); `t_v30.js` uses the chips.

## v3.8 + Code.gs 3.3 (20-11-2026) — order note, duplicate parties, folding filters
- **Order note** `o.onote` on every line of the order (party+tab+date). Code.gs 3.3: `splitPartyNote(ss,text)` (trailing `(…)`/`[…]`, recursive for two; skipped when the full text is a PARTIES name, read once per run into `KNOWN_PARTIES`); `readOrderSheet` reads party-row G (+ bracket) into `onote`, writes the cleaned name to C and the note to G (`fixes`, one setValue each); `writeOrderSheet` writes the group's first non-empty `onote` into party-row G. `MIN_TOOL` 3.8 (an older tool would drop `onote`). Tool: `splitPartyNote(text)` (S.parties check), `onotesOf(lines)`, `onoteHtml(lines)` (`.onote`, print-hidden); parsePaste (`curNote`, party-row G or bracket), Type an order (`spn`), commitPasteRows, toModel / ordKey / applyModel / FIELD_NAMES. Orders edit mode `input.onotein[data-onote]` sets/clears it on the batch.
- **Duplicate parties** (Admin): `dupNameKey(n)` (upper, & → AND, only A-Z 0-9 @), `editDist(a,b,max)` (optimal string alignment with early stop), `findDupParties()` = same key groups + near keys compared inside buckets of the first 3 and last 3 letters (1 edit from 10 letters, 2 from 16; a party and a delivery location never pair); `paintDupList`, `#dupFind`, `#dupShowHidden`; `S.dupNot{"A|B":1}` in `_DATA` (MAPS 'Not the same party'). 2,500 random names ≈ 0.4 s. NB the order-duplicate check already owns `dupKey(o)` - don't reuse that name.
- `mergeParty` keeps phone/note (joined with " / " when both differ).
- Parties & map: `.pfbox` is `<details id="pfDetails">` with `#pfOn` in the summary.
- Tests `t_v38.js`; t_fast / t_gs31 push as app 3.8; t_v30 / t_v37 open the filters first.

## v3.8.1 (21-11-2026) — bracket always split
- `splitPartyNote` (tool) and Code.gs `splitPartyNote` no longer check for a known party name (`KNOWN_PARTIES` removed). Any trailing `(…)` / `[…]` is the order note.

## v4.0 + Code.gs 4.0 (21-11-2026) — companies, login, shared setup, who saved last
- **Storage per company:** `COMPANIES` (id, name, url), `CO` (localStorage `ld:company`), `PERCO` = keys that get ":c2" for company 2 (`lpb:v3`, `lpb:synccfg`, `lpb:syncbase`, `lpb:clashes`, `lpb:restore`, `lpb:setupmeta`, `lpb:recent`); `ck(k)` / `ckFor(k,co)` used by `store.get/set`, `kvGet/kvSet`, `kvGetFor(co,k)`. The v2 backup fallback and the Claude db only apply to company 1. `switchCompany(id)`: flushSave, quick sync (max 4 s), set `ld:company`, reload. `cfgOfCompany(co)`, `callCfg(cfg,action,payload)` talk to any company's script.
- **Login:** localStorage `ld:user`, `ld:uh` (sha256(name lower|PIN)), `ld:needlogin:<co>` (set when ping says `users>0`, so the gate shows before anything renders). `showGate/hideGate`, `#loginGate`, `#userBtn` + `#userMenu`, `paintUserBtn`. `syncCall` sends `usr`,`uh` and `dev` = "Name · Device"; a `login:true` answer clears the login and shows the gate. Script: `loginAction`, `userAction` (userset/userdel/userlist; first user needs no login), `readUsers/writeUsers/checkUser`, auth check before every action except ping/login; Document Property `USERS`; `resetUsers()` in the editor. Admin → People: `paintPeople`, `peopleChange` (calls every connected company).
- **Who saved last:** `logSave` writes Document Property `LASTSAVE`; `withLast` adds `last` to pull / changed-parts / conflict answers; tool `lastFromSheet` → `noteOthers()` (flash, `recentChg`, Setup line `lastSheetInfo`).
- **Shared setup:** script Property `SETUP` {at,by,b}; `setupSet` keeps the newer `at`; ping returns `setup` (and takes `quiet:1` so a call to the other company is not logged). Tool `setupBundle/applySetupBundle/setupTick(own,init)`, meta `lpb:setupmeta` {sig,at,pend}; runs after opening, connecting and each good sync; an empty company takes the bundle from its own script or the other company's.
- **Grey first sync:** `body.syncgrey` (+ `#greyNote`), removed when the opening sync ends or after 25 s.
- **Tray:** `trayCoMatch(b)`; `trayWaiting()` filters by company.
- Plan log entries and Upload log entries get `by`. Tests `t_v40.js`; version strings 4.0; t_v17 waits 1.5 s after connecting (the first setup share is one extra call).

## v4.1 + Code.gs 4.1 (21-11-2026) — login without the key, themes, Item history
- **Code.gs 4.1:** `keyOk = req.key === KEY`; without it a call is allowed only when people exist and it is ping, login, or carries a valid `usr`+`uh` (`checkUser`); `req.keyOk` set. Ping without key/login returns `{ok, version, users, needLogin}` only. `loginAction` also counts `ld_fail_all` (cache, 1 h): 40 → "Logins are paused". No people + no key → `{ok:false, nokey:true}`.
- **Tool:** `autoConnect()` (called from `initSync` when not connected): `callCfg({url:coInfo().url,key:''},'ping',{quiet:1})` → if users>0, `syncCfg={url,key:''}` and the login gate. `cfgOfCompany(co)` falls back to the built-in URL when logged in. Connect allows an empty key.
- **Dashboard:** `newestKey/byNewest/newestDate` in `paintDash`; `dashRoutePick` Map + `routePickHtml(p)`; `[data-r]` picks, `[data-rsave]` saves.
- **Themes:** `THEMES`, `applyTheme(id)` (top of the script, before drawing; `meta theme-color`), `curTheme` (localStorage `ld:theme`), `paintThemes()` + `#themeBtn` / `#themeList` (Setup card `#themeCard`). CSS: `html[data-theme=blue|red|brown]` vars; night vars inside `@media screen`; `/* v4.1 night (generated) */` block from `tools/gen_night.py` (light backgrounds → dark tint of the same hue, dark text → light, light borders → dark, `color:var(--green-dk)` → `var(--head-ink)`; print rules skipped) + a hand-written night block after it.
- **Item history:** `REPORT_VIEWS.ritem='item'`, nav `data-v="ritem"`, `paintItemHistory()` (groups `reportLines()` by `stockKey`, `itemSort`), `repFiltered('item')` (Find = item, second box = party). Period `custom` + `#repFrom/#repTo` (`normDateTyped`).
- **CLT-Setup.gs** + `t_clt.js`. Tests `t_v41.js`; version strings 4.1.

## v4.1.1 — CLT&KNR web app URL in `COMPANIES[1].url`.

## v4.2 + Code.gs 4.2 (21-11-2026) — requests between the companies
- **Code.gs:** `requestAction(req, ss)` for `reqInfo` ({routes, tabs} from MASTERS), `reqList` (all `REQ_*` Document Properties; non-pending older than `REQ_KEEP_DAYS`=30 deleted), `reqAdd` {req} (key `REQ_<dir>_<id>`, max 8800 chars, duplicate id ignored), `reqSet` {id, dir, patch: status/reply/applied/told/dismissed}. Same login/key rules as other calls. ACCESS LOG rows "REQUEST".
- **Request:** {id, from, fromName, to, toName, by, at, note, party, info{place,pincode,phone,note,loc,pin}, routes (suggested), lines[{id,item,qty,unit,weight,date,tab,onote,remark}], status pending|accepted|delayed|rejected, reply{by,at,routes,tab,delay,reason}, applied (asker), told (receiver), dismissed}.
- **Tool:** `otherCo()`, `reqTick(force)` (after a good sync, 45 s throttle; Dashboard paint), `reqProcess()` (asker: drop lines with `dropOrders`, lift holds whose reason starts "Asked ", `applied`; receiver: tell the asker via `callCfg(cfgOfCompany(from),'reqSet')`, `told`), `paintReqs()` (`#reqBox` at the top of Dashboard), `reqAnswer(q,status,row,text)` (re-reads reqList first so two devices can't answer twice; `commitPasteRows` + `recordUpload(...,'Request from X',{req})`), `openReqForm(parties)` (`#reqForm`, button `#selAsk` in the selection bar), `REQ_HOLD(name)`. Test `t_v42.js` (two sheets, two browser contexts).

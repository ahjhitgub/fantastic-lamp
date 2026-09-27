# CEW / CBEP Tracker

An offline, single-user tracking and reporting tool for CalRecycle
CEW/CBEP monthly claims — transfers, cancellations, residual weights,
battery/panel disposition, and (eventually) the claim forms themselves,
all cross-referenced across claim periods.

## Running it

No build step, no install, no server required.

- **Easiest:** unzip and double-click `index.html`. It opens in your
  default browser and works fully offline.
- **If your browser blocks it on `file://`** (some do, for IndexedDB or
  module loading): run a tiny local server from this folder instead —
  `python3 -m http.server 8000`, then open `http://localhost:8000`.
- **Hosted on GitHub Pages:** push this folder to a repo, enable Pages
  on the `main` branch, and it runs the same way over `https://`.

All data is stored in the browser's IndexedDB, scoped to whichever
browser/profile you open it in. Nothing is sent anywhere — there's no
server component at all. Use **Settings & Backup → Download backup**
regularly to save an actual `.json` file to disk (attachments included)
— that's your portable copy for backups, moving laptops, etc.

## Project structure

```
index.html               Shell — sidebar, active-period switcher, page mount point
css/styles.css           One stylesheet, no framework
js/models.js             Constants (CEW types, company roles, WC types, transfer timeline, seed materials)
js/logic.js              ALL rules and math, no DOM/database — tested by tests/logic.test.js
js/ui.js                 Small rendering helpers (HTML escaping, element builder, notices)
js/db.js                 IndexedDB wrapper (schema v4)
js/store.js              Shared data helpers + one-time migration of pre-v4 data
js/periods.js            Claim-period dates/totals from allocations
js/backup.js             Backup download / restore
js/attachments.js        "Supporting documents" section used on every WC
js/pages/*.js            One file per page (doc.js = printable transfer documents)
js/app.js                Router (#/page or #/page/param) and shell
js/vendor/pdf-lib.min.js pdf-lib 1.17.1 (MIT) — fills the official CalRecycle 197; loaded only on the 197 tab
forms/CalRecycle197.pdf  Blank fillable CalRecycle 197 (Rev. 1/2026)
CHANGELOG.md             What changed in each version
tests/logic.test.js      node --test tests/logic.test.js
```

## How the records fit together

- **Weight certificates (WCs)** are the central record. Every WC has a number,
  type, date, status, company, notes and attachments. Built-in types:
  **Transfer**, **Residual Shipment**, **Inventory Check**; add more in Settings.
  Statuses are entirely yours (Settings → WC statuses).
- A **transfer** WC holds the IRR lines (what was received), the source-log count
  per line (= CEW units), the non-CEW weight (typed in) and the derived CEW
  weight. Only CEW LCD/LED (and CBEP) is claimable; CEW CRT and plasma trigger
  the 197 note "CRT and Plasma Units, will not be kept and instead transferred
  to another recycler".
- A transfer is **allocated** to claim periods afterwards — whole, or split
  across at most two back-to-back months, never before it was received and
  never beyond its claimable total.
- **Cancelled units** carry a **lot #**, which must equal the transfer's WC #.
  The **Audit** page compares each lot's units and weight against what was
  allocated to that period — showing short/over and the full math per lot — and flags unknown lots, misspelled or wrong company
  names, units outside the month, missing weights, over-claiming across periods,
  and units corrected after import. Time, make, model and box # are not audited.
- **Customers and pricing.** We buy CEW units and charge for non-CEW ones
  (non-CEW LCD/LED and plasma print as one "Non-CEW Non-CRT" line). Each company holds the customer sheet fields (owner,
  CEWID, admin, source log system, language, pick up/drop off, trucking deduction,
  CBEP enrollment) and its own rates. The **Price List** holds drop-off and pick-up
  rates or "variable". On a transfer the rate for each line is: a rate typed at
  inspection → the customer's rate → the price list for pick-up/drop-off. Trucking
  deductions apply to pick-ups. Paste the customer spreadsheet on the Companies page.
- **New WCs.** The WC # field starts at one past the highest WC # on file (still
  editable). Transfers pick who they're from, shipments where they're going, right
  on the create form. A transfer's WC date is also the "WC # assigned" and
  "Material received" date, the IRR date and the 197 date of transfer.
- **IRR.** Each transfer has its own unique IRR # (its own sequence, filled in as
  one past the highest on file), shipping date, license plate and "inbound report
  by". IRR lines carry gross/tare/net; blank units print as "Wt.Only".
- **Parties.** We are always the recycler; when a handler is selected we are also
  the collector (a dual-entity transfer, using our collector CEWID from Settings),
  and the handler is the customer. Closed accounts are left out of pickers.
- **Documents.** Each transfer prints an Inbound Receiving Report, Weight
  Certificate and Purchase Invoice laid out like Bellflower's own forms, and fills
  in the official CalRecycle 197 PDF (`#/doc/<wcId>/<irr|wc|invoice|197>`).
  The 197 lists only CEW LCD/LED (and CBEP); CRT/plasma are noted instead.
  The 197 needs the site opened from its web address (it loads `forms/CalRecycle197.pdf`).
- **Companies** (collectors, handlers, destinations) can have saved
  misspellings; the Companies page lists every non-matching name found in the
  logs and maps them onto a company in one step.
- **Inventory** is always ours. End-of-month inventory can be a general entry (no
  WC #) grouped by material, with Enter adding the next weighing under the same
  material and net totals per material. Materials marked "needs its own WC" (LCD
  lamps) must be on an inventory WC by themselves.
- **Shipments** use the vendor's own descriptions (Vendor Descriptions page — new
  ones are learned on save), each marked CEW or not and linked to a residual.
  Only CEW lines count as residuals. Each shipment records whether we were paid or
  charged, drop-off/pick-up, and the vehicle. Oldest storage ships first: every
  residual shipment WC gets a note saying how much came from which earlier month's
  storage (printed on its weight certificate).
- **CRTs and plasmas** go to approved CEW recyclers on CRT/plasma shipments, which
  have no WC. Each line names its source transfer; units received after the ship
  date can't be used, and units the recycler rejects as non-CEW still count as
  shipped. The CRT & Plasma page shows received, shipped, rejected and left.
- **Vehicles.** Companies and our facility have license plates. Transfers: dropped
  off = the customer's plate, picked up = ours. Shipments: we deliver = ours,
  vendor picks up = theirs.
- **Residuals** are calculated, never typed: generated = shipped this month +
  end-of-month inventory − last month's end-of-month inventory, per material,
  rolled into the 196B §IV/§V columns. Verified against the filed Jan 2025 196B.

## Development notes

- Page rule: load data first, then build elements synchronously, attach
  listeners, and append. Never assign `innerHTML` to an element after listeners
  were attached inside it. Re-render with `App.rerender()`.
- After changing any js/css file, bump the `?v=` value on every tag in
  `index.html` so browsers fetch the new files.
- Run `node --test tests/logic.test.js` after changing `js/logic.js`.

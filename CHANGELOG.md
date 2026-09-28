# Changelog

Each build gets a version number. It shows in the top bar under the app name (on wide screens) and at the top of Settings.

## 2.9 — Sorting, filters & companies
- **Every list sorts and filters**: click a column heading to sort (again to reverse); **Filter** above a list opens a
  filter box under each heading — a dropdown for columns with a few values (type, status, packet month…), text for
  the rest — with "Showing X of Y" and Clear filters. Sorting knows dates, months, weights and money. Your sort and
  filters stay put while you move around the app. Applies to the WC list, transfers, audit, residuals, CRT & plasma,
  companies, price list, vendor descriptions, claim periods and disposition. The cancellation log's headings sort the
  whole log, not just the page showing.
- **Missing numbers**: a gap in the WC # or IRR # sequence shows "WC #2300 missing" / "IRR #1799 missing" (on the
  WC list, Transfers and the Dashboard). A missing WC # can be recorded as void; either can be marked skipped on
  purpose.
- **Saved companies** shows open accounts only, with **Show closed accounts** to include the closed ones, and a
  **Type** filter: handlers, collectors, approved recyclers, vendors (with counts; "No type set" appears if any
  company has no role).
- The list shows just **Company, Owner, CEWID #** ("Handler" for handlers) and **CBEP enrolled**, with **Edit** at the
  end. Click a company's name for everything else: roles, account, drop-off/pick-up, plates, contact details,
  rates, trucking, misspellings, WC count and notes.
- **CEWID #** takes numbers only (anything else is dropped as it's typed) and is off for handlers.
- **Roles:** a company is a handler or a collector, and a handler or an approved recycler — never both. Ticking one
  clears the other. Companies already saved with both show under **Pick one role**. Merging companies, the WC log
  import and the customer-sheet import follow the same rule; "Handler" written in the sheet's CEWID column makes the
  company a handler.

## 2.8 — WC log import
- **Paste your WC log** (Weight Certificates page): copy the rows of the office WC log — WC, Type, Company, Date, IRR,
  Status, Paid, Payment Due Date, Packet Month, Lot Canceled, Notes — header included, and paste. A preview shows what
  each row becomes before anything is saved. Pasting again skips WCs already in the app (or updates their log details
  if you tick the box).
  - Types are read from the log's wording ("cew transfer only?", "cew/cbep residual shipment", "residual transfer",
    "void", typos like "tranfser"). A "shipment" with a PO or a cancelled lot comes in as a transfer to check.
  - Companies are matched to saved companies and their misspellings; spellings of the same new company
    ("Goldn' West Surplus", "Golden west surplus", "Goldenwest surplus") become one company with the others saved as
    misspellings. Notes in the company cell ("(lamps)", "- copper wire") go on the WC's notes. "Dual entity" rows
    become our own collections.
  - Statuses are added as they appear in the log. Payment: Paid, due dates, "PO sent 9.23.26" (fills the timeline's
    PO step) and payment notes. Packet month, Lot Canceled and notes are kept, along with the original row.
  - Date typos are fixed (9.18.16 → 9.18.26, 916.26 → 9.16.26) and flagged for checking.
- **Weight Certificates list** now shows the log's columns: status, paid / payment due (past due in orange),
  packet month, lot cancelled, notes. WCs from the log that need a look (unclear type, a fixed date, a "shipment"
  that's really a transfer) have a badge; **Only WCs to check** lists them, and **Mark as checked** on the WC clears it.
- Transfers: **Our own collection (dual entity — no customer)**, and a **Payment & WC log** section (paid, payment
  due, payment note, claim packet month, lot cancelled, and the log row as written).

## 2.7 — New look
- Navigation moved from the sidebar to a top bar. Dashboard, Transfers, WCs, Cancellations, Audit and Residuals
  are one click away; everything else is under **More** (claim periods, CRT & plasma, disposition, reports) and
  **Setup** (companies, price list, vendor descriptions, settings). The active claim period sits at the right of
  the bar. Below laptop width the tabs fold into a **Menu** button; on a phone the claim period gets its own row.
- Fresh styling throughout: cool green-gray background, white panels with rounded corners, green primary buttons,
  softer fields and badges, a floating save bar, numbers that line up in columns. Pages are 1280px wide and centered.
- Transfers list: Handler and Collector are one **Customer** column; shorter dates (8.3.26), Drop-off / Pick-up,
  and allocation badges (Full / Partial / Not allocated). It fits a laptop screen without scrolling sideways.
- Printed forms: the IRR, WC and purchase invoice now always print in Arial like the paper templates (before, they
  took the computer's system font — Segoe UI on Windows). The purchase invoice now fits on one page. The printed
  IRR, WC and shipment WC were checked pixel for pixel against 2.6.1; the 197 is unchanged.

## 2.6.1 — Exact 197
- The CalRecycle 197 prints exactly like CalRecycle's form: same two pages and same 48 fields with none of their
  settings changed; checked pixel-for-pixel against the original (nothing differs outside the fill-in boxes).
- Values are drawn the way Adobe draws typed-in values: in the form's own embedded Arial, at each field's own size
  (Arial 14 in Section I, auto-size elsewhere) and alignment. A value too wide for its box shrinks to fit.
- Reporting Month/Year is written on the label's own line in the label's font and size (Arial 12).
- "Print 197" (and Ctrl+P on the 197 page) prints the filled form itself, not the app page. Choose "Actual size"
  in the print dialog.

## 2.6 — Paper forms
- **CalRecycle 197:** the app fills in CalRecycle's own fillable 197 (Rev. 1/2026) — shown on the page, with
  Open to print and Download PDF. It fills Sections I–III, the printed names in Section IV, and Recycler
  Tables 1/2 with the Reporting Month/Year when a claim is split. The form stays fillable; signatures are left
  for pen or Adobe. Each transfer has a CalRecycle 197 section for SA units (198SA), documents provided,
  and printed names.
- IRR, weight certificate and purchase invoice laid out like Bellflower's templates (one shared layout): grey title,
  IRR # / INVOICE # / PO # with DATE and SHIPPING DATE, Commodity Owner and Ship To, vehicle info, a 15-row
  grid with totals boxes. Dates as on each form: IRR 7.1.26, WC 08.07.2026, purchase invoice 9/26/26.
- Weight certificate: CEW rows in bold, "Wt. Only" for weight-only lines, long descriptions shrink to one line,
  Weighmaster Certificate with the scale person. Transfer WCs split CEW / non-CEW with gross and tare
  (totals always equal the IRR).
- Residual-shipment WCs: we're the commodity owner, the vendor is ship-to; first column is Skids or Units; the
  storage note prints beside the totals in line order.
- Purchase invoice: PO # is the WC #; credits and a Deductions table (non-CEW units, * handling from the price
  list, trucking, and deductions added by hand such as Diesel); Total Credit, Total Deduction, Final Balance;
  Circumstance, PO date and "Purchase Invoice by".
- Scale person is picked from a list of authorized WC signers in Settings (no default name).
- Version number shown in the app; this changelog.

## 2.5 — Vendors, vehicles & storage
- Approved CEW recyclers are vendors that also take CRTs and plasmas; vendors don't need customer-only details.
- License plates for companies and our vehicles; drop-off prints the customer's plate, pick-up prints ours.
- Non-CEW units are charged on the purchase invoice; non-CEW LCD/LED and plasma print as "Non-CEW Non-CRT".
- Storage note: which month's storage each residual shipment came from (oldest first), on the shipment WC.
- CRT/plasma shipments have no WC; received-date rule; units rejected as non-CEW by the recycler.

## 2.4 — Inventory, shipments & CRT tracking
- Dual entity status with our collector CEWID; account open/closed; drop off and/or pick up.
- End-of-month inventory as a general entry (no WC) grouped by material; LCD lamps on their own WC.
- Vendor descriptions list with CEW flag and linked residual; paid/charged on shipments.
- CRT & Plasma page tracking units back to their source transfers. No number-box arrows.

## 2.3 — IRR
- Unique IRR # sequence; IRR laid out like Bellflower's IRR (gross/tare/net, Wt.Only, license plate, report by).

## 2.2 — Numbering & audit math
- Next WC # filled in automatically; pick who a transfer is from / a shipment is going to when creating it.
- One WC date for WC assigned, material received, IRR and 197. Audit shows short/over and the math per lot.

## 2.1 — Customers, pricing & documents
- Customer details and import from the customer sheet; master price list with customer rates and variable rates.
- Printable IRR, WC, purchase invoice and 197; the 197 lists only CEW LCD/LED; handler ⇒ we're the collector.

## 2.0 — Weight certificates
- Rebuilt around weight certificates: transfers, residual shipments, inventory checks and custom WC types.
- Companies with saved misspellings; cancellation log import and bulk editing; allocation rules against
  double dipping; audit page; residuals calculated from shipments and end-of-month inventory.

## 1.0 — First working version
- Claim periods, transfers, per-unit cancellation logs, residual and disposition tracking, backups.

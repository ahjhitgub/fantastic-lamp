# Data model (IndexedDB schema v6, data migrations through v8)

| Store | Key fields |
|---|---|
| `facilityProfile` | `id: 'profile'`, `recyclerName`, `cewID` (ours — also the collector CEWID on handler transfers), `dualEntity`, `form198ContactName`, `form198ContactPhone` (198 Master), `fein`, `recyclerContact` (CEWIS), `oldCollectorCewID` (retired in 3.0), `vehicles` (our plates), `wcSigners` (authorized WC signers), `form197Signers` (authorized 197 signers), `phone`, `address` |
| `companies` | `name`, `cewId`, `roles: ['collector'|'handler'|'destination' (vendor)|'recycler' (approved CEW recycler — always also a vendor)]` (handler never with collector or recycler), `cewId` (digits only; blank for handlers), `accountStatus: 'open'|'closed'`, `licensePlates: [string]`, `fromLog`/`logReviewed` (added by the WC-log import), `aliases: [string]`, `owner`, `admin`, `sourceLogSystem`, `primaryLanguage`, `materialMode: 'pickup'|'dropoff'|'both'`, `truckingDeduction: {amount, basis: 'perLb'|'flat'|'percent'}`, `cbepEnrolled`, `phone`, `email`, `address`, `notes`, `rates: {priceItemId: {rate, variable}}` |
| `priceItems` | `name`, `appliesTo` (`cew:lcdled`, `cew:crt`, `cew:plasma`, `cew:cbep`, `noncew:noncrt`, `noncew:crt`, `noncew:cbep` or `other`), `direction: 'pay'|'charge'` (several `cew:cbep` items allowed — CBEP Computer Towers, CBEP Printers; a CBEP line's `priceItemId` says which), `handling` ($/lb * handling deduction), `basis: 'lb'|'unit'`, `dropOff`, `pickUp`, `variable`, `notes` |
| `wcTypes` | `name`, `kind: 'transfer'|'shipment'|'inventory'|'generic'`, `builtin` |
| `wcStatuses` | `name`, `order` (none are created automatically) |
| `materials` | `name`, `category` (196B column), `ownWc` (must be alone on an inventory WC, e.g. LCD lamps) |
| `shipDescriptions` | `name`, `vendorId` (blank = any vendor), `cew`, `materialId` (residual it counts as) |
| `wcs` | `wcNumber`, `typeId`, `kind`, `date`, `statusId`, `companyId`, `notes`, `log` (the WC-log row it came from, as written; `log.checked` once reviewed), plus one of the objects below |
| `claimPeriods` | `cewType`, `year`, `month`, `status`, `previousPeriodId`, `notes`, `requestedAmount`, `receivedAmount`, `paidDate`, `submittedDate`, `reviewStatus`, `deficiencies`, `closedDate` |
| `transferAllocations` | `wcId`, `claimPeriodId`, `units`, `weight` |
| `cancelledUnits` | `claimPeriodId`, `date`, `time`, `make`, `model`, `weight`, `lotNumber`, `company`, `boxNumber`, `original: {lotNumber, company, boxNumber}` |
| `batteryDisposition`, `panelDisposition` | per-period disposition rows |
| `attachments` | `linkedEntityType: 'wc'`, `linkedEntityId`, `documentType`, `filename`, `blob` |
| `meta` | `key: 'migrations'`, `done: [...]` |
| `meta` (`skippedNumbers`) | `wc: [numbers]`, `irr: [numbers]` — numbers marked skipped on purpose (no missing alert) |
| `meta` (`cbepStored:YYYY-MM`) | `values: {residual: lbs, 'residual|acc': 'YYYY-MM-DD'}` — CBEP stored at month-end (and batteries' accumulation start) |
| `meta` (`cbepDaily:<periodId>`) | `items: [{date, weight, units}]` — CBEP daily cancellation days typed in by hand |
| `meta` (`otherSales`) | `items: [{id, date, buyer, description, amount}]` — sales not tied to a shipment (annual summary) |

WC sub-objects:

- `transfer`: `collectorId` (unused when a handler is set — we are the collector), `handlerId`, `mode: 'pickup'|'dropoff'`,
  `irrNumber` (unique across transfers), `shippingDate` (blank = WC date), `licensePlate`, `irrBy`, `scalePerson` (WC signer),
  `poDate`, `circumstance`, `invoiceBy`, `deductions: [{quantity, description, reason, rate}]` (purchase invoice; PO # = WC #),
  `form197: {saNonCrt, saCbep, docsLogs, docs184, signer, collectorPrinted}` (signer = ours; collectorPrinted only for an outside collector), `selfCollected` (our own collection, no customer),
  `payment: {paid, dueDate, note}`, `packetMonth` ('YYYY-MM'), `lotCancelled`,
  `lines: [{category, description, irrUnits (blank = weight only), irrGross, irrTare, irrWeight (net), cewUnits, nonCewWeight, cewRate, nonCewRate, rate, priceItemId}]`
  (the `*Rate` fields are rates set at inspection; blank = customer rate or price list),
  `timeline: {stepKey: 'YYYY-MM-DD' | 'N/A'}`, `activityNotes`, `transferType: 'cew'|'cbep'|'both'`,
  `logs: {o, a}` — each null or `{source: 'file'|'manual', fileName, method, header: {name, cewid, address, contact, phone, activity, location, form},
  rows: [{date, type (R|B|E|G|H|OC), name, address, contact, crt, noncrt, cbep}], pages: [{page, sum, written}], readAt}`
  (the uploaded file or scans are attachments with `linkedEntityType: 'log198o'|'log198a'`),
  `strikes: null | [{crt, noncrt}]` (one per entry of the basis log — the 198 A when customer adjustments were required,
  else the 198 O; null = picked automatically).
  Categories: `lcdled` (claimable, Non-CRT), `plasma`, `crt` (never claimed; trigger the 197 note), `cbep` (claimable, CBEP), `other` (non-CEW).
- `shipment` (residuals, has a WC): `lines: [{count, description, cew, materialId, gross, tare, net}]`, `countLabel: 'units'|'skids'`, `scalePerson`, `mode`, `licensePlate`,
  `settlement: {type: ''|'paid'|'charged'|'none', amount, reference, date}`
- `crtShipment` (CRTs/plasmas to an approved recycler, `noWc: true`, no WC #): `reference`, `mode`, `licensePlate`, `settlement`,
  `lines: [{wcId (source transfer), category: 'crt'|'plasma', units, weight, rejectedUnits, rejectedNote, ucSent, ucShort}]`
  (`ucSent: [{src, crt, noncrt}]` = the source transfer's 198 UC entries that went out on this line — saved the first
  time its "198 UC — Shipped" is made, so they're never sent again; `ucShort` = units with no logs left)
- `inventory`: `forMonth: 'YYYY-MM'`, `lines: [{materialId, gross, tare, net}]` (several lines per material allowed), `materialOrder`;
  the WC itself has `noWc: true` for a general entry (then `wcNumber` is blank)

`lotNumber` and WC numbers are compared after normalization (`#0715` = `715`).
Legacy stores (`collectors`, `transfers`, `shipmentRecords`, `residualMaterials`,
`residualGenerationLog`, `physicalInventoryCounts`) are kept only so older data
survives; they are migrated into the stores above once, on first load.

## 3.1 additions
- **materials**: `residual196C` — Plastic, Copper, Non-Copper Metals, Circuit Boards, Glass, Fibers, Other, a battery
  chemistry (Lithium-ion / Nickel-Metal Hydride / Sealed Lead-Acid / Nickel-Cadmium / Other Batteries) or "Not a CBEP residual".
- **companies**: `materialFlow` (copied onto CBEP shipments to them).
- **wcs** `kind: 'shipment'`: `shipment.shipmentType` ('cew'|'cbep'|'both'), each line's `program` ('cew'|'cbep', on
  'both'), `shipment.accumulationStart`, `shipment.paperwork: {destination: 'recycling'|'landfill', bol, manifest,
  sigGenerator, sigTransporter, sigFacility, receiptDate, materialFlow, ultimate}`.
- **wcs** `kind: 'generation'` (WC type "CBEP residual generated"): `generation: {forMonth: 'YYYY-MM', residual,
  lines: [{gross, tare, net}], scalePerson}` — one per residual type per month, numbered from the WC sequence.
- **wcs** `kind: 'transfer'`: `transfer.claimParts: {[claimPeriodId]: [{src, units}]}` — a transfer claimed over several
  months: the 198 C entries locked to each period (src = the 198 C line).
- **cancelledUnits**: `device`, `bulk`, `bulkItems: [{device, units}]` (a bulk line counts as its units).

## 3.3 additions
- **wcs** `kind: 'inventory'`: `inventory.program: 'cbep'` marks a CBEP month-end check (counted only for the CBEP claim;
  its lines' materials are totaled by their 196C residual).
- **meta** `cbepGen:YYYY-MM`: `days: {'YYYY-MM-DD': [{materialId, net}]}` — the daily CBEP residual log (generated each day).

## 3.5 additions
- **materials**: `program: 'cew'|'cbep'` — a CEW Non-CRT residual (uses `category`, the 196B column, and `ownWc`) or a CBEP
  residual (uses `residual196C`). Names are stored without the program; it's shown in front ("CBEP Power Boards").

# Data model (IndexedDB schema v6, data migrations through v8)

| Store | Key fields |
|---|---|
| `facilityProfile` | `id: 'profile'`, `recyclerName`, `cewID` (ours — also the collector CEWID on handler transfers), `dualEntity`, `form198ContactName`, `form198ContactPhone` (198 Master), `oldCollectorCewID` (retired in 3.0), `vehicles` (our plates), `wcSigners` (authorized WC signers), `form197Signers` (authorized 197 signers), `phone`, `address` |
| `companies` | `name`, `cewId`, `roles: ['collector'|'handler'|'destination' (vendor)|'recycler' (approved CEW recycler — always also a vendor)]` (handler never with collector or recycler), `cewId` (digits only; blank for handlers), `accountStatus: 'open'|'closed'`, `licensePlates: [string]`, `fromLog`/`logReviewed` (added by the WC-log import), `aliases: [string]`, `owner`, `admin`, `sourceLogSystem`, `primaryLanguage`, `materialMode: 'pickup'|'dropoff'|'both'`, `truckingDeduction: {amount, basis: 'perLb'|'flat'|'percent'}`, `cbepEnrolled`, `phone`, `email`, `address`, `notes`, `rates: {priceItemId: {rate, variable}}` |
| `priceItems` | `name`, `appliesTo` (`cew:lcdled`, `cew:crt`, `cew:plasma`, `cew:cbep`, `noncew:noncrt`, `noncew:crt`, `noncew:cbep` or `other`), `direction: 'pay'|'charge'` (several `cew:cbep` items allowed — CBEP Computer Towers, CBEP Printers; a CBEP line's `priceItemId` says which), `handling` ($/lb * handling deduction), `basis: 'lb'|'unit'`, `dropOff`, `pickUp`, `variable`, `notes` |
| `wcTypes` | `name`, `kind: 'transfer'|'shipment'|'inventory'|'generic'`, `builtin` |
| `wcStatuses` | `name`, `order` (none are created automatically) |
| `materials` | `name`, `category` (196B column), `ownWc` (must be alone on an inventory WC, e.g. LCD lamps) |
| `shipDescriptions` | `name`, `vendorId` (blank = any vendor), `cew`, `materialId` (residual it counts as) |
| `wcs` | `wcNumber`, `typeId`, `kind`, `date`, `statusId`, `companyId`, `notes`, `log` (the WC-log row it came from, as written; `log.checked` once reviewed), plus one of the objects below |
| `claimPeriods` | `cewType`, `year`, `month`, `status`, `previousPeriodId`, `notes`, `requestedAmount`, `receivedAmount`, `paidDate` |
| `transferAllocations` | `wcId`, `claimPeriodId`, `units`, `weight` |
| `cancelledUnits` | `claimPeriodId`, `date`, `time`, `make`, `model`, `weight`, `lotNumber`, `company`, `boxNumber`, `original: {lotNumber, company, boxNumber}` |
| `batteryDisposition`, `panelDisposition` | per-period disposition rows |
| `attachments` | `linkedEntityType: 'wc'`, `linkedEntityId`, `documentType`, `filename`, `blob` |
| `meta` | `key: 'migrations'`, `done: [...]` |
| `meta` (`skippedNumbers`) | `wc: [numbers]`, `irr: [numbers]` — numbers marked skipped on purpose (no missing alert) |
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

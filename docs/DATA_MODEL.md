# Data model (IndexedDB schema v5)

| Store | Key fields |
|---|---|
| `facilityProfile` | `id: 'profile'`, `recyclerName`, `cewID`, `phone`, `address` |
| `companies` | `name`, `cewId`, `roles: ['collector'|'handler'|'destination']`, `aliases: [string]`, `owner`, `admin`, `sourceLogSystem`, `primaryLanguage`, `materialMode: 'pickup'|'dropoff'|'both'`, `truckingDeduction: {amount, basis: 'perLb'|'flat'|'percent'}`, `cbepEnrolled`, `phone`, `email`, `address`, `notes`, `rates: {priceItemId: {rate, variable}}` |
| `priceItems` | `name`, `appliesTo` (`cew:lcdled`, `noncew:lcdled`, … or `other`), `basis: 'lb'|'unit'`, `dropOff`, `pickUp`, `variable`, `notes` |
| `wcTypes` | `name`, `kind: 'transfer'|'shipment'|'inventory'|'generic'`, `builtin` |
| `wcStatuses` | `name`, `order` (none are created automatically) |
| `materials` | `name`, `category` (196B column, or "Not a CEW residual") |
| `wcs` | `wcNumber`, `typeId`, `kind`, `date`, `statusId`, `companyId`, `notes`, plus one of the objects below |
| `claimPeriods` | `cewType`, `year`, `month`, `status`, `previousPeriodId`, `notes` |
| `transferAllocations` | `wcId`, `claimPeriodId`, `units`, `weight` |
| `cancelledUnits` | `claimPeriodId`, `date`, `time`, `make`, `model`, `weight`, `lotNumber`, `company`, `boxNumber`, `original: {lotNumber, company, boxNumber}` |
| `batteryDisposition`, `panelDisposition` | per-period disposition rows |
| `attachments` | `linkedEntityType: 'wc'`, `linkedEntityId`, `documentType`, `filename`, `blob` |
| `meta` | `key: 'migrations'`, `done: [...]` |

WC sub-objects:

- `transfer`: `collectorId` (unused when a handler is set — we are the collector), `handlerId`, `mode: 'pickup'|'dropoff'`,
  `lines: [{category, description, irrUnits, irrWeight, cewUnits, nonCewWeight, cewRate, nonCewRate, rate, priceItemId}]`
  (the `*Rate` fields are rates set at inspection; blank = customer rate or price list),
  `timeline: {stepKey: 'YYYY-MM-DD' | 'N/A'}`, `activityNotes`.
  Categories: `lcdled` (claimable, Non-CRT), `plasma`, `crt` (never claimed; trigger the 197 note), `cbep` (claimable, CBEP), `other` (non-CEW).
- `shipment`: `lines: [{materialId, gross, tare, net}]`
- `inventory`: `forMonth: 'YYYY-MM'`, `lines: [{materialId, gross, tare, net}]`

`lotNumber` and WC numbers are compared after normalization (`#0715` = `715`).
Legacy stores (`collectors`, `transfers`, `shipmentRecords`, `residualMaterials`,
`residualGenerationLog`, `physicalInventoryCounts`) are kept only so older data
survives; they are migrated into the stores above once, on first load.

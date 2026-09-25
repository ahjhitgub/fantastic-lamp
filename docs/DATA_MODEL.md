# Data Model

This app tracks the paperwork chain behind CalRecycle CEW/CBEP monthly
claims. Everything is scoped to a **Claim Period** (one CEW type, one
reporting month) so history stays queryable across periods.

```
Collector ──┐
            ▼
ClaimPeriod ──> Transfer (197) ──attachments──> Attachment
    │
    ├──> Cancellation (daily total, 196B/196C §VI)
    │        └── (future) CancelledUnit — one row per physical unit,
    │            deferred for now, see "Deferred" below
    │
    ├──> BatteryDisposition (196C §IV/VII) — CBEP periods only
    ├──> PanelDisposition   (196B §IV/VIII) — NonCRT periods only
    │
    ├──> ResidualMaterial      (196B/196C §V — monthly totals by material)
    ├──> ResidualGenerationLog (daily scale-ticket entries)
    ├──> PhysicalInventoryCount (manual month-end count)
    └──> ShipmentRecord (196B/196C §VIII — other residual shipments)
```

## Stores

### facilityProfile (singleton)
Your own recycler identity. `id` is always `"profile"`.
| field | type | notes |
|---|---|---|
| recyclerName | string | |
| cewID | string | your Approved Recycler CEWID |

### collectors
Approved Collectors you receive transfers from (CalRecycle 197 §I).
| field | type |
|---|---|
| id | autoincrement |
| name | string |
| cewID | string |

### claimPeriods
The organizing spine of the app. One record per CEW type per month.
| field | type | notes |
|---|---|---|
| id | autoincrement | |
| cewType | 'CRT' \| 'NonCRT' \| 'CBEP' | 196B = NonCRT, 196C = CBEP |
| year | number | |
| month | number | 1-12 |
| periodStart | date string | |
| periodEnd | date string | |
| status | 'draft' \| 'submitted' | |
| previousPeriodId | id \| null | same cewType, prior month — lets "stored" totals carry forward the way the residual spreadsheets already do (Previous Stored → Total Stored) |
| notes | string | |

Index: `[cewType+year+month]` (unique-ish lookup), `cewType`.

### transfers  — CalRecycle 197
| field | type | notes |
|---|---|---|
| id | autoincrement | |
| claimPeriodId | id | |
| dateOfTransfer | date string | |
| collectorId | id | |
| amounts | `{crt:{units,weight}, nonCrt:{units,weight}, cbep:{units,weight}, saUnits}` | §II |
| collectorActivityNotes | string | discrepancy explanation |
| documentsProvided | `{collectionLogs:boolean, proofOfDesignations:boolean}` | §III |
| discrepancyTables | `{table1:[...], table2:[...]}` | §V, optional |
| attachmentIds | id[] | scanned receipts, 198/198SA, 184s |

Index: `claimPeriodId`, `collectorId`, `dateOfTransfer`.

*197S (Transfer Summary) is not stored — it's a rollup of `transfers`
grouped by collector for a period, computed on demand in Reports.*

### cancellations — 196B/196C §VI (daily totals)
| field | type |
|---|---|
| id | autoincrement |
| claimPeriodId | id |
| dateCancelled | date string |
| poundsCancelled | number |
| cancellationMethod | string |

Index: `claimPeriodId`, `dateCancelled`.

### batteryDisposition — 196C §IV/VII (CBEP only)
| field | type | notes |
|---|---|---|
| id | autoincrement | |
| claimPeriodId | id | |
| batteryType | 'Lithium-Ion' \| 'Nickel-Metal Hydride' \| 'Sealed Lead-Acid' \| 'Nickel-Cadmium' \| 'Other' | |
| weightGenerated / weightShipped / weightStored | number | §IV summary |
| detail | array of `{accumulationStartDate, dateShipped, referenceNumber, poundsGenerated, poundsShipped, poundsStored, initialDestination, ultimateDestination, batteryChemistry}` | §VII |

### panelDisposition — 196B §IV/VIII (NonCRT only)
Same shape as batteryDisposition, `screenType`: 'Bare Plasma Panels' | 'LCD Lamps'.

### residualMaterials — 196B/196C §V (monthly totals by material)
| field | type | notes |
|---|---|---|
| id | autoincrement | |
| claimPeriodId | id | |
| materialCategory | string | Plastic, Copper, Non-Copper Metals, Circuit Boards, All Battery Chemistries / LCD Bare Panels, Glass, Fibers, Other |
| weightShipped | number | |
| weightStored | number | |

### residualGenerationLog — daily scale tickets (your existing spreadsheet)
| field | type |
|---|---|
| id | autoincrement |
| claimPeriodId | id |
| date | date string |
| materialType | string |
| grossWeight / tareWeight / netWeight | number |

### physicalInventoryCounts — manual month-end count sheet
| field | type |
|---|---|
| id | autoincrement |
| claimPeriodId | id |
| monthLabel | string |
| doneBy | string |
| lines | array of `{category, grossWeight, tareWeight, netWeight}` |

### shipmentRecords — 196B/196C §VIII (other residual shipments)
| field | type |
|---|---|
| id | autoincrement |
| claimPeriodId | id |
| dateShipped | date string |
| referenceNumber | string |
| poundsShipped / poundsClaimed | number |
| initialDestination | string |
| materialType | string |
| description | string |

### attachments
| field | type |
|---|---|
| id | autoincrement |
| linkedEntityType | string (e.g. 'transfer') |
| linkedEntityId | id |
| filename | string |
| mimeType | string |
| blob | Blob |
| uploadedDate | date string |
| description | string |

## Deferred (explicitly not built yet)

**CancelledUnit** — a per-unit log of individual CEW units
cancelled/dismantled, for CBEP. Note: 196B §VII already does this for
NonCRT (date, pounds, manufacturer, model #) — CBEP's 196C form has no
equivalent per-unit section today, but the data model reserves a
`cewType` field on cancellation-detail records generically so this can
be added later as `cancelledUnits` (claimPeriodId, cewType, date,
pounds, manufacturer, model#, serial#) without reshaping anything
already built.

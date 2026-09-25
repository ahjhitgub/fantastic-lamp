# Data Model

This app tracks the paperwork chain behind CalRecycle CEW/CBEP monthly
claims. Everything is scoped to a **Claim Period** (one CEW type, one
reporting month) so history stays queryable across periods.

Refined against two real claim packets (Dec 2024 and Jan 2025 — see
"What the real claim taught us" at the bottom) and against how transfers
actually get cancelled: not necessarily in the month they arrive, and not
always all at once.

```
Collector ──> Transfer (197, + handler/WC ref#) ──attachments──> Attachment (typed: our WC / customer WC / 198 log / 184 / other)
                  │
                  ▼
         TransferAllocation ──> ClaimPeriod
         (how much of this transfer counts toward this period —
          a transfer with none yet is "not cancelled"; rows summing
          to less than its total = "partially cancelled"; rows
          summing to the full amount, in one period or split across
          two, = "fully cancelled")

ClaimPeriod
    │   (activity start = earliest transfer date among its allocations;
    │    activity end = always the last day of its own month — both
    │    computed, never typed in)
    │
    ├──> CancelledUnit (per-unit, 196B/196C §VI+VII) ──optional origin──> Transfer
    │        Daily totals are a computed view over these, not separate records.
    │
    ├──> BatteryDisposition (196C §IV/VII) — CBEP periods only
    ├──> PanelDisposition   (196B §IV/VIII) — NonCRT periods only
    │
    ├──> ResidualMaterial      (196B/196C §V — monthly totals by material)
    ├──> ResidualGenerationLog (daily scale-ticket entries)
    ├──> PhysicalInventoryCount (manual month-end count)
    └──> ShipmentRecord (196B/196C §VIII — other residual shipments) ──attachments──> Attachment
```

## Stores

### facilityProfile (singleton)
Your own recycler identity. `id` is always `"profile"`.
| field | type | notes |
|---|---|---|
| recyclerName | string | |
| cewID | string | your Approved Recycler CEWID |

### collectors
Approved Collectors you receive transfers from (CalRecycle 197 §I) —
a CEWID-holding entity (e.g. "Bellflower Recycling Center" 127632 or
"Allied Erecycling" 127733). A single collector can bring in many
transfers through different named handlers — see `transfers.handlerName`.
| field | type |
|---|---|
| id | autoincrement |
| name | string |
| cewID | string |

### claimPeriods
The organizing spine of the app. One record per CEW type per month.
`periodStart`/`periodEnd` are **not stored** — `App.Periods` computes
them on demand: start = earliest `dateOfTransfer` among transfers
allocated to this period (via `transferAllocations`), or unset until
the first allocation exists; end = always the last calendar day of
`year`/`month`. This matches your real 196B forms exactly (Dec 2024's
activity period ran 11/27/24–12/31/24 — the start floats because it's
whichever transfer was oldest, not the 1st of the month).
| field | type | notes |
|---|---|---|
| id | autoincrement | |
| cewType | 'CRT' \| 'NonCRT' \| 'CBEP' | 196B = NonCRT, 196C = CBEP |
| year | number | |
| month | number | 1-12 |
| status | 'draft' \| 'submitted' | |
| previousPeriodId | id \| null | same cewType, prior month — lets "stored" totals carry forward the way the residual spreadsheets already do (Previous Stored → Total Stored) |
| notes | string | |

Index: `[cewType+year+month]` (unique-ish lookup), `cewType`.

### transfers — CalRecycle 197 (+ your own handler/reference tracking)
A transfer is **not scoped to a claim period**. It's received once, on
one date, and stays on file permanently; how much of it counts toward
which period(s) lives separately in `transferAllocations`, because a
transfer isn't always cancelled whole, or in the month it arrived.
| field | type | notes |
|---|---|---|
| id | autoincrement | |
| dateOfTransfer | date string | |
| collectorId | id | the CEWID-holding collector of record |
| handlerName | string, optional | sub-handler/agent who actually brought the batch in (e.g. "Cash 4 Cans Riverside") — your Transfer Summary tracks this separately from the collector |
| referenceNumber | string, optional | your internal WC/invoice reference for this batch (e.g. "634") — what your Transfer Summary's "WC Ref" column is |
| amounts | `{crt:{units,weight}, nonCrt:{units,weight}, cbep:{units,weight}, saUnits}` | §II — the transfer's full, as-received amount |
| collectorActivityNotes | string | discrepancy explanation |
| attachmentIds | id[] | see `attachments` — typed as WC/198/184/other |

Index: `collectorId`, `dateOfTransfer`.

*197S (Transfer Summary) is not stored — it's a rollup of `transfers`
grouped by collector for a period, computed on demand (shown live on
the Transfers page, and later in Reports).*

### transferAllocations — links a transfer to the period(s) it was cancelled in
One row per (transfer, claim period) pairing — most transfers get
exactly one row once fully cancelled, but a transfer can have two,
one per period, when it's cancelled in installments (e.g. 150 of 200
units before month-end, the remaining 50 the following month — this
appears on the real CalRecycle 197 too, as its "Recycler Table 1 /
Table 2" discrepancy tables in §V). A transfer with zero rows here is
"not yet cancelled" and is excluded from every claim period; this is
never a separate stored status, always derived from comparing the sum
of its rows to its total (see `App.Periods.computeTransferStatus`).
| field | type | notes |
|---|---|---|
| id | autoincrement | |
| transferId | id | |
| claimPeriodId | id | |
| units | number | portion of the transfer's matching CEW-type bucket claimed in this period |
| weight | number | portion of the transfer's matching CEW-type bucket claimed in this period |
| notes | string, optional | |

Index: `transferId`, `claimPeriodId`.

### cancelledUnits — 196B/196C §VI+VII (per-unit detail; daily totals are computed)
Your actual December log was per-unit (date, manufacturer, model,
pounds, type, method) — 2,696 rows for the month, no origin recorded.
This store keeps that same shape and adds an optional link back to
the transfer it came in on, so origin can be tracked going forward
without forcing it on historical data.
| field | type | notes |
|---|---|---|
| id | autoincrement | |
| claimPeriodId | id | |
| dateCancelled | date string | |
| manufacturer | string | |
| model | string | |
| pounds | number | |
| deviceType | string | e.g. "LED" — the screen/device type, free text |
| cancellationMethod | string | free text, suggested from `CANCELLATION_METHODS_BY_TYPE` |
| originTransferId | id \| null | which `transfers` record this unit's material came from, if known |

Index: `claimPeriodId`, `dateCancelled`, `originTransferId`.
Daily totals (§VI) = `SUM(pounds) GROUP BY dateCancelled` over this store — not stored separately.

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
Your December LCD Lamp numbers (344 generated / 126 shipped / 218 stored)
are a real example of this table.

### residualMaterials — your monthly Residual Summary (feeds 196B/196C §V)
Your real summary sheet (validated against both Dec 2024 and Jan 2025)
tracks *granular* materials — Steel, ABS Plastic, Power Boards, Circuit
Boards, LCD Panels, LCD Lamps, LCD Lamps Crushed, LCD Strips, Copper
Metals (Wires), Residual Waste — not the 196B's six official columns
(Plastic, Copper, Non-Copper Metals, LCD Bare Panels, Circuit Boards,
Other). `materialCategory` is free text (suggested from
`RESIDUAL_MATERIAL_HINTS`) at the granular level you actually use;
mapping granular materials to the 196B's official columns is an open
question for Reports, not solved here.
| field | type | notes |
|---|---|---|
| id | autoincrement | |
| claimPeriodId | id | |
| materialCategory | string | granular material name, e.g. "Steel", "ABS Plastic" |
| generatedWeight | number | your Residual Summary's "Generated Lbs." |
| weightShipped | number | your Residual Summary's "Shipped Lbs." |
| weightStored | number | your Residual Summary's "Total Stored Lbs." (in both real months this equalled "Monthly Stored" — no multi-month backlog observed yet, so `previousPeriodId` carry-forward is not auto-computed, just available) |

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
One row per outbound Weight Certificate (e.g. your Atlas Iron & Metal,
CR&R, Alpert & Alpert, Cal Micro, IQA Metals, Federal Metals, CleanEarth
shipments) — attach the WC itself via `attachments`. This is the
detail behind each "Dates Shipped" entry on your Residual Summary; it
does not auto-total into `residualMaterials` (that's entered directly
from your summary sheet) — the two are shown together on the Residuals
page but kept independent so partial data entry never produces a wrong
computed total.
| field | type |
|---|---|
| id | autoincrement |
| claimPeriodId | id |
| dateShipped | date string |
| referenceNumber | string | your WC invoice # |
| poundsShipped / poundsClaimed | number |
| initialDestination | string | suggested from `SHIPMENT_DESTINATION_HINTS` |
| materialType | string | granular material name, matches `residualMaterials.materialCategory` |
| description | string |
| attachmentIds | id[] |

### attachments
Supporting documents for a transfer or a shipment — your own WC, the
counterparty's copy, the CIWMB 198 Collection Log, a 184, etc. Not
generated by the app; you upload what you already have.
| field | type |
|---|---|
| id | autoincrement |
| linkedEntityType | string ('transfer' \| 'shipmentRecord') |
| linkedEntityId | id |
| documentType | string | one of `ATTACHMENT_DOCUMENT_TYPES` — Our Weight Certificate, Customer Weight Certificate, 198 Collection Log, Proof of Designation (184), Other |
| filename | string |
| mimeType | string |
| blob | Blob |
| uploadedDate | date string |
| description | string |

Index: `linkedEntityType`, `linkedEntityId`.

## What the real claim taught us

Your December 2024 packet (Bellflower Recycling Center, CEWID 127632)
is a working example of the whole reconciliation chain, and everything
in it actually ties out:

- **2,696 units** in the per-unit Cancellation Log = **2,696 units /
  79,858 lbs** in the Transfer Summary's Non-CRT totals = **79,858 lbs**
  cancelled on the filed 196B. This is the check the app should make
  visible: Transfers total vs. Cancellations total for a period.
- The Transfer Summary's "Handler/WC Ref" column (e.g. "Cash 4 Cans
  Riverside / 634") is one transfer batch under one collector
  (Bellflower itself, CEWID 127632, or a separate collector like
  Allied Erecycling, CEWID 127733) — hence `handlerName` +
  `referenceNumber` on `transfers`, distinct from `collectorId`.
- The CIWMB 198 Collection Log (391 pages for the month) is where a
  unit's actual origin lives — individual donor name/address/date per
  handler batch. The recycler-side cancellation log never carries
  that forward, which is exactly what prompted `originTransferId`:
  the practical unit of "origin" is the transfer batch, not the
  individual donor, and it's optional because historical rows won't
  have it.
- The Residual Summary's per-material Generated/Shipped/Stored numbers
  match the 196B §V table exactly, and each material's "Shipped" total
  is the sum of individual outbound Weight Certificates — hence
  `shipmentRecords` carrying its own attachments.

A second month (January 2025) confirmed the shape rather than changing
it: 2,815 units / 83,419 lbs transferred = 83,419 lbs cancelled on the
196B, same granular material list on the Residual Summary, same 197
form fields. Two new things it surfaced:
- The official CalRecycle 197 has no "handler name" field at all — your
  own practice embeds it in the Collector Activity notes (e.g. "Got
  EWaste (Handler)"); keeping `handlerName` as its own field on
  `transfers` is a deliberate improvement over the raw form, matching
  how your own Transfer Summary already treats it as data.
- A "Dual Entity" transfer showed up (Bellflower Recycling Center
  transferring to itself under two CEWIDs — 127362 as collector,
  127632 as recycler). No schema change needed: it's just another
  `collectors` entry.

## Why transfers aren't scoped to a period anymore (v3)

The original design gave every transfer a single fixed `claimPeriodId`,
set the moment it was created. That breaks in practice: some transfers
aren't cancelled at all yet (for various reasons), some are cancelled
in full the same month, and some straddle two claim periods — received
late in one month, partially dismantled before month-end, the rest
finished the next month. A fixed one-to-one link can't represent any
split, and it forced a claim period to exist (and its start/end dates
to be guessed) before a single transfer had actually been processed.

`transferAllocations` fixes this by making the link many-to-many and
always additive: a transfer accumulates rows as portions of it get
cancelled, in whichever period that actually happens. Nothing is typed
in twice — a claim period's activity dates and "lbs claimed this
period" figures are always computed from these rows, so they can never
drift out of sync with what's actually been allocated.

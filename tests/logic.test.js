// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

test('parses the new cancellation log format, with header', () => {
  const text = [
    'Date\tTime\tMake\tModel\tWeight (lb)\tLot #\tCompany\tBox #',
    '08/01/2026\t9:52 AM\tSamsung\tS20A300B\t3\t2179\tOscar recycling\t4',
    '08/01/2026\t11:11 AM\tacer\tV176L\t5\t2166\tscrap angeles\t1',
    'bad date\t\tx\ty\t1\t1\tz\t1',
  ].join('\n');
  const { rows, skipped, usedHeader } = L.parseCancellationLog(text);
  assert.equal(usedHeader, true);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    date: '2026-08-01', time: '9:52 AM', device: '', make: 'Samsung', model: 'S20A300B', weight: 3,
    lotNumber: '2179', company: 'Oscar recycling', boxNumber: '4',
    original: { lotNumber: '2179', company: 'Oscar recycling', boxNumber: '4' },
  });
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].line, 4);
});

test('parses without a header using the default column order', () => {
  const { rows } = L.parseCancellationLog('08/01/2026\t12:21 PM\tacer\tUM.BV6AA 003\t5\t2181\tgarcia\t1');
  assert.equal(rows[0].lotNumber, '2181');
  assert.equal(rows[0].company, 'garcia');
  assert.equal(rows[0].weight, 5);
});

test('lot numbers and company names normalize', () => {
  assert.equal(L.normLot('#0715'), '715');
  assert.equal(L.normLot('715.0'), '715');
  const companies = [{ id: 1, name: 'Garcia Recycling', aliases: ['garcia', 'garica recycling'] }, { id: 2, name: 'CR&R Inc', aliases: [] }];
  const idx = L.companyIndex(companies);
  assert.equal(L.resolveCompany('GARCIA RECYCLING', idx).match, 'exact');
  assert.equal(L.resolveCompany('garica recycling', idx).match, 'alias');
  assert.equal(L.resolveCompany('cr and r inc', idx).match, 'exact');
  assert.equal(L.resolveCompany('Mundo', idx).match, 'none');
  assert.equal(L.resolveCompany('  ', idx).match, 'blank');
});

test('IRR → WC math: 100 received, 90 source logs, non-CEW weight typed in', () => {
  const m = L.transferMath({ lines: [
    { category: 'lcdled', irrUnits: 100, irrWeight: 1000, cewUnits: 90, nonCewWeight: 85 },
    { category: 'plasma', irrUnits: 4, irrWeight: 200, cewUnits: 4, nonCewWeight: 0 },
    { category: 'other', irrUnits: 3, irrWeight: 60 },
  ] });
  assert.deepEqual(m.claimable.NonCRT, { units: 90, weight: 915 });
  assert.equal(m.lines[0].nonCewUnits, 10);
  assert.equal(m.hasCrtOrPlasma, true);
  // the 197 lists only the CEW LCD/LED we keep; plasma/CRT are left off (and noted)
  assert.deepEqual(m.form197.nonCrt, { units: 90, weight: 915 });
  assert.deepEqual(m.form197.crt, { units: 0, weight: 0 });
  assert.deepEqual(m.problems, []);
  const bad = L.transferMath({ lines: [{ category: 'lcdled', irrUnits: 10, irrWeight: 100, cewUnits: 8, nonCewWeight: 0 }] });
  assert.match(bad.problems[0], /2 non-CEW units but no non-CEW weight/);
});

test('allocation rules prevent double dipping', () => {
  const wc = { id: 1, date: '2026-01-01', transfer: { lines: [{ category: 'lcdled', irrUnits: 200, irrWeight: 10000, cewUnits: 200, nonCewWeight: 0 }] } };
  const math = L.transferMath(wc.transfer);
  const periods = [
    { id: 10, cewType: 'NonCRT', year: 2025, month: 12 },
    { id: 11, cewType: 'NonCRT', year: 2026, month: 1 },
    { id: 12, cewType: 'NonCRT', year: 2026, month: 2 },
    { id: 13, cewType: 'NonCRT', year: 2026, month: 3 },
    { id: 20, cewType: 'CRT', year: 2026, month: 1 },
  ];
  const p = (id) => periods.find((x) => x.id === id);
  const v = (period, units, weight, allocations = [], editingId) =>
    L.validateAllocation({ wc, math, period, units, weight, allocations, periods, editingId });

  assert.deepEqual(v(p(11), 150, 8000), []);                                   // user's example, part 1
  const jan = [{ id: 1, wcId: 1, claimPeriodId: 11, units: 150, weight: 8000 }];
  assert.deepEqual(v(p(12), 50, 2000, jan), []);                               // part 2, next month
  assert.match(v(p(12), 51, 2000, jan)[0], /only 200 are claimable/);           // over by one unit
  assert.match(v(p(13), 50, 2000, jan)[0], /back-to-back months/);             // skips a month
  assert.match(v(p(10), 50, 2000)[0], /wasn't received until January 2026/);   // before receipt
  assert.match(v(p(11), 10, 100, jan)[0], /already allocated to that period/);
  const both = jan.concat([{ id: 2, wcId: 1, claimPeriodId: 12, units: 25, weight: 1000 }]);
  assert.ok(v(p(13), 1, 1, both).some((e) => /at most two/.test(e)));
  assert.match(v(p(20), 1, 1)[0], /Only Non-CRT and CBEP/);
  // "was whole, turned out partial": shrink the January allocation while editing it
  const whole = [{ id: 1, wcId: 1, claimPeriodId: 11, units: 200, weight: 10000 }];
  assert.deepEqual(v(p(11), 150, 8000, whole, 1), []);
  assert.equal(L.allocationStatus(math.claimable.NonCRT, whole), 'Fully allocated');
  assert.equal(L.allocationStatus(math.claimable.NonCRT, jan), 'Partially allocated');
});

test('audit flags weight, units, lot, misspellings and wrong company — not time/make/model/box', () => {
  const companies = [
    { id: 1, name: 'Oscar Recycling', aliases: ['oscar recyling'] },
    { id: 2, name: 'Scrap Angeles', aliases: [] },
  ];
  const period = { id: 11, cewType: 'NonCRT', year: 2026, month: 8 };
  const wcs = [{ id: 5, kind: 'transfer', wcNumber: '2179', date: '2026-08-01',
    transfer: { handlerId: 1, lines: [{ category: 'lcdled', irrUnits: 4, irrWeight: 20, cewUnits: 4, nonCewWeight: 0 }] } }];
  const allocations = [{ id: 1, wcId: 5, claimPeriodId: 11, units: 4, weight: 20 }];
  const u = (lot, company, weight, extra = {}) => ({ claimPeriodId: 11, date: '2026-08-01', lotNumber: lot, company, weight,
    time: 'whatever', make: 'x', model: 'y', boxNumber: '9', ...extra });
  const units = [
    u('2179', 'Oscar recycling', 5),
    u('2179', 'oscar recyling', 5),                       // misspelling
    u('2179', 'Scrap Angeles', 5),                        // wrong company for this lot
    u('2197', 'Oscar Recycling', 5),                      // lot typo → no such WC
  ];
  const r = L.reconcile({ period, units, allUnits: units, wcs, allocations, periods: [period], companies });
  const text = r.issues.map((i) => i.message).join('\n');
  assert.match(text, /Lot #2179: short 1 unit — cancellation log 3 − allocated from WC #2179 4 = −1\./);
  assert.match(text, /Lot #2179: short 5 lbs — cancellation log 15 lbs − allocated from WC #2179 20 lbs = −5 lbs\./);
  const row = r.lots.find((x) => x.lot === '2179');
  assert.equal(row.diffUnits, -1); assert.equal(row.diffWeight, -5);
  assert.deepEqual(row.math.claim, { units: 4, weight: 20 });
  assert.match(text, /"oscar recyling" \(1 unit\) is a misspelling of Oscar Recycling/);
  assert.match(text, /log says Scrap Angeles \(1 unit\), but WC #2179 is from Oscar Recycling/);
  assert.match(text, /no WC #2197 on file/);
  assert.doesNotMatch(text, /time|make|model|box/i);
  assert.equal(r.totals.units, 4);
});

test('residual formula reproduces the real January 2025 196B from Dec + Jan data', () => {
  const mats = [
    ['Steel', 'Non-Copper Metals'], ['ABS Plastic', 'Plastic'], ['Copper Metals (Wires)', 'Copper'],
    ['LCD Panels', 'LCD Bare Panels'], ['Circuit Boards', 'Circuit Boards'], ['Power Boards', 'Circuit Boards'],
    ['LCD Strips', 'Circuit Boards'], ['Residual Waste', 'Other'], ['LCD Lamps', 'LCD Lamps (§IV)'], ['LCD Lamps Crushed', 'LCD Lamps (§IV)'],
  ].map(([name, category], i) => ({ id: i + 1, name, category }));
  const id = (name) => mats.find((m) => m.name === name).id;
  const lines = (obj) => Object.entries(obj).map(([n, net]) => ({ materialId: id(n), net }));
  // "Total stored" column of the Dec 2024 and Jan 2025 Residual Summaries, and Jan shipments
  const decEnd = { Steel: 7548, 'LCD Lamps': 218, 'LCD Lamps Crushed': 47, 'LCD Panels': 3097, 'Copper Metals (Wires)': 21,
    'Circuit Boards': 187, 'ABS Plastic': 4110, 'Power Boards': 815, 'LCD Strips': 238, 'Residual Waste': 3067 };
  const janEnd = { Steel: 3517, 'LCD Lamps': 209, 'LCD Panels': 2480, 'Copper Metals (Wires)': 224, 'ABS Plastic': 2370,
    'Circuit Boards': 204, 'Power Boards': 437, 'Residual Waste': 5279, 'LCD Strips': 96 };
  const janShipped = { Steel: 43592, 'LCD Lamps': 355, 'LCD Panels': 12539, 'Copper Metals (Wires)': 251, 'ABS Plastic': 22927,
    'Circuit Boards': 1386, 'Power Boards': 3342, 'Residual Waste': 27061, 'LCD Strips': 226 };
  const wcs = [
    { kind: 'inventory', date: '2024-12-31', inventory: { forMonth: '2024-12', lines: lines(decEnd) } },
    { kind: 'inventory', date: '2025-01-31', inventory: { forMonth: '2025-01', lines: lines(janEnd) } },
    { kind: 'shipment', date: '2025-01-15', shipment: { lines: lines(janShipped) } },
  ];
  const s = L.residualSummary({ year: 2025, month: 1, materials: mats, wcs });
  const c = s.categories;
  // Every number below is printed on the filed January 2025 196B.
  assert.deepEqual(c.Plastic, { generated: 21187, stored: 2370, shipped: 18817 });
  assert.deepEqual(c.Copper, { generated: 454, stored: 224, shipped: 230 });
  assert.deepEqual(c['Non-Copper Metals'], { generated: 39561, stored: 3517, shipped: 36044 });
  assert.deepEqual(c['LCD Bare Panels'], { generated: 11922, stored: 2480, shipped: 9442 });
  assert.deepEqual(c['Circuit Boards'], { generated: 4451, stored: 725, shipped: 3726 });
  assert.deepEqual(c.Other, { generated: 29273, stored: 5279, shipped: 23994 });
  assert.deepEqual(c['LCD Lamps (§IV)'], { generated: 299, stored: 209, shipped: 90 });
  const total = L.FORM_V_CATEGORIES.reduce((a, k) => a + c[k].generated, 0);
  assert.equal(total, 106848);
  // crushed lamps: 47 lbs stored in Dec, nothing shipped or stored under that name in Jan
  assert.ok(s.warnings.some((w) => /LCD Lamps Crushed: generated comes out to -47/.test(w)));
});

test('rates: inspection rate → customer rate → price list by pick-up/drop-off; variable needs a rate', () => {
  const priceItems = [
    { id: 1, appliesTo: 'cew:lcdled', basis: 'lb', dropOff: '0.30', pickUp: '0.20' },
    { id: 2, appliesTo: 'noncew:noncrt', basis: 'lb', dropOff: '0.10', pickUp: '0.10', direction: 'charge' },
    { id: 3, appliesTo: 'cew:plasma', basis: 'unit', dropOff: '', pickUp: '', variable: true },
    { id: 4, appliesTo: 'other', name: 'Printers', basis: 'lb', dropOff: '0.05', pickUp: '0.03' },
  ];
  const transfer = { lines: [
    { category: 'lcdled', irrUnits: 100, irrWeight: 1000, cewUnits: 90, nonCewWeight: 85 },
    { category: 'plasma', irrUnits: 2, irrWeight: 80, cewUnits: 2, nonCewWeight: 0 },
    { category: 'other', description: 'Printers', irrUnits: 3, irrWeight: 60, priceItemId: 4 },
  ] };
  const company = { rates: { 1: { rate: '0.35' } }, truckingDeduction: { amount: '0.02', basis: 'perLb' } };
  const drop = L.invoiceMath({ transfer, mode: 'dropoff', priceItems, company });
  assert.deepEqual(drop.rows.map((r) => r.label), ['CEW LCD/LED', 'Non-CEW Non-CRT', 'CEW PLASMA', 'Printers']);
  assert.equal(drop.rows[1].charge, true);
  assert.equal(drop.rows[1].amount, -8.5);               // we charge for non-CEW: 85 lbs × $0.10
  assert.equal(drop.chargeTotal, 8.5);
  assert.equal(drop.rows[0].source, 'Customer rate');
  assert.equal(drop.rows[0].amount, 320.25);             // 915 lbs × $0.35
  assert.equal(drop.rows[2].needsRate, true);             // plasma is variable
  assert.equal(drop.rows[3].amount, 3);                   // 60 lbs × $0.05 drop-off
  assert.equal(drop.trucking, null);                      // no trucking on drop-off
  assert.equal(drop.missing, 1);
  // set the plasma rate at inspection ($5/unit) and switch to pick-up
  transfer.lines[1].cewRate = '5';
  const pick = L.invoiceMath({ transfer, mode: 'pickup', priceItems, company });
  assert.equal(pick.rows[2].amount, 10);                  // 2 units × $5
  assert.equal(pick.rows[3].amount, 1.8);                 // 60 × $0.03 pick-up
  assert.equal(pick.missing, 0);
  assert.equal(pick.trucking.amount, -22.8);              // 1,140 lbs × $0.02
  assert.equal(pick.total, L.r2(pick.subtotal - 22.8));
});

test('customer sheet paste with the exact header row', () => {
  const text = [
    'Company\tLCD/LED\tCRT\tPLASMA\towner\tCEWID #\tADMIN\tSource Log System\tPrimary Language\tPick up or drop off material\tTrucking Deduction\tCBEP Enrolled?\tCBEP Price/Lb',
    'Garcia Recycling\t$0.30\t$0.10\tmarket\tJose Garcia\t\tMaria\tPaper\tSpanish\tPick up\t$0.02/lb\tYes\t$0.50',
    'Allied Erecycling\t0.28\t\t\tBob\t127733\t\tSoftware\tEnglish\tDrop off\t\tNo\t',
  ].join('\n');
  const { rows, usedHeader } = L.parseCustomerSheet(text);
  assert.equal(usedHeader, true);
  assert.equal(rows.length, 2);
  const g = rows[0];
  assert.equal(g.owner, 'Jose Garcia'); assert.equal(g.admin, 'Maria'); assert.equal(g.primaryLanguage, 'Spanish');
  assert.equal(g.materialMode, 'pickup'); assert.equal(g.cbepEnrolled, true);
  assert.deepEqual(g.rates.lcdled, { rate: '0.3', variable: false });
  assert.deepEqual(g.rates.plasma, { rate: '', variable: true, note: 'market' });
  assert.deepEqual(g.rates.cbep, { rate: '0.5', variable: false });
  assert.deepEqual(g.truckingDeduction, { amount: '0.02', basis: 'perLb', raw: '$0.02/lb' });
  assert.equal(rows[1].cewId, '127733'); assert.equal(rows[1].materialMode, 'dropoff'); assert.equal(rows[1].rates.crt, null);
  assert.equal(L.parseCustomerSheet('Company\tCEWID #\tAccount\nAcme\t\tClosed').rows[0].accountStatus, 'closed');
});

test('audit math: split transfer logged twice is over across periods', () => {
  const periods = [{ id: 1, cewType: 'NonCRT', year: 2026, month: 8 }, { id: 2, cewType: 'NonCRT', year: 2026, month: 9 }];
  const wcs = [{ id: 5, kind: 'transfer', wcNumber: '2179', date: '2026-08-01',
    transfer: { lines: [{ category: 'lcdled', irrUnits: 6, irrWeight: 32, cewUnits: 5, nonCewWeight: 5 }] } }];
  const allocations = [{ id: 1, wcId: 5, claimPeriodId: 1, units: 4, weight: 22 }, { id: 2, wcId: 5, claimPeriodId: 2, units: 1, weight: 5 }];
  const u = (pid, weight) => ({ claimPeriodId: pid, date: pid === 1 ? '2026-08-03' : '2026-09-03', lotNumber: '2179', weight, company: '' });
  const aug = [u(1, 5), u(1, 5), u(1, 6), u(1, 6), u(1, 5)];      // 5 units / 27 lbs logged in August
  const sep = [u(2, 5)];                                          // and the remainder again in September
  const r = L.reconcile({ period: periods[0], units: aug, allUnits: aug.concat(sep), wcs, allocations, periods, companies: [] });
  const text = r.issues.map((i) => i.message).join('\n');
  assert.match(text, /over by 1 unit — cancellation log 5 − allocated from WC #2179 4 = \+1\./);
  assert.match(text, /over by 5 lbs — cancellation log 27 lbs − allocated from WC #2179 22 lbs = \+5 lbs\./);
  assert.match(text, /over by 1 unit across all claim periods — logged 5 \(August 2026\) \+ 1 \(September 2026\) = 6, but WC #2179 has only 5 claimable\./);
  const m = r.lots[0].math;
  assert.deepEqual([m.irr, m.nonCew, m.claim], [{ units: 6, weight: 32 }, { units: 1, weight: 5 }, { units: 5, weight: 27 }]);
  assert.deepEqual(m.allocs.map((x) => [x.label, x.units, x.weight, x.here]), [['August 2026', 4, 22, true], ['September 2026', 1, 5, false]]);
});

test('next WC # is one past the highest on file', () => {
  assert.equal(L.nextWcNumber([]), '');
  assert.equal(L.nextWcNumber([{ id: 1, wcNumber: '2179' }, { id: 2, wcNumber: '715' }, { id: 3, wcNumber: 'INV-08' }]), '2180');
  assert.equal(L.nextWcNumber([{ id: 1, wcNumber: '2179' }, { id: 2, wcNumber: '2180' }]), '2181');
  assert.equal(L.nextWcNumber([{ id: 1, wcNumber: 'WC-0099' }]), 'WC-0100');
});

test('IRR # is its own sequence on transfers', () => {
  const wcs = [
    { id: 1, kind: 'transfer', wcNumber: '2179', transfer: { irrNumber: '1045' } },
    { id: 2, kind: 'transfer', wcNumber: '2180', transfer: { irrNumber: '' } },
    { id: 3, kind: 'shipment', wcNumber: '2181' },
  ];
  assert.equal(L.nextIrrNumber(wcs), '1046');
  assert.equal(L.nextWcNumber(wcs), '2182');
  assert.equal(L.nextIrrNumber([{ id: 1, kind: 'transfer', wcNumber: '1', transfer: {} }]), '');
  assert.equal(L.shortDate('2026-07-01'), '7.1.26');
});

test('residuals count only CEW shipment lines; inventory rules for LCD lamps', () => {
  const mats = [{ id: 1, name: 'Steel', category: 'Non-Copper Metals' }, { id: 2, name: 'LCD Lamps', category: 'LCD Lamps (§IV)', ownWc: true }];
  const wcs = [
    { kind: 'shipment', date: '2026-08-10', shipment: { lines: [{ materialId: 1, net: 1000, cew: true }, { materialId: 1, net: 300, cew: false }, { materialId: 1, net: 50 }] } },
    { kind: 'inventory', noWc: true, date: '2026-08-31', inventory: { forMonth: '2026-08', lines: [{ materialId: 1, net: 200 }, { materialId: 1, gross: 150, tare: 20, net: '' }] } },
  ];
  const s = L.residualSummary({ year: 2026, month: 8, materials: mats, wcs });
  const steel = s.rows.find((r) => r.material.id === 1);
  assert.equal(steel.shipped, 1050);            // the 300 lbs marked non-CEW is left out
  assert.equal(s.nonCewShipped, 300);
  assert.equal(steel.endStored, 330);           // 200 + (150 − 20)
  assert.deepEqual(L.netByMaterial(wcs[1].inventory.lines).get(1), { count: 2, net: 330 });

  const inv = (noWc, lines) => ({ noWc, inventory: { lines } });
  assert.deepEqual(L.inventoryRuleErrors({ wc: inv(true, [{ materialId: 1, net: 5 }]), materials: mats }), []);
  assert.match(L.inventoryRuleErrors({ wc: inv(true, [{ materialId: 2, net: 5 }]), materials: mats })[0], /LCD Lamps need their own weight certificate/);
  assert.match(L.inventoryRuleErrors({ wc: inv(false, [{ materialId: 2, net: 5 }, { materialId: 1, net: 9 }]), materials: mats })[0], /LCD Lamps have to be alone on their WC — move Steel/);
  assert.deepEqual(L.inventoryRuleErrors({ wc: inv(false, [{ materialId: 2, net: 5 }]), materials: mats }), []);
});

test('CRT/plasma shipped to other recyclers is tracked back to the transfer', () => {
  const t = (id, wcNumber, lines) => ({ id, kind: 'transfer', wcNumber, transfer: { lines } });
  const wcs = [
    t(1, '2179', [{ category: 'crt', irrUnits: 1, irrWeight: 67, cewUnits: 1 }, { category: 'plasma', irrUnits: 2, irrGross: 199, irrTare: 35, irrWeight: 164, cewUnits: 2 }]),
    t(2, '2180', [{ category: 'plasma', irrUnits: 3, irrWeight: 150, cewUnits: 3 }]),
    { id: 9, kind: 'shipment', wcNumber: '2200', date: '2026-09-02', shipment: { lines: [], crtPlasma: [{ wcId: 1, category: 'plasma', units: 2, weight: 160 }, { wcId: 2, category: 'plasma', units: 1, weight: 50 }] } },
  ];
  const { rows } = L.crtPlasmaLedger(wcs);
  const get = (k) => rows.find((r) => r.key === k);
  assert.deepEqual(get('1:plasma').onHand, { units: 0, weight: 4 });
  assert.deepEqual(get('1:crt').onHand, { units: 1, weight: 67 });
  assert.deepEqual(get('2:plasma').onHand, { units: 2, weight: 100 });
  assert.equal(get('1:plasma').shipments[0].wc.wcNumber, '2200');
  // a second shipment trying to send another plasma from 2179 is blocked; editing 2200 itself is fine
  const next = { id: 10, kind: 'shipment', shipment: { crtPlasma: [{ wcId: 1, category: 'plasma', units: 1, weight: 80 }] } };
  assert.match(L.crtPlasmaErrors({ shipment: next, wcs: wcs.concat(next) })[0], /WC #2179 has only 0 plasma unit\(s\) left to ship — this shipment lists 1/);
  assert.deepEqual(L.crtPlasmaErrors({ shipment: wcs[2], wcs }), []);
  assert.equal(L.settlementAmount({ type: 'charged', amount: '$85.00' }), -85);
  assert.equal(L.settlementText({ type: 'paid', amount: '1200' }), 'Paid $1,200.00');
});

test('non-CEW LCD/LED and non-CEW plasma print as one Non-CEW Non-CRT row', () => {
  const t = { lines: [
    { category: 'lcdled', irrUnits: 10, irrWeight: 100, cewUnits: 8, nonCewWeight: 20 },
    { category: 'plasma', irrUnits: 3, irrWeight: 150, cewUnits: 1, nonCewWeight: 90 },
  ] };
  const items = [{ id: 1, appliesTo: 'noncew:noncrt', basis: 'lb', dropOff: '0.10', direction: 'charge' }];
  const inv = L.invoiceMath({ transfer: t, mode: 'dropoff', priceItems: items, company: null });
  const nc = inv.merged.filter((r) => r.label === 'Non-CEW Non-CRT');
  assert.equal(nc.length, 1);
  assert.deepEqual([nc[0].units, nc[0].weight, nc[0].amount], [4, 110, -11]);
});

test('storage note: oldest storage ships first (the three ABS examples)', () => {
  const mats = [{ id: 1, name: 'ABS Plastic', category: 'Plastic' }];
  const inv = (date, lbs) => ({ id: date, kind: 'inventory', noWc: true, date, inventory: { forMonth: date.slice(0, 7), lines: [{ materialId: 1, net: lbs }] } });
  const ship = (id, date, lbs) => ({ id, kind: 'shipment', date, shipment: { lines: [{ materialId: 1, net: lbs, cew: true }] } });
  const note = (wcs, id) => L.storageNoteText(L.residualFifo({ materials: mats, wcs }).notes.get(id)[0]);

  // 1) 1,000 lbs left from January, 1,500 shipped Feb 10
  assert.equal(note([inv('2026-01-31', 1000), ship(1, '2026-02-10', 1500)], 1),
    "1,000 lbs of ABS Plastic shipped were from January 2026's storage; the other 500 lbs were generated in February 2026.");
  // 2) 750 on Feb 10 is all January storage; 500 on Feb 20 is 250 January + 250 February
  const two = [inv('2026-01-31', 1000), ship(1, '2026-02-10', 750), ship(2, '2026-02-20', 500)];
  assert.equal(note(two, 1), "All 750 lbs of ABS Plastic shipped were from January 2026's storage.");
  assert.equal(note(two, 2), "250 lbs of ABS Plastic shipped were from January 2026's storage; the other 250 lbs were generated in February 2026.");
  // 3) January 1,000; end of February 3,000 on hand; 4,000 shipped March 15
  const three = [inv('2026-01-31', 1000), inv('2026-02-28', 3000), ship(1, '2026-03-15', 4000)];
  const f = L.residualFifo({ materials: mats, wcs: three });
  assert.deepEqual(f.storage.get(L.monthIndex(2026, 2)).get(1), [{ idx: L.monthIndex(2026, 1), lbs: 1000 }, { idx: L.monthIndex(2026, 2), lbs: 2000 }]);
  assert.equal(note(three, 1), "1,000 lbs of ABS Plastic shipped were from January 2026's storage and 2,000 lbs from February 2026's storage; the other 1,000 lbs were generated in March 2026.");
});

test('CRT/plasma shipments: no WC, received-date rule, rejected as non-CEW still counts as shipped', () => {
  const wcs = [
    { id: 1, kind: 'transfer', wcNumber: '2179', date: '2026-07-10', transfer: { lines: [{ category: 'crt', irrUnits: 4, irrWeight: 260, cewUnits: 4 }] } },
    { id: 2, kind: 'transfer', wcNumber: '2185', date: '2026-07-12', transfer: { lines: [{ category: 'crt', irrUnits: 2, irrWeight: 130, cewUnits: 2 }] } },
    { id: 9, kind: 'crtShipment', noWc: true, wcNumber: '', date: '2026-07-11', crtShipment: { lines: [{ wcId: 1, category: 'crt', units: 4, weight: 255, rejectedUnits: 1, rejectedNote: 'no source log' }] } },
  ];
  const r = L.crtPlasmaLedger(wcs).rows.find((x) => x.key === '1:crt');
  assert.deepEqual([r.shipped.units, r.rejected, r.onHand.units], [4, 1, 0]);
  assert.equal(r.shipments[0].rejectedNote, 'no source log');
  assert.deepEqual(L.crtPlasmaErrors({ shipment: wcs[2], wcs }), []);
  const early = { ...wcs[2], crtShipment: { lines: [{ wcId: 2, category: 'crt', units: 1, weight: 65 }] } };
  assert.match(L.crtPlasmaErrors({ shipment: early, wcs })[0], /WC #2185 was received 7\.12\.26, after this shipment \(7\.11\.26\)/);
  const tooMany = { ...wcs[2], crtShipment: { lines: [{ wcId: 1, category: 'crt', units: 2, weight: 1, rejectedUnits: 3 }] } };
  assert.ok(L.crtPlasmaErrors({ shipment: tooMany, wcs }).some((e) => /Rejected-as-non-CEW/.test(e)));
});

test('WC rows: CEW / non-CEW split with gross and tare, totals equal the IRR', () => {
  const t = { lines: [
    { category: 'lcdled', irrUnits: 57, irrGross: 1714, irrTare: 0, irrWeight: 1714, cewUnits: 50, nonCewWeight: 200 },
    { category: 'crt', irrUnits: 1, irrGross: 67, irrTare: 0, irrWeight: 67, cewUnits: 1 },
    { category: 'plasma', irrUnits: 2, irrGross: 199, irrTare: 35, irrWeight: 164, cewUnits: 1, nonCewWeight: 80 },
    { category: 'other', description: 'CPU', irrUnits: '', irrGross: 18, irrTare: 0, irrWeight: 18 },
  ] };
  const rows = L.wcRows(t);
  assert.deepEqual(rows.map((r) => [r.label, r.units, r.gross, r.tare, r.net]), [
    ['CEW LCD/LED', 50, 1514, 0, 1514],
    ['CEW CRT', 1, 67, 0, 67],
    ['CEW PLASMA', 1, 119, 35, 84],             // plasma's tare stays with its first row
    ['Non-CEW Non-CRT', 8, 280, 0, 280],        // 7 LCD/LED (200 lbs) + 1 plasma (80 lbs)
    ['CPU', 0, 18, 0, 18],
  ]);
  assert.equal(rows[4].weightOnly, true);
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  assert.deepEqual([sum('gross'), sum('tare'), sum('net')], [1998, 35, 1963]);   // = IRR totals
});

test('purchase invoice: credits, deductions, final balance (like the PO template)', () => {
  const items = [
    { id: 1, appliesTo: 'cew:lcdled', basis: 'lb', dropOff: '0.30', direction: 'pay' },
    { id: 2, appliesTo: 'noncew:noncrt', basis: 'lb', dropOff: '1.16', direction: 'charge' },
    { id: 3, appliesTo: 'other', name: 'Laptops', basis: 'lb', dropOff: '0.20', direction: 'pay', handling: '0.10' },
  ];
  const t = { lines: [
    { category: 'lcdled', irrUnits: 10, irrGross: 120, irrTare: 20, irrWeight: 100, cewUnits: 8, nonCewWeight: 20 },
    { category: 'other', description: 'Laptops', irrUnits: '', irrGross: 50, irrTare: 0, irrWeight: 50, priceItemId: 3 },
  ], deductions: [{ quantity: 1, description: 'Diesel', reason: 'Temporary Deduction', rate: '100' }] };
  const inv = L.invoiceMath({ transfer: t, mode: 'dropoff', priceItems: items, company: null });
  assert.deepEqual(inv.credits.map((r) => [r.label, r.units, r.gross, r.tare, r.weight, r.amount]), [['CEW LCD/LED', 8, 100, 20, 80, 24], ['Laptops', 0, 50, 0, 50, 10]]);
  assert.deepEqual(inv.deductions.map((d) => [d.description, d.quantity, d.reason, d.rate, d.amount]), [
    ['Non-CEW Non-CRT', 20, 'Missing source logs for quantity stated.', 1.16, 23.2],
    ['Laptops*', 50, 'Handling deduction', 0.1, 5],
    ['Diesel', 1, 'Temporary Deduction', 100, 100],
  ]);
  assert.deepEqual([inv.totalCredit, inv.totalDeduction, inv.finalBalance], [34, 128.2, -94.2]);
  assert.equal(L.slashDate('2026-09-26'), '9/26/26');
  assert.equal(L.dotDate('2026-08-07'), '08.07.2026');
});

test('storage sentence for the shipment WC (their Aug 7 example)', () => {
  const mats = [{ id: 1, name: 'circuit boards', category: 'Circuit Boards' }, { id: 2, name: 'power boards', category: 'Circuit Boards' }, { id: 3, name: 'LED light strips', category: 'Circuit Boards' }];
  const wcs = [
    { id: 1, kind: 'inventory', noWc: true, date: '2026-07-31', inventory: { forMonth: '2026-07', lines: [{ materialId: 1, net: 230 }, { materialId: 2, net: 743 }, { materialId: 3, net: 765 }] } },
    { id: 2, kind: 'shipment', date: '2026-08-07', shipment: { lines: [{ materialId: 1, net: 1169, cew: true }, { materialId: 2, net: 1868, cew: true }, { materialId: 3, net: 1095, cew: true }] } },
  ];
  const notes = L.residualFifo({ materials: mats, wcs }).notes.get(2);
  assert.equal(L.storageSentence(notes), "230 lbs of circuit boards, 743 lbs of power boards, and 765 lbs of LED light strips shipped from July 2026's storage.");
  // listed in the order the lines appear on the WC, not alphabetically
  const flipped = [wcs[0], { ...wcs[1], shipment: { lines: [...wcs[1].shipment.lines].reverse() } }];
  assert.match(L.storageSentence(L.residualFifo({ materials: mats, wcs: flipped }).notes.get(2)), /^765 lbs of LED light strips, 743 lbs of power boards, and 230 lbs of circuit boards/);
});

test('197 values: official field names, LCD/LED only, split claim fills Tables 1 and 2', () => {
  const wc = { id: 5, wcNumber: '2179', date: '2026-07-01', transfer: {
    lines: [{ category: 'lcdled', irrUnits: 57, irrWeight: 1714, cewUnits: 50, nonCewWeight: 200 }, { category: 'plasma', irrUnits: 2, irrWeight: 164, cewUnits: 2 }],
    form197: { saNonCrt: '3', collectorPrinted: 'Joshua Lopez', recyclerPrinted: 'Joshua Lopez' }, timeline: { sourceLogsReceived: '2026-07-02' } } };
  const parties = { facility: { name: 'Bellflower Recycling Center', cewId: '127632' }, collector: { name: 'Bellflower Recycling Center', cewId: '127362' }, handler: { name: 'Got EWaste' }, collectorIsFacility: true };
  const periods = [{ id: 1, cewType: 'NonCRT', year: 2026, month: 7 }, { id: 2, cewType: 'NonCRT', year: 2026, month: 8 }];
  const allocations = [{ wcId: 5, claimPeriodId: 1, units: 40, weight: 1200 }, { wcId: 5, claimPeriodId: 2, units: 10, weight: 314 }];
  const v = L.form197Values({ wc, parties, allocations, periods });
  const f = v.fields;
  assert.equal(f['Date of TransferRow1'], '07/01/2026');
  assert.deepEqual([f['Collector CEWID Row1'], f['Recycler CEWID Row1']], ['127362', '127632']);
  assert.deepEqual([f['Units TransferredCA Sourced NonCRT CEW'], f['Weights Transferred lbsCA Sourced NonCRT CEW'], f['SA Units From Units TransferredCA Sourced NonCRT CEW']], ['50', '1,514', '3']);
  assert.deepEqual([f['Units TransferredCA Sourced CRT CEW'], f['Units TransferredTotals'], f['Weights Transferred lbsTotals']], ['0', '50', '1,514']);
  assert.equal(f['documented in the collection log'], 'Got EWaste (Handler). CRT and Plasma Units, will not be kept and instead transferred to another recycler');
  assert.deepEqual([f['Units TransferredCA Sourced NonCRT CEW_2'], f['Weights Transferred lbsCA Sourced NonCRT CEW_2'], f['Units TransferredCA Sourced NonCRT CEW_3']], ['40', '1,200', '10']);
  assert.deepEqual(v.reportingMonths, ['July 2026', 'August 2026']);
  assert.equal(v.checks[L.F197_CHECK_LOGS], true);
  // a handler's transfer: we're both collector and recycler, so our signer's name goes in both boxes and signs both
  assert.deepEqual([f['Printed NameRow1'], f['Printed NameRow1_2']], ['Joshua Lopez', 'Joshua Lopez']);
  assert.deepEqual(v.signatures, { collector: 'Joshua Lopez', recycler: 'Joshua Lopez' });
  // an outside collector signs their own box
  const outside = L.form197Values({ wc: { ...wc, transfer: { ...wc.transfer, form197: { signer: 'Jonathan Jaffee', collectorPrinted: 'Bob Smith' } } },
    parties: { ...parties, handler: null, collector: { name: 'Allied Erecycling', cewId: '127733' }, collectorIsFacility: false }, allocations, periods });
  assert.deepEqual([outside.fields['Printed NameRow1'], outside.fields['Printed NameRow1_2']], ['Bob Smith', 'Jonathan Jaffee']);
  assert.deepEqual(outside.signatures, { collector: '', recycler: 'Jonathan Jaffee' });
  assert.equal(v.checks[L.F197_CHECK_184], false);
  // claimed whole in one month → tables stay blank
  const one = L.form197Values({ wc, parties, allocations: [{ wcId: 5, claimPeriodId: 1, units: 50, weight: 1514 }], periods });
  assert.equal(one.needTables, false);
  assert.equal(one.fields['Units TransferredCA Sourced NonCRT CEW_2'], undefined);
});

test('WC log paste: their real 74-row log', () => {
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'wc-log-sample.tsv'), 'utf8');
  const { rows, skipped, usedHeader, mainYear } = L.parseWcLog(text);
  assert.equal(usedHeader, true); assert.equal(skipped.length, 0); assert.equal(rows.length, 74); assert.equal(mainYear, 2026);
  const by = (n) => rows.find((r) => r.wcNumber === n);
  const count = (k) => rows.filter((r) => r.kind === k).length;
  assert.deepEqual([count('transfer'), count('shipment'), count('void'), count('unknown')], [48, 25, 1, 0]);
  // types
  assert.equal(by('2341').unsure, true);                         // "cew transfer? (Josh a confirmar)"
  assert.equal(by('2330').kind, 'transfer');                     // "tranfser"
  assert.deepEqual([by('2300').kind, by('2300').unsure], ['transfer', true]); // type "Reboot Tech" but it has an IRR
  assert.equal(by('2286').kind, 'shipment');                     // "residual transfer cew only"
  assert.equal(by('2282').kind, 'shipment');                     // "ced    =w/cbep residual shipment"
  assert.equal(by('2334').nonCew, true); assert.equal(by('2322').cbepOnly, true); assert.equal(by('2339').cbep, true);
  assert.equal(by('2321').maybeTransfer, true);                  // "cew shipment" with a PO sent and a cancellation…
  assert.deepEqual([by('2321').kind, by('2321').unsure], ['transfer', true]); // …so it comes in as a transfer to check
  assert.equal(by('2342').maybeTransfer, false);
  // dates
  assert.deepEqual([by('2319').date, by('2319').dateFixed], ['2026-09-18', true]);   // 9.18.16
  assert.deepEqual([by('2315').date, by('2315').dateFixed], ['2026-09-16', true]);   // 916.26
  assert.deepEqual([by('2309').date, by('2309').dateFixed], ['2026-09-15', false]);  // `9.15.26 (just tidied)
  // payment column
  assert.equal(by('2330').paid, true); assert.equal(by('2328').paid, true); assert.equal(by('2349').paid, false);
  assert.equal(by('2321').poSent, '2026-09-23'); assert.equal(by('2321').dueDate, '');
  assert.deepEqual([by('2306').dueDate, by('2306').dueNote], ['2026-09-17', 'porfavor revisa el packing list contra nuestro cuenta']);
  assert.deepEqual([by('2317').dueDate, by('2317').dueNote], ['', 'Josh va mandar el PO']);
  assert.equal(by('2347').dueDate, '2026-09-30');                // 9..30.26
  // packet month, lot, notes, IRR
  assert.equal(by('2294').packetMonth, '2026-09'); assert.equal(by('2277').packetMonth, '2026-08'); assert.equal(by('2349').packetMonth, '');
  assert.equal(by('2336').lotCancelled, true);
  assert.equal(by('2293').notes, 'Porfavor manda los extra CBEP logs a Oscar (una photo or escrito por correo)\nCancelled 9.11.26');
  assert.equal(by('2311').irrNumber, '1811');
  // companies
  assert.deepEqual([by('2338').companyName, by('2338').companyNote], ['clean earth', 'lamps']);
  assert.deepEqual([by('2348').companyName, by('2348').companyNote], ['FMC Metals', 'copper wire']);
  assert.deepEqual(['2329', '2322', '2308'].map((n) => by(n).selfCollected), [true, true, true]);
  const g = L.groupCompanyNames(rows.map((r) => ({ name: r.companyName, note: r.companyNote })), [{ id: 7, name: 'Oscar Recycling', aliases: [] }]);
  const same = (a, b) => g.get(a).group === g.get(b).group;
  assert.ok(same("Goldn' West Surplus", 'Golden west surplus') && same("Goldn' West Surplus", 'Goldenwest surplus'));
  assert.equal(g.get('Goldenwest surplus').display, "Goldn' West Surplus");
  assert.ok(same('E Recycle', 'e recycle abs plastic') && same('E Recycle', 'Abs plastic e recycle'));
  assert.ok(same('Reboot Tech', 'reboot tech')); assert.equal(g.get('reboot tech').display, 'Reboot Tech');
  assert.ok(!same('Sanchez Corona', 'Sanchez Placentia') && !same('G Rod Anaheim', 'G Rod Chino'));
  assert.equal(g.get('oscar recycling').companyId, 7);          // matches a saved company
  assert.equal(g.get('mccoy recycling').display, 'Mccoy Recycling');
  assert.equal(g.get('quality paper and metals').display, 'Quality Paper and Metals');
});


test('company roles: handler xor collector, handler xor recycler; CEWID numbers only', () => {
  assert.deepEqual(L.roleConflicts(['handler', 'collector', 'destination']), [['handler', 'collector']]);
  assert.deepEqual(L.roleConflicts(['collector', 'recycler', 'destination']), []);          // collector + recycler is fine
  assert.deepEqual(L.roleConflicts(['handler', 'destination']), []);                        // handler + vendor is fine
  assert.deepEqual(L.resolveRoles(['handler', 'collector'], ['collector']), ['collector']);
  assert.deepEqual(L.resolveRoles(['handler', 'recycler'], ['handler']), ['handler']);
  assert.deepEqual(L.resolveRoles(['handler', 'collector']), ['handler']);
  assert.deepEqual(L.resolveRoles(['recycler']), ['recycler', 'destination']);
  assert.equal(L.cleanCewId('Handler'), ''); assert.equal(L.cleanCewId('CEWID 127,733'), '127733');
  const { rows } = L.parseCustomerSheet('Company\tCEWID #\nGot E Waste\tHandler\nAllied\t127733');
  assert.deepEqual([rows[0].cewId, rows[0].isHandler, rows[1].cewId, rows[1].isHandler], ['', true, '127733', false]);
});

test('missing WC # and IRR # alerts', () => {
  assert.deepEqual(L.numberGaps(['2276', '2277', '2279', '2281']).missing, ['2278', '2280']);
  assert.deepEqual(L.numberGaps(['2276', '2279'], ['2277']).missing, ['2278']);            // 2277 marked as skipped
  assert.deepEqual(L.numberGaps(['INV-08', '715', '716']).missing, []);                    // only plain numbers count
  assert.equal(L.numberGaps(['715', '22790']).tooWide, true);                              // a typo, not 22,000 gaps
  const wcs = [{ wcNumber: '2300', kind: 'transfer', transfer: { irrNumber: '1798' } }, { wcNumber: '2302', kind: 'transfer', transfer: { irrNumber: '1800' } },
    { wcNumber: '', noWc: true, kind: 'inventory' }, { wcNumber: '2303', kind: 'shipment' }];
  assert.deepEqual(L.wcNumberGaps(wcs).missing, ['2301']);
  assert.deepEqual(L.irrNumberGaps(wcs).missing, ['1799']);
  // their real log: WC 2276–2349 and IRR 1792–1811 have no gaps
  const { rows } = L.parseWcLog(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'wc-log-sample.tsv'), 'utf8'));
  assert.deepEqual(L.numberGaps(rows.map((r) => r.wcNumber)).missing, []);
  assert.deepEqual(L.numberGaps(rows.map((r) => r.irrNumber)).missing, []);
});

test('CBEP: several items, each at its own rate', () => {
  const items = [
    { id: 1, appliesTo: 'cew:lcdled', name: 'CEW LCD/LED', basis: 'lb', dropOff: '0.30', direction: 'pay' },
    { id: 4, appliesTo: 'cew:cbep', name: 'CBEP Computer Towers', basis: 'lb', dropOff: '0.40', direction: 'pay' },
    { id: 5, appliesTo: 'cew:cbep', name: 'CBEP Printers', basis: 'lb', dropOff: '0.25', direction: 'pay' },
    { id: 6, appliesTo: 'noncew:cbep', name: 'CBEP without source logs', basis: 'lb', dropOff: '0.10', direction: 'charge' },
  ];
  const t = { lines: [
    { category: 'cbep', priceItemId: 5, irrUnits: 6, irrGross: 120, irrTare: 0, irrWeight: 120, cewUnits: 5, nonCewWeight: 20 },
    { category: 'cbep', priceItemId: 4, irrUnits: 2, irrGross: 60, irrTare: 0, irrWeight: 60, cewUnits: 2 },
    { category: 'cbep', irrUnits: 1, irrGross: 30, irrTare: 0, irrWeight: 30, cewUnits: 1 },   // kind not picked yet
  ] };
  const inv = L.invoiceMath({ transfer: t, mode: 'dropoff', priceItems: items, company: null });
  const byLabel = (x) => inv.credits.find((r) => r.label === x);
  assert.deepEqual([byLabel('CBEP Printers').rate, byLabel('CBEP Printers').amount], [0.25, 25]);
  assert.deepEqual([byLabel('CBEP Computer Towers').rate, byLabel('CBEP Computer Towers').amount], [0.4, 24]);
  const unpicked = byLabel('CBEP');
  assert.equal(unpicked.needsRate, true); assert.match(unpicked.source, /Pick which CBEP item/);
  assert.equal(inv.deductions[0].description, 'CBEP without source logs');
  assert.equal(L.PRICE_KEYS.find(([k]) => k === 'cew:cbep')[1], 'CBEP (with source logs)');
  // a single CBEP item needs no picking
  const one = L.invoiceMath({ transfer: { lines: [t.lines[2]] }, mode: 'dropoff', priceItems: items.filter((p) => p.id !== 5), company: null });
  assert.equal(one.credits[0].label, 'CBEP Computer Towers');
});

// ---------- 198 logs — checked against Got E Waste's real 6/24/26 transfer (198 O, A, C, UC, Master) ----------
const GEW_A = require('./fixtures/got-e-waste-6-24-26-198A.json');
const gewTransfer = () => ({ lines: [
  { category: 'lcdled', irrUnits: 35, irrWeight: 1190, cewUnits: 35 },
  { category: 'plasma', irrUnits: 7, irrWeight: 300, cewUnits: 7 },
  { category: 'crt', irrUnits: 1, irrWeight: 50, cewUnits: 1 },
], timeline: { customerAdjustments: '2026-06-26' }, logs: { a: { rows: GEW_A.rows } } });

test('198: source types and contact rules', () => {
  assert.equal(L.contactRequired({ type: 'R', noncrt: 4 }), false);
  assert.equal(L.contactRequired({ type: 'r', noncrt: 5 }), true);           // residents: 5 or more units
  for (const t of ['B', 'E', 'G', 'H', 'OC']) assert.equal(L.contactRequired({ type: t, noncrt: 1 }), true, t);
  const issues = L.logIssues({ rows: [{ date: '6/24/26', type: 'B', name: 'Acme', address: '1 Main St', contact: 'Bob', noncrt: 1 }] }, null);
  assert.match(issues.map((i) => i.text).join(' '), /business source needs a contact person name & phone/);
});

test('198: the A is the basis when adjustments were required; its totals match the transfer', () => {
  const t = gewTransfer();
  const b = L.logBasis(t);
  assert.deepEqual([b.which, b.missing, b.log.rows.length], ['A', false, 16]);
  assert.deepEqual(L.logTotals(b.log.rows), { crt: 1, noncrt: 42, cbep: 0 });
  assert.equal(L.logIssues(b.log, t).filter((i) => /unit\(s\), the transfer has/.test(i.text)).length, 0);
  assert.deepEqual(L.logBasis({ ...t, timeline: {} }), { which: 'O', log: null, missing: true });
  assert.deepEqual(L.strikeTargets(t), { crt: 1, plasma: 7 });
});

test('198 C / UC / Master: their strikes on the 6/24/26 transfer', () => {
  const t = gewTransfer();
  const rows = GEW_A.rows;
  // the entries they struck: Jarrod Morgan 2, Janessa Chun 3, Gary Crosby Jr. 2 (Non-CRT) and Ayad Eren 1 (CRT)
  const pick = { 'Jarrod Morgan': { crt: 0, noncrt: 2 }, 'Janessa Chun': { crt: 0, noncrt: 3 }, 'Gary Crosby Jr.': { crt: 0, noncrt: 2 }, 'Ayad Eren': { crt: 1, noncrt: 0 } };
  t.strikes = rows.map((r) => pick[r.name] || { crt: 0, noncrt: 0 });
  const { plan, saved } = L.strikePlan(t, rows);
  assert.equal(saved, true);
  const lines = L.claimLines(rows, plan);
  assert.equal(lines.length, 16);                                            // whole entries struck: no splits
  const pages = L.paginate198(lines);
  assert.deepEqual(pages.map((p) => [p.lines.length, p.totals.crt, p.totals.noncrt]), [[7, 0, 18], [7, 1, 18], [2, 0, 6]]); // Totals unchanged, as on their C
  const uc = L.ucLines(lines);
  assert.deepEqual(uc.map((l) => [l.name, l.crt, l.noncrt]), [['Jarrod Morgan', 0, 2], ['Janessa Chun', 0, 3], ['Gary Crosby Jr.', 0, 2], ['Ayad Eren', 1, 0]]);
  assert.deepEqual(L.claimedTotals(lines), { crt: 0, noncrt: 35, cbep: 0 }); // = their 198 Master: 35 Non-CRT
  // picks being changed one at a time are kept (not complete yet); picks that don't fit the log fall back to automatic
  const partial = L.strikePlan({ ...t, strikes: rows.map(() => ({ crt: 0, noncrt: 0 })) }, rows);
  assert.deepEqual([partial.saved, partial.complete], [true, false]);
  assert.deepEqual([L.strikePlan({ ...t, strikes: [{ crt: 0, noncrt: 0 }] }, rows).saved, L.strikePlan(t, rows).complete], [false, true]);
});

test('198 C: a partly struck entry splits into two lines, claimed then struck', () => {
  const rows = [{ date: '01/01/2026', type: 'R', name: 'John Smith', address: 'X', contact: '', crt: 0, noncrt: 4, cbep: 0 },
    { date: '01/01/2026', type: 'R', name: 'Next', address: 'Y', contact: '', crt: 0, noncrt: 1, cbep: 0 }];
  const lines = L.claimLines(rows, [{ crt: 0, noncrt: 2 }, { crt: 0, noncrt: 0 }]);
  assert.deepEqual(lines.map((l) => [l.name, l.noncrt, l.struck]), [['John Smith', 2, false], ['John Smith', 2, true], ['Next', 1, false]]);
  // 7 per page: 8 lines make two pages
  assert.deepEqual(L.paginate198(Array(8).fill(lines[0])).map((p) => p.lines.length), [7, 1]);
});

test('198 O → A changes (their 6/24/26 logs)', () => {
  const A = GEW_A.rows;
  const O = A.map((r) => ({ ...r, contact: 'PH#' }));
  O[0] = { ...O[0], name: 'Jessie Contreres' };
  O[7] = { ...O[7], address: '1245 morning view dr # 335 escondido CA, 92026' };
  O[14] = { ...O[14], noncrt: 2 };                                          // Devin Lewis: 2 on the O, 3 on the A
  const d = L.diffLogs({ rows: O }, { rows: A });
  assert.deepEqual([d.added.length, d.removed.length], [0, 0]);
  const by = (n) => d.changed.find((c) => c.name === n);
  assert.deepEqual(by('Jessie Contreras').fields.filter((f) => f.field === 'name').map((f) => [f.from, f.to]), [['Jessie Contreres', 'Jessie Contreras']]);
  assert.deepEqual(by('Devin Lewis').fields.filter((f) => f.units).map((f) => [f.label, f.from, f.to]), [['Non-CRT', 2, 3]]);
  assert.deepEqual(d.totals.delta, { crt: 0, noncrt: 1, cbep: 0 });
  assert.deepEqual([d.totals.o.noncrt, d.totals.a.noncrt], [41, 42]);
});

test('198 UC by shipment: 5 CRT + 5 plasma, 3 CRT + 2 plasma shipped, the rest later — never sent twice', () => {
  const uc = [{ name: 'A', crt: 3, noncrt: 2 }, { name: 'B', crt: 2, noncrt: 3 }];
  const first = L.allocateUc(uc, [], { crt: 3, plasma: 2 });
  assert.deepEqual(first.lines.map((l) => [l.name, l.crt, l.noncrt]), [['A', 3, 2]]);
  const sent = first.lines.map((l) => ({ src: l.src, crt: l.crt, noncrt: l.noncrt }));
  assert.deepEqual(L.ucRemaining(uc, sent).map((l) => [l.name, l.crt, l.noncrt]), [['B', 2, 3]]);
  const again = L.allocateUc(uc, sent, { crt: 3, plasma: 0 });              // only 2 CRT left
  assert.deepEqual([again.lines.map((l) => [l.name, l.crt]), again.short.crt], [[['B', 2]], 1]);
  // a partial take splits the entry
  const part = L.allocateUc(uc, [], { crt: 1, plasma: 0 });
  assert.deepEqual(part.lines.map((l) => [l.name, l.crt]), [['A', 1]]);
});

test('transfer type: from the WC log wording, and lines that don\'t fit', () => {
  assert.equal(L.transferTypeFromText('cew/cbep transfer'), 'both');
  assert.equal(L.transferTypeFromText('CBEP only transfer'), 'cbep');
  assert.equal(L.transferTypeFromText('cew transfer only'), 'cew');
  assert.equal(L.transferTypeFromText('CBEP/CEW Transfer'), 'both');
  assert.match(L.transferTypeIssues({ transferType: 'cew', lines: [{ category: 'cbep', irrUnits: 2, irrWeight: 40 }] })[0], /CBEP line/);
  assert.equal(L.transferTypeIssues({ transferType: 'both', lines: [{ category: 'cbep', irrUnits: 2, irrWeight: 40 }] }).length, 0);
});

test('WC: every CBEP item is one "CBEP Units" line; the invoice keeps them apart', () => {
  const items = [{ id: 4, appliesTo: 'cew:cbep', name: 'CBEP Computer Towers', basis: 'lb', dropOff: '0.40', direction: 'pay' },
    { id: 5, appliesTo: 'cew:cbep', name: 'CBEP Printers', basis: 'lb', dropOff: '0.25', direction: 'pay' }];
  const t = { lines: [
    { category: 'cbep', priceItemId: 5, irrUnits: 6, irrGross: 120, irrTare: 10, irrWeight: 110, cewUnits: 5, nonCewWeight: 20 },
    { category: 'cbep', priceItemId: 4, irrUnits: 2, irrGross: 60, irrTare: 0, irrWeight: 60, cewUnits: 2 },
  ] };
  assert.deepEqual(L.wcRows(t, items).map((r) => [r.label, r.units, r.gross, r.tare, r.net, r.claim]), [['CBEP Units', 8, 180, 10, 170, true]]);
  const inv = L.invoiceMath({ transfer: t, mode: 'dropoff', priceItems: items, company: null });
  assert.deepEqual(inv.credits.filter((r) => /^CBEP (Printers|Computer)/.test(r.label)).map((r) => [r.label, r.rate]), [['CBEP Printers', 0.25], ['CBEP Computer Towers', 0.4]]);
});

test('annual summary: received, paid by kind, shipped, claims requested vs received, sales — by calendar year', () => {
  const items = [{ id: 1, appliesTo: 'cew:lcdled', name: 'CEW LCD/LED', basis: 'lb', dropOff: '0.30', direction: 'pay' }];
  const mk = (id, date, lines, extra = {}) => ({ id, date, wcNumber: String(id), kind: 'transfer', transfer: { mode: 'dropoff', lines, transferType: 'cew', ...extra } });
  const w1 = mk(1, '2026-03-02', [{ category: 'lcdled', irrUnits: 10, irrGross: 200, irrTare: 0, irrWeight: 200, cewUnits: 10 }, { category: 'crt', irrUnits: 2, irrGross: 100, irrTare: 0, irrWeight: 100, cewUnits: 2 }]);
  const w2 = mk(2, '2025-12-30', [{ category: 'lcdled', irrUnits: 5, irrGross: 100, irrTare: 0, irrWeight: 100, cewUnits: 5 }], { poDate: '2026-01-04' });
  const inv = (w) => L.invoiceMath({ transfer: w.transfer, mode: 'dropoff', priceItems: items, company: null });
  const sum = L.annualSummary({ year: 2026, transfers: [w1, w2].map((wc) => ({ wc, customer: 'Got E Waste', invoice: inv(wc) })),
    shipments: [
      { id: 10, kind: 'crtShipment', date: '2026-04-01', companyId: 7, crtShipment: { lines: [{ wcId: 1, category: 'crt', units: 2, weight: 100 }], settlement: { type: 'paid', amount: '40' } } },
      { id: 11, kind: 'shipment', date: '2026-04-09', wcNumber: '2209', companyId: 8, shipment: { lines: [{ materialId: 3, net: 500 }], settlement: { type: 'charged', amount: '25' } } },
    ],
    periods: [{ id: 1, cewType: 'NonCRT', year: 2026, month: 3, requestedAmount: '230.00', receivedAmount: '228.50', paidDate: '2026-05-20' }, { id: 2, cewType: 'NonCRT', year: 2025, month: 12, requestedAmount: '100' }],
    otherSales: [{ id: 1, date: '2026-06-01', buyer: 'Scrap buyer', description: 'misc metal', amount: '15.25' }, { id: 2, date: '2025-06-01', amount: '99' }],
    materials: [{ id: 3, name: 'ABS Plastic' }], companyName: (id) => ({ 7: 'Clean Earth', 8: 'E Recycle' }[id] || '') });
  // received: only the 2026 transfer (w2 was received 12/30/2025)
  assert.deepEqual([sum.received.rows.length, sum.received.totals.units, sum.received.totals.weight, sum.received.totals.byKind.crt.units], [1, 12, 300, 2]);
  assert.equal(sum.received.monthlyWeight[2], 300);
  // paid: both invoices are dated 2026 (w2 by its PO date, 1/4/26)
  assert.deepEqual([sum.paid.rows.length, sum.paid.totals.balance], [2, 90]);          // 200×.30 + 100×.30
  assert.deepEqual(sum.paid.byKind[0], { label: 'CEW LCD/LED', amount: 90 });
  // shipped + sales
  assert.deepEqual([sum.shipped.crt.length, sum.shipped.totals.crtUnits, sum.shipped.residual[0].weight, sum.shipped.residual[0].byMaterial[0].name], [1, 2, 500, 'ABS Plastic']);
  assert.deepEqual([sum.sales.total, sum.sales.charged, sum.sales.rows.map((r) => r.source)], [55.25, 25, ['CRT/plasma shipment', 'Other sale']]);
  // claims: requested vs received
  assert.deepEqual(sum.claims.rows.map((r) => [r.requested, r.received, r.diff, r.paidDate]), [[230, 228.5, -1.5, '2026-05-20']]);
  assert.deepEqual(sum.money, { income: 283.75, spent: 115 });
});

// ---------- v3.1: types, CBEP residuals, claim-period views, cancellations, partial 198 C ----------
test('types: CEW is spelled out from the lines; CBEP stays CBEP', () => {
  const t = (type, cats) => ({ transferType: type, lines: cats.map((c) => ({ category: c, irrUnits: 1, irrWeight: 10 })) });
  assert.equal(L.transferTypeDisplay(t('cew', ['lcdled', 'plasma'])), 'CEW Non-CRT');
  assert.equal(L.transferTypeDisplay(t('cew', ['crt'])), 'CEW CRT');
  assert.equal(L.transferTypeDisplay(t('both', ['crt', 'lcdled', 'cbep'])), 'CEW CRT & Non-CRT & CBEP');
  assert.equal(L.transferTypeDisplay(t('cbep', ['cbep'])), 'CBEP');
  assert.equal(L.transferTypeLabel('both'), 'CEW & CBEP');
  assert.equal(L.shipmentTypeDisplay('both'), 'CEW Non-CRT & CBEP');
  assert.equal(L.cbepName({ category: 'cbep' }, []), 'CBEP');
});

test('CBEP residuals: varied materials print as one 196C line; batteries alone, one chemistry', () => {
  const mats = [{ id: 1, name: 'Power Boards', category: 'Circuit Boards' }, { id: 2, name: 'Circuit Boards', category: 'Circuit Boards' },
    { id: 3, name: 'Motherboards', category: 'Other', residual196C: 'Circuit Boards' }, { id: 4, name: 'Steel', category: 'Non-Copper Metals' },
    { id: 5, name: 'Li-ion', category: 'All Battery Chemistries', residual196C: 'Lithium-ion Batteries' }, { id: 6, name: 'LCD Panels', category: 'LCD Bare Panels' }];
  assert.equal(L.residual196C(mats[5]), L.NOT_CBEP);
  const cb = { shipment: { shipmentType: 'cbep', lines: [{ materialId: 1, net: 100, tare: 5 }, { materialId: 2, net: 50 }, { materialId: 3, net: 25 }, { materialId: 4, net: 400 }] } };
  assert.deepEqual(L.shipmentRows(cb, mats).map((r) => [r.label, r.net, r.tare]), [['CBEP Circuit Boards', 175, 5], ['CBEP Non-Copper Metals', 400, 0]]);
  // CEW & CBEP: each line marked; CEW lines combine under their 196B column
  const mixed = { shipment: { shipmentType: 'both', lines: [{ materialId: 1, net: 10, program: 'cew' }, { materialId: 2, net: 20, program: 'cbep' }, { materialId: 1, net: 5, program: 'cew' }] } };
  assert.deepEqual(L.shipmentRows(mixed, mats).map((r) => [r.label, r.net]), [['CEW Non-CRT Circuit Boards', 15], ['CBEP Circuit Boards', 20]]);
  // CEW-only shipments print as entered
  assert.deepEqual(L.shipmentRows({ shipment: { lines: [{ materialId: 4, net: 7 }, { materialId: 6, net: 3 }] } }, mats).map((r) => r.label), ['Steel', 'LCD Panels']);
  const bat = { shipment: { shipmentType: 'cbep', accumulationStart: '2026-08-01', paperwork: { destination: 'recycling', bol: 'B1', materialFlow: 'X → Y' }, lines: [{ materialId: 5, net: 900 }, { materialId: 4, net: 10 }] } };
  assert.match(L.shipmentIssues(bat, mats)[0].text, /only one battery chemistry/);
  bat.shipment.lines.pop();
  assert.deepEqual(L.shipmentIssues(bat, mats), []);
  // receipts / third signature owed before the claim closes
  assert.equal(L.claimOwed([{ wcNumber: '9', shipment: bat.shipment }], mats)[0].text, 'WC #9: receipt from the receiving facility');
});

test('claim-period views: program, dates, fully used, and the month-end lamp exception', () => {
  const periods = [{ id: 1, cewType: 'NonCRT', year: 2026, month: 8 }, { id: 2, cewType: 'NonCRT', year: 2026, month: 9 }, { id: 3, cewType: 'CBEP', year: 2026, month: 9 }];
  const tr = (id, date, type, lines) => ({ id, kind: 'transfer', date, transfer: { transferType: type, lines } });
  const lcd = { category: 'lcdled', irrUnits: 10, irrWeight: 300, cewUnits: 10, cewWeight: 300 };
  const cb = { category: 'cbep', irrUnits: 4, irrWeight: 80, cewUnits: 4, cewWeight: 80 };
  const both = tr(10, '2026-08-20', 'both', [lcd, cb]);
  const allocs = [{ wcId: 10, claimPeriodId: 1, units: 10, weight: 300 }];        // its Non-CRT part fully claimed in August
  const ctx = { allocations: allocs, periods };
  assert.equal(L.wcInPeriod(both, periods[0], ctx), true);                           // August: it's on that claim
  assert.equal(L.wcInPeriod(both, periods[1], ctx), false);                          // September Non-CRT: fully used
  assert.equal(L.wcInPeriod(both, periods[2], ctx), true);                           // September CBEP: its CBEP part isn't claimed
  assert.equal(L.wcInPeriod(tr(11, '2026-09-02', 'cew', [lcd]), periods[2], ctx), false); // CEW only: not on a CBEP period
  assert.equal(L.wcInPeriod(tr(12, '2026-10-01', 'cew', [lcd]), periods[1], ctx), false); // after September's end
  const lamps = { kind: 'inventory', date: '2026-10-01', inventory: { forMonth: '2026-09' } };
  assert.equal(L.wcInPeriod(lamps, periods[1], ctx), true);                          // September's lamp storage, dated 10/01
  assert.equal(L.wcInPeriod({ kind: 'shipment', date: '2026-09-10', shipment: { shipmentType: 'cbep' } }, periods[1], ctx), false);
  assert.equal(L.wcInPeriod({ kind: 'shipment', date: '2026-09-10', shipment: { shipmentType: 'both' } }, periods[2], ctx), true);
  assert.equal(L.periodEnd({ year: 2026, month: 2 }), '2026-02-28');
});

test('CBEP month: 196C §IV and §V from generation certificates and shipments; stored check', () => {
  const mats = [{ id: 1, name: 'Plastic', category: 'Plastic' }, { id: 2, name: 'NiCd', residual196C: 'Nickel-Cadmium Batteries' }];
  const gen = (n, res, lbs) => ({ wcNumber: n, kind: 'generation', generation: { forMonth: '2026-09', residual: res, lines: [{ net: lbs }] } });
  const m = L.cbepMonth({ month: '2026-09',
    generations: [gen('3001', 'Plastic', 45000), gen('3002', 'Nickel-Cadmium Batteries', 9000)],
    shipments: [{ date: '2026-09-12', shipment: { shipmentType: 'cbep', lines: [{ materialId: 1, net: 45000 }] } },
      { date: '2026-09-20', shipment: { shipmentType: 'cbep', lines: [{ materialId: 2, net: 2000 }] } }],
    stored: { 'Nickel-Cadmium Batteries': 7500 }, prevStored: { 'Nickel-Cadmium Batteries': 500 }, materials: mats });
  const nicd = m.sec4.find((r) => r.residual === 'Nickel-Cadmium Batteries');
  assert.deepEqual([nicd.generated, nicd.shipped, nicd.stored, nicd.storageOk], [9000, 2000, 7000, true]);   // 7,500 − 500 + 2,000 = 9,000
  const plastic = m.sec5.find((r) => r.residual === 'Plastic');
  assert.deepEqual([plastic.shipped, plastic.stored, plastic.generated], [45000, 0, 45000]);
  assert.deepEqual([m.allBatteries, m.totals.total], [9000, 54000]);
  assert.equal(m.issues.length, 0);
  const off = L.cbepMonth({ month: '2026-09', generations: [gen('3002', 'Nickel-Cadmium Batteries', 9000)], stored: { 'Nickel-Cadmium Batteries': 1000 }, materials: mats });
  assert.match(off.issues[0], /Nickel-Cadmium Batteries: generated 9,000 lbs, but shipped \+ stored/);
});

test('cancellations: Device column, bulk lines, daily summary, likely bulk', () => {
  const r = L.parseCancellationLog('Date\tDevice\tWeight (lb)\tLot #\tCompany\n09/02/2026\tComputer Tower\t18.5\t2250\tGot E Waste\n09/02/2026\tMixed stack\t640\t2250\tGot E Waste\n09/03/2026\tPrinter\t22\t2251\tPink');
  assert.deepEqual(r.rows.map((x) => [x.device, x.weight, x.lotNumber]), [['Computer Tower', 18.5, '2250'], ['Mixed stack', 640, '2250'], ['Printer', 22, '2251']]);
  assert.deepEqual(L.likelyBulk(r.rows), [false, true, false]);
  r.rows[1].bulk = true; r.rows[1].bulkItems = [{ device: 'Computer Tower', units: 25 }, { device: 'Printer', units: 8 }];
  assert.equal(L.unitCount(r.rows[1]), 33);
  const d = L.dailySummary(r.rows, [{ date: '2026-09-04', weight: 100, units: 5 }]);
  assert.deepEqual(d.days.map((x) => [x.date, x.units, x.weight]), [['2026-09-02', 34, 658.5], ['2026-09-03', 1, 22], ['2026-09-04', 5, 100]]);
  assert.deepEqual(d.total, { units: 40, weight: 780.5 });
});

test('partial transfer: each month\'s 198 C — its share of entries (split as needed) plus every struck line', () => {
  const lines = [{ name: 'A', noncrt: 3, struck: false }, { name: 'B', noncrt: 4, struck: false }, { name: 'S', noncrt: 2, struck: true }, { name: 'C', noncrt: 5, struck: false }];
  const aug = L.claimPart(lines, 'NonCRT', [], 5);                     // August claims 5 of 12
  assert.deepEqual(aug.parts, [{ src: 0, units: 3 }, { src: 1, units: 2 }]);
  assert.deepEqual(L.partLines(lines, 'NonCRT', aug.parts).map((l) => [l.name, l.noncrt, l.struck]), [['A', 3, false], ['B', 2, false], ['S', 2, true]]);
  const sep = L.claimPart(lines, 'NonCRT', aug.parts, 7);             // September takes what's left
  assert.deepEqual(L.partLines(lines, 'NonCRT', sep.parts).map((l) => [l.name, l.noncrt, l.struck]), [['B', 2, false], ['S', 2, true], ['C', 5, false]]);
  assert.equal(L.claimPart(lines, 'NonCRT', [...aug.parts, ...sep.parts], 1).short, 1);
});

test('O → A list: placeholders count as blank; unit changes first, capitals/punctuation last', () => {
  const O = [{ date: '1/1/26', type: 'R', name: 'Ann', address: 'Moreno Valley CA, 92551', contact: 'PH#', noncrt: 2 }, { date: '1/1/26', type: 'R', name: 'Bo', address: '1 A St', contact: 'PH#', noncrt: 1 }];
  const A = [{ date: '1/1/26', type: 'R', name: 'Ann', address: 'Moreno Valley, CA 92551', contact: '', noncrt: 2 }, { date: '1/1/26', type: 'R', name: 'Bo', address: '1 A St', contact: '', noncrt: 3 }];
  const d = L.diffLogs({ rows: O }, { rows: A });
  assert.deepEqual(d.changed.map((c) => [c.name, c.units, c.minorOnly]), [['Bo', true, false], ['Ann', false, true]]);
  assert.equal(d.changed[0].fields.length, 1);                         // "PH#" → blank isn't a change
});

test('197S transfer summary: the period\'s transfers, partial ones noted', () => {
  const s = L.transferSummary({ period: { id: 2 }, allocations: [{ wcId: 1, claimPeriodId: 2, units: 5, weight: 150 }, { wcId: 1, claimPeriodId: 1, units: 5, weight: 150 }, { wcId: 2, claimPeriodId: 2, units: 3, weight: 90 }],
    wcs: [{ id: 1, wcNumber: '2250', date: '2026-08-20' }, { id: 2, wcNumber: '2260', date: '2026-09-02' }], partyName: (w) => `C${w.id}` });
  assert.deepEqual(s.rows.map((r) => [r.wcNumber, r.units, r.partial]), [['2250', 5, true], ['2260', 3, false]]);
  assert.deepEqual(s.totals, { units: 8, weight: 240 });
});

test('v3.3: CBEP month-end inventory check and the daily residual log, sorted into 196C categories', () => {
  const mats = [{ id: 1, name: 'CBEP Power Boards', residual196C: 'Circuit Boards' }, { id: 2, name: 'Motherboards', residual196C: 'Circuit Boards' },
    { id: 3, name: 'Steel', category: 'Non-Copper Metals', residual196C: 'Non-Copper Metals' }, { id: 4, name: 'LCD Panels', residual196C: 'Not a CBEP residual' }];
  const check = { kind: 'inventory', date: '2026-10-01', inventory: { program: 'cbep', forMonth: '2026-09', lines: [{ materialId: 1, net: 40 }, { materialId: 2, net: 60 }, { materialId: 3, net: 25 }, { materialId: 4, net: 99 }] } };
  const nonCrt = { kind: 'inventory', date: '2026-09-30', inventory: { forMonth: '2026-09', lines: [{ materialId: 3, net: 500 }] } };
  assert.deepEqual(L.cbepStoredFromChecks([check, nonCrt], mats, '2026-09'), { 'Circuit Boards': 100, 'Non-Copper Metals': 25 });
  assert.equal(L.cbepStoredFromChecks([nonCrt], mats, '2026-09'), null);
  // a CBEP check stays out of the 196B, and shows only in the CBEP period
  const s = L.residualSummary({ year: 2026, month: 9, materials: mats, wcs: [check, nonCrt] });
  assert.equal(JSON.stringify(s).includes('"99"') || JSON.stringify(s).includes(':99'), false);
  assert.equal(L.wcInPeriod(check, { cewType: 'CBEP', year: 2026, month: 9 }), true);
  assert.equal(L.wcInPeriod(check, { cewType: 'NonCRT', year: 2026, month: 9 }), false);
  assert.equal(L.wcInPeriod(nonCrt, { cewType: 'CBEP', year: 2026, month: 9 }), false);
  const d = L.cbepDailyResiduals({ '2026-09-02': [{ materialId: 1, net: 10 }, { materialId: 3, net: 5 }], '2026-09-01': [{ materialId: 2, net: 7 }] }, mats);
  assert.deepEqual(d.rows.map((r) => [r.date, r.total]), [['2026-09-01', 7], ['2026-09-02', 15]]);
  assert.deepEqual(d.totals, { 'Circuit Boards': 17, 'Non-Copper Metals': 5 });
});

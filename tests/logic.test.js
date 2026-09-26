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
    date: '2026-08-01', time: '9:52 AM', make: 'Samsung', model: 'S20A300B', weight: 3,
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
    { id: 2, appliesTo: 'noncew:lcdled', basis: 'lb', dropOff: '0', pickUp: '0' },
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
  assert.deepEqual(drop.rows.map((r) => r.label), ['CEW LCD/LED', 'Non-CEW LCD/LED', 'CEW Plasma', 'Printers']);
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

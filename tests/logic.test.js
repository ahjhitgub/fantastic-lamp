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
  assert.deepEqual(m.form197.nonCrt, { units: 94, weight: 1115 });
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
  assert.match(text, /Lot #2179: 3 units in the cancellation log vs 4 allocated/);
  assert.match(text, /Lot #2179: 15 lbs in the cancellation log vs 20 lbs allocated/);
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

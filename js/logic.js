/**
 * logic.js
 * Every rule and calculation in the app, with no DOM or database access,
 * so it can be tested on its own (see tests/logic.test.js).
 */
(function (L) {
  // ---------- small helpers ----------
  const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(String(v).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  };
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const sameWeight = (a, b) => Math.abs(r2(a) - r2(b)) < 0.005;
  const fmt = (n) => r2(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  L.num = num; L.r2 = r2; L.fmt = fmt; L.sameWeight = sameWeight;

  L.MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  // ---------- months ----------
  L.monthIndex = (y, m) => Number(y) * 12 + (Number(m) - 1);
  L.fromIndex = (i) => ({ year: Math.floor(i / 12), month: (i % 12) + 1 });
  L.monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  L.monthLabel = (y, m) => `${L.MONTHS[m - 1]} ${y}`;
  L.monthLabelFromIndex = (i) => { const d = L.fromIndex(i); return L.monthLabel(d.year, d.month); };
  L.dateMonthIndex = (iso) => {
    const m = /^(\d{4})-(\d{2})/.exec(iso || '');
    return m ? L.monthIndex(+m[1], +m[2]) : null;
  };
  L.lastDayISO = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  function isoDate(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return null;
    return dt.toISOString().slice(0, 10);
  }
  /** Accepts 08/01/2026, 8/1/26, 12.27.24, 2026-08-01. Returns YYYY-MM-DD or null. */
  L.parseDate = (raw) => {
    const s = String(raw ?? '').trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) return isoDate(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return isoDate(y, +m[1], +m[2]); }
    return null;
  };

  // ---------- names and lot numbers ----------
  /** Comparison key: case, spacing and punctuation don't matter; "&" = "and". */
  L.norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  /** "#0715", "715", "715.0" all become "715". */
  L.normLot = (s) => {
    let v = String(s ?? '').trim().replace(/^#\s*/, '').replace(/\.0+$/, '');
    if (/^\d+$/.test(v)) v = String(parseInt(v, 10));
    return v.toUpperCase();
  };

  L.companyIndex = (companies) => {
    const exact = new Map(); const alias = new Map();
    companies.forEach((c) => exact.set(L.norm(c.name), c));
    companies.forEach((c) => (c.aliases || []).forEach((a) => {
      const k = L.norm(a);
      if (k && !exact.has(k) && !alias.has(k)) alias.set(k, c);
    }));
    return { exact, alias };
  };
  /** match: 'exact' (same name ignoring case/punctuation), 'alias' (a saved misspelling), 'none', 'blank'. */
  L.resolveCompany = (text, index) => {
    const k = L.norm(text);
    if (!k) return { match: 'blank', company: null };
    if (index.exact.has(k)) return { match: 'exact', company: index.exact.get(k) };
    if (index.alias.has(k)) return { match: 'alias', company: index.alias.get(k) };
    return { match: 'none', company: null };
  };

  // ---------- transfer lines (IRR → WC) ----------
  L.CRT_PLASMA_NOTE = 'CRT and Plasma Units, will not be kept and instead transferred to another recycler';

  // bucket = which claim-period type the CEW part can be claimed in (null = never claimed here)
  L.CATEGORIES = [
    { key: 'lcdled', label: 'LCD/LED', cew: true, bucket: 'NonCRT', form197: 'nonCrt' },
    { key: 'plasma', label: 'Plasma', cew: true, bucket: null, form197: 'nonCrt' },
    { key: 'crt', label: 'CRT', cew: true, bucket: null, form197: 'crt' },
    { key: 'cbep', label: 'CBEP (battery-embedded)', cew: true, bucket: 'CBEP', form197: 'cbep' },
    { key: 'other', label: 'Other (non-CEW)', cew: false, bucket: null, form197: null },
  ];
  L.category = (key) => L.CATEGORIES.find((c) => c.key === key) || L.CATEGORIES[L.CATEGORIES.length - 1];

  /**
   * One IRR line. CEW units = source logs received; non-CEW weight is typed in;
   * CEW weight and non-CEW units are derived from the IRR totals.
   */
  L.lineMath = (line) => {
    const cat = L.category(line.category);
    const irrUnits = num(line.irrUnits); const irrWeight = r2(num(line.irrWeight));
    if (!cat.cew) {
      return { cat, irrUnits, irrWeight, cewUnits: 0, cewWeight: 0, nonCewUnits: irrUnits, nonCewWeight: irrWeight, problems: [] };
    }
    const cewUnits = num(line.cewUnits);
    const nonCewWeight = r2(num(line.nonCewWeight));
    const nonCewUnits = irrUnits - cewUnits;
    const cewWeight = r2(irrWeight - nonCewWeight);
    const problems = [];
    if (cewUnits > irrUnits) problems.push(`${cat.label}: ${cewUnits} source logs but only ${irrUnits} units on the IRR`);
    if (nonCewWeight > irrWeight) problems.push(`${cat.label}: non-CEW weight (${fmt(nonCewWeight)} lbs) is more than the IRR weight (${fmt(irrWeight)} lbs)`);
    if (nonCewUnits > 0 && nonCewWeight === 0) problems.push(`${cat.label}: ${nonCewUnits} non-CEW units but no non-CEW weight entered`);
    if (nonCewUnits === 0 && nonCewWeight > 0) problems.push(`${cat.label}: non-CEW weight entered, but every unit has a source log`);
    return { cat, irrUnits, irrWeight, cewUnits, cewWeight, nonCewUnits, nonCewWeight, problems };
  };

  L.transferMath = (transfer) => {
    const lines = ((transfer && transfer.lines) || []).map(L.lineMath);
    const sum = (pred) => lines.filter(pred).reduce(
      (a, l) => ({ units: a.units + l.cewUnits, weight: r2(a.weight + l.cewWeight) }), { units: 0, weight: 0 });
    const excluded = sum((l) => l.cat.cew && !l.cat.bucket);
    return {
      lines,
      claimable: { NonCRT: sum((l) => l.cat.bucket === 'NonCRT'), CBEP: sum((l) => l.cat.bucket === 'CBEP') },
      form197: {
        crt: sum((l) => l.cat.form197 === 'crt'),
        nonCrt: sum((l) => l.cat.form197 === 'nonCrt'),
        cbep: sum((l) => l.cat.form197 === 'cbep'),
      },
      excluded,
      hasCrtOrPlasma: excluded.units > 0 || excluded.weight > 0,
      irr: lines.reduce((a, l) => ({ units: a.units + l.irrUnits, weight: r2(a.weight + l.irrWeight) }), { units: 0, weight: 0 }),
      nonCew: lines.reduce((a, l) => ({ units: a.units + l.nonCewUnits, weight: r2(a.weight + l.nonCewWeight) }), { units: 0, weight: 0 }),
      problems: lines.flatMap((l) => l.problems),
    };
  };

  // ---------- allocations (which claim period a transfer is cancelled in) ----------
  L.sumAllocs = (allocs) => allocs.reduce(
    (a, x) => ({ units: a.units + num(x.units), weight: r2(a.weight + num(x.weight)) }), { units: 0, weight: 0 });

  L.allocationStatus = (claim, allocs) => {
    const a = L.sumAllocs(allocs);
    if (a.units === 0 && a.weight === 0) return 'Not allocated';
    if (a.units > claim.units || a.weight > claim.weight + 0.005) return 'Over-allocated';
    if (a.units === claim.units && sameWeight(a.weight, claim.weight)) return 'Fully allocated';
    return 'Partially allocated';
  };

  /**
   * Rules that stop double dipping:
   *  - both units and weight required; never more than the transfer's claimable total
   *  - at most two claim periods per transfer, and if two, back-to-back months
   *  - never claimed in a month before the transfer was received
   *  - one allocation per period (edit it instead of adding a second)
   * `allocations` = every allocation for this WC. `editingId` = the one being edited, if any.
   */
  L.validateAllocation = ({ wc, math, period, units, weight, allocations, periods, editingId }) => {
    const bucket = period.cewType;
    if (bucket !== 'NonCRT' && bucket !== 'CBEP') {
      return ['Only Non-CRT and CBEP claim periods can receive allocations — CRT and plasma units go to other recyclers.'];
    }
    const errors = [];
    const claim = math.claimable[bucket];
    const kind = bucket === 'NonCRT' ? 'CEW LCD/LED' : 'CBEP';
    if (!(claim.units > 0)) errors.push(`This transfer has no claimable ${kind} units yet — enter the source-log count first.`);
    units = num(units); weight = r2(num(weight));
    if (units < 0 || weight < 0) errors.push("Units and weight can't be negative.");
    else if (!(units > 0) || !(weight > 0)) errors.push('Enter both the units and the weight being claimed.');

    const periodById = new Map(periods.map((p) => [p.id, p]));
    const others = allocations.filter((a) => a.id !== editingId && (periodById.get(a.claimPeriodId) || {}).cewType === bucket);
    if (others.some((a) => a.claimPeriodId === period.id)) errors.push('This transfer is already allocated to that period — edit that allocation instead.');
    if (others.length >= 2) errors.push('A transfer can be split across at most two claim periods.');

    const pIdx = L.monthIndex(period.year, period.month);
    const rIdx = L.dateMonthIndex(wc.date);
    if (rIdx !== null && pIdx < rIdx) {
      errors.push(`Can't claim it in ${L.monthLabel(period.year, period.month)} — it wasn't received until ${L.monthLabelFromIndex(rIdx)}.`);
    }
    if (others.length === 1) {
      const op = periodById.get(others[0].claimPeriodId);
      if (op && Math.abs(L.monthIndex(op.year, op.month) - pIdx) !== 1) {
        errors.push(`A split has to land in back-to-back months — the other part is claimed in ${L.monthLabel(op.year, op.month)}.`);
      }
    }
    const used = L.sumAllocs(others);
    if (used.units + units > claim.units) {
      errors.push(`That makes ${used.units + units} units, but only ${claim.units} are claimable (${used.units} already allocated).`);
    }
    if (used.weight + weight > claim.weight + 0.005) {
      errors.push(`That makes ${fmt(used.weight + weight)} lbs, but only ${fmt(claim.weight)} lbs are claimable (${fmt(used.weight)} already allocated).`);
    }
    return errors;
  };

  // ---------- cancellation log import ----------
  const COLS = {
    date: /^date/, time: /^time/, make: /^(make|manufacturer|brand|mfr)/, model: /^model/,
    weight: /^(weight|wt|lbs?\b|pounds)/, lotNumber: /^lot/, company: /^(company|customer|handler|client)/, boxNumber: /^box/,
  };
  const DEFAULT_ORDER = ['date', 'time', 'make', 'model', 'weight', 'lotNumber', 'company', 'boxNumber'];

  /** Tab-separated (pasted from Excel) or comma-separated. A header row is optional. */
  L.parseCancellationLog = (text) => {
    let order = DEFAULT_ORDER; let usedHeader = false;
    const rows = []; const skipped = [];
    String(text || '').split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim());
      const lower = cells.map((c) => c.toLowerCase());
      if (lower.some((c) => /^lot/.test(c)) && lower.some((c) => /^date/.test(c))) {
        order = lower.map((c) => Object.keys(COLS).find((k) => COLS[k].test(c)) || null);
        usedHeader = true;
        return;
      }
      const rec = {};
      order.forEach((k, idx) => { if (k) rec[k] = cells[idx] ?? ''; });
      const date = L.parseDate(rec.date);
      if (!date) { skipped.push({ line: i + 1, reason: `unreadable date "${rec.date ?? ''}"` }); return; }
      const row = {
        date,
        time: rec.time || '',
        make: rec.make || '',
        model: rec.model || '',
        weight: r2(num(rec.weight)),
        lotNumber: L.normLot(rec.lotNumber),
        company: String(rec.company || '').replace(/\s+/g, ' ').trim(),
        boxNumber: String(rec.boxNumber || '').trim(),
      };
      row.original = { lotNumber: row.lotNumber, company: row.company, boxNumber: row.boxNumber };
      rows.push(row);
    });
    return { rows, skipped, usedHeader };
  };

  L.unitWasEdited = (u) => !!u.original && (
    L.normLot(u.original.lotNumber) !== L.normLot(u.lotNumber)
    || (u.original.company || '') !== (u.company || '')
    || String(u.original.boxNumber || '') !== String(u.boxNumber || ''));

  // ---------- audit ----------
  /**
   * Compares one claim period's cancellation log against the WCs allocated to it.
   * Not checked, on purpose: time, make, model, box #.
   */
  L.reconcile = ({ period, units, allUnits, wcs, allocations, periods, companies }) => {
    const bucket = period.cewType;
    const issues = [];
    const add = (severity, lot, message) => issues.push({ severity, lot, message });
    const periodById = new Map(periods.map((p) => [p.id, p]));
    const wcByLot = new Map();
    wcs.forEach((w) => { const k = L.normLot(w.wcNumber); if (k) wcByLot.set(k, w); });
    const index = L.companyIndex(companies);
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const pIdx = L.monthIndex(period.year, period.month);
    const here = L.monthLabel(period.year, period.month);
    const sumW = (list) => r2(list.reduce((s, u) => s + num(u.weight), 0));

    const groups = new Map();
    units.forEach((u) => {
      const k = L.normLot(u.lotNumber);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(u);
    });
    const allocHere = allocations.filter((a) => a.claimPeriodId === period.id);
    const lots = [];

    for (const [lot, list] of groups) {
      const n = list.length; const w = sumW(list);
      const tag = lot ? `Lot #${lot}` : 'No lot #';

      const noWeight = list.filter((u) => !(num(u.weight) > 0)).length;
      if (noWeight) add('error', lot, `${tag}: ${noWeight} unit(s) have no weight.`);
      const outside = list.filter((u) => L.dateMonthIndex(u.date) !== pIdx).length;
      if (outside) add('warning', lot, `${tag}: ${outside} unit(s) are dated outside ${here}.`);
      const edited = list.filter(L.unitWasEdited).length;
      if (edited) add('info', lot, `${tag}: ${edited} unit(s) were corrected after import (lot, company, or box).`);

      const wc = lot ? wcByLot.get(lot) : null;
      const t = (wc && wc.transfer) || {};
      const okIds = [t.handlerId, t.collectorId].filter(Boolean);

      // company names — grouped so 90 identical rows make one line
      const byText = new Map();
      list.forEach((u) => { const k = (u.company || '').trim(); byText.set(k, (byText.get(k) || 0) + 1); });
      for (const [text, cnt] of byText) {
        const r = L.resolveCompany(text, index);
        if (r.match === 'blank') add('warning', lot, `${tag}: ${cnt} unit(s) have no company.`);
        else if (r.match === 'none') add('warning', lot, `${tag}: "${text}" (${cnt} unit${cnt > 1 ? 's' : ''}) doesn't match any company on file.`);
        else {
          if (r.match === 'alias') add('warning', lot, `${tag}: "${text}" (${cnt} unit${cnt > 1 ? 's' : ''}) is a misspelling of ${r.company.name}.`);
          if (okIds.length && !okIds.includes(r.company.id)) {
            const expected = companyById.get(t.handlerId || t.collectorId);
            add('error', lot, `${tag}: log says ${r.company.name} (${cnt} unit${cnt > 1 ? 's' : ''}), but WC #${wc.wcNumber} is from ${expected ? expected.name : 'another company'}.`);
          }
        }
      }

      const row = { lot, wcId: wc ? wc.id : null, units: n, weight: w, allocUnits: null, allocWeight: null, status: '' };
      lots.push(row);
      if (!lot) { add('error', lot, `${n} unit(s) (${fmt(w)} lbs) have no lot #.`); row.status = 'No lot #'; continue; }
      if (!wc) { add('error', lot, `${tag}: there's no WC #${lot} on file (${n} units, ${fmt(w)} lbs).`); row.status = 'No matching WC'; continue; }
      if (wc.kind !== 'transfer') { add('error', lot, `${tag}: WC #${wc.wcNumber} isn't a transfer.`); row.status = 'Not a transfer'; continue; }

      const math = L.transferMath(t);
      math.problems.forEach((p) => add('warning', lot, `WC #${wc.wcNumber}: ${p}.`));
      const mine = allocHere.filter((a) => a.wcId === wc.id);
      if (!mine.length) {
        add('error', lot, `${tag}: ${n} units / ${fmt(w)} lbs were cancelled in ${here}, but WC #${wc.wcNumber} isn't allocated to this claim period.`);
        row.status = 'Not allocated here';
      } else {
        const a = L.sumAllocs(mine);
        row.allocUnits = a.units; row.allocWeight = a.weight;
        const du = n - a.units; const dw = r2(w - a.weight);
        if (du !== 0) add('error', lot, `${tag}: ${n} units in the cancellation log vs ${a.units} allocated from WC #${wc.wcNumber} (${du > 0 ? '+' : ''}${du}).`);
        if (!sameWeight(w, a.weight)) add('error', lot, `${tag}: ${fmt(w)} lbs in the cancellation log vs ${fmt(a.weight)} lbs allocated from WC #${wc.wcNumber} (${dw > 0 ? '+' : ''}${fmt(dw)} lbs).`);
        row.status = du === 0 && sameWeight(w, a.weight) ? 'Matches' : 'Mismatch';
      }

      // double dipping: this lot across every period of the same type
      const claim = math.claimable[bucket] || { units: 0, weight: 0 };
      const everywhere = allUnits.filter((u) => L.normLot(u.lotNumber) === lot
        && (periodById.get(u.claimPeriodId) || {}).cewType === bucket);
      const ew = sumW(everywhere);
      if (everywhere.length > claim.units) add('error', lot, `${tag}: ${everywhere.length} units cancelled across all claim periods, but WC #${wc.wcNumber} only has ${claim.units} claimable units.`);
      if (ew > claim.weight + 0.005) add('error', lot, `${tag}: ${fmt(ew)} lbs cancelled across all claim periods, but WC #${wc.wcNumber} only has ${fmt(claim.weight)} claimable lbs.`);
      const allMine = allocations.filter((x) => x.wcId === wc.id && (periodById.get(x.claimPeriodId) || {}).cewType === bucket);
      if (L.allocationStatus(claim, allMine) === 'Over-allocated') add('error', lot, `WC #${wc.wcNumber} is allocated beyond its claimable amount.`);
    }

    for (const a of allocHere) {
      const wc = wcs.find((x) => x.id === a.wcId);
      if (!wc) continue;
      const k = L.normLot(wc.wcNumber);
      if (!groups.has(k)) {
        add('error', k, `WC #${wc.wcNumber}: ${num(a.units)} units / ${fmt(a.weight)} lbs are allocated to ${here}, but no cancelled units carry lot #${wc.wcNumber}.`);
        lots.push({ lot: k, wcId: wc.id, units: 0, weight: 0, allocUnits: num(a.units), allocWeight: r2(num(a.weight)), status: 'No units logged' });
      }
    }

    const rank = { error: 0, warning: 1, info: 2 };
    const lotSort = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
    issues.sort((a, b) => (rank[a.severity] - rank[b.severity]) || lotSort(a.lot, b.lot));
    lots.sort((a, b) => lotSort(a.lot, b.lot));
    const alloc = L.sumAllocs(allocHere);
    return {
      issues,
      lots,
      totals: { units: units.length, weight: sumW(units), allocUnits: alloc.units, allocWeight: alloc.weight },
    };
  };

  // ---------- residuals ----------
  L.RESIDUAL_CATEGORIES = [
    'Plastic', 'Copper', 'Non-Copper Metals', 'LCD Bare Panels', 'Circuit Boards',
    'All Battery Chemistries', 'Glass', 'Fibers', 'Other',
    'LCD Lamps (§IV)', 'Bare Plasma Panels (§IV)', 'Not a CEW residual',
  ];
  L.FORM_V_CATEGORIES = ['Plastic', 'Copper', 'Non-Copper Metals', 'LCD Bare Panels', 'Circuit Boards', 'Other'];

  L.lineNet = (l) => (l.net !== '' && l.net !== undefined && l.net !== null ? r2(num(l.net)) : r2(num(l.gross) - num(l.tare)));
  L.inventoryMonthKey = (wc) => (wc.inventory && wc.inventory.forMonth) || String(wc.date || '').slice(0, 7);

  /**
   * generated = shipped this month + end-of-month inventory − last month's end-of-month inventory
   * stored (this month's share) = min(end inventory, generated) — oldest material ships first
   * 196B "shipped" = generated − stored; 196B "total" = generated
   */
  L.residualSummary = ({ year, month, materials, wcs }) => {
    const key = L.monthKey(year, month);
    const pv = L.fromIndex(L.monthIndex(year, month) - 1);
    const prevKey = L.monthKey(pv.year, pv.month);
    const inventory = (k) => {
      const map = new Map(); const docs = wcs.filter((w) => w.kind === 'inventory' && L.inventoryMonthKey(w) === k);
      docs.forEach((w) => ((w.inventory && w.inventory.lines) || []).forEach((l) => {
        if (l.materialId != null) map.set(l.materialId, r2((map.get(l.materialId) || 0) + L.lineNet(l)));
      }));
      return { map, docs };
    };
    const end = inventory(key); const start = inventory(prevKey);
    const shipments = wcs.filter((w) => w.kind === 'shipment' && String(w.date || '').slice(0, 7) === key);
    const shipped = new Map();
    shipments.forEach((w) => ((w.shipment && w.shipment.lines) || []).forEach((l) => {
      if (l.materialId != null) shipped.set(l.materialId, r2((shipped.get(l.materialId) || 0) + L.lineNet(l)));
    }));

    const rows = materials.filter((m) => m.category !== 'Not a CEW residual').map((m) => {
      const prevStored = start.map.get(m.id) || 0; const s = shipped.get(m.id) || 0; const endStored = end.map.get(m.id) || 0;
      const generated = r2(s + endStored - prevStored);
      const monthlyStored = r2(Math.min(endStored, Math.max(generated, 0)));
      return { material: m, prevStored, shipped: s, endStored, generated, monthlyStored };
    });

    const categories = {};
    rows.forEach((r) => {
      const c = r.material.category;
      categories[c] = categories[c] || { generated: 0, stored: 0, shipped: 0 };
      categories[c].generated = r2(categories[c].generated + r.generated);
      categories[c].stored = r2(categories[c].stored + r.monthlyStored);
    });
    Object.values(categories).forEach((c) => { c.shipped = r2(c.generated - c.stored); });

    const warnings = [];
    if (!end.docs.length) warnings.push(`No end-of-month inventory recorded for ${L.monthLabel(year, month)} — generated weights can't be trusted until it is.`);
    if (!start.docs.length) warnings.push(`No end-of-month inventory recorded for ${L.monthLabel(pv.year, pv.month)} — last month's stored weight is being counted as 0.`);
    rows.filter((r) => r.generated < 0).forEach((r) => warnings.push(
      `${r.material.name}: generated comes out to ${fmt(r.generated)} lbs — a shipment or inventory weight is probably recorded under a different material.`));

    return { key, prevKey, rows, categories, warnings, shipments, endDocs: end.docs, startDocs: start.docs };
  };
})(typeof window !== 'undefined' ? ((window.App = window.App || {}), (window.App.Logic = {})) : module.exports);

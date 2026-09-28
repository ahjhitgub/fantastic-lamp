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
  /** "4SXT911, 8ABC123" → ['4SXT911', '8ABC123'] */
  L.splitPlates = (text) => String(text || '').split(/[,;\n]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

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
    const claimable = { NonCRT: sum((l) => l.cat.bucket === 'NonCRT'), CBEP: sum((l) => l.cat.bucket === 'CBEP') };
    return {
      lines,
      claimable,
      // The 197 lists only what we keep and cancel: CEW LCD/LED (and CBEP). CRT and plasma
      // go to another recycler, so they're left off and noted in the collector activity instead.
      form197: { crt: { units: 0, weight: 0 }, nonCrt: claimable.NonCRT, cbep: claimable.CBEP },
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
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
  const plural = (n, one, many) => `${fmt(n)} ${Math.abs(n) === 1 ? one : many}`;
  const shortOver = (d, one, many) => (d > 0 ? `over by ${plural(d, one, many)}` : `short ${plural(-d, one, many)}`);
  L.signed = signed;

  /**
   * Compares one claim period's cancellation log against the WCs allocated to it.
   * Not checked, on purpose: time, make, model, box #.
   * Each lot row carries `math` — the numbers behind every discrepancy.
   */
  L.reconcile = ({ period, units, allUnits, wcs, allocations, periods, companies }) => {
    const bucket = period.cewType;
    const issues = [];
    const add = (severity, lot, message) => issues.push({ severity, lot, message });
    const periodById = new Map(periods.map((p) => [p.id, p]));
    const plabel = (id) => { const p = periodById.get(id); return p ? L.monthLabel(p.year, p.month) : '?'; };
    const pindex = (id) => { const p = periodById.get(id); return p ? L.monthIndex(p.year, p.month) : 0; };
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

    /** Breakdown for one transfer WC: where the claimable number comes from, where it's allocated, where it's logged. */
    function mathFor(wc, loggedHere) {
      const tm = L.transferMath(wc.transfer);
      const bl = tm.lines.filter((l) => l.cat.bucket === bucket);
      const irr = bl.reduce((a, l) => ({ units: a.units + l.irrUnits, weight: r2(a.weight + l.irrWeight) }), { units: 0, weight: 0 });
      const nonCew = bl.reduce((a, l) => ({ units: a.units + l.nonCewUnits, weight: r2(a.weight + l.nonCewWeight) }), { units: 0, weight: 0 });
      const claim = tm.claimable[bucket] || { units: 0, weight: 0 };
      const mine = allocations.filter((x) => x.wcId === wc.id && (periodById.get(x.claimPeriodId) || {}).cewType === bucket)
        .sort((x, y) => pindex(x.claimPeriodId) - pindex(y.claimPeriodId));
      const allocs = mine.map((x) => ({ label: plabel(x.claimPeriodId), units: num(x.units), weight: r2(num(x.weight)), here: x.claimPeriodId === period.id }));
      const lot = L.normLot(wc.wcNumber);
      const byPeriod = new Map();
      allUnits.filter((u) => L.normLot(u.lotNumber) === lot && (periodById.get(u.claimPeriodId) || {}).cewType === bucket).forEach((u) => {
        const cur = byPeriod.get(u.claimPeriodId) || { units: 0, weight: 0 };
        cur.units += 1; cur.weight = r2(cur.weight + num(u.weight));
        byPeriod.set(u.claimPeriodId, cur);
      });
      if (!byPeriod.has(period.id) && loggedHere.units) byPeriod.set(period.id, loggedHere);
      const logged = [...byPeriod].sort((x, y) => pindex(x[0]) - pindex(y[0]))
        .map(([id, v]) => ({ label: plabel(id), units: v.units, weight: v.weight, here: id === period.id }));
      const allocHereSum = L.sumAllocs(mine.filter((x) => x.claimPeriodId === period.id));
      const loggedAll = logged.reduce((a, x) => ({ units: a.units + x.units, weight: r2(a.weight + x.weight) }), { units: 0, weight: 0 });
      const allocAll = L.sumAllocs(mine);
      return {
        wcNumber: wc.wcNumber, tm, irr, nonCew, claim, allocs, logged,
        thisPeriod: { logged: loggedHere, allocated: mine.some((x) => x.claimPeriodId === period.id) ? allocHereSum : null,
          diffUnits: loggedHere.units - allocHereSum.units, diffWeight: r2(loggedHere.weight - allocHereSum.weight) },
        allPeriods: { logged: loggedAll, allocated: allocAll, claim,
          overUnits: loggedAll.units - claim.units, overWeight: r2(loggedAll.weight - claim.weight) },
      };
    }

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

      const row = { lot, wcId: wc ? wc.id : null, units: n, weight: w, allocUnits: null, allocWeight: null, diffUnits: null, diffWeight: null, status: '', math: null };
      lots.push(row);
      if (!lot) { add('error', lot, `${n} unit(s) (${fmt(w)} lbs) have no lot #.`); row.status = 'No lot #'; continue; }
      if (!wc) { add('error', lot, `${tag}: there's no WC #${lot} on file (${n} units, ${fmt(w)} lbs).`); row.status = 'No matching WC'; continue; }
      if (wc.kind !== 'transfer') { add('error', lot, `${tag}: WC #${wc.wcNumber} isn't a transfer.`); row.status = 'Not a transfer'; continue; }

      const m = mathFor(wc, { units: n, weight: w });
      row.math = m;
      m.tm.problems.forEach((p) => add('warning', lot, `WC #${wc.wcNumber}: ${p}.`));
      if (!m.thisPeriod.allocated) {
        const elsewhere = m.allocs.length ? ` It's allocated to ${m.allocs.map((x) => `${x.label} (${plural(x.units, 'unit', 'units')} / ${fmt(x.weight)} lbs)`).join(' and ')}.` : ' It isn\u2019t allocated to any claim period yet.';
        add('error', lot, `${tag}: ${plural(n, 'unit', 'units')} / ${fmt(w)} lbs logged in ${here}, but WC #${wc.wcNumber} isn't allocated to this claim period.${elsewhere}`);
        row.status = 'Not allocated here';
      } else {
        const a = m.thisPeriod.allocated;
        row.allocUnits = a.units; row.allocWeight = a.weight;
        row.diffUnits = m.thisPeriod.diffUnits; row.diffWeight = m.thisPeriod.diffWeight;
        if (row.diffUnits !== 0) add('error', lot, `${tag}: ${shortOver(row.diffUnits, 'unit', 'units')} — cancellation log ${fmt(n)} − allocated from WC #${wc.wcNumber} ${fmt(a.units)} = ${signed(row.diffUnits)}.`);
        if (!sameWeight(w, a.weight)) add('error', lot, `${tag}: ${shortOver(row.diffWeight, 'lb', 'lbs')} — cancellation log ${fmt(w)} lbs − allocated from WC #${wc.wcNumber} ${fmt(a.weight)} lbs = ${signed(row.diffWeight)} lbs.`);
        row.status = row.diffUnits === 0 && sameWeight(w, a.weight) ? 'Matches' : 'Mismatch';
      }

      const ap = m.allPeriods;
      const parts = (key) => m.logged.map((x) => `${fmt(x[key])} (${x.label})`).join(' + ');
      if (ap.overUnits > 0) add('error', lot, `${tag}: over by ${plural(ap.overUnits, 'unit', 'units')} across all claim periods — logged ${parts('units')} = ${fmt(ap.logged.units)}, but WC #${wc.wcNumber} has only ${fmt(ap.claim.units)} claimable.`);
      if (ap.overWeight > 0.005) add('error', lot, `${tag}: over by ${fmt(ap.overWeight)} lbs across all claim periods — logged ${parts('weight')} = ${fmt(ap.logged.weight)} lbs, but WC #${wc.wcNumber} has only ${fmt(ap.claim.weight)} claimable lbs.`);
      if (ap.allocated.units > ap.claim.units || ap.allocated.weight > ap.claim.weight + 0.005) {
        add('error', lot, `WC #${wc.wcNumber} is allocated beyond its claimable amount — allocated ${fmt(ap.allocated.units)} units / ${fmt(ap.allocated.weight)} lbs vs ${fmt(ap.claim.units)} / ${fmt(ap.claim.weight)} claimable.`);
      }
    }

    for (const a of allocHere) {
      const wc = wcs.find((x) => x.id === a.wcId);
      if (!wc) continue;
      const k = L.normLot(wc.wcNumber);
      if (!groups.has(k)) {
        const au = num(a.units); const aw = r2(num(a.weight));
        add('error', k, `WC #${wc.wcNumber}: short ${plural(au, 'unit', 'units')} / ${fmt(aw)} lbs — ${fmt(au)} units / ${fmt(aw)} lbs allocated to ${here}, but 0 logged with lot #${wc.wcNumber} (0 − ${fmt(au)} = ${signed(-au)}; 0 − ${fmt(aw)} = ${signed(-aw)} lbs).`);
        lots.push({ lot: k, wcId: wc.id, units: 0, weight: 0, allocUnits: au, allocWeight: aw, diffUnits: -au, diffWeight: -aw,
          status: 'No units logged', math: wc.kind === 'transfer' ? mathFor(wc, { units: 0, weight: 0 }) : null });
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
      totals: { units: units.length, weight: sumW(units), allocUnits: alloc.units, allocWeight: alloc.weight,
        diffUnits: units.length - alloc.units, diffWeight: r2(sumW(units) - alloc.weight) },
    };
  };

  // ---------- WC and IRR numbers ----------
  /** One past the highest number in the list, keeping any prefix/zero-padding; skips numbers already used. */
  L.nextNumber = (entries) => {
    let best = null;
    entries.forEach(({ id, value }) => {
      const m = /^(.*?)(\d+)$/.exec(String(value || '').trim());
      if (!m) return;
      const n = parseInt(m[2], 10);
      if (!best || n > best.n || (n === best.n && (id || 0) > (best.id || 0))) best = { prefix: m[1], n, width: m[2].length, id };
    });
    if (!best) return '';
    const taken = new Set(entries.map((e) => L.normLot(e.value)));
    let n = best.n + 1; let candidate;
    do { candidate = best.prefix + String(n).padStart(best.width, '0'); n += 1; } while (taken.has(L.normLot(candidate)));
    return candidate;
  };
  /**
   * Numbers skipped inside a run (e.g. WC #s 2276–2349 with 2300 missing). Only plain numbers count; `skipped`
   * are numbers marked as skipped on purpose. A spread over 5,000 is almost certainly a typo, so it's reported
   * as `tooWide` instead of listing thousands of numbers.
   */
  L.numberGaps = (values, skipped = []) => {
    const nums = [...new Set(values.map((v) => String(v ?? '').trim()).filter((v) => /^\d+$/.test(v)).map(Number))].sort((a, b) => a - b);
    if (nums.length < 2) return { missing: [], min: nums[0] ?? null, max: nums[0] ?? null };
    const min = nums[0]; const max = nums[nums.length - 1];
    if (max - min > 5000) return { missing: [], min, max, tooWide: true };
    const have = new Set(nums); const skip = new Set(skipped.map((x) => Number(L.normLot(x))));
    const missing = [];
    for (let n = min + 1; n < max; n += 1) if (!have.has(n) && !skip.has(n)) missing.push(String(n));
    return { missing, min, max };
  };
  L.wcNumberGaps = (wcs, skipped = []) => L.numberGaps(wcs.filter((w) => !w.noWc).map((w) => w.wcNumber), skipped);
  L.irrNumberGaps = (wcs, skipped = []) => L.numberGaps(wcs.filter((w) => w.kind === 'transfer').map((w) => w.transfer && w.transfer.irrNumber), skipped);

  L.nextWcNumber = (wcs) => L.nextNumber(wcs.map((w) => ({ id: w.id, value: w.wcNumber })));
  /** IRR #s are their own sequence, on transfer WCs only. */
  L.nextIrrNumber = (wcs) => L.nextNumber(wcs.filter((w) => w.kind === 'transfer').map((w) => ({ id: w.id, value: w.transfer && w.transfer.irrNumber })));

  /** 2026-08-07 → 08.07.2026 (the style used on weight certificates) */
  L.dotDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[2]}.${m[3]}.${m[1]}` : (iso || ''); };
  /** 2026-09-26 → 9/26/26 (the style used on purchase invoices) */
  L.slashDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${+m[2]}/${+m[3]}/${m[1].slice(2)}` : (iso || ''); };
  /** 2026-07-01 → 7.1.26 (the style used on the IRR) */
  L.shortDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${+m[2]}.${+m[3]}.${m[1].slice(2)}` : (iso || ''); };

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
    let nonCewShipped = 0;
    shipments.forEach((w) => ((w.shipment && w.shipment.lines) || []).forEach((l) => {
      // only CEW material counts toward residuals; lines marked non-CEW are shipped but not counted
      if (l.cew === false) { nonCewShipped = r2(nonCewShipped + L.lineNet(l)); return; }
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

    return { key, prevKey, rows, categories, warnings, shipments, nonCewShipped, endDocs: end.docs, startDocs: start.docs };
  };

  /**
   * Oldest storage ships first. For every residual shipment, how much of each material came out of
   * earlier months' storage (and which month), and how much was generated in the shipment's own month.
   * Also the storage left at the end of each month, split by the month it was generated.
   */
  L.residualFifo = ({ materials, wcs }) => {
    const mats = materials.filter((m) => m.category && m.category !== 'Not a CEW residual');
    const byId = new Map(mats.map((m) => [m.id, m]));
    const inv = new Map();
    wcs.filter((w) => w.kind === 'inventory').forEach((w) => {
      const idx = L.dateMonthIndex(`${L.inventoryMonthKey(w)}-01`);
      if (idx === null) return;
      const e = inv.get(idx) || { map: new Map(), general: false, wc: false };
      if (w.noWc) e.general = true; else e.wc = true;
      ((w.inventory && w.inventory.lines) || []).forEach((l) => { if (l.materialId != null) e.map.set(l.materialId, r2((e.map.get(l.materialId) || 0) + L.lineNet(l))); });
      inv.set(idx, e);
    });
    const ships = [];
    wcs.filter((w) => w.kind === 'shipment').forEach((w) => {
      const idx = L.dateMonthIndex(w.date);
      if (idx === null) return;
      const per = new Map();
      ((w.shipment && w.shipment.lines) || []).forEach((l) => {
        if (l.cew === false || l.materialId == null || !byId.has(l.materialId)) return;
        per.set(l.materialId, r2((per.get(l.materialId) || 0) + L.lineNet(l)));
      });
      let order = 0;
      per.forEach((lbs, materialId) => { ships.push({ wc: w, idx, materialId, lbs, order }); order += 1; });
    });
    ships.sort((x, y) => String(x.wc.date).localeCompare(String(y.wc.date)) || (x.wc.id || 0) - (y.wc.id || 0));
    const notes = new Map(); const storage = new Map();
    const idxs = [...inv.keys(), ...ships.map((x) => x.idx)];
    if (!idxs.length) return { notes, storage };
    const lo = Math.min(...idxs); const hi = Math.max(...idxs);
    mats.forEach((m) => {
      let layers = null; // null = nothing known yet (before the first end-of-month inventory)
      for (let idx = lo; idx <= hi; idx += 1) {
        ships.filter((x) => x.idx === idx && x.materialId === m.id).forEach((x) => {
          let need = x.lbs; const from = [];
          (layers || []).forEach((layer) => {
            if (need <= 0.005) return;
            const take = r2(Math.min(layer.lbs, need));
            if (take > 0) { from.push({ idx: layer.idx, lbs: take }); layer.lbs = r2(layer.lbs - take); need = r2(need - take); }
          });
          if (layers) layers = layers.filter((y) => y.lbs > 0.005);
          if (!notes.has(x.wc.id)) notes.set(x.wc.id, []);
          notes.get(x.wc.id).push({ materialId: m.id, name: m.name, total: x.lbs, fromStorage: from, fromMonth: Math.max(need, 0), monthIdx: idx, order: x.order });
        });
        const e = inv.get(idx);
        if (e && (m.ownWc ? e.wc : (e.general || e.wc))) {
          const end = e.map.get(m.id) || 0;
          layers = layers || [];
          const older = r2(layers.reduce((s2, y) => s2 + y.lbs, 0));
          if (end >= older) {
            if (end - older > 0.005) layers.push({ idx, lbs: r2(end - older) });
          } else {
            // less on hand than older storage accounts for: the oldest is treated as gone first
            let extra = r2(older - end);
            layers.forEach((y) => { const t = Math.min(y.lbs, extra); y.lbs = r2(y.lbs - t); extra = r2(extra - t); });
            layers = layers.filter((y) => y.lbs > 0.005);
          }
          if (!storage.has(idx)) storage.set(idx, new Map());
          storage.get(idx).set(m.id, layers.map((y) => ({ ...y })));
        }
      }
    });
    notes.forEach((list) => list.sort((a, b) => a.order - b.order));
    return { notes, storage };
  };

  const joinList = (xs) => (xs.length < 2 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`);
  /** The single line printed under a shipment WC: "230 lbs of Circuit Boards and 743 lbs of Power Boards shipped from July 2026's storage." */
  L.storageSentence = (notes) => {
    const byMonth = new Map();
    (notes || []).forEach((n) => n.fromStorage.forEach((f) => {
      if (!byMonth.has(f.idx)) byMonth.set(f.idx, []);
      byMonth.get(f.idx).push(`${fmt(f.lbs)} lbs of ${n.name}`);
    }));
    const parts = [...byMonth.keys()].sort((x, y) => x - y).map((idx) => `${joinList(byMonth.get(idx))} shipped from ${L.monthLabelFromIndex(idx)}'s storage`);
    return parts.length ? `${parts.join('; ')}.` : '';
  };

  /** "1,000 lbs of ABS Plastic shipped were from January 2026's storage; the other 500 lbs were generated in February 2026." */
  L.storageNoteText = (n) => {
    const ml = (i) => `${L.monthLabelFromIndex(i)}'s storage`;
    if (!n.fromStorage.length) return `All ${fmt(n.total)} lbs of ${n.name} shipped were generated in ${L.monthLabelFromIndex(n.monthIdx)}.`;
    if (n.fromMonth <= 0.005 && n.fromStorage.length === 1) return `All ${fmt(n.total)} lbs of ${n.name} shipped were from ${ml(n.fromStorage[0].idx)}.`;
    const parts = n.fromStorage.map((f, i) => (i === 0 ? `${fmt(f.lbs)} lbs of ${n.name} shipped were from ${ml(f.idx)}` : `${fmt(f.lbs)} lbs from ${ml(f.idx)}`));
    const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    return `${joined}${n.fromMonth > 0.005 ? `; the other ${fmt(n.fromMonth)} lbs were generated in ${L.monthLabelFromIndex(n.monthIdx)}` : ''}.`;
  };

  /** Net weight and number of weighings per material. */
  L.netByMaterial = (lines) => {
    const m = new Map();
    (lines || []).forEach((l) => {
      if (l.materialId == null) return;
      const cur = m.get(l.materialId) || { count: 0, net: 0 };
      cur.count += 1; cur.net = r2(cur.net + L.lineNet(l));
      m.set(l.materialId, cur);
    });
    return m;
  };

  /**
   * Materials marked "own WC" (LCD lamps) must be on a weight certificate, with nothing else on it.
   * Everything else can be on a general entry with no WC.
   */
  L.inventoryRuleErrors = ({ wc, materials }) => {
    const byId = new Map(materials.map((m) => [m.id, m]));
    const used = [...new Set(((wc.inventory && wc.inventory.lines) || [])
      .filter((l) => l.materialId != null && (L.lineNet(l) || num(l.gross)))
      .map((l) => byId.get(l.materialId)).filter(Boolean))];
    const own = used.filter((m) => m.ownWc);
    if (!own.length) return [];
    const names = own.map((m) => m.name).join(' and ');
    const errors = [];
    if (wc.noWc) errors.push(`${names} need their own weight certificate — make this entry a WC, or move them to a separate WC.`);
    const others = used.filter((m) => !m.ownWc).map((m) => m.name);
    if (!wc.noWc && others.length) errors.push(`${names} have to be alone on their WC — move ${others.join(', ')} to a different entry.`);
    return errors;
  };
  // ---------- CRT / plasma sent to other recyclers ----------
  L.CRT_PLASMA = ['crt', 'plasma'];
  /** CRT/plasma lines on an outgoing record (CRT/plasma shipments; older residual shipments may carry some too). */
  L.crtLines = (w) => (w.kind === 'crtShipment' ? (w.crtShipment && w.crtShipment.lines)
    : w.kind === 'shipment' ? (w.shipment && w.shipment.crtPlasma) : null) || [];

  /**
   * Every transfer with CRTs or plasmas: what came in on the IRR, what has gone out to other
   * recyclers (and on which shipment), how many the recycler rejected as non-CEW, and what's on hand.
   * `excludeWcId` leaves one shipment out (used while that shipment is being edited).
   */
  L.crtPlasmaLedger = (wcs, { excludeWcId } = {}) => {
    const rows = new Map();
    wcs.filter((w) => w.kind === 'transfer').forEach((w) => {
      const tm = L.transferMath(w.transfer);
      L.CRT_PLASMA.forEach((cat) => {
        const ls = tm.lines.filter((l) => l.cat.key === cat);
        const received = ls.reduce((a, l) => ({ units: a.units + l.irrUnits, weight: r2(a.weight + l.irrWeight) }), { units: 0, weight: 0 });
        const cew = ls.reduce((a, l) => ({ units: a.units + l.cewUnits, weight: r2(a.weight + l.cewWeight) }), { units: 0, weight: 0 });
        const key = `${w.id}:${cat}`;
        if (received.units || received.weight) rows.set(key, { key, wc: w, category: cat, received, cew, shipped: { units: 0, weight: 0 }, rejected: 0, shipments: [] });
      });
    });
    const orphans = [];
    wcs.filter((w) => (w.kind === 'crtShipment' || w.kind === 'shipment') && w.id !== excludeWcId).forEach((sh) => L.crtLines(sh).forEach((l) => {
      const units = num(l.units); const weight = r2(num(l.weight)); const rejected = num(l.rejectedUnits);
      const row = rows.get(`${l.wcId}:${l.category}`);
      if (!row) { orphans.push({ shipment: sh, line: l }); return; }
      row.shipped.units += units; row.shipped.weight = r2(row.shipped.weight + weight); row.rejected += rejected;
      row.shipments.push({ wc: sh, units, weight, rejectedUnits: rejected, rejectedNote: l.rejectedNote || '' });
    }));
    rows.forEach((r) => { r.onHand = { units: r.received.units - r.shipped.units, weight: r2(r.received.weight - r.shipped.weight) }; });
    return { rows: [...rows.values()], orphans };
  };

  /**
   * Rules for a CRT/plasma shipment: pick the source transfer, never more units than it still has,
   * never units received after the shipment date, and rejected-as-non-CEW can't exceed units shipped.
   */
  L.crtPlasmaErrors = ({ shipment, wcs }) => {
    const byKey = new Map(L.crtPlasmaLedger(wcs, { excludeWcId: shipment.id }).rows.map((r) => [r.key, r]));
    const want = new Map(); const errors = [];
    L.crtLines(shipment).forEach((l) => {
      if (!l.wcId || !l.category) { errors.push('Pick the transfer each CRT/plasma line came from.'); return; }
      if (!(num(l.units) > 0)) errors.push('Enter how many units are on each CRT/plasma line.');
      if (num(l.rejectedUnits) > num(l.units)) errors.push("Rejected-as-non-CEW units can't be more than the units shipped on that line.");
      const k = `${l.wcId}:${l.category}`;
      const r = byKey.get(k);
      if (r && shipment.date && r.wc.date && r.wc.date > shipment.date) {
        errors.push(`WC #${r.wc.wcNumber} was received ${L.shortDate(r.wc.date)}, after this shipment (${L.shortDate(shipment.date)}) — its units can't be on it.`);
      }
      want.set(k, (want.get(k) || 0) + num(l.units));
    });
    want.forEach((units, k) => {
      const r = byKey.get(k);
      const label = k.endsWith('crt') ? 'CRT' : 'plasma';
      if (!r) errors.push(`That transfer has no ${label} units on its IRR.`);
      else if (units > r.onHand.units) errors.push(`WC #${r.wc.wcNumber} has only ${r.onHand.units} ${label} unit(s) left to ship — this shipment lists ${units}.`);
    });
    return [...new Set(errors)];
  };

  // ---------- paid / charged for shipments ----------
  L.SETTLEMENTS = [['', 'Not settled yet'], ['paid', 'We were paid'], ['charged', 'We were charged'], ['none', 'No charge']];
  /** + when we were paid, − when we were charged, 0 otherwise. */
  L.settlementAmount = (st) => {
    const a = st ? L.parseMoney(st.amount) : null;
    if (!st || a === null) return 0;
    return st.type === 'paid' ? a : st.type === 'charged' ? -a : 0;
  };
  L.settlementText = (st) => {
    if (!st || !st.type) return '';
    const a = L.parseMoney(st.amount);
    if (st.type === 'paid') return `Paid${a !== null ? ` ${L.money(a)}` : ''}`;
    if (st.type === 'charged') return `Charged${a !== null ? ` ${L.money(a)}` : ''}`;
    return 'No charge';
  };

  // ---------- CalRecycle 197 (official fillable form, Rev. 1/2026) ----------
  const F197_ROWS = [['crt', 'CA Sourced CRT CEW'], ['nonCrt', 'CA Sourced NonCRT CEW'], ['cbep', 'CA Sourced CBEP CEW']];
  L.F197_CHECK_LOGS = 'Copies of all applicable portions of Collection LogsCalRecycle 198CalRecycle 198SA received from';
  L.F197_CHECK_184 = 'Copies of all Proof of DesignationsCalRecycle 184s received from the Approved Collector';
  const mdy = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; };

  /**
   * Everything that goes on one transfer's 197, keyed by the form's own field names.
   * Section II lists only what we keep (CEW LCD/LED, plus CBEP); Recycler Tables 1/2 are filled
   * only when the claim is split across months or doesn't cover everything listed.
   */
  L.form197Values = ({ wc, parties, allocations, periods }) => {
    const t = wc.transfer || {}; const g = t.form197 || {};
    const tm = L.transferMath(t); const f = tm.form197;
    const P = parties;
    const fields = {
      'Date of TransferRow1': mdy(wc.date),
      'Approved Collector NameRow1': P.collector ? P.collector.name || '' : '',
      'Collector CEWID Row1': P.collector ? P.collector.cewId || '' : '',
      'Approved Recycler NameRow1': P.facility.name || '',
      'Recycler CEWID Row1': P.facility.cewId || '',
      'documented in the collection log': [P.handler ? `${P.handler.name} (Handler)` : null, tm.hasCrtOrPlasma ? L.CRT_PLASMA_NOTE : null, t.activityNotes || null].filter(Boolean).join('. '),
      'Printed NameRow1': g.collectorPrinted || '',
      'Printed NameRow1_2': g.recyclerPrinted || '',
    };
    const sa = { crt: 0, nonCrt: num(g.saNonCrt), cbep: num(g.saCbep) };
    const fill = (suffix, vals, saVals) => {
      const tot = { units: 0, weight: 0, sa: 0 };
      F197_ROWS.forEach(([k, label]) => {
        const v = vals[k] || { units: 0, weight: 0 };
        fields[`Units Transferred${label}${suffix}`] = fmt(v.units);
        fields[`Weights Transferred lbs${label}${suffix}`] = fmt(v.weight);
        fields[`SA Units From Units Transferred${label}${suffix}`] = saVals ? fmt(saVals[k] || 0) : '';
        tot.units += v.units; tot.weight = r2(tot.weight + v.weight); tot.sa += saVals ? (saVals[k] || 0) : 0;
      });
      fields[`Units TransferredTotals${suffix}`] = fmt(tot.units);
      fields[`Weights Transferred lbsTotals${suffix}`] = fmt(tot.weight);
      fields[`SA Units From Units TransferredTotals${suffix}`] = saVals ? fmt(tot.sa) : '';
    };
    fill('', f, sa);

    const periodById = new Map(periods.map((p) => [p.id, p]));
    const byMonth = new Map();
    allocations.filter((a) => a.wcId === wc.id).forEach((a) => {
      const p = periodById.get(a.claimPeriodId); if (!p) return;
      const k = L.monthIndex(p.year, p.month);
      if (!byMonth.has(k)) byMonth.set(k, { crt: { units: 0, weight: 0 }, nonCrt: { units: 0, weight: 0 }, cbep: { units: 0, weight: 0 } });
      const slot = byMonth.get(k)[p.cewType === 'NonCRT' ? 'nonCrt' : p.cewType === 'CBEP' ? 'cbep' : 'crt'];
      slot.units += num(a.units); slot.weight = r2(slot.weight + num(a.weight));
    });
    const months = [...byMonth.keys()].sort((x, y) => x - y);
    const listed = f.crt.units + f.nonCrt.units + f.cbep.units;
    const claimed = months.reduce((s2, k) => s2 + byMonth.get(k).nonCrt.units + byMonth.get(k).cbep.units, 0);
    const needTables = months.length > 1 || (months.length === 1 && claimed !== listed);
    const reportingMonths = [null, null];
    if (needTables) {
      months.slice(0, 2).forEach((k, i) => { fill(i === 0 ? '_2' : '_3', byMonth.get(k), null); reportingMonths[i] = L.monthLabelFromIndex(k); });
    }
    const docsLogs = g.docsLogs !== undefined ? !!g.docsLogs : !!(t.timeline && t.timeline.sourceLogsReceived && t.timeline.sourceLogsReceived !== 'N/A');
    return { fields, checks: { [L.F197_CHECK_LOGS]: docsLogs, [L.F197_CHECK_184]: !!g.docs184 }, reportingMonths, needTables };
  };

  // ---------- pricing, purchase invoice ----------
  L.PRICE_KEYS = [
    ['cew:lcdled', 'CEW LCD/LED'], ['cew:crt', 'CEW CRT'], ['cew:plasma', 'CEW Plasma'], ['cew:cbep', 'CEW CBEP'],
    ['noncew:noncrt', 'Non-CEW Non-CRT (LCD/LED and plasma)'], ['noncew:crt', 'Non-CEW CRT'], ['noncew:cbep', 'Non-CEW CBEP'],
    ['other', 'Other (non-CEW) item'],
  ];
  // non-CEW LCD/LED and non-CEW plasma are one line: Non-CEW Non-CRT
  L.nonCewKey = (catKey) => (catKey === 'crt' ? 'noncew:crt' : catKey === 'cbep' ? 'noncew:cbep' : 'noncew:noncrt');
  L.nonCewLabel = (catKey) => ({ crt: 'Non-CEW CRT', cbep: 'Non-CEW CBEP' }[catKey] || 'Non-CEW Non-CRT');
  /** Combine rows that print identically (e.g. non-CEW LCD/LED + non-CEW plasma → one Non-CEW Non-CRT row). */
  L.mergeRows = (rows, keyFn) => {
    const out = []; const at = new Map();
    rows.forEach((r) => {
      const k = keyFn(r);
      if (!at.has(k)) { at.set(k, out.length); out.push({ ...r }); return; }
      const m = out[at.get(k)];
      m.units += r.units; m.weight = r2(m.weight + r.weight);
      if (r.gross !== undefined) { m.gross = r2((m.gross || 0) + r.gross); m.tare = r2((m.tare || 0) + (r.tare || 0)); }
      if (m.amount !== undefined) m.amount = m.amount === null || r.amount === null ? null : r2(m.amount + r.amount);
      m.needsRate = m.needsRate || r.needsRate;
    });
    return out;
  };

  L.MATERIAL_MODES = [['dropoff', 'Drop off'], ['pickup', 'Pick up'], ['both', 'Drop off & pick up']];
  L.TRUCKING_BASES = [['perLb', '$ per lb'], ['flat', 'Flat $ per pick-up'], ['percent', '% of the invoice']];

  /** "$0.25", "0.25/lb", "1,200" → number; blank or text → null. */
  L.parseMoney = (v) => {
    const s = String(v ?? '').replace(/[$,\s]/g, '').replace(/\/(lbs?|units?|ea)$/i, '');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  L.money = (n) => (n === null || n === undefined ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(r2(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  L.rateText = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);

  /** Rows shown on the WC and the purchase invoice: the CEW and non-CEW part of each IRR line. */
  const FORM_LABELS = { lcdled: 'LCD/LED', crt: 'CRT', plasma: 'PLASMA', cbep: 'CBEP' };
  L.documentRows = (transfer) => {
    const rows = [];
    ((transfer && transfer.lines) || []).forEach((line, i) => {
      const m = L.lineMath(line);
      const desc = String(line.description || '').trim();
      const tare = r2(num(line.irrTare));
      if (!m.cat.cew) {
        if (m.irrUnits || m.irrWeight) {
          rows.push({ lineIndex: i, part: 'other', key: 'other', label: desc || 'Other (non-CEW)', units: m.irrUnits, weight: m.irrWeight, gross: r2(m.irrWeight + tare), tare, priceItemId: line.priceItemId ?? null, manualRate: line.rate });
        }
        return;
      }
      const suffix = desc ? ` — ${desc}` : '';
      let first = true;
      const take = () => { const t = first ? tare : 0; first = false; return t; };
      if (m.cewUnits || m.cewWeight) { const t = take(); rows.push({ lineIndex: i, part: 'cew', key: `cew:${m.cat.key}`, label: `CEW ${FORM_LABELS[m.cat.key]}${suffix}`, units: m.cewUnits, weight: m.cewWeight, gross: r2(m.cewWeight + t), tare: t, manualRate: line.cewRate }); }
      if (m.nonCewUnits || m.nonCewWeight) { const t = take(); rows.push({ lineIndex: i, part: 'noncew', key: L.nonCewKey(m.cat.key), label: L.nonCewLabel(m.cat.key), units: m.nonCewUnits, weight: m.nonCewWeight, gross: r2(m.nonCewWeight + t), tare: t, manualRate: line.nonCewRate }); }
    });
    return rows;
  };

  /**
   * Which rate applies to one invoice row, in order:
   * rate entered on the transfer (set at inspection) → the customer's own rate →
   * the master price list for pick-up or drop-off. "Variable" means it must be entered at inspection.
   */
  /** Rate for one invoice row; `charge` = we charge the customer for it (non-CEW units) instead of paying. */
  /**
   * Rows for the weight certificate: CEW and non-CEW parts of each IRR line with gross/tare/net.
   * Each line's tare stays with its first row (CEW if any), so WC totals equal the IRR totals.
   * Non-CEW LCD/LED and non-CEW plasma combine into one Non-CEW Non-CRT row.
   */
  const WC_LABELS = { lcdled: 'LCD/LED', crt: 'CRT', plasma: 'PLASMA', cbep: 'CBEP' };
  const WC_ORDER = ['CEW LCD/LED', 'CEW CRT', 'CEW PLASMA', 'CEW CBEP', 'Non-CEW Non-CRT', 'Non-CEW CRT', 'Non-CEW CBEP'];
  L.wcRows = (transfer) => {
    const rows = [];
    ((transfer && transfer.lines) || []).forEach((line) => {
      const m = L.lineMath(line);
      const tare = r2(num(line.irrTare));
      const desc = String(line.description || '').trim();
      if (!m.cat.cew) {
        if (m.irrUnits || m.irrWeight || tare) rows.push({ label: desc || 'Other (non-CEW)', units: m.irrUnits, weightOnly: !m.irrUnits, gross: r2(m.irrWeight + tare), tare, net: m.irrWeight, other: true });
        return;
      }
      const parts = [];
      if (m.cewUnits || m.cewWeight) parts.push({ label: `CEW ${WC_LABELS[m.cat.key]}`, units: m.cewUnits, net: m.cewWeight });
      if (m.nonCewUnits || m.nonCewWeight) parts.push({ label: L.nonCewLabel(m.cat.key), units: m.nonCewUnits, net: m.nonCewWeight });
      if (!parts.length && (m.irrUnits || m.irrWeight)) parts.push({ label: WC_LABELS[m.cat.key], units: m.irrUnits, net: m.irrWeight });
      parts.forEach((pt, i) => rows.push({ ...pt, weightOnly: false, tare: i === 0 ? tare : 0, gross: r2(pt.net + (i === 0 ? tare : 0)), other: false }));
    });
    const merged = [];
    rows.forEach((r) => {
      const hit = merged.find((x) => x.label === r.label && x.other === r.other);
      if (!hit) { merged.push({ ...r }); return; }
      hit.units += r.units; hit.gross = r2(hit.gross + r.gross); hit.tare = r2(hit.tare + r.tare); hit.net = r2(hit.net + r.net);
      hit.weightOnly = hit.weightOnly && r.weightOnly;
    });
    const rank = (r) => (r.other ? 100 : (WC_ORDER.indexOf(r.label) + 1 || 50));
    return merged.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
  };

  L.resolveRate = (args) => {
    const res = L.resolveRateOnly(args);
    return { ...res, charge: !!(res.item && res.item.direction === 'charge') };
  };
  L.resolveRateOnly = ({ row, mode, priceItems, company }) => {
    const item = row.key === 'other'
      ? priceItems.find((p) => p.id === row.priceItemId)
      : priceItems.find((p) => p.appliesTo === row.key);
    const basis = (item && item.basis) || 'lb';
    const manual = L.parseMoney(row.manualRate);
    if (manual !== null) return { rate: manual, basis, item, source: 'Set at inspection' };
    if (!item) return { rate: null, basis, item: null, needsRate: true, source: row.key === 'other' ? 'Pick a price-list item or enter a rate' : 'Not on the price list' };
    const cust = company && company.rates ? company.rates[item.id] : null;
    if (cust && cust.variable) return { rate: null, basis, item, needsRate: true, source: 'Variable for this customer — enter at inspection' };
    const cr = cust ? L.parseMoney(cust.rate) : null;
    if (cr !== null) return { rate: cr, basis, item, source: 'Customer rate' };
    if (item.variable) return { rate: null, basis, item, needsRate: true, source: 'Variable — enter at inspection' };
    if (mode !== 'pickup' && mode !== 'dropoff') return { rate: null, basis, item, needsRate: true, source: 'Choose pick up or drop off' };
    const p = L.parseMoney(mode === 'pickup' ? item.pickUp : item.dropOff);
    const modeText = mode === 'pickup' ? 'pick-up' : 'drop-off';
    if (p === null) return { rate: null, basis, item, needsRate: true, source: `No ${modeText} price on the list` };
    return { rate: p, basis, item, source: `Price list (${modeText})` };
  };

  L.MISSING_LOGS_REASON = 'Missing source logs for quantity stated.';
  /**
   * The purchase invoice, laid out like Bellflower's PO:
   *  credits    = what we buy (CEW units and bought items): net × rate
   *  deductions = non-CEW units we charge for, * handling deductions, trucking, and any added by hand
   *  final balance = total credit − total deduction
   */
  L.invoiceMath = ({ transfer, mode, priceItems, company }) => {
    const rows = L.documentRows(transfer).map((r) => {
      const res = L.resolveRate({ row: r, mode, priceItems, company });
      const qty = res.basis === 'unit' ? r.units : r.weight;
      return { ...r, ...res, amount: res.rate === null ? null : r2((res.charge ? -1 : 1) * res.rate * qty) };
    });
    const merged = L.mergeRows(rows, (r) => [r.label, r.rate, r.basis, !!r.charge].join('|'));
    const credits = merged.filter((r) => !r.charge).map((r) => ({ ...r, handling: r.item ? L.parseMoney(r.item.handling) : null }));
    const deductions = [];
    merged.filter((r) => r.charge).forEach((r) => deductions.push({
      auto: 'noncew', quantity: r.basis === 'unit' ? r.units : r.weight, description: r.label, reason: L.MISSING_LOGS_REASON,
      rate: r.rate, amount: r.amount === null ? null : r2(-r.amount), needsRate: r.needsRate,
    }));
    credits.filter((r) => r.handling).forEach((r) => deductions.push({
      auto: 'handling', quantity: r.weight, description: `${r.label}*`, reason: 'Handling deduction', rate: r.handling, amount: r2(r.weight * r.handling),
    }));
    const payTotal = r2(credits.reduce((s2, r) => s2 + (r.amount || 0), 0));
    const chargeTotal = r2(deductions.filter((d) => d.auto === 'noncew').reduce((s2, d) => s2 + (d.amount || 0), 0));
    const totalWeight = r2(rows.reduce((s2, r) => s2 + r.weight, 0));
    let trucking = null;
    const td = company && company.truckingDeduction;
    const a = td ? L.parseMoney(td.amount) : null;
    if (mode === 'pickup' && a) {
      const amount = td.basis === 'flat' ? a : td.basis === 'percent' ? r2((payTotal * a) / 100) : r2(totalWeight * a);
      const label = td.basis === 'flat' ? 'Trucking deduction' : td.basis === 'percent' ? `Trucking deduction (${a}%)` : `Trucking deduction (${fmt(totalWeight)} lbs × ${L.rateText(a)})`;
      trucking = { label, amount: -amount };
      deductions.push({ auto: 'trucking', quantity: td.basis === 'perLb' ? totalWeight : 1, description: 'Trucking', reason: label, rate: td.basis === 'perLb' ? a : amount, amount });
    }
    ((transfer && transfer.deductions) || []).forEach((d) => {
      const q = num(d.quantity); const rate = L.parseMoney(d.rate);
      if (!q && rate === null && !d.description) return;
      deductions.push({ auto: '', quantity: q, description: d.description || '', reason: d.reason || '', rate, amount: rate === null ? null : r2(q * rate) });
    });
    const totalCredit = payTotal;
    const totalDeduction = r2(deductions.reduce((s2, d) => s2 + (d.amount || 0), 0));
    const finalBalance = r2(totalCredit - totalDeduction);
    return {
      rows, merged, credits, deductions, totalCredit, totalDeduction, finalBalance,
      // kept for the editor's pricing panel
      subtotal: r2(payTotal - chargeTotal), payTotal, chargeTotal, trucking, total: finalBalance, totalWeight,
      missing: rows.filter((r) => r.needsRate).length,
    };
  };

  // ---------- WC log (the office spreadsheet) ----------
  /** Tab-separated text as Excel copies it: quoted cells may hold tabs, line breaks and "" quotes. */
  L.parseTsv = (text) => {
    const rows = []; let row = []; let cell = ''; let quoted = false;
    const src = String(text || '').replace(/\r\n?/g, '\n');
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; } else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === '\t') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  };

  const DATE_TOKEN = /(\d{1,2}\.{1,2}\d{1,2}\.{1,2}\d{2,4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{3,4}\.\d{2,4})/;
  /**
   * Dates as typed in the log: 9.26.26, 9..30.26, `9.15.26, 916.26 (→ 9.16.26), 9.18.16 (→ the log's usual year).
   * `fixed` = the date had to be reinterpreted (not just tidied), so someone should check it.
   */
  L.parseLooseDate = (raw, mainYear) => {
    const original = String(raw || '').trim();
    const s = original.replace(/[^0-9./]/g, '').replace(/\//g, '.').replace(/\.{2,}/g, '.');
    if (!s) return null;
    let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s);
    let reshaped = false;
    if (!m) { const m2 = /^(\d{1,2})(\d{2})\.(\d{2,4})$/.exec(s); if (m2) { m = m2; reshaped = true; } }
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    let yearFixed = false;
    if (mainYear && Math.abs(y - mainYear) >= 2) { y = mainYear; yearFixed = true; }
    const iso = isoDate(y, +m[1], +m[2]);
    return iso ? { iso, fixed: reshaped || yearFixed } : null;
  };

  const TYPO_FIXES = [[/\b(tranfser|tranfer|trasnfer|transefer|transfr|trnasfer)\b/g, 'transfer'], [/\b(shipmnet|shipmet|shippment)\b/g, 'shipment'], [/\bced\b/g, 'cew']];
  /** What a WC is, from the log's free-text type ("cew transfer only?", "cew/cbep residual shipment", "void", …). */
  L.classifyWcType = (raw, { hasIrr } = {}) => {
    let s = L.norm(raw);
    TYPO_FIXES.forEach(([re, to]) => { s = s.replace(re, to); });
    const has = (w) => new RegExp(`\\b${w}\\b`).test(s);
    let kind;
    if (has('void')) kind = 'void';
    else if (has('residual') || has('shipment') || has('shipped')) kind = 'shipment';
    else if (has('transfer')) kind = 'transfer';
    else kind = hasIrr ? 'transfer' : 'unknown';
    const recognized = has('void') || has('residual') || has('shipment') || has('shipped') || has('transfer');
    const nonCew = /\bnon cew\b/.test(s);
    return { kind, unsure: /\?|confirm/i.test(String(raw || '')) || !recognized, cbep: has('cbep'), cbepOnly: /\bcbep only\b|\bonly cbep\b/.test(s), nonCew, cew: has('cew') && !nonCew };
  };

  /** "clean earth (lamps)" → name + note; "FMC Metals- copper wire" → same; "Dual entity (…)" → our own collection. */
  L.splitCompanyText = (raw) => {
    let name = String(raw || '').replace(/\s+/g, ' ').trim(); let note = '';
    const p = /^(.*?)\s*\((.*)\)\s*$/.exec(name);
    if (p && p[1]) { note = p[2].trim(); name = p[1].trim(); } else {
      const d = /^(.*?\S)\s*-\s+(.+)$/.exec(name);
      if (d) { note = d[2].trim(); name = d[1].trim(); }
    }
    const selfCollected = /^dual entity$/i.test(name);
    return { name: selfCollected ? '' : name, note, selfCollected };
  };

  const LOG_COLS = [['paid', /^paid$/], ['due', /(payment|due)/], ['wcNumber', /^wc\b/], ['type', /^type/], ['company', /^(company|customer)/], ['date', /^date/],
    ['irr', /^irr/], ['status', /^status/], ['packet', /packet/], ['lotCancelled', /(lot|cancel)/], ['notes', /^notes?/]];
  const LOG_ORDER = ['wcNumber', 'type', 'company', 'date', 'irr', 'status', 'paid', 'due', 'packet', 'lotCancelled', 'notes'];
  const yes = (v) => /^(true|yes|y|x|✓|✔)$/i.test(String(v || '').trim());

  /** Every row of the pasted WC log, read and sorted out. Nothing is saved here. */
  L.parseWcLog = (text) => {
    let order = null; const recs = []; const skipped = [];
    L.parseTsv(text).forEach((cells, i) => {
      const normed = cells.map((c) => L.norm(c));
      if (!order && normed.includes('wc') && normed.some((c) => /^type/.test(c))) {
        order = normed.map((c) => (LOG_COLS.find(([, re]) => re.test(c)) || [null])[0]);
        return;
      }
      const rec = {};
      (order || LOG_ORDER).forEach((k, idx) => { if (k && rec[k] === undefined) rec[k] = String(cells[idx] ?? '').trim(); });
      if (!rec.wcNumber || !/\d/.test(rec.wcNumber)) { skipped.push({ line: i + 1, reason: 'no WC #' }); return; }
      recs.push(rec);
    });
    const yearCounts = new Map();
    recs.forEach((r) => { const d = L.parseLooseDate(r.date); if (d) { const y = +d.iso.slice(0, 4); yearCounts.set(y, (yearCounts.get(y) || 0) + 1); } });
    const mainYear = [...yearCounts].sort((a, b) => b[1] - a[1]).map(([y]) => y)[0] || null;

    const rows = recs.map((r) => {
      const date = L.parseLooseDate(r.date, mainYear);
      const irrNumber = L.normLot(r.irr);
      const type = L.classifyWcType(r.type, { hasIrr: !!irrNumber });
      const co = L.splitCompanyText(r.company);
      const due = String(r.due || '').trim();
      const tok = DATE_TOKEN.exec(due);
      const tokDate = tok ? L.parseLooseDate(tok[0], mainYear) : null;
      const poSent = /po\s*sent/i.test(due) && tokDate ? tokDate.iso : '';
      const paid = yes(r.paid) || /^paid\b/i.test(due);
      const dueDate = !poSent && tokDate ? tokDate.iso : '';
      const dueNote = due.replace(tok ? tok[0] : '', '').replace(/^paid$/i, '').replace(/po\s*sent/i, '').trim().replace(/^\((.*)\)$/s, '$1').trim();
      let packetMonth = '';
      const pm = /([a-z]{3,})\.?\s*(\d{4})?/i.exec(String(r.packet || ''));
      if (pm) {
        const mi = L.MONTHS.findIndex((mn) => mn.toLowerCase().startsWith(pm[1].toLowerCase().slice(0, 3)));
        if (mi >= 0) packetMonth = L.monthKey(pm[2] ? +pm[2] : (date ? +date.iso.slice(0, 4) : mainYear), mi + 1);
      }
      const lotCancelled = yes(r.lotCancelled);
      const notes = String(r.notes || '').trim();
      return {
        wcNumber: String(r.wcNumber).trim(), typeText: String(r.type || '').replace(/\s+/g, ' ').trim(), ...type,
        companyText: String(r.company || '').replace(/\s+/g, ' ').trim(), companyName: co.name, companyNote: co.note, selfCollected: co.selfCollected,
        date: date ? date.iso : '', dateText: String(r.date || '').trim(), dateFixed: date ? date.fixed : !!String(r.date || '').trim(),
        irrNumber, status: String(r.status || '').replace(/\s+/g, ' ').trim(), paid, dueDate, dueNote, poSent, packetMonth, packetText: String(r.packet || '').trim(),
        lotCancelled, notes,
        // shipments never have a PO or a cancelled lot, so a "shipment" row with either is really a transfer
        maybeTransfer: type.kind === 'shipment' && (!!poSent || lotCancelled || /cancel/i.test(notes)),
      };
    }).map((row) => (row.maybeTransfer ? { ...row, kind: 'transfer', unsure: true } : row));
    return { rows, skipped, usedHeader: !!order, mainYear };
  };

  /** What still needs a look on a WC that came from the WC log (cleared with "Mark as checked" on the WC). */
  L.wcLogChecks = (wc) => {
    const l = wc && wc.log;
    if (!l || l.checked) return [];
    const out = [];
    if (l.kind === 'unknown') out.push('needs a type');
    else if (l.maybeTransfer) out.push('log says shipment');
    else if (l.unsure) out.push('check type');
    if (l.dateFixed) out.push(`date "${l.dateText}"`);
    return out;
  };

  // spellings of the same company: same letters ignoring spaces, same words in any order, or one letter off
  const compactName = (x) => L.norm(x).replace(/ /g, '');
  const wordKey = (x) => L.norm(x).split(' ').filter(Boolean).sort().join(' ');
  const lev = (a, b) => {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let diag = prev[0]; prev[0] = i;
      for (let j = 1; j <= b.length; j += 1) { const tmp = prev[j]; prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1)); diag = tmp; }
    }
    return prev[b.length];
  };
  const near = (a, b) => a === b || (a.length >= 8 && b.length >= 8 && lev(a, b) <= 1);
  const SMALL_WORDS = new Set(['and', 'of', 'the', 'for', 'de', 'a']);
  const tidyName = (x) => (x !== x.toLowerCase() ? x : x.split(' ').map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' '));

  /**
   * Matches each company spelling in the log to a saved company (or its saved misspellings) or groups it with
   * other spellings of the same new company. Returns Map(spelling → { companyId, display } | { group, display, spellings }).
   */
  L.groupCompanyNames = (entries, companies) => {
    const index = L.companyIndex(companies);
    const saved = companies.map((c) => ({ c, names: [c.name, ...(c.aliases || [])] }));
    const seen = new Map();
    entries.forEach((e) => { if (!e.name) return; const x = seen.get(e.name) || { name: e.name, note: e.note, count: 0 }; x.count += 1; seen.set(e.name, x); });
    const out = new Map(); const fresh = [];
    seen.forEach((x) => {
      let hit = L.resolveCompany(x.name, index).company;
      if (!hit) {
        const cp = compactName(x.name); const wk = wordKey(x.name);
        const f = saved.find((k) => k.names.some((n) => near(compactName(n), cp) || wordKey(n) === wk));
        if (f) hit = f.c;
      }
      if (hit) out.set(x.name, { companyId: hit.id, display: hit.name });
      else fresh.push(x);
    });
    const keys = fresh.map((x) => {
      const k = [compactName(x.name), wordKey(x.name)];
      if (x.note && x.note.split(' ').length <= 3) k.push(wordKey(`${x.name} ${x.note}`));
      return k;
    });
    const parent = fresh.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < fresh.length; i += 1) {
      for (let j = i + 1; j < fresh.length; j += 1) {
        if (keys[i].some((k) => keys[j].includes(k)) || near(keys[i][0], keys[j][0])) parent[find(j)] = find(i);
      }
    }
    const groups = new Map();
    fresh.forEach((x, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); });
    const caps = (x) => (x.match(/\b[A-Z]/g) || []).length;
    groups.forEach((members, g) => {
      const best = [...members].sort((a, b) => (b.count - a.count) || (caps(b.name) - caps(a.name)))[0];
      const display = tidyName(best.name);
      members.forEach((m) => out.set(m.name, { group: g, display, spellings: members.map((y) => y.name) }));
    });
    return out;
  };

  // ---------- company roles ----------
  // A company is a handler or a collector, never both; and a handler or an approved recycler, never both.
  L.ROLE_CONFLICTS = [['handler', 'collector'], ['handler', 'recycler']];
  L.roleConflicts = (roles) => L.ROLE_CONFLICTS.filter(([a, b]) => (roles || []).includes(a) && (roles || []).includes(b));
  /** Removes clashing roles, keeping whichever of each clashing pair is in `prefer` (else the handler). Recycler ⇒ vendor. */
  L.resolveRoles = (roles, prefer = []) => {
    let out = [...new Set(roles || [])];
    L.ROLE_CONFLICTS.forEach(([a, b]) => {
      if (out.includes(a) && out.includes(b)) {
        const keep = prefer.includes(a) ? a : prefer.includes(b) ? b : a;
        out = out.filter((r) => r !== (keep === a ? b : a));
      }
    });
    if (out.includes('recycler') && !out.includes('destination')) out.push('destination');
    return out;
  };
  /** CEWID #s are numbers only. */
  L.cleanCewId = (v) => String(v ?? '').replace(/\D/g, '');

  // ---------- customer spreadsheet import ----------
  const CUSTOMER_COLS = [
    ['cbepEnrolled', /^cbep enrol/], ['cbepRate', /^cbep (price|rate)/], ['name', /^(company|customer|company name|customer name)$/],
    ['lcdled', /^lcd/], ['crt', /^crt/], ['plasma', /^plasma/], ['owner', /^owner/], ['cewId', /^cew ?id/], ['admin', /^admin/],
    ['sourceLogSystem', /^source log/], ['primaryLanguage', /language/], ['materialMode', /(pick ?up|drop ?off)/], ['trucking', /trucking/],
    ['accountStatus', /^(account|status)/], ['licensePlates', /(plate|license|vehicle)/],
  ];
  const CUSTOMER_ORDER = ['name', 'lcdled', 'crt', 'plasma', 'owner', 'cewId', 'admin', 'sourceLogSystem', 'primaryLanguage', 'materialMode', 'trucking', 'cbepEnrolled', 'cbepRate'];

  const parseRateCell = (v) => {
    const t = String(v ?? '').trim();
    if (!t) return null;
    const n = L.parseMoney(t);
    return n === null ? { rate: '', variable: true, note: t } : { rate: String(n), variable: false };
  };
  const parseTrucking = (v) => {
    const t = String(v ?? '').trim();
    if (!t) return { amount: '', basis: 'perLb', raw: '' };
    const n = L.parseMoney(t.replace(/%|per.*$|\/.*$|flat/gi, ''));
    let basis = 'flat';
    if (/%/.test(t)) basis = 'percent';
    else if (/lb/i.test(t)) basis = 'perLb';
    else if (/flat|trip|load|pick/i.test(t)) basis = 'flat';
    else if (n !== null && n < 1) basis = 'perLb';
    return { amount: n === null ? '' : String(n), basis, raw: t };
  };

  /** Pasted customer sheet (tab- or comma-separated). Header row recommended; otherwise the column order you use. */
  L.parseCustomerSheet = (text) => {
    let order = CUSTOMER_ORDER; let usedHeader = false;
    const rows = []; const skipped = [];
    String(text || '').split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim());
      const normed = cells.map(L.norm);
      if (!usedHeader && normed.some((c) => /^(company|customer)/.test(c)) && normed.some((c) => /cew ?id|owner|lcd/.test(c))) {
        order = normed.map((c) => { const hit = CUSTOMER_COLS.find(([, re]) => re.test(c)); return hit ? hit[0] : null; });
        usedHeader = true;
        return;
      }
      const rec = {};
      order.forEach((k, idx) => { if (k) rec[k] = cells[idx] ?? ''; });
      const name = String(rec.name || '').replace(/\s+/g, ' ').trim();
      if (!name) { skipped.push({ line: i + 1, reason: 'no company name' }); return; }
      const mode = L.norm(rec.materialMode);
      rows.push({
        name,
        cewId: L.cleanCewId(rec.cewId),
        isHandler: /handler/i.test(String(rec.cewId || '')),
        owner: String(rec.owner || '').trim(),
        admin: String(rec.admin || '').trim(),
        sourceLogSystem: String(rec.sourceLogSystem || '').trim(),
        primaryLanguage: String(rec.primaryLanguage || '').trim(),
        materialMode: /pick/.test(mode) && /drop/.test(mode) ? 'both' : /pick/.test(mode) ? 'pickup' : /drop/.test(mode) ? 'dropoff' : '',
        truckingDeduction: parseTrucking(rec.trucking),
        cbepEnrolled: /^(y|yes|true|x|enrolled)\b/i.test(String(rec.cbepEnrolled || '').trim()),
        licensePlates: L.splitPlates(rec.licensePlates),
        accountStatus: /clos|inactive/i.test(rec.accountStatus || '') ? 'closed' : /open|active/i.test(rec.accountStatus || '') ? 'open' : '',
        rates: { lcdled: parseRateCell(rec.lcdled), crt: parseRateCell(rec.crt), plasma: parseRateCell(rec.plasma), cbep: parseRateCell(rec.cbepRate) },
      });
    });
    return { rows, skipped, usedHeader, columns: new Set(order.filter(Boolean)) };
  };
})(typeof window !== 'undefined' ? ((window.App = window.App || {}), (window.App.Logic = {})) : module.exports);

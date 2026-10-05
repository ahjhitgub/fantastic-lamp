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
    date: /^date/, time: /^time/, device: /^(device|item)/, make: /^(make|manufacturer|brand|mfr)/, model: /^model/,
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
        device: rec.device || '',
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
      const n = list.reduce((a, u) => a + L.unitCount(u), 0); const w = sumW(list);   // a bulk line counts as its units
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
      totals: { units: units.reduce((a, u) => a + L.unitCount(u), 0), weight: sumW(units), allocUnits: alloc.units, allocWeight: alloc.weight,
        diffUnits: units.reduce((a, u) => a + L.unitCount(u), 0) - alloc.units, diffWeight: r2(sumW(units) - alloc.weight) },
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
      const map = new Map(); const docs = wcs.filter((w) => w.kind === 'inventory' && !L.isCbepInventory(w) && L.inventoryMonthKey(w) === k);
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
      if (L.lineProgram(w, l, materials) === 'cbep') return;   // CBEP residuals count only toward the 196C
      // only CEW material counts toward residuals; lines marked non-CEW are shipped but not counted
      if (l.materialId == null) { nonCewShipped = r2(nonCewShipped + L.lineNet(l)); return; }   // "— none —": shipped, not a residual
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
    const mats = materials.filter((m) => m.program !== 'cbep' && m.category && m.category !== 'Not a CEW residual');
    const byId = new Map(mats.map((m) => [m.id, m]));
    const inv = new Map();
    wcs.filter((w) => w.kind === 'inventory' && !L.isCbepInventory(w)).forEach((w) => {
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
    // our 197 signer signs as the recycler — and as the collector too when we're the collector (a handler's
    // transfer or our own collection); an outside collector's person is typed in by hand
    const signer = g.signer || g.recyclerPrinted || '';
    const collectorName = P.collectorIsFacility ? signer : (g.collectorPrinted || '');
    const fields = {
      'Date of TransferRow1': mdy(wc.date),
      'Approved Collector NameRow1': P.collector ? P.collector.name || '' : '',
      'Collector CEWID Row1': P.collector ? P.collector.cewId || '' : '',
      'Approved Recycler NameRow1': P.facility.name || '',
      'Recycler CEWID Row1': P.facility.cewId || '',
      'documented in the collection log': [P.handler ? `${P.handler.name} (Handler)` : null, tm.hasCrtOrPlasma ? L.CRT_PLASMA_NOTE : null, t.activityNotes || null].filter(Boolean).join('. '),
      'Printed NameRow1': collectorName,
      'Printed NameRow1_2': signer,
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
    return { fields, checks: { [L.F197_CHECK_LOGS]: docsLogs, [L.F197_CHECK_184]: !!g.docs184 }, reportingMonths, needTables,
      signatures: { collector: P.collectorIsFacility ? signer : '', recycler: signer } };
  };

  // ---------- pricing, purchase invoice ----------
  L.PRICE_KEYS = [
    ['cew:lcdled', 'CEW LCD/LED'], ['cew:crt', 'CEW CRT'], ['cew:plasma', 'CEW Plasma'], ['cew:cbep', 'CBEP (with source logs)'],
    ['noncew:noncrt', 'Non-CEW Non-CRT (LCD/LED and plasma)'], ['noncew:crt', 'Non-CEW CRT'], ['noncew:cbep', 'CBEP without source logs'],
    ['other', 'Other (non-CEW) item'],
  ];
  // non-CEW LCD/LED and non-CEW plasma are one line: Non-CEW Non-CRT
  L.nonCewKey = (catKey) => (catKey === 'crt' ? 'noncew:crt' : catKey === 'cbep' ? 'noncew:cbep' : 'noncew:noncrt');
  L.nonCewLabel = (catKey) => ({ crt: 'Non-CEW CRT', cbep: 'CBEP without source logs' }[catKey] || 'Non-CEW Non-CRT');
  /** CBEP items on the price list (CBEP Computer Towers, CBEP Printers, …) — each bought at its own rate. */
  L.cbepItems = (priceItems) => (priceItems || []).filter((p) => p.appliesTo === 'cew:cbep');
  /** The CBEP item a line is for: the one picked, or the only one there is. */
  L.cbepItemFor = (line, priceItems) => {
    const items = L.cbepItems(priceItems);
    return items.find((p) => p.id === (line && line.priceItemId)) || (items.length === 1 ? items[0] : null);
  };
  L.cbepName = (line, priceItems) => (L.cbepItemFor(line, priceItems) || {}).name || 'CBEP';
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
  L.documentRows = (transfer, priceItems = []) => {
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
      if (m.cewUnits || m.cewWeight) { const t = take(); rows.push({ lineIndex: i, part: 'cew', key: `cew:${m.cat.key}`, priceItemId: m.cat.key === 'cbep' ? line.priceItemId ?? null : undefined,
        label: `${m.cat.key === 'cbep' ? L.cbepName(line, priceItems) : `CEW ${FORM_LABELS[m.cat.key]}`}${suffix}`, units: m.cewUnits, weight: m.cewWeight, gross: r2(m.cewWeight + t), tare: t, manualRate: line.cewRate }); }
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
  L.WC_CBEP_LABEL = 'CBEP Units';
  const WC_ORDER = ['CEW LCD/LED', 'CEW CRT', 'CEW PLASMA', 'CBEP Units', 'Non-CEW Non-CRT', 'Non-CEW CRT'];
  L.wcRows = (transfer, priceItems = []) => {
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
      // the WC shows every CBEP item — with or without source logs — as one "CEW CBEP Units" line
      // (the IRR and purchase invoice keep each CBEP item on its own line)
      if (m.cat.key === 'cbep') {
        if (m.irrUnits || m.irrWeight) parts.push({ label: L.WC_CBEP_LABEL, units: m.irrUnits, net: m.irrWeight, claim: true });
      } else {
        if (m.cewUnits || m.cewWeight) parts.push({ label: `CEW ${WC_LABELS[m.cat.key]}`, units: m.cewUnits, net: m.cewWeight, claim: true });
        if (m.nonCewUnits || m.nonCewWeight) parts.push({ label: L.nonCewLabel(m.cat.key), units: m.nonCewUnits, net: m.nonCewWeight });
        if (!parts.length && (m.irrUnits || m.irrWeight)) parts.push({ label: WC_LABELS[m.cat.key], units: m.irrUnits, net: m.irrWeight });
      }
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
      : row.key === 'cew:cbep' ? L.cbepItemFor(row, priceItems)
        : priceItems.find((p) => p.appliesTo === row.key);
    const basis = (item && item.basis) || 'lb';
    const manual = L.parseMoney(row.manualRate);
    if (manual !== null) return { rate: manual, basis, item, source: 'Set at inspection' };
    if (!item && row.key === 'cew:cbep' && L.cbepItems(priceItems).length > 1) return { rate: null, basis, item: null, needsRate: true, source: 'Pick which CBEP item this line is' };
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
  L.invoiceMath = ({ transfer, mode, priceItems: allItems, company, date }) => {
    const priceItems = date ? L.priceItemsOn(allItems, date) : allItems;   // the rates in effect on the transfer's date
    const rows = L.documentRows(transfer, priceItems).map((r) => {
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

  // ---------- transfer type: CEW, CBEP, or CEW/CBEP ----------
  L.TRANSFER_TYPES = [['cew', 'CEW'], ['cbep', 'CBEP'], ['both', 'CEW & CBEP']];
  L.transferTypeLabel = (k) => (L.TRANSFER_TYPES.find(([x]) => x === k) || [null, ''])[1];
  /** From the WC log's wording: "cew/cbep transfer" → both, "CBEP only transfer" → cbep, anything else → cew. */
  L.transferTypeFromText = (text) => {
    const t = String(text || '').toLowerCase();
    if (/cbep/.test(t) && /\bcew\b|cew\//.test(t)) return 'both';
    if (/cbep/.test(t)) return 'cbep';
    return 'cew';
  };
  /** Lines that don't fit the transfer's type (CBEP lines on a CEW transfer, CEW lines on a CBEP one). */
  L.transferTypeIssues = (transfer) => {
    const type = transfer && transfer.transferType;
    if (!type || type === 'both') return [];
    const lines = (transfer.lines || []).filter((l) => L.lineMath(l).irrUnits || L.lineMath(l).irrWeight);
    const cbep = lines.filter((l) => l.category === 'cbep').length;
    const cew = lines.filter((l) => ['lcdled', 'crt', 'plasma'].includes(l.category)).length;
    if (type === 'cew' && cbep) return [`This is marked a CEW transfer but has ${cbep} CBEP line(s) — change the type to CEW & CBEP or check the lines.`];
    if (type === 'cbep' && cew) return [`This is marked a CBEP transfer but has ${cew} CEW line(s) — change the type to CEW & CBEP or check the lines.`];
    return [];
  };

  // ---------- CalRecycle 198 logs: 198 O / 198 A → 198 C, 198 UC, 198 Master ----------
  L.SOURCE_TYPES = [['R', 'Resident'], ['B', 'Business'], ['E', 'Education'], ['G', 'Government'], ['H', 'Handler'], ['OC', 'Other collector']];
  L.sourceType = (t) => String(t || '').trim().toUpperCase();
  L.rowUnits = (r) => num(r.crt) + num(r.noncrt) + num(r.cbep);
  /** Contact name & phone: always for B, E, G, H and OC; for residents only at 5 or more units. */
  L.contactRequired = (r) => L.sourceType(r.type) !== 'R' || L.rowUnits(r) >= 5;
  const hasPhone = (s) => /\d{3}\D{0,3}\d{3}\D?\d{4}/.test(String(s || ''));
  L.logTotals = (rows) => (rows || []).reduce((t, r) => ({ crt: t.crt + num(r.crt), noncrt: t.noncrt + num(r.noncrt), cbep: t.cbep + num(r.cbep) }), { crt: 0, noncrt: 0, cbep: 0 });
  L.parseLogDate = (s) => {
    const m = /^\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})/.exec(String(s || ''));
    if (!m) return '';
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const mm = +m[1]; const dd = +m[2];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };
  /** CEW units the transfer holds with source logs, by the 198's columns (Non-CRT = LCD/LED + plasma). */
  L.transferLogUnits = (transfer) => {
    const out = { crt: 0, noncrt: 0, cbep: 0, plasma: 0 };
    ((transfer && transfer.lines) || []).forEach((l) => {
      const u = num(l.cewUnits);
      if (l.category === 'crt') out.crt += u;
      else if (l.category === 'lcdled') out.noncrt += u;
      else if (l.category === 'plasma') { out.noncrt += u; out.plasma += u; }
      else if (l.category === 'cbep') out.cbep += u;
    });
    return out;
  };
  /** Problems with one 198 (O or A): per entry, and its totals against the transfer. */
  L.logIssues = (log, transfer) => {
    const out = [];
    const rows = (log && log.rows) || [];
    const known = L.SOURCE_TYPES.map(([k]) => k);
    rows.forEach((r, i) => {
      const n = `Entry ${i + 1}${r.name ? ` (${r.name})` : ''}`;
      if (!L.parseLogDate(r.date)) out.push({ kind: 'error', text: `${n}: the date "${r.date || ''}" can't be read.` });
      if (!known.includes(L.sourceType(r.type))) out.push({ kind: 'warning', text: `${n}: source type "${r.type || ''}" isn't R, B, E, G, H or OC.` });
      if (!String(r.name || '').trim() || !String(r.address || '').trim()) out.push({ kind: 'warning', text: `${n}: name or address missing.` });
      if (L.contactRequired(r) && !(String(r.contact || '').trim() && hasPhone(r.contact))) {
        out.push({ kind: 'warning', text: `${n}: ${L.sourceType(r.type) === 'R' ? '5 or more units' : `a ${(L.SOURCE_TYPES.find(([k]) => k === L.sourceType(r.type)) || [0, 'non-resident'])[1].toLowerCase()} source`} needs a contact person name & phone.` });
      }
      if (!L.rowUnits(r)) out.push({ kind: 'warning', text: `${n}: no units.` });
    });
    ((log && log.pages) || []).forEach((p) => {
      if (p.written && p.sum && (p.written[0] !== p.sum[0] || p.written[1] !== p.sum[1] || p.written[2] !== p.sum[2])) {
        out.push({ kind: 'warning', text: `Page ${p.page}: the Total written on the log (${p.written.join(' / ')}) doesn't match its entries (${p.sum.join(' / ')}).` });
      }
    });
    if (transfer && rows.length) {
      const t = L.logTotals(rows); const x = L.transferLogUnits(transfer);
      [['crt', 'CRT'], ['noncrt', 'Non-CRT'], ['cbep', 'CBEP']].forEach(([k, label]) => {
        if (t[k] !== x[k]) out.push({ kind: 'warning', text: `${label}: the log has ${fmt(t[k])} unit(s), the transfer has ${fmt(x[k])} with source logs.` });
      });
    }
    return out;
  };
  /** Customer adjustments were required (the timeline step is done, not "N/A") → the 198 A is the basis. */
  L.adjustmentsRequired = (transfer) => {
    const v = transfer && transfer.timeline && transfer.timeline.customerAdjustments;
    return !!v && v !== 'N/A';
  };
  L.logBasis = (transfer) => {
    const logs = (transfer && transfer.logs) || {};
    const has = (l) => !!(l && l.rows && l.rows.length);
    if (L.adjustmentsRequired(transfer)) return { which: 'A', log: has(logs.a) ? logs.a : null, missing: !has(logs.a) };
    return { which: 'O', log: has(logs.o) ? logs.o : null, missing: !has(logs.o) };
  };
  /** Units struck on the 198 C: exactly the transfer's CRT and plasma units with source logs. */
  L.strikeTargets = (transfer) => { const u = L.transferLogUnits(transfer); return { crt: u.crt, plasma: u.plasma }; };
  /** Default strikes: CRT from the entries with CRT units, plasma from the Non-CRT entries, in log order. */
  L.autoStrikes = (rows, targets) => {
    let crt = targets.crt; let plasma = targets.plasma;
    return rows.map((r) => {
      const c = Math.min(num(r.crt), crt); crt -= c;
      const p = Math.min(num(r.noncrt), plasma); plasma -= p;
      return { crt: c, noncrt: p };
    });
  };
  L.strikeTotals = (plan) => (plan || []).reduce((t, s) => ({ crt: t.crt + num(s && s.crt), noncrt: t.noncrt + num(s && s.noncrt) }), { crt: 0, noncrt: 0 });
  /**
   * The strikes to use: your saved picks as long as they fit the log (even while the totals don't match yet —
   * `complete` says whether they do), else the automatic picks.
   */
  L.strikePlan = (transfer, rows) => {
    const targets = L.strikeTargets(transfer);
    const saved = transfer && transfer.strikes;
    const fits = Array.isArray(saved) && saved.length === rows.length
      && saved.every((s, i) => num(s.crt) <= num(rows[i].crt) && num(s.noncrt) <= num(rows[i].noncrt));
    const plan = fits ? saved.map((s) => ({ crt: num(s.crt), noncrt: num(s.noncrt) })) : L.autoStrikes(rows, targets);
    const tot = L.strikeTotals(plan);
    return { plan, saved: fits, complete: tot.crt === targets.crt && tot.noncrt === targets.plasma, targets };
  };
  /**
   * The 198 C's entries: every entry of the basis log; an entry partly struck is split into two lines with the
   * same source info — what we claim, then what we don't (struck) right below it.
   */
  L.claimLines = (rows, plan) => {
    const out = [];
    rows.forEach((r, i) => {
      const s = (plan && plan[i]) || { crt: 0, noncrt: 0 };
      const struck = { crt: num(s.crt), noncrt: num(s.noncrt), cbep: 0 };
      const kept = { crt: num(r.crt) - struck.crt, noncrt: num(r.noncrt) - struck.noncrt, cbep: num(r.cbep) };
      const base = { date: r.date, type: r.type, name: r.name, address: r.address, contact: r.contact, src: i };
      if (!struck.crt && !struck.noncrt) out.push({ ...base, ...kept, struck: false });
      else if (!kept.crt && !kept.noncrt && !kept.cbep) out.push({ ...base, ...struck, struck: true });
      else out.push({ ...base, ...kept, struck: false }, { ...base, ...struck, struck: true, split: true });
    });
    return out;
  };
  L.claimedTotals = (lines) => L.logTotals(lines.filter((l) => !l.struck));
  L.ucLines = (lines) => lines.filter((l) => l.struck).map((l) => ({ ...l, struck: false }));
  /** 7 entries per 198 page; each page's Total is its own entries. */
  L.paginate198 = (lines, per = 7) => {
    const pages = [];
    for (let i = 0; i < Math.max(lines.length, 1); i += per) {
      const chunk = lines.slice(i, i + per);
      pages.push({ lines: chunk, totals: L.logTotals(chunk) });
    }
    return pages;
  };
  /** O → A: entries added, removed and changed (source info and units), and the totals. */
  L.diffLogs = (o, a) => {
    const O = ((o && o.rows) || []).map((r, i) => ({ r, i })); const A = ((a && a.rows) || []).map((r, i) => ({ r, i }));
    const key = (r) => L.norm(r.name).replace(/\s+/g, '');
    const addr = (r) => L.norm(r.address).replace(/\s+/g, '');
    const pairs = []; const usedO = new Set(); const usedA = new Set();
    const match = (test) => A.forEach((x) => {
      if (usedA.has(x.i)) return;
      const y = O.find((z) => !usedO.has(z.i) && test(x.r, z.r));
      if (y) { pairs.push([y, x]); usedO.add(y.i); usedA.add(x.i); }
    });
    match((p, q) => key(p) === key(q) && addr(p) === addr(q));
    match((p, q) => addr(p) && addr(p) === addr(q));                         // name corrected
    match((p, q) => key(p) && key(p) === key(q));                            // address corrected
    match((p, q) => key(p) && key(q) && lev(key(p), key(q)) <= 2);           // small spelling fixes in both
    const FIELDS = [['date', 'Date'], ['type', 'Type'], ['name', 'Name'], ['address', 'Address'], ['contact', 'Contact'], ['crt', 'CRT'], ['noncrt', 'Non-CRT'], ['cbep', 'CBEP']];
    const changed = [];
    pairs.forEach(([x, y]) => {
      const fields = [];
      FIELDS.forEach(([f, label]) => {
        const from = x.r[f]; const to = y.r[f];
        if (['crt', 'noncrt', 'cbep'].includes(f)) { if (num(from) !== num(to)) fields.push({ field: f, label, from: num(from), to: num(to), units: true }); return; }
        const ph = (v) => (f === 'contact' && /^(ph#?|phone#?|n\/?a|none|-+)$/i.test(String(v || '').trim()) ? '' : String(v || '').trim());
        const same = f === 'date' ? L.parseLogDate(from) === L.parseLogDate(to) : ph(from) === ph(to);
        if (!same) fields.push({ field: f, label, from: String(from || ''), to: String(to || ''), minor: f === 'date' ? false : L.norm(ph(from)) === L.norm(ph(to)) });
      });
      if (fields.length) changed.push({ o: x.i, a: y.i, name: y.r.name || x.r.name, fields, minorOnly: fields.every((f) => f.minor), units: fields.some((f) => f.units) });
    });
    const t0 = L.logTotals(O.map((x) => x.r)); const t1 = L.logTotals(A.map((x) => x.r));
    return {
      added: A.filter((x) => !usedA.has(x.i)).map((x) => ({ a: x.i, row: x.r })),
      removed: O.filter((x) => !usedO.has(x.i)).map((x) => ({ o: x.i, row: x.r })),
      // unit changes first, then real corrections; capitals/punctuation-only last
      changed: changed.sort((p, q) => (q.units - p.units) || (p.minorOnly - q.minorOnly) || p.a - q.a),
      totals: { o: t0, a: t1, delta: { crt: t1.crt - t0.crt, noncrt: t1.noncrt - t0.noncrt, cbep: t1.cbep - t0.cbep } },
    };
  };
  /**
   * 198 UC by shipment: which struck entries go out with a CRT/plasma shipment. `sent` = earlier shipments'
   * entries [{src, crt, noncrt}] — those units are never sent again. Takes in log order, splitting an entry
   * when only part of it goes.
   */
  L.ucRemaining = (uc, sent) => uc.map((l, i) => {
    const gone = (sent || []).filter((x) => x.src === i).reduce((t, x) => ({ crt: t.crt + num(x.crt), noncrt: t.noncrt + num(x.noncrt) }), { crt: 0, noncrt: 0 });
    return { ...l, src: i, crt: num(l.crt) - gone.crt, noncrt: num(l.noncrt) - gone.noncrt };
  }).filter((l) => l.crt > 0 || l.noncrt > 0);
  L.allocateUc = (uc, sent, need) => {
    let crt = num(need.crt); let plasma = num(need.plasma);
    const take = [];
    L.ucRemaining(uc, sent).forEach((l) => {
      const c = Math.min(l.crt, crt); crt -= c;
      const p = Math.min(l.noncrt, plasma); plasma -= p;
      if (c || p) take.push({ ...l, crt: c, noncrt: p, cbep: 0 });
    });
    return { lines: take, short: { crt, plasma } };
  };

  /**
   * The type as shown: "CEW" is spelled out from the lines (CEW CRT, CEW Non-CRT, or both) since CBEP is
   * technically CEW too; CBEP stays CBEP. Shipments: their CEW part is always Non-CRT (CRTs aren't dismantled).
   */
  L.cewPartOf = (transfer) => {
    const live = ((transfer && transfer.lines) || []).filter((l) => { const m = L.lineMath(l); return m.irrUnits || m.irrWeight; });
    const crt = live.some((l) => l.category === 'crt'); const non = live.some((l) => l.category === 'lcdled' || l.category === 'plasma');
    return crt && non ? 'CEW CRT & Non-CRT' : crt ? 'CEW CRT' : non ? 'CEW Non-CRT' : 'CEW';
  };
  L.transferTypeDisplay = (transfer) => {
    const type = (transfer && transfer.transferType) || 'cew';
    if (type === 'cbep') return 'CBEP';
    const cew = L.cewPartOf(transfer);
    return type === 'both' ? `${cew} & CBEP` : cew;
  };
  L.shipmentTypeDisplay = (type) => ({ cbep: 'CBEP', both: 'CEW Non-CRT & CBEP' }[type] || 'CEW Non-CRT');

  // ---------- CBEP residuals (196C) ----------
  L.RESIDUALS_196C = ['Plastic', 'Copper', 'Non-Copper Metals', 'Circuit Boards', 'Glass', 'Fibers', 'Other'];
  L.BATTERY_CHEMISTRIES = ['Lithium-ion Batteries', 'Nickel-Metal Hydride Batteries', 'Sealed Lead-Acid Batteries', 'Nickel-Cadmium Batteries', 'Other Batteries'];
  L.NOT_CBEP = 'Not a CBEP residual';
  L.CBEP_RESIDUAL_OPTIONS = [...L.RESIDUALS_196C, ...L.BATTERY_CHEMISTRIES, L.NOT_CBEP];
  L.isBattery = (res) => L.BATTERY_CHEMISTRIES.includes(res);
  /** "CBEP Power Boards" / "CEW Non-CRT Steel": a material's name with its program in front (never doubled). */
  L.stripProgram = (n) => String(n || '').replace(/^\s*(CEW\s+Non-?CRT|CEW|CBEP)\s+/i, '').trim();
  L.materialLabel = (m) => {
    if (!m) return '';
    const base = L.stripProgram(m.name);
    return m.program === 'cbep' ? `CBEP ${base}` : m.program === 'cew' ? `CEW Non-CRT ${base}` : m.name;
  };
  /** A material's 196C residual: a CBEP material's category (Settings → Materials); a CEW Non-CRT material never has one. */
  L.residual196C = (material) => {
    if (!material) return 'Other';
    if (material.program === 'cew') return L.NOT_CBEP;
    if (material.residual196C && L.CBEP_RESIDUAL_OPTIONS.includes(material.residual196C)) return material.residual196C;
    const c = material.category;
    if (L.RESIDUALS_196C.includes(c)) return c;
    if (c === 'All Battery Chemistries') return 'Other Batteries';
    return L.NOT_CBEP;
  };
  /** The program of one shipment line: the shipment's type, or the line's own mark on a CEW & CBEP shipment. */
  L.lineProgram = (wc, line, materials) => {
    // a line's program is its material's (CEW Non-CRT or CBEP); lines without a listed material follow the shipment
    const m = materials && line && line.materialId != null ? materials.find((x) => x.id === line.materialId) : null;
    if (m && m.program) return m.program;
    const type = (wc.shipment && wc.shipment.shipmentType) || 'cew';
    return type === 'both' ? (line.program === 'cbep' ? 'cbep' : 'cew') : type;
  };
  /**
   * The rows a residual shipment WC prints. CEW-only shipments print each line as entered (as before). On CBEP
   * shipments, lines combine under their 196C residual ("CBEP Circuit Boards" = power boards + circuit boards +
   * motherboards…); on CEW & CBEP shipments the CEW lines combine under their 196B column ("CEW Non-CRT …").
   */
  L.shipmentRows = (wc, materials = []) => {
    const sh = wc.shipment || {}; const type = sh.shipmentType || 'cew';
    const mat = (id) => materials.find((m) => m.id === id) || null;
    const live = (sh.lines || []).filter((l) => l.description || l.materialId != null || L.lineNet(l));
    const rows = []; const by = new Map();
    live.forEach((l) => {
      const net = L.lineNet(l); const tare = r2(num(l.tare)); const gross = num(l.gross) || r2(net + tare); const count = num(l.count);
      const program = L.lineProgram(wc, l, materials); const m = mat(l.materialId);
      let key = null; let label = l.description || (m && m.name) || '';
      if (program === 'cbep') { const res = L.residual196C(m); label = `CBEP ${res === L.NOT_CBEP ? (L.stripProgram(label) || 'Other') : res}`; key = label; }
      else if (type === 'both' || type === 'cbep') { const col = m && L.FORM_V_CATEGORIES.includes(m.category) ? m.category : null; label = `CEW Non-CRT ${col || L.stripProgram(label)}`; key = col ? label : null; }
      const row = { label, count, gross, tare, net, bold: l.materialId != null, program, residual: program === 'cbep' ? L.residual196C(m) : null };
      if (key && by.has(key)) { const x = by.get(key); x.count += count; x.gross = r2(x.gross + gross); x.tare = r2(x.tare + tare); x.net = r2(x.net + net); return; }
      if (key) by.set(key, row);
      rows.push(row);
    });
    return rows;
  };
  L.DESTINATIONS = [['recycling', 'Recycling facility'], ['landfill', 'Hazardous waste landfill']];
  /** CBEP shipment rules (CBEP Claim Completeness Checklist; 14 CCR §18660.26(f)). */
  L.shipmentIssues = (wc, materials = []) => {
    const sh = wc.shipment || {}; const type = sh.shipmentType || 'cew';
    const mat = (id) => materials.find((m) => m.id === id) || null;
    if (type === 'cew') {
      return (sh.lines || []).filter((l) => L.lineProgram(wc, l, materials) === 'cbep').map((l) => ({ kind: 'error',
        text: `${L.materialLabel(mat(l.materialId))} is a CBEP residual — it can't go on a CEW shipment. Pick its CEW Non-CRT residual, or make this a CEW & CBEP shipment.` }));
    }
    const out = [];
    const live = (sh.lines || []).filter((l) => l.materialId != null || l.description || L.lineNet(l));
    const cbepLines = live.filter((l) => L.lineProgram(wc, l, materials) === 'cbep');
    const chems = [...new Set(cbepLines.map((l) => L.residual196C(mat(l.materialId))).filter(L.isBattery))];
    if (chems.length) {
      if (chems.length > 1 || live.length !== live.filter((l) => L.lineProgram(wc, l, materials) === 'cbep' && L.residual196C(mat(l.materialId)) === chems[0]).length) {
        out.push({ kind: 'error', text: 'A CBEP battery shipment may hold only one battery chemistry, from CBEP cancellation, and nothing else — ship the other lines on their own WC.' });
      }
      if (!sh.accumulationStart) out.push({ kind: 'warning', text: 'Batteries need their accumulation start date.' });
    }
    if (!cbepLines.length) out.push({ kind: 'warning', text: 'No CBEP residual on this shipment — change the shipment type or pick the CBEP residuals.' });
    if (type === 'cbep') live.filter((l) => L.lineProgram(wc, l, materials) === 'cew').forEach((l) => out.push({ kind: 'error', text: `${L.materialLabel(mat(l.materialId)) || l.description} is a CEW Non-CRT residual — it can't go on a CBEP shipment. Pick its CBEP residual, or make this a CEW & CBEP shipment.` }));
    const p = sh.paperwork || {};
    if (!p.destination) out.push({ kind: 'warning', text: 'Choose where it went: a recycling facility or a hazardous waste landfill.' });
    if (p.destination === 'recycling' && !p.bol) out.push({ kind: 'warning', text: 'Bill of lading # missing.' });
    if (p.destination === 'landfill') {
      if (!p.manifest) out.push({ kind: 'warning', text: 'Hazardous waste manifest # missing.' });
      if (!p.sigGenerator || !p.sigTransporter) out.push({ kind: 'warning', text: 'The manifest needs the generator\'s and transporter\'s signatures before the claim is submitted.' });
    }
    if (!String(p.materialFlow || '').trim()) out.push({ kind: 'warning', text: 'Describe the material flow (each broker or facility until its final recycler, processor or landfill).' });
    return out;
  };
  /** What a CBEP claim still owes before it can close: battery receipts and third manifest signatures. */
  L.claimOwed = (shipments, materials = []) => shipments.flatMap((w) => {
    const sh = w.shipment || {}; const p = sh.paperwork || {};
    if ((sh.shipmentType || 'cew') === 'cew') return [];
    const bat = (sh.lines || []).some((l) => L.lineProgram(w, l, materials) === 'cbep' && L.isBattery(L.residual196C(materials.find((m) => m.id === l.materialId))));
    const out = [];
    if (bat && p.destination === 'recycling' && !p.receiptDate) out.push({ wc: w, text: `WC #${w.wcNumber}: receipt from the receiving facility` });
    if (p.destination === 'landfill' && !p.sigFacility) out.push({ wc: w, text: `WC #${w.wcNumber}: the receiving facility's (third) manifest signature` });
    return out;
  });

  // ---------- claim-period views ----------
  L.periodMonthKey = (p) => `${p.year}-${String(p.month).padStart(2, '0')}`;
  L.periodEnd = (p) => { const d = new Date(Date.UTC(Number(p.year), Number(p.month), 0)); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
  L.programOfType = (type, program) => (program === 'CBEP' ? type === 'cbep' || type === 'both' : type === 'cew' || type === 'both');
  /**
   * Does a transfer belong to — or could it go on — this claim period? Its program matches, it's dated by the
   * period's end, and it isn't already fully used by other claims of that program (judged per program).
   */
  L.transferInPeriod = (w, period, allocations = [], periods = []) => {
    const t = w.transfer || {};
    if (!L.programOfType(t.transferType || 'cew', period.cewType)) return false;
    if (String(w.date || '') > L.periodEnd(period)) return false;
    const mine = allocations.filter((a) => a.wcId === w.id);
    if (mine.some((a) => a.claimPeriodId === period.id)) return true;
    const sameProgram = new Set(periods.filter((p) => p.cewType === period.cewType && p.id !== period.id).map((p) => p.id));
    const used = L.sumAllocs(mine.filter((a) => sameProgram.has(a.claimPeriodId)));
    const c = (L.transferMath(t).claimable || {})[period.cewType] || { units: 0, weight: 0 };
    return c.units - used.units > 0 || r2(c.weight - used.weight) > 0.01;
  };
  /** Any WC in a claim period's view: transfers by the rule above; residual shipments of its program in its month;
   *  month-end storage (LCD lamps) and CBEP generation WCs for its month even if dated after; nothing else. */
  L.wcInPeriod = (w, period, ctx = {}) => {
    if (!period) return true;
    if (w.voided) return false;
    const month = L.periodMonthKey(period);
    if (w.kind === 'transfer') return L.transferInPeriod(w, period, ctx.allocations, ctx.periods);
    if (w.kind === 'shipment') return L.programOfType((w.shipment && w.shipment.shipmentType) || 'cew', period.cewType) && String(w.date || '').slice(0, 7) === month;
    if (w.kind === 'inventory') return period.cewType === (L.isCbepInventory(w) ? 'CBEP' : 'NonCRT') && L.inventoryMonthKey(w) === month;
    if (w.kind === 'generation') return period.cewType === 'CBEP' && ((w.generation && w.generation.forMonth) || String(w.date || '').slice(0, 7)) === month;
    return false;
  };

  // ---------- CBEP month: generation certificates, stored amounts, 196C §IV and §V ----------
  /**
   * shipments: CBEP/CEW & CBEP shipment WCs; generations: generation WCs ({generation: {forMonth, residual}}, net
   * on its line); stored / prevStored: {residual: lbs} entered for this and last month-end.
   */
  L.cbepMonth = ({ month, shipments = [], generations = [], stored = null, prevStored = null, materials = [] }) => {
    const mat = (id) => materials.find((m) => m.id === id) || null;
    const all = [...L.RESIDUALS_196C, ...L.BATTERY_CHEMISTRIES];
    const row = () => ({ generated: 0, shipped: 0, certs: [] });
    const by = Object.fromEntries(all.map((r) => [r, row()]));
    shipments.filter((w) => String(w.date || '').slice(0, 7) === month).forEach((w) => {
      ((w.shipment && w.shipment.lines) || []).forEach((l) => {
        if (L.lineProgram(w, l, materials) !== 'cbep') return;
        const res = L.residual196C(mat(l.materialId)); if (!by[res]) return;
        by[res].shipped = r2(by[res].shipped + L.lineNet(l));
      });
    });
    generations.filter((w) => w.generation && w.generation.forMonth === month).forEach((w) => {
      const res = w.generation.residual; if (!by[res]) return;
      by[res].generated = r2(by[res].generated + L.lineNet(((w.generation.lines || [])[0]) || {}));
      by[res].certs.push(w.wcNumber);
    });
    const rows = all.map((res) => {
      const x = by[res]; const storedCalc = r2(x.generated - x.shipped);
      const end = stored && stored[res] !== undefined && stored[res] !== '' ? num(stored[res]) : null;
      const prev = prevStored && prevStored[res] !== undefined && prevStored[res] !== '' ? num(prevStored[res]) : 0;
      const expected = end === null ? null : r2(end - prev + x.shipped);
      return { residual: res, battery: L.isBattery(res), ...x, stored: storedCalc, storedEnd: end, expectedGenerated: expected,
        storageOk: end === null || Math.abs(expected - x.generated) < 0.01 };
    });
    const bat = rows.filter((r) => r.battery);
    const allBat = bat.reduce((a, r) => r2(a + r.generated), 0);
    const sec5 = L.RESIDUALS_196C.map((res) => rows.find((r) => r.residual === res));
    const issues = [];
    rows.forEach((r) => {
      if (r.shipped > r.generated + 0.01) issues.push(`${r.residual}: shipped ${fmt(r.shipped)} lbs but generated ${fmt(r.generated)} lbs${r.certs.length ? '' : ' (no generation certificate yet)'}.`);
      if (!r.storageOk) issues.push(`${r.residual}: generated ${fmt(r.generated)} lbs, but shipped + stored at month-end − stored the month before = ${fmt(r.expectedGenerated)} lbs.`);
    });
    return { rows, sec4: bat, sec5, allBatteries: allBat,
      totals: { shipped: r2(sec5.reduce((a, r) => a + r.shipped, 0)), stored: r2(sec5.reduce((a, r) => a + r.stored, 0)), total: r2(sec5.reduce((a, r) => a + r.generated, 0) + allBat) },
      issues };
  };

  /** A CBEP month-end inventory check (counts only toward the CBEP claim; Non-CRT checks only toward the 196B). */
  L.isCbepInventory = (w) => !!(w && w.kind === 'inventory' && w.inventory && w.inventory.program === 'cbep');
  /** Lines of material + weight, sorted into the 196C categories (by each material's 196C residual). */
  L.by196C = (lines, materials = []) => {
    const out = {};
    (lines || []).forEach((l) => {
      const res = L.residual196C(materials.find((m) => m.id === l.materialId));
      if (res === L.NOT_CBEP) return;
      const n = L.lineNet(l); if (!n) return;
      out[res] = r2((out[res] || 0) + n);
    });
    return out;
  };
  /** Stored at month-end from that month's CBEP inventory check(s), by 196C category; null if there's no check. */
  L.cbepStoredFromChecks = (wcs, materials, month) => {
    const checks = wcs.filter((w) => L.isCbepInventory(w) && L.inventoryMonthKey(w) === month);
    if (!checks.length) return null;
    const out = {};
    checks.forEach((w) => Object.entries(L.by196C(w.inventory.lines, materials)).forEach(([k, v]) => { out[k] = r2((out[k] || 0) + v); }));
    return out;
  };
  /** The daily CBEP residual log (what was generated each day from dismantling): per day and per 196C category. */
  L.cbepDailyResiduals = (days = {}, materials = []) => {
    const rows = Object.keys(days).sort().map((date) => {
      const byRes = L.by196C(days[date], materials);
      return { date, byRes, total: r2(Object.values(byRes).reduce((a, x) => a + x, 0)) };
    }).filter((r) => r.total > 0 || (days[r.date] || []).length);
    const totals = {};
    rows.forEach((r) => Object.entries(r.byRes).forEach(([k, v]) => { totals[k] = r2((totals[k] || 0) + v); }));
    return { rows, totals, total: r2(Object.values(totals).reduce((a, x) => a + x, 0)) };
  };

  // ---------- cancellations: bulk entries and daily summaries ----------
  /** A cancelled-log line counts as one unit, or as its bulk breakdown's units. */
  L.unitCount = (u) => (u && u.bulk ? Math.max(1, (u.bulkItems || []).reduce((a, x) => a + num(x.units), 0)) : 1);
  /** Lines much heavier than one device: likely a weighed stack. */
  L.likelyBulk = (rows) => {
    const w = rows.map((r) => num(r.weight)).filter((x) => x > 0).sort((a, b) => a - b);
    const median = w.length ? w[Math.floor(w.length / 2)] : 0;
    const limit = Math.max(100, median * 4);
    return rows.map((r) => !r.bulk && num(r.weight) > limit);
  };
  /** Daily summary: units and pounds per day — from the log, plus any days typed in by hand. */
  L.dailySummary = (units = [], manual = []) => {
    const by = new Map();
    units.forEach((u) => { const d = u.date || ''; const x = by.get(d) || { date: d, units: 0, weight: 0, manual: false }; x.units += L.unitCount(u); x.weight = r2(x.weight + num(u.weight)); by.set(d, x); });
    manual.forEach((m) => { if (!m.date) return; const x = by.get(m.date) || { date: m.date, units: 0, weight: 0, manual: true }; x.units += num(m.units); x.weight = r2(x.weight + num(m.weight)); x.manual = true; by.set(m.date, x); });
    const days = [...by.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { days, total: { units: days.reduce((a, d) => a + d.units, 0), weight: r2(days.reduce((a, d) => a + d.weight, 0)) } };
  };

  // ---------- a transfer claimed over more than one month: its 198 C per claim period ----------
  L.PROGRAM_COLUMN = { NonCRT: 'noncrt', CBEP: 'cbep', CRT: 'crt' };
  /**
   * One period's share of a transfer's 198 C: entries for that period's units of its program, taken in log order
   * from what earlier-made periods haven't taken (`taken` = [{src, units}]), an entry split when it straddles
   * months; plus every struck line (never claimed, so struck on every month's 198 C), in log order.
   */
  L.claimPart = (lines, program, taken, need) => {
    const col = L.PROGRAM_COLUMN[program];
    let left = num(need); const parts = [];
    lines.forEach((l, i) => {
      if (l.struck) return;
      const used = (taken || []).filter((x) => x.src === i).reduce((a, x) => a + num(x.units), 0);
      const avail = num(l[col]) - used;
      const u = Math.min(avail, left); if (u <= 0) return;
      left -= u; parts.push({ src: i, units: u });
    });
    return { parts, short: left };
  };
  L.partLines = (lines, program, parts) => {
    const col = L.PROGRAM_COLUMN[program];
    return lines.map((l, i) => {
      if (l.struck) return [{ ...l }];
      const mine = parts.filter((x) => x.src === i);
      if (!mine.length) return [];
      const u = mine.reduce((a, x) => a + num(x.units), 0);
      return [{ ...l, crt: 0, noncrt: 0, cbep: 0, [col]: u }];
    }).flat();
  };

  // ---------- 197S transfer summary ----------
  L.transferSummary = ({ period, allocations = [], wcs = [], partyName = () => '' }) => {
    const rows = allocations.filter((a) => a.claimPeriodId === period.id).map((a) => {
      const w = wcs.find((x) => x.id === a.wcId) || {};
      const others = allocations.filter((b) => b.wcId === a.wcId && b.claimPeriodId !== period.id);
      return { wcId: a.wcId, wcNumber: w.wcNumber, date: w.date, collector: partyName(w), units: num(a.units), weight: r2(num(a.weight)), partial: others.length > 0 };
    }).sort((x, y) => String(x.date).localeCompare(String(y.date)) || String(x.wcNumber).localeCompare(String(y.wcNumber), undefined, { numeric: true }));
    return { rows, totals: { units: rows.reduce((a, r) => a + r.units, 0), weight: r2(rows.reduce((a, r) => a + r.weight, 0)) } };
  };

  // ---------- 4.0: streamlining ----------
  const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  L.addDays = addDays;
  const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); if (!a.length) return 0; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

  /** Rate history: a price item's rates as they were on a date (rates changed on `since`; earlier ones in `history`). */
  L.rateOn = (item, date) => {
    if (!item || !date || !item.since || date >= item.since) return item;
    const past = (item.history || []).filter((h) => h.from <= date).sort((a, b) => String(b.from).localeCompare(String(a.from)))[0]
      || (item.history || []).slice().sort((a, b) => String(a.from).localeCompare(String(b.from)))[0];
    return past ? { ...item, dropOff: past.dropOff, pickUp: past.pickUp, variable: past.variable } : item;
  };
  L.priceItemsOn = (items, date) => (items || []).map((p) => L.rateOn(p, date));
  /** Saving new rates: the old ones go into history, in effect until `from`. */
  L.withNewRates = (item, rates, from) => {
    const changed = ['dropOff', 'pickUp', 'variable'].some((k) => k in rates && String(rates[k] ?? '') !== String(item[k] ?? ''));
    if (!changed) return { ...item, ...rates };
    // a first rate (nothing set before) isn't a change of rate: no history
    const hadRate = ['dropOff', 'pickUp'].some((k) => String(item[k] ?? '').trim() !== '') || item.variable;
    if (!hadRate) return { ...item, ...rates };
    const history = [...(item.history || []), { from: item.since || '0000-01-01', dropOff: item.dropOff, pickUp: item.pickUp, variable: item.variable }];
    return { ...item, ...rates, since: from, history };
  };

  /** Usual pounds per unit for each kind, from all transfer lines (needs 8 lines before it judges). */
  L.unitWeightNorms = (wcs) => {
    const by = {};
    wcs.filter((w) => w.kind === 'transfer' && !w.voided).forEach((w) => ((w.transfer && w.transfer.lines) || []).forEach((l) => {
      const m = L.lineMath(l); if (m.irrUnits > 0 && m.irrWeight > 0) (by[l.category] = by[l.category] || []).push(m.irrWeight / m.irrUnits);
    }));
    return Object.fromEntries(Object.entries(by).map(([k, xs]) => [k, { median: r2(median(xs)), n: xs.length }]));
  };
  L.unitWeightIssues = (transfer, norms) => ((transfer && transfer.lines) || []).flatMap((l) => {
    const m = L.lineMath(l); const n = norms[l.category];
    if (!n || n.n < 8 || !(m.irrUnits > 0) || !(m.irrWeight > 0)) return [];
    const per = m.irrWeight / m.irrUnits;
    if (per > n.median * 2.5 || per < n.median * 0.4) return [`${(L.CATEGORIES.find((c) => c.key === l.category) || {}).label || l.category}: ${fmt(r2(per))} lbs per unit — usually about ${fmt(n.median)} (${n.n} lines). Check the units and weight.`];
    return [];
  });

  /** Make & model (or CBEP device) usual weights, learned from cancellation logs; bulk lines and excluded ones left out. */
  L.modelKey = (u) => L.norm(u.device ? `device ${u.device}` : `${u.make || ''} ${u.model || ''}`);
  L.modelWeights = (units, excluded = []) => {
    const by = new Map();
    units.filter((u) => !u.bulk && !excluded.includes(u.id) && num(u.weight) > 0 && L.modelKey(u).trim()).forEach((u) => {
      const k = L.modelKey(u); by.set(k, [...(by.get(k) || []), num(u.weight)]);
    });
    return new Map([...by].map(([k, xs]) => [k, { median: r2(median(xs)), n: xs.length }]));
  };
  L.modelWeightFlag = (u, map, { minSeen = 3, tolerance = 0.5 } = {}) => {
    if (!u || u.bulk || !(num(u.weight) > 0)) return null;
    const m = map.get(L.modelKey(u)); if (!m || m.n < minSeen || !m.median) return null;
    return Math.abs(num(u.weight) - m.median) / m.median > tolerance ? { usual: m.median, n: m.n } : null;
  };

  /** All paperwork received: the step's date, or once the 198 (the A if adjustments were needed) and the signed 197 are both in. */
  L.paperworkDate = (w) => {
    const tl = ((w && w.transfer) || {}).timeline || {};
    if (tl.allPaperwork && tl.allPaperwork !== 'N/A') return tl.allPaperwork;
    const logs = tl.customerAdjustments && tl.customerAdjustments !== 'N/A' ? tl.customerAdjustments : tl.sourceLogsReceived;
    if (!logs || logs === 'N/A' || !tl.form197Signed || tl.form197Signed === 'N/A') return '';
    return [logs, tl.form197Signed].sort().pop();
  };
  /** 3 calendar days from all paperwork to close and pay (not for Dual Entity transfers). */
  L.paymentDue = (w, today) => {
    if (!w || w.kind !== 'transfer' || w.voided || (w.transfer && w.transfer.selfCollected)) return null;
    const p = L.paperworkDate(w); if (!p) return null;
    const due = addDays(p, 3); const paid = ((w.transfer.timeline || {}).paid);
    const status = paid && paid !== 'N/A' ? 'paid' : today > due ? 'overdue' : today === due ? 'due-today' : addDays(today, 1) === due ? 'due-tomorrow' : 'open';
    return { paperwork: p, due, status, paid: paid && paid !== 'N/A' ? paid : '' };
  };

  /** A claim's payment requested: claimed pounds × CalRecycle's rate for its claim type (Settings). */
  L.claimAmount = (period, allocations, rates = {}) => {
    const rate = L.parseMoney((rates || {})[period.cewType]);
    if (rate === null) return null;
    return r2(L.sumAllocs(allocations.filter((a) => a.claimPeriodId === period.id)).weight * rate);
  };
  L.requestedFor = (period, allocations, rates) => {
    const typed = L.parseMoney(period.requestedAmount);
    return typed !== null ? typed : L.claimAmount(period, allocations, rates);
  };

  /** The same source (name + address) on more than one transfer's 198 — a double claim waiting to happen. */
  L.sourceDuplicates = (transfers) => {
    const by = new Map();
    transfers.forEach((w) => {
      const b = L.logBasis(w.transfer || {}); if (!b.log) return;
      b.log.rows.forEach((r) => {
        const k = `${L.norm(r.name).replace(/\s+/g, '')}|${L.norm(r.address).replace(/\s+/g, '')}`;
        if (k === '|') return;
        const list = by.get(k) || []; if (!list.some((x) => x.wc.id === w.id)) list.push({ wc: w, row: r }); by.set(k, list);
      });
    });
    return [...by.values()].filter((list) => list.length > 1).map((list) => ({ name: list[0].row.name, address: list[0].row.address, transfers: list.map((x) => x.wc) }));
  };
  /** Cancellation lines dated before their transfer was received. */
  L.cancelledEarly = (units, wcs) => units.filter((u) => {
    const w = wcs.find((x) => x.kind === 'transfer' && L.normLot(x.wcNumber) === L.normLot(u.lotNumber));
    return w && u.date && w.date && u.date < w.date;
  });

  /** Margin: the claim payment a transfer should bring (its claimable pounds × claim rate) less what we paid for it. */
  L.transferMargin = ({ wc, invoice, rates = {} }) => {
    const c = L.transferMath((wc && wc.transfer) || {}).claimable || {};
    let expected = 0; let known = true;
    ['NonCRT', 'CBEP'].forEach((k) => {
      const lbs = (c[k] || {}).weight || 0; if (!lbs) return;
      const rate = L.parseMoney(rates[k]); if (rate === null) { known = false; return; }
      expected = r2(expected + lbs * rate);
    });
    const paid = invoice ? invoice.finalBalance : 0;
    return { expected: known ? expected : null, paid, margin: known ? r2(expected - paid) : null };
  };

  /** Archived: a transfer fully claimed on claims closed more than `days` ago. */
  L.isArchived = (w, allocations, periods, today, days = 90) => {
    if (!w || w.kind !== 'transfer') return false;
    const mine = allocations.filter((a) => a.wcId === w.id); if (!mine.length) return false;
    const c = L.transferMath(w.transfer || {}).claimable || {};
    const full = Object.entries(c).every(([k, v]) => !v.weight || L.sumAllocs(mine.filter((a) => (periods.find((p) => p.id === a.claimPeriodId) || {}).cewType === k)).weight >= v.weight - 0.01);
    const cutoff = addDays(today, -days);
    return full && mine.every((a) => { const p = periods.find((x) => x.id === a.claimPeriodId); return p && p.closedDate && p.closedDate <= cutoff; });
  };

  /** Everything the top-bar search can find. */
  L.searchIndex = (data) => {
    const out = [];
    data.allWcs.forEach((w) => {
      const company = data.companies.find((c) => c.id === w.companyId || (w.transfer && (c.id === w.transfer.handlerId || c.id === w.transfer.collectorId)));
      out.push({ kind: 'WC', label: `WC #${w.wcNumber || '(no #)'}${w.voided ? ' · VOID' : ''}`, sub: [w.kind, company && company.name, w.date].filter(Boolean).join(' · '), href: `#/wc/${w.id}`,
        text: L.norm([w.wcNumber, w.transfer && w.transfer.irrNumber ? `irr ${w.transfer.irrNumber}` : '', company && company.name].join(' ')) });
      ['o', 'a'].forEach((k) => { const lg = w.transfer && w.transfer.logs && w.transfer.logs[k];
        (lg && lg.rows || []).forEach((r) => out.push({ kind: `198 ${k.toUpperCase()}`, label: r.name || '(no name)', sub: `${r.address || ''} · WC #${w.wcNumber}`, href: `#/wc/${w.id}`, text: L.norm(`${r.name} ${r.address}`) })); });
    });
    data.companies.forEach((c) => out.push({ kind: 'Company', label: c.name, sub: (c.roles || []).join(', '), href: `#/companies/${c.id}`, text: L.norm(`${c.name} ${(c.aliases || []).join(' ')} ${c.cewId || ''}`) }));
    return out;
  };
  L.search = (index, q, limit = 12) => {
    const words = L.norm(q).split(/\s+/).filter(Boolean); if (!words.length) return [];
    return index.filter((x) => words.every((w) => x.text.includes(w))).slice(0, limit);
  };

  /** What a save changed, in plain words (for a WC's edit history). */
  L.changedFields = (before, after) => {
    const out = []; const skip = new Set(['history', 'updatedAt', 'createdAt']);
    const walk = (a, b, path) => {
      if (out.length > 40) return;
      if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
        new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => { if (!skip.has(k)) walk(a[k], b[k], path ? `${path}.${k}` : k); });
        return;
      }
      if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) { a.forEach((x, i) => walk(x, b[i], `${path}[${i + 1}]`)); return; }
      const sa = JSON.stringify(a ?? ''); const sb = JSON.stringify(b ?? '');
      if (sa !== sb) out.push({ field: path, from: Array.isArray(a) ? `${a.length} items` : String(a ?? ''), to: Array.isArray(b) ? `${b.length} items` : String(b ?? '') });
    };
    walk(before, after, '');
    return out;
  };

  // ---------- annual summary (calendar year, each item by its own date) ----------
  /**
   * transfers: [{ wc, customer (name), invoice (L.invoiceMath result) }]; shipments: residual and CRT/plasma
   * shipment WCs; periods: claim periods; otherSales: [{date, buyer, description, amount}].
   */
  L.annualSummary = ({ year, transfers = [], shipments = [], periods = [], otherSales = [], materials = [], companyName = () => '' }) => {
    const Y = String(year);
    const inYear = (iso) => typeof iso === 'string' && iso.slice(0, 4) === Y;
    const month = (iso) => Number(String(iso).slice(5, 7)) - 1;
    const months = () => Array.from({ length: 12 }, () => 0);
    const KINDS = ['lcdled', 'crt', 'plasma', 'cbep', 'other'];
    const blankKinds = () => Object.fromEntries(KINDS.map((k) => [k, { units: 0, weight: 0, cew: 0 }]));
    // received
    const recv = { rows: [], totals: { units: 0, weight: 0, byKind: blankKinds() }, monthlyWeight: months(), monthlyUnits: months() };
    const paid = { rows: [], byKind: new Map(), byCompany: new Map(), monthly: months(), totals: { credit: 0, deduction: 0, balance: 0 } };
    transfers.forEach(({ wc, customer, invoice }) => {
      const t = wc.transfer || {};
      if (inYear(wc.date)) {
        const byKind = blankKinds(); let units = 0; let weight = 0;
        (t.lines || []).forEach((line) => {
          const m = L.lineMath(line); const k = KINDS.includes(line.category) ? line.category : 'other';
          byKind[k].units += m.irrUnits; byKind[k].weight = r2(byKind[k].weight + m.irrWeight); byKind[k].cew += m.cat.cew ? m.cewUnits : 0;
          units += m.irrUnits; weight = r2(weight + m.irrWeight);
        });
        KINDS.forEach((k) => { const a = recv.totals.byKind[k]; a.units += byKind[k].units; a.weight = r2(a.weight + byKind[k].weight); a.cew += byKind[k].cew; });
        recv.totals.units += units; recv.totals.weight = r2(recv.totals.weight + weight);
        recv.monthlyUnits[month(wc.date)] += units; recv.monthlyWeight[month(wc.date)] = r2(recv.monthlyWeight[month(wc.date)] + weight);
        recv.rows.push({ id: wc.id, date: wc.date, wcNumber: wc.wcNumber, customer, type: t.transferType || 'cew', units, weight, byKind });
      }
      // paid for material: by the purchase invoice's date
      const po = t.timeline && t.timeline.poSent && t.timeline.poSent !== 'N/A' ? t.timeline.poSent : '';
      const invDate = t.poDate || po || wc.date;
      if (invoice && inYear(invDate) && (invoice.credits.length || invoice.deductions.length)) {
        const credit = invoice.totalCredit; const deduction = invoice.totalDeduction; const balance = invoice.finalBalance;
        invoice.credits.forEach((c) => { if (c.amount !== null) paid.byKind.set(c.label.replace(/ — .*$/, ''), r2((paid.byKind.get(c.label.replace(/ — .*$/, '')) || 0) + c.amount)); });
        paid.byCompany.set(customer || '—', r2((paid.byCompany.get(customer || '—') || 0) + balance));
        paid.monthly[month(invDate)] = r2(paid.monthly[month(invDate)] + balance);
        paid.totals.credit = r2(paid.totals.credit + credit); paid.totals.deduction = r2(paid.totals.deduction + deduction); paid.totals.balance = r2(paid.totals.balance + balance);
        paid.rows.push({ id: wc.id, date: invDate, wcNumber: wc.wcNumber, customer, credit, deduction, balance, missing: invoice.missing });
      }
    });
    // shipped out
    const matName = (id) => (materials.find((m) => m.id === id) || {}).name || 'Unlisted';
    const ship = { residual: [], crt: [], monthlyWeight: months(), totals: { residualWeight: 0, crtUnits: 0, crtWeight: 0, plasmaUnits: 0, plasmaWeight: 0 } };
    const sales = { rows: [], total: 0, charged: 0 };
    shipments.filter((w) => inYear(w.date)).forEach((w) => {
      const settle = (w.crtShipment || w.shipment || {}).settlement;
      const amt = L.settlementAmount(settle);
      const cl = L.crtLines(w);
      const crt = cl.filter((l) => l.category === 'crt').reduce((a, l) => ({ units: a.units + num(l.units), weight: r2(a.weight + num(l.weight)) }), { units: 0, weight: 0 });
      const plasma = cl.filter((l) => l.category === 'plasma').reduce((a, l) => ({ units: a.units + num(l.units), weight: r2(a.weight + num(l.weight)) }), { units: 0, weight: 0 });
      if (w.kind === 'shipment') {
        const byMat = new Map(); let weight = 0;
        ((w.shipment && w.shipment.lines) || []).forEach((l) => { const n = L.lineNet(l); weight = r2(weight + n); const k = l.materialId != null ? matName(l.materialId) : (l.description || 'Other'); byMat.set(k, r2((byMat.get(k) || 0) + n)); });
        ship.residual.push({ id: w.id, date: w.date, wcNumber: w.wcNumber, vendor: companyName(w.companyId), weight, byMaterial: [...byMat].map(([name, lbs]) => ({ name, lbs })), settlement: settle });
        ship.totals.residualWeight = r2(ship.totals.residualWeight + weight); ship.monthlyWeight[month(w.date)] = r2(ship.monthlyWeight[month(w.date)] + weight);
      }
      if (crt.units || plasma.units || w.kind === 'crtShipment') {
        ship.crt.push({ id: w.id, date: w.date, recycler: companyName(w.companyId), crt, plasma, settlement: settle });
        ship.totals.crtUnits += crt.units; ship.totals.crtWeight = r2(ship.totals.crtWeight + crt.weight);
        ship.totals.plasmaUnits += plasma.units; ship.totals.plasmaWeight = r2(ship.totals.plasmaWeight + plasma.weight);
        if (w.kind === 'crtShipment') ship.monthlyWeight[month(w.date)] = r2(ship.monthlyWeight[month(w.date)] + crt.weight + plasma.weight);
      }
      if (amt > 0) { sales.rows.push({ date: w.date, source: w.kind === 'crtShipment' ? 'CRT/plasma shipment' : 'Residual shipment', who: companyName(w.companyId), description: w.wcNumber ? `WC #${w.wcNumber}` : ((w.crtShipment && w.crtShipment.reference) || ''), amount: amt }); sales.total = r2(sales.total + amt); }
      if (amt < 0) sales.charged = r2(sales.charged - amt);
    });
    otherSales.filter((x) => inYear(x.date)).forEach((x) => { const a = L.parseMoney(x.amount) || 0; sales.rows.push({ date: x.date, source: 'Other sale', who: x.buyer || '', description: x.description || '', amount: a, otherId: x.id }); sales.total = r2(sales.total + a); });
    sales.rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    // claims: by the claim period's month
    const claims = { rows: [], totals: { requested: 0, received: 0 } };
    periods.filter((p) => String(p.year) === Y).sort((a, b) => a.month - b.month || String(a.cewType).localeCompare(b.cewType)).forEach((p) => {
      const req = L.parseMoney(p.requestedAmount); const rec = L.parseMoney(p.receivedAmount);
      claims.rows.push({ id: p.id, cewType: p.cewType, month: p.month, requested: req, received: rec, diff: req !== null && rec !== null ? r2(rec - req) : null, paidDate: p.paidDate || '' });
      claims.totals.requested = r2(claims.totals.requested + (req || 0)); claims.totals.received = r2(claims.totals.received + (rec || 0));
    });
    const sortDesc = (m) => [...m].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
    return {
      year: Number(year), received: recv, shipped: ship, claims, sales,
      paid: { ...paid, byKind: sortDesc(paid.byKind), byCompany: sortDesc(paid.byCompany) },
      money: { income: r2(claims.totals.received + sales.total), spent: r2(paid.totals.balance + sales.charged) },
    };
  };

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

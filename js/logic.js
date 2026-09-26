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

  // ---------- WC numbers ----------
  /** One past the highest WC # on file, keeping any prefix/zero-padding; skips numbers already used. */
  L.nextWcNumber = (wcs) => {
    let best = null;
    wcs.forEach((w) => {
      const m = /^(.*?)(\d+)$/.exec(String(w.wcNumber || '').trim());
      if (!m) return;
      const n = parseInt(m[2], 10);
      if (!best || n > best.n || (n === best.n && (w.id || 0) > (best.id || 0))) best = { prefix: m[1], n, width: m[2].length, id: w.id };
    });
    if (!best) return '';
    const taken = new Set(wcs.map((w) => L.normLot(w.wcNumber)));
    let n = best.n + 1; let candidate;
    do { candidate = best.prefix + String(n).padStart(best.width, '0'); n += 1; } while (taken.has(L.normLot(candidate)));
    return candidate;
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
  // ---------- pricing, purchase invoice ----------
  L.PRICE_KEYS = [
    ['cew:lcdled', 'CEW LCD/LED'], ['noncew:lcdled', 'Non-CEW LCD/LED'],
    ['cew:crt', 'CEW CRT'], ['noncew:crt', 'Non-CEW CRT'],
    ['cew:plasma', 'CEW Plasma'], ['noncew:plasma', 'Non-CEW Plasma'],
    ['cew:cbep', 'CEW CBEP'], ['noncew:cbep', 'Non-CEW CBEP'],
    ['other', 'Other (non-CEW) item'],
  ];
  L.MATERIAL_MODES = [['dropoff', 'Drop off'], ['pickup', 'Pick up'], ['both', 'Both']];
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
  L.documentRows = (transfer) => {
    const rows = [];
    ((transfer && transfer.lines) || []).forEach((line, i) => {
      const m = L.lineMath(line);
      const desc = String(line.description || '').trim();
      if (!m.cat.cew) {
        if (m.irrUnits || m.irrWeight) {
          rows.push({ lineIndex: i, part: 'other', key: 'other', label: desc || 'Other (non-CEW)', units: m.irrUnits, weight: m.irrWeight, priceItemId: line.priceItemId ?? null, manualRate: line.rate });
        }
        return;
      }
      const suffix = desc ? ` — ${desc}` : '';
      if (m.cewUnits || m.cewWeight) rows.push({ lineIndex: i, part: 'cew', key: `cew:${m.cat.key}`, label: `CEW ${m.cat.label}${suffix}`, units: m.cewUnits, weight: m.cewWeight, manualRate: line.cewRate });
      if (m.nonCewUnits || m.nonCewWeight) rows.push({ lineIndex: i, part: 'noncew', key: `noncew:${m.cat.key}`, label: `Non-CEW ${m.cat.label}${suffix}`, units: m.nonCewUnits, weight: m.nonCewWeight, manualRate: line.nonCewRate });
    });
    return rows;
  };

  /**
   * Which rate applies to one invoice row, in order:
   * rate entered on the transfer (set at inspection) → the customer's own rate →
   * the master price list for pick-up or drop-off. "Variable" means it must be entered at inspection.
   */
  L.resolveRate = ({ row, mode, priceItems, company }) => {
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

  L.invoiceMath = ({ transfer, mode, priceItems, company }) => {
    const rows = L.documentRows(transfer).map((r) => {
      const res = L.resolveRate({ row: r, mode, priceItems, company });
      const qty = res.basis === 'unit' ? r.units : r.weight;
      return { ...r, ...res, amount: res.rate === null ? null : r2(res.rate * qty) };
    });
    const subtotal = r2(rows.reduce((s, r) => s + (r.amount || 0), 0));
    const totalWeight = r2(rows.reduce((s, r) => s + r.weight, 0));
    let trucking = null;
    const td = company && company.truckingDeduction;
    const a = td ? L.parseMoney(td.amount) : null;
    if (mode === 'pickup' && a) {
      const amount = td.basis === 'flat' ? a : td.basis === 'percent' ? r2((subtotal * a) / 100) : r2(totalWeight * a);
      const label = td.basis === 'flat' ? 'Trucking deduction' : td.basis === 'percent' ? `Trucking deduction (${a}%)` : `Trucking deduction (${fmt(totalWeight)} lbs × ${L.rateText(a)})`;
      trucking = { label, amount: -amount };
    }
    return { rows, subtotal, trucking, total: r2(subtotal + (trucking ? trucking.amount : 0)), totalWeight, missing: rows.filter((r) => r.needsRate).length };
  };

  // ---------- customer spreadsheet import ----------
  const CUSTOMER_COLS = [
    ['cbepEnrolled', /^cbep enrol/], ['cbepRate', /^cbep (price|rate)/], ['name', /^(company|customer|company name|customer name)$/],
    ['lcdled', /^lcd/], ['crt', /^crt/], ['plasma', /^plasma/], ['owner', /^owner/], ['cewId', /^cew ?id/], ['admin', /^admin/],
    ['sourceLogSystem', /^source log/], ['primaryLanguage', /language/], ['materialMode', /(pick ?up|drop ?off)/], ['trucking', /trucking/],
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
        cewId: String(rec.cewId || '').trim(),
        owner: String(rec.owner || '').trim(),
        admin: String(rec.admin || '').trim(),
        sourceLogSystem: String(rec.sourceLogSystem || '').trim(),
        primaryLanguage: String(rec.primaryLanguage || '').trim(),
        materialMode: /pick/.test(mode) && /drop/.test(mode) ? 'both' : /pick/.test(mode) ? 'pickup' : /drop/.test(mode) ? 'dropoff' : '',
        truckingDeduction: parseTrucking(rec.trucking),
        cbepEnrolled: /^(y|yes|true|x|enrolled)\b/i.test(String(rec.cbepEnrolled || '').trim()),
        rates: { lcdled: parseRateCell(rec.lcdled), crt: parseRateCell(rec.crt), plasma: parseRateCell(rec.plasma), cbep: parseRateCell(rec.cbepRate) },
      });
    });
    return { rows, skipped, usedHeader, columns: new Set(order.filter(Boolean)) };
  };
})(typeof window !== 'undefined' ? ((window.App = window.App || {}), (window.App.Logic = {})) : module.exports);

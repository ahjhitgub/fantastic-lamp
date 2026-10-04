/**
 * store.js — data helpers shared by pages, plus the one-time move of pre-v4
 * records (collectors, transfers, shipments, old unit fields) into the new shape.
 */
window.App = window.App || {};

App.Store = (function () {
  const L = () => App.Logic;

  async function loadAll() {
    const names = ['wcs', 'companies', 'claimPeriods', 'transferAllocations', 'wcTypes', 'wcStatuses', 'materials', 'priceItems', 'shipDescriptions'];
    const [wcs, companies, periods, allocations, wcTypes, wcStatuses, materials, priceItems, shipDescriptions] = await Promise.all(names.map((n) => App.DB.getAll(n)));
    shipDescriptions.sort((a, b) => String(a.name).localeCompare(b.name));
    const profile = (await App.DB.get('facilityProfile', 'profile')) || {};
    wcStatuses.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
    companies.sort((a, b) => a.name.localeCompare(b.name));
    materials.sort((a, b) => a.name.localeCompare(b.name));
    periods.sort((a, b) => (b.year - a.year) || (b.month - a.month) || String(a.cewType).localeCompare(b.cewType));
    const keyOrder = App.Logic.PRICE_KEYS.map(([k]) => k);
    priceItems.sort((a, b) => (keyOrder.indexOf(a.appliesTo) - keyOrder.indexOf(b.appliesTo)) || String(a.name).localeCompare(b.name));
    const skippedRec = (await App.DB.get('meta', 'skippedNumbers')) || {};
    const skipped = { wc: skippedRec.wc || [], irr: skippedRec.irr || [] };
    return { wcs, companies, periods, allocations, wcTypes, wcStatuses, materials, priceItems, shipDescriptions, profile, skipped };
  }

  /**
   * Who is on each side of a transfer. We are always the recycler. With a handler
   * selected, we are also the collector; the handler is the customer.
   */
  function transferParties(wc, data) {
    const t = (wc && wc.transfer) || {};
    const byId = (id) => data.companies.find((c) => c.id === id) || null;
    const facility = { name: data.profile.recyclerName || 'Our facility (set the name in Settings)', cewId: data.profile.cewID || '' };
    // on a handler's transfer (or our own collection) we're both collector and recycler: our CEWID in both boxes
    const asCollector = { name: facility.name, cewId: facility.cewId };
    const handler = byId(t.handlerId);
    // our own collection (dual entity, no customer) — "Dual entity" rows in the WC log
    const self = !handler && !!t.selfCollected;
    const collectorCompany = handler || self ? null : byId(t.collectorId);
    const collector = handler || self ? asCollector : (collectorCompany ? { name: collectorCompany.name, cewId: collectorCompany.cewId || '' } : null);
    return { facility, handler, collector, collectorIsFacility: !!handler || self, selfCollected: self, dualEntity: !!data.profile.dualEntity, customer: handler || collectorCompany };
  }

  async function wcNumberTaken(wcNumber, exceptId) {
    const k = L().normLot(wcNumber);
    if (!k) return false;
    return (await App.DB.getAll('wcs')).some((w) => L().normLot(w.wcNumber) === k && w.id !== exceptId);
  }

  function blankTransferLine() { return { category: 'lcdled', irrUnits: '', irrGross: '', irrTare: '', irrWeight: '', cewUnits: '', nonCewWeight: '' }; }

  async function irrNumberTaken(irrNumber, exceptId) {
    const k = L().normLot(irrNumber);
    if (!k) return false;
    return (await App.DB.getAll('wcs')).some((w) => w.kind === 'transfer' && w.id !== exceptId && L().normLot(w.transfer && w.transfer.irrNumber) === k);
  }
  function blankWeighLine() { return { materialId: null, gross: '', tare: '', net: '' }; }

  /**
   * <option>s for "who is it from / going to".
   * transfer → values "handler:ID" / "collector:ID"; anything else → company id (destinations first).
   */
  function partyOptions(kind, companies, selected) {
    const { esc } = App.UI;
    const opt = (value, c) => `<option value="${value}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${esc(c.name)}${c.cewId ? ` — ${esc(c.cewId)}` : ''}${c.accountStatus === 'closed' ? ' (closed)' : ''}</option>`;
    const sel = String(selected ?? '');
    // closed accounts stay out of the list unless this record already uses them
    companies = companies.filter((c) => c.accountStatus !== 'closed' || sel === String(c.id) || sel === `handler:${c.id}` || sel === `collector:${c.id}`);
    const has = (c, r) => (c.roles || []).includes(r);
    if (kind === 'transfer') {
      const handlers = companies.filter((c) => has(c, 'handler'));
      const collectors = companies.filter((c) => has(c, 'collector'));
      return `<option value="">— choose —</option>`
        + (handlers.length ? `<optgroup label="Handlers (we're the collector)">${handlers.map((c) => opt(`handler:${c.id}`, c)).join('')}</optgroup>` : '')
        + (collectors.length ? `<optgroup label="Approved collectors">${collectors.map((c) => opt(`collector:${c.id}`, c)).join('')}</optgroup>` : '');
    }
    if (kind === 'crtShipment') {
      const recyclers = companies.filter((c) => has(c, 'recycler'));
      return `<option value="">— choose —</option>` + recyclers.map((c) => opt(c.id, c)).join('');
    }
    const groups = kind === 'shipment'
      ? [['Vendors', companies.filter((c) => has(c, 'destination') || has(c, 'recycler'))]]
      : [];
    const listed = new Set(groups.flatMap(([, list]) => list));
    groups.push([groups.length ? 'Other companies' : 'Companies', companies.filter((c) => !listed.has(c))]);
    return `<option value="">— none —</option>`
      + groups.filter(([, list]) => list.length).map(([label, list]) => `<optgroup label="${label}">${list.map((c) => opt(c.id, c)).join('')}</optgroup>`).join('');
  }
  const partyLabel = (kind) => (kind === 'transfer' ? 'From (customer)' : kind === 'shipment' || kind === 'crtShipment' ? 'Going to' : 'Company');

  const platesOf = (x) => (Array.isArray(x) ? x : L().splitPlates(x));
  /**
   * License plates that fit a trip. Inbound (transfer): dropped off = the customer's truck, picked up = ours.
   * Outbound (shipment): dropped off = we delivered (ours), picked up = the vendor's truck.
   */
  /** True when a plate was filled in from a known list (ours or the company's) rather than typed by hand. */
  function isKnownPlate(plate, company, profile) {
    const p = String(plate || '').trim().toUpperCase();
    return !p || platesOf(profile && profile.vehicles).includes(p) || platesOf(company && company.licensePlates).includes(p);
  }
  function plateChoices({ direction, mode, company, profile }) {
    const ours = platesOf(profile && profile.vehicles);
    const theirs = platesOf(company && company.licensePlates);
    const usOnes = direction === 'in' ? mode === 'pickup' : mode === 'dropoff';
    return { plates: usOnes ? ours : theirs, whose: usOnes ? 'our vehicle' : company ? `${company.name}'s vehicle` : "the other company's vehicle" };
  }

  async function createWC({ wcNumber, typeId, date, companyId, party, irrNumber, noWc, kind: forcedKind, reference, transferType, shipmentType }) {
    if (forcedKind === 'crtShipment') {
      // CRT/plasma shipments to another recycler don't get a WC
      const recId = party ? Number(party) : null;
      const rec = { wcNumber: '', noWc: true, typeId: null, kind: 'crtShipment', date: date || App.UI.today(), statusId: null, companyId: recId, notes: '', createdAt: new Date().toISOString(),
        crtShipment: { reference: String(reference || '').trim(), mode: '', licensePlate: '', lines: [], settlement: { type: '', amount: '', reference: '', date: '' } } };
      if (recId) {
        const [c, profile] = await Promise.all([App.DB.get('companies', recId), App.DB.get('facilityProfile', 'profile')]);
        if (c && (c.materialMode === 'pickup' || c.materialMode === 'dropoff')) rec.crtShipment.mode = c.materialMode;
        rec.crtShipment.licensePlate = plateChoices({ direction: 'out', mode: rec.crtShipment.mode, company: c, profile }).plates[0] || '';
      }
      return App.DB.add('wcs', rec);
    }
    const number = noWc ? '' : String(wcNumber || '').trim();
    if (!number && !noWc) throw new Error('Enter a WC #.');
    if (await wcNumberTaken(number)) throw new Error(`WC #${number} already exists.`);
    const irr = irrNumber === undefined ? undefined : String(irrNumber || '').trim();
    if (irr && await irrNumberTaken(irr)) throw new Error(`IRR #${irr} is already used on another transfer.`);
    const type = (await App.DB.getAll('wcTypes')).find((t) => t.id === typeId);
    if (!type) throw new Error('Pick a WC type.');
    const kind = type.kind || 'generic';
    const rec = { wcNumber: number, typeId, kind, date: date || '', statusId: null, companyId: companyId || null, notes: '', createdAt: new Date().toISOString() };
    const [role, idText] = String(party || '').includes(':') ? String(party).split(':') : [null, party];
    const partyId = idText ? Number(idText) : null;
    if (kind === 'transfer') {
      const d = date || App.UI.today();
      const all = await App.DB.getAll('wcs');
      const lastBy = all.filter((w) => w.kind === 'transfer' && w.transfer && w.transfer.irrBy).sort((x, y) => y.id - x.id)[0];
      rec.transfer = { collectorId: role === 'collector' ? partyId : null, handlerId: role === 'handler' ? partyId : null, mode: '',
        irrNumber: irr === undefined ? L().nextIrrNumber(all) : irr, shippingDate: '', licensePlate: '', irrBy: lastBy ? lastBy.transfer.irrBy : '',
        poDate: '', circumstance: '', invoiceBy: '', deductions: [], scalePerson: '', transferType: transferType || 'cew',
        logs: { o: null, a: null }, strikes: null,
        lines: [blankTransferLine()], timeline: { wcAssigned: d, materialReceived: d }, activityNotes: '' };
      if (partyId) {
        rec.companyId = partyId;
        const [cust, profile] = await Promise.all([App.DB.get('companies', partyId), App.DB.get('facilityProfile', 'profile')]);
        if (cust && (cust.materialMode === 'pickup' || cust.materialMode === 'dropoff')) rec.transfer.mode = cust.materialMode;
        rec.transfer.licensePlate = plateChoices({ direction: 'in', mode: rec.transfer.mode, company: cust, profile }).plates[0] || '';
      }
    } else if (kind === 'shipment') {
      rec.shipment = { lines: [{ description: '', cew: true, materialId: null, gross: '', tare: '', net: '' }], mode: '', licensePlate: '',
        shipmentType: shipmentType || 'cew', paperwork: {} };
      if (partyId) {
        rec.companyId = partyId;
        const [c, profile] = await Promise.all([App.DB.get('companies', partyId), App.DB.get('facilityProfile', 'profile')]);
        if (c && c.materialFlow) rec.shipment.paperwork.materialFlow = c.materialFlow;   // the buyer's usual flow, editable per shipment
        if (c && (c.materialMode === 'pickup' || c.materialMode === 'dropoff')) rec.shipment.mode = c.materialMode;
        rec.shipment.licensePlate = plateChoices({ direction: 'out', mode: rec.shipment.mode, company: c, profile }).plates[0] || '';
      }
    } else if (kind === 'inventory') {
      // inventory is always ours: no company. A general entry (noWc) lists every residual except own-WC ones (LCD lamps).
      rec.noWc = !!noWc;
      const mats = (await App.DB.getAll('materials')).filter((m) => m.category !== 'Not a CEW residual' && (!noWc || !m.ownWc)).sort((a, b) => a.name.localeCompare(b.name));
      rec.inventory = { forMonth: (date || App.UI.today()).slice(0, 7), lines: [], materialOrder: noWc ? mats.filter((m) => m.program !== 'cbep').map((m) => m.id) : [] };
    }
    if (kind === 'generic' && partyId) rec.companyId = partyId;
    return App.DB.add('wcs', rec);
  }

  /** A transfer's 198 C lines and 198 UC (struck entries), from its basis 198 (A if adjustments were required, else O). */
  function transfer198(w) {
    const t = (w && w.transfer) || {};
    const basis = L().logBasis(t);
    if (!basis.log) return { basis, lines: [], uc: [], plan: null };
    const sp = L().strikePlan(t, basis.log.rows);
    const lines = L().claimLines(basis.log.rows, sp.plan);
    return { basis, lines, uc: L().ucLines(lines), plan: sp };
  }
  /** Everything already sent on 198 UCs from one transfer, by other shipment lines ({src, crt, noncrt}). */
  const sentFrom = (wcs, transferId, exceptShipmentId) => wcs.filter((x) => (x.kind === 'crtShipment' || x.kind === 'shipment') && x.id !== exceptShipmentId)
    .flatMap((x) => L().crtLines(x).filter((l) => l.wcId === transferId).flatMap((l) => l.ucSent || []));
  /**
   * The 198 UC entries that go out with a CRT/plasma shipment, per source transfer. The first time it's made, each
   * shipment line takes units from what's left on that transfer's UC and the choice is saved (locked) on the line,
   * so the same logs are never sent twice; later shipments take from what remains.
   */
  async function shipmentUc(shipment, data, { lock = true } = {}) {
    const out = []; let changed = false;
    const lines = L().crtLines(shipment);
    const ids = [...new Set(lines.map((l) => l.wcId))];
    for (const id of ids) {
      const w = data.wcs.find((x) => x.id === id);
      if (!w) continue;
      const T = transfer198(w);
      if (!T.basis.log) { out.push({ wc: w, missing: true, lines: [], short: null }); continue; }
      const sent = sentFrom(data.wcs, id, shipment.id);
      const taken = []; const short = { crt: 0, plasma: 0 };
      lines.filter((l) => l.wcId === id).forEach((l) => {
        if (!l.ucSent) {
          const need = { crt: l.category === 'crt' ? L().num(l.units) - L().num(l.rejectedUnits) : 0, plasma: l.category === 'plasma' ? L().num(l.units) - L().num(l.rejectedUnits) : 0 };
          const alloc = L().allocateUc(T.uc, sent.concat(taken), need);
          l.ucSent = alloc.lines.map((x) => ({ src: x.src, crt: x.crt, noncrt: x.noncrt }));
          l.ucShort = alloc.short; changed = true;
        }
        taken.push(...l.ucSent);
        short.crt += (l.ucShort && l.ucShort.crt) || 0; short.plasma += (l.ucShort && l.ucShort.plasma) || 0;
      });
      const entries = taken.map((x) => ({ ...T.uc[x.src], crt: x.crt, noncrt: x.noncrt, cbep: 0 })).filter((x) => x.name !== undefined);
      out.push({ wc: w, lines: entries, short, basis: T.basis });
    }
    if (changed && lock) await App.DB.put('wcs', shipment);
    return out;
  }
  /** What's left on a transfer's 198 UC after every shipment so far. */
  function ucRemaining(w, data) {
    const T = transfer198(w);
    return { basis: T.basis, uc: T.uc, remaining: L().ucRemaining(T.uc, sentFrom(data.wcs, w.id, null)) };
  }

  // ---------------------------------------------------------------- changing a WC's type (after a mistake)
  /** Fresh details for a kind — what creating a WC of that kind would set up. */
  function kindDefaults(kind, w, all) {
    const d = w.date || App.UI.today();
    if (kind === 'transfer') {
      return { collectorId: null, handlerId: null, mode: '', irrNumber: L().nextIrrNumber(all), shippingDate: '', licensePlate: '', irrBy: '',
        poDate: '', circumstance: '', invoiceBy: '', deductions: [], scalePerson: '', transferType: 'cew', logs: { o: null, a: null }, strikes: null,
        lines: [blankTransferLine()], timeline: { wcAssigned: d, materialReceived: d }, activityNotes: '' };
    }
    if (kind === 'shipment') return { lines: [{ description: '', cew: true, materialId: null, gross: '', tare: '', net: '' }], mode: '', licensePlate: '', shipmentType: 'cew', paperwork: {} };
    if (kind === 'inventory') return { forMonth: d.slice(0, 7), lines: [], materialOrder: [] };
    if (kind === 'generation') return { forMonth: d.slice(0, 7), residual: 'Other', lines: [{ gross: '', tare: '', net: '' }], scalePerson: '' };
    return null;
  }
  const KIND_NAMES = { transfer: 'transfer', shipment: 'residual shipment', inventory: 'inventory WC', generation: 'CBEP generation certificate', generic: 'WC' };
  /** What stops a WC from changing kind: claim records that depend on it. Same-kind changes are never blocked. */
  function typeChangeBlockers(w, to, data, units) {
    if (!to || (to.kind || 'generic') === w.kind) return [];
    const out = [];
    if (w.kind === 'transfer') {
      const al = data.allocations.filter((a) => a.wcId === w.id);
      if (al.length) out.push(`It's on ${al.length} claim${al.length === 1 ? '' : 's'} — remove its allocations first (its Claim periods section).`);
      const lot = units.filter((u) => String(u.lotNumber || '') === String(w.wcNumber || '')).length;
      if (lot) out.push(`${lot} cancellation log unit${lot === 1 ? '' : 's'} use it as their lot #.`);
      if (w.transfer && w.transfer.claimParts && Object.keys(w.transfer.claimParts).length) out.push('Its 198 C is split across claims.');
    }
    if (w.kind === 'shipment' && L().crtLines(w).some((l) => l.ucSent)) out.push('Its 198 UC entries are locked to it.');
    if (w.kind === 'generation' || w.kind === 'inventory') {
      const m = (w.generation || w.inventory || {}).forMonth;
      const sub = data.periods.find((p) => L().periodMonthKey(p) === m && p.submittedDate && (w.kind === 'inventory' || p.cewType === 'CBEP'));
      if (sub) out.push(`It's counted in the ${App.Models.formatPeriodLabel(sub)} claim, already submitted.`);
    }
    return out;
  }
  /**
   * Change a WC's type. Same kind: just the type. A different kind: the WC #, date, company, status, notes and documents
   * stay; the new kind starts fresh, and the old details are kept with the WC so switching back brings them back.
   */
  async function changeWcType(id, typeId) {
    const w = await App.DB.get('wcs', id); const types = await App.DB.getAll('wcTypes');
    const from = types.find((t) => t.id === w.typeId); const to = types.find((t) => t.id === Number(typeId));
    if (!to) throw new Error('Pick a WC type.');
    const data = await loadAll(); const units = await App.DB.getAll('cancelledUnits');
    const block = typeChangeBlockers(w, to, data, units);
    if (block.length) throw new Error(block.join(' '));
    const oldKind = w.kind; const newKind = to.kind || 'generic';
    let restored = false;
    if (oldKind !== newKind) {
      w.stash = { ...(w.stash || {}) };
      if (w[oldKind] !== undefined) { w.stash[oldKind] = w[oldKind]; delete w[oldKind]; }
      const back = w.stash[newKind]; delete w.stash[newKind]; restored = !!back;
      const fresh = back || kindDefaults(newKind, w, data.wcs);
      if (fresh) w[newKind] = fresh;
      w.kind = newKind;
    }
    w.typeId = to.id;
    w.typeHistory = [...(w.typeHistory || []), { from: from ? from.name : '', to: to.name, date: App.UI.today() }];
    await App.DB.put('wcs', w);
    return { from, to, kindChanged: oldKind !== newKind, restored };
  }

  // ---------------------------------------------------------------- claim-period views
  /** The selected claim period, or null for "All — no claim period". */
  function currentPeriod(data) { return data.periods.find((p) => p.id === App.State.currentPeriodId) || null; }
  function inScope(w, data) { return L().wcInPeriod(w, currentPeriod(data), { allocations: data.allocations, periods: data.periods }); }

  // ---------------------------------------------------------------- CBEP month: generation certificates, stored amounts
  /** Issue the month's generation WCs: one per residual, numbered consecutively from the WC sequence. */
  async function issueGeneration({ month, entries, date, scalePerson }) {
    const type = (await App.DB.getAll('wcTypes')).find((t) => t.kind === 'generation');
    if (!type) throw new Error('The "CBEP residual generated" WC type is missing.');
    const list = entries.filter((e) => L().num(e.net) > 0);
    if (!list.length) throw new Error('Enter at least one residual\'s generated weight.');
    const all = await App.DB.getAll('wcs');
    const taken = all.filter((w) => w.kind === 'generation' && w.generation && w.generation.forMonth === month).map((w) => w.generation.residual);
    const dup = list.find((e) => taken.includes(e.residual));
    if (dup) throw new Error(`${dup.residual} already has a generation certificate for this month.`);
    let next = L().nextWcNumber(all);
    const ids = [];
    for (const e of list) {
      while (await wcNumberTaken(String(next))) next = String(Number(next) + 1);
      ids.push(await App.DB.add('wcs', { wcNumber: String(next), typeId: type.id, kind: 'generation', date, statusId: null, companyId: null, notes: '', createdAt: new Date().toISOString(),
        generation: { forMonth: month, residual: e.residual, lines: [{ gross: '', tare: '', net: L().r2(L().num(e.net)) }], scalePerson: scalePerson || '' } }));
      next = String(Number(next) + 1);
    }
    return ids;
  }
  const monthMeta = async (prefix, month) => ((await App.DB.get('meta', `${prefix}:${month}`)) || { key: `${prefix}:${month}`, values: {} });
  async function cbepStored(month) { return (await monthMeta('cbepStored', month)).values; }
  async function saveCbepStored(month, values) { await App.DB.put('meta', { key: `cbepStored:${month}`, values }); }
  /** The daily CBEP residual log: what was generated each day from dismantling ({date: [{materialId, net}]}). */
  async function cbepGenDays(month) { return ((await App.DB.get('meta', `cbepGen:${month}`)) || { days: {} }).days; }
  async function saveCbepGenDay(month, date, lines) {
    const rec = (await App.DB.get('meta', `cbepGen:${month}`)) || { key: `cbepGen:${month}`, days: {} };
    if (lines.length) rec.days[date] = lines; else delete rec.days[date];
    await App.DB.put('meta', rec);
  }
  /** The month-end CBEP inventory check: a general entry listing the CBEP residual materials, for the claim's month. */
  async function createCbepCheck(month, date) {
    const type = (await App.DB.getAll('wcTypes')).find((t) => t.kind === 'inventory');
    const id = await createWC({ typeId: type.id, date, noWc: true });
    const w = await App.DB.get('wcs', id);
    const mats = await App.DB.getAll('materials');
    w.inventory = { ...w.inventory, program: 'cbep', forMonth: month, materialOrder: mats.filter((m) => m.program === 'cbep').map((m) => m.id) };
    await App.DB.put('wcs', w);
    return id;
  }
  async function cbepDaily(periodId) { return ((await App.DB.get('meta', `cbepDaily:${periodId}`)) || { items: [] }).items; }
  async function saveCbepDaily(periodId, items) { await App.DB.put('meta', { key: `cbepDaily:${periodId}`, items }); }

  // ---------------------------------------------------------------- a transfer claimed over several months: its 198 C per period
  /**
   * A period's 198 C for a transfer. Claimed in one period of a program → the whole 198 C. Claimed over several →
   * that period's share of entries (locked to it the first time it's made, so the next month takes what's left)
   * plus every struck line.
   */
  async function claimPart198(w, period, data, { lock = true } = {}) {
    const T = transfer198(w);
    if (!T.basis.log) return { basis: T.basis, lines: [], partial: false };
    const sameProgram = data.periods.filter((p) => p.cewType === period.cewType).map((p) => p.id);
    const allocs = data.allocations.filter((a) => a.wcId === w.id && sameProgram.includes(a.claimPeriodId));
    const mine = allocs.find((a) => a.claimPeriodId === period.id);
    if (!mine || allocs.length < 2) return { basis: T.basis, lines: T.lines, partial: false, plan: T.plan };
    const t = w.transfer; t.claimParts = t.claimParts || {};
    let parts = t.claimParts[period.id];
    let short = 0;
    if (!parts) {
      const taken = Object.entries(t.claimParts).filter(([pid]) => Number(pid) !== period.id && sameProgram.includes(Number(pid))).flatMap(([, x]) => x);
      const r = L().claimPart(T.lines, period.cewType, taken, L().num(mine.units));
      parts = r.parts; short = r.short;
      if (lock) { t.claimParts[period.id] = parts; await App.DB.put('wcs', w); }
    }
    return { basis: T.basis, lines: L().partLines(T.lines, period.cewType, parts), partial: true, short, plan: T.plan };
  }

  /** Mark a WC # or IRR # as skipped on purpose, so its "missing" alert goes away. kind: 'wc' | 'irr' */
  async function markSkipped(kind, number) {
    const rec = (await App.DB.get('meta', 'skippedNumbers')) || { key: 'skippedNumbers', wc: [], irr: [] };
    rec[kind] = [...new Set([...(rec[kind] || []), String(number)])];
    await App.DB.put('meta', rec);
  }
  /** Record a skipped WC # as a void WC (like "void" rows in the WC log). */
  async function recordVoidWc(number) {
    let type = (await App.DB.getAll('wcTypes')).find((t) => t.name === 'Void');
    if (!type) { type = { name: 'Void', kind: 'generic', builtin: false }; type.id = await App.DB.add('wcTypes', type); }
    const id = await createWC({ wcNumber: String(number), typeId: type.id, date: App.UI.today() });
    const wc = await App.DB.get('wcs', id);
    wc.notes = 'Recorded as void — this WC # was skipped.';
    await App.DB.put('wcs', wc);
    return id;
  }

  async function deleteWC(id) {
    const allocs = await App.DB.getAllByIndex('transferAllocations', 'wcId', id);
    await App.DB.bulkDelete('transferAllocations', allocs.map((a) => a.id));
    const docs = (await App.DB.getAllByIndex('attachments', 'linkedEntityId', id)).filter((d) => d.linkedEntityType === 'wc');
    await App.DB.bulkDelete('attachments', docs.map((d) => d.id));
    await App.DB.delete('wcs', id);
  }

  async function ensurePeriod(cewType, year, month) {
    const found = await App.DB.getAllByIndex('claimPeriods', 'cewType_year_month', [cewType, year, month]);
    if (found.length) return found[0];
    const rec = { cewType, year, month, status: 'draft', previousPeriodId: null, notes: '' };
    rec.id = await App.DB.add('claimPeriods', rec);
    return rec;
  }

  // ---------- companies ----------
  async function findOrCreateCompany(name, role) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const companies = await App.DB.getAll('companies');
    const r = L().resolveCompany(clean, L().companyIndex(companies));
    if (r.company) {
      if (role && !(r.company.roles || []).includes(role)) {
        r.company.roles = L().resolveRoles([...(r.company.roles || []), role], r.company.roles || []);
        await App.DB.put('companies', r.company);
      }
      return r.company.id;
    }
    return App.DB.add('companies', { name: clean, cewId: '', roles: role ? [role] : [], aliases: [] });
  }

  function mergeAliases(company, names) {
    const seen = new Set([L().norm(company.name), ...(company.aliases || []).map(L().norm)]);
    const out = [...(company.aliases || [])];
    names.forEach((n) => { const k = L().norm(n); if (k && !seen.has(k)) { seen.add(k); out.push(String(n).trim()); } });
    company.aliases = out;
  }

  async function addAliases(companyId, names) {
    const c = await App.DB.get('companies', companyId);
    mergeAliases(c, names);
    await App.DB.put('companies', c);
  }

  /** Company `fromId` was a duplicate/misspelling of `intoId`: fold it in and repoint everything. */
  async function mergeCompanies(fromId, intoId) {
    if (fromId === intoId) return;
    const [from, into] = await Promise.all([App.DB.get('companies', fromId), App.DB.get('companies', intoId)]);
    mergeAliases(into, [from.name, ...(from.aliases || [])]);
    // the company kept wins any handler/collector or handler/recycler clash
    into.roles = L().resolveRoles([...(into.roles || []), ...(from.roles || [])], into.roles || []);
    into.cewId = into.roles.includes('handler') ? '' : (into.cewId || L().cleanCewId(from.cewId) || '');
    const changed = [];
    (await App.DB.getAll('wcs')).forEach((w) => {
      let hit = false;
      if (w.companyId === fromId) { w.companyId = intoId; hit = true; }
      if (w.transfer && w.transfer.collectorId === fromId) { w.transfer.collectorId = intoId; hit = true; }
      if (w.transfer && w.transfer.handlerId === fromId) { w.transfer.handlerId = intoId; hit = true; }
      if (hit) changed.push(w);
    });
    await App.DB.bulkPut('wcs', changed);
    await App.DB.put('companies', into);
    await App.DB.delete('companies', fromId);
  }

  /** Rewrite the Company text on cancelled units whose text matches any of `texts`. Returns count. */
  async function rewriteUnitCompanies(texts, canonical) {
    const keys = new Set(texts.map(L().norm));
    const units = (await App.DB.getAll('cancelledUnits')).filter((u) => keys.has(L().norm(u.company)) && u.company !== canonical);
    units.forEach((u) => { u.company = canonical; });
    await App.DB.bulkPut('cancelledUnits', units);
    return units.length;
  }

  // ---------- WC log import ----------
  const sentenceCase = (x) => { const t = String(x).replace(/\s+/g, ' ').trim().toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
  function applyTransferLog(t, r) {
    const pay = t.payment || {};
    t.payment = { paid: r.paid, dueDate: r.dueDate || pay.dueDate || '', note: r.dueNote || pay.note || '' };
    if (r.poSent) { t.timeline = t.timeline || {}; t.timeline.poSent = r.poSent; }
    if (r.packetMonth) t.packetMonth = r.packetMonth;
    t.lotCancelled = r.lotCancelled;
    if (r.selfCollected && !t.handlerId && !t.collectorId) t.selfCollected = true;
    if (r.typeText) t.transferType = L().transferTypeFromText(r.typeText);   // "cew/cbep transfer" → CEW/CBEP
  }
  function logRecord(r) {
    return { typeText: r.typeText, kind: r.kind, unsure: r.unsure, maybeTransfer: r.maybeTransfer, dateText: r.dateText, dateFixed: r.dateFixed,
      companyText: r.companyText, status: r.status, paid: r.paid, dueText: [r.dueDate ? L().shortDate(r.dueDate) : '', r.poSent ? `PO sent ${L().shortDate(r.poSent)}` : '', r.dueNote].filter(Boolean).join(' '),
      packetText: r.packetText, lotCancelled: r.lotCancelled, notes: r.notes, importedAt: new Date().toISOString() };
  }

  /**
   * Saves pasted WC-log rows (from L.parseWcLog). New WCs are created; WCs already in the app are skipped unless
   * updateExisting, which refreshes only the log's own details (status, payment, packet month, lot cancelled, notes).
   */
  async function importWcLog(rows, { updateExisting } = {}) {
    const result = { created: 0, updated: 0, skipped: [], companiesCreated: [], statusesCreated: [], irrConflicts: [] };
    const byNumber = new Map((await App.DB.getAll('wcs')).map((w) => [L().normLot(w.wcNumber), w]));
    const types = await App.DB.getAll('wcTypes');
    const typeFor = async (kind) => {
      if (kind === 'transfer' || kind === 'shipment') return types.find((t) => t.kind === kind);
      const name = kind === 'void' ? 'Void' : 'Unsorted (from WC log)';
      let t = types.find((x) => x.name === name);
      if (!t) { t = { name, kind: 'generic', builtin: false }; t.id = await App.DB.add('wcTypes', t); types.push(t); }
      return t;
    };
    const statuses = await App.DB.getAll('wcStatuses');
    const statusFor = async (text) => {
      if (!text) return null;
      let st = statuses.find((x) => L().norm(x.name) === L().norm(text));
      if (!st) { st = { name: sentenceCase(text), order: statuses.length }; st.id = await App.DB.add('wcStatuses', st); statuses.push(st); result.statusesCreated.push(st.name); }
      return st.id;
    };
    const companies = await App.DB.getAll('companies');
    const groups = L().groupCompanyNames(rows.map((r) => ({ name: r.companyName, note: r.companyNote })), companies);
    const roleSets = new Map();
    rows.forEach((r) => {
      const g = groups.get(r.companyName); if (!g) return;
      const k = g.companyId ? `c${g.companyId}` : `g${g.group}`;
      if (!roleSets.has(k)) roleSets.set(k, new Set());
      if (r.kind === 'transfer') roleSets.get(k).add('handler');
      if (r.kind === 'shipment') roleSets.get(k).add('destination');
    });
    const made = new Map();
    const companyFor = async (r) => {
      const g = groups.get(r.companyName); if (!g) return null;
      if (g.companyId) {
        const c = companies.find((x) => x.id === g.companyId);
        let changed = false;
        if (L().norm(c.name) !== L().norm(r.companyName) && !(c.aliases || []).some((a) => L().norm(a) === L().norm(r.companyName))) { c.aliases = [...(c.aliases || []), r.companyName]; changed = true; }
        const need = roleSets.get(`c${c.id}`) || new Set(); const roles = new Set(c.roles || []);
        if (need.has('handler') && !roles.has('handler') && !roles.has('collector') && !roles.has('recycler')) { roles.add('handler'); changed = true; }
        if (need.has('destination') && !roles.has('destination') && !roles.has('recycler')) { roles.add('destination'); changed = true; }
        if (changed) { c.roles = [...roles]; await App.DB.put('companies', c); }
        return c;
      }
      if (!made.has(g.group)) {
        const rec = { name: g.display, cewId: '', roles: [...(roleSets.get(`g${g.group}`) || [])], aliases: g.spellings.filter((x) => L().norm(x) !== L().norm(g.display)),
          rates: {}, accountStatus: 'open', materialMode: '', licensePlates: [], fromLog: true };
        rec.id = await App.DB.add('companies', rec);
        companies.push(rec); made.set(g.group, rec); result.companiesCreated.push(rec.name);
      }
      return made.get(g.group);
    };

    for (const r of rows) {
      const existing = byNumber.get(L().normLot(r.wcNumber));
      if (existing && !updateExisting) { result.skipped.push(r.wcNumber); continue; }
      const statusId = await statusFor(r.status);
      const company = r.selfCollected ? null : await companyFor(r);
      const notes = [r.companyNote ? `(${r.companyNote})` : '', r.notes].filter(Boolean).join(' ');
      if (existing) {
        existing.log = logRecord(r);
        if (statusId) existing.statusId = statusId;
        if (!existing.notes && notes) existing.notes = notes;
        if (existing.kind === 'transfer') applyTransferLog(existing.transfer, r);
        await App.DB.put('wcs', existing); result.updated += 1; continue;
      }
      const type = await typeFor(r.kind);
      let party = '';
      if (company && type.kind === 'transfer') party = `${(company.roles || []).includes('collector') && !(company.roles || []).includes('handler') ? 'collector' : 'handler'}:${company.id}`;
      else if (company) party = String(company.id);
      let irr = type.kind === 'transfer' ? r.irrNumber : undefined;
      if (irr && await irrNumberTaken(irr)) { result.irrConflicts.push(`WC #${r.wcNumber}: IRR #${irr}`); irr = ''; }
      const id = await createWC({ wcNumber: r.wcNumber, typeId: type.id, date: r.date, party, irrNumber: irr });
      const wc = await App.DB.get('wcs', id);
      wc.statusId = statusId; wc.notes = notes; wc.log = logRecord(r);
      if (type.kind === 'transfer') {
        const t = wc.transfer;
        if (r.cbepOnly) t.lines[0].category = 'cbep';
        else if (r.cbep) t.lines.push({ ...blankTransferLine(), category: 'cbep' });
        if (r.nonCew && !r.cbep) t.lines[0].cewUnits = '0';
        applyTransferLog(t, r);
      }
      await App.DB.put('wcs', wc);
      byNumber.set(L().normLot(r.wcNumber), wc);
      result.created += 1;
    }
    return result;
  }

  // ---------- one-time setup and migration ----------
  async function migrate() {
    const meta = (await App.DB.get('meta', 'migrations')) || { key: 'migrations', done: [] };
    const mark = async (name) => { meta.done.push(name); await App.DB.put('meta', meta); };

    if (!meta.done.includes('v4-seed')) {
      const types = await App.DB.getAll('wcTypes');
      for (const t of App.Models.BUILTIN_WC_TYPES) {
        if (!types.some((x) => x.kind === t.kind)) await App.DB.add('wcTypes', { ...t, builtin: true });
      }
      if ((await App.DB.count('materials')) === 0) {
        await App.DB.bulkAdd('materials', App.Models.SEED_MATERIALS.map(([name, category]) => ({ name, category })));
      }
      await mark('v4-seed');
    }

    if (!meta.done.includes('v5-price-items')) {
      if ((await App.DB.count('priceItems')) === 0) {
        await App.DB.bulkAdd('priceItems', App.Models.SEED_PRICE_ITEMS.map(([appliesTo, name, direction]) => ({ name, appliesTo, direction, basis: 'lb', dropOff: '', pickUp: '', variable: false, notes: '' })));
      }
      await mark('v5-price-items');
    }

    if (!meta.done.includes('v6-irr-items')) {
      const items = await App.DB.getAll('priceItems');
      const have = new Set(items.map((p) => L().norm(p.name)));
      const add = App.Models.SEED_OTHER_ITEMS.filter((n) => !have.has(L().norm(n)))
        .map((name) => ({ name, appliesTo: 'other', basis: 'lb', dropOff: '', pickUp: '', variable: false, notes: '' }));
      await App.DB.bulkAdd('priceItems', add);
      await mark('v6-irr-items');
    }

    if (!meta.done.includes('v7-own-wc')) {
      const mats = await App.DB.getAll('materials');
      await App.DB.bulkPut('materials', mats.filter((m) => m.category === 'LCD Lamps (§IV)' && m.ownWc === undefined).map((m) => ({ ...m, ownWc: true })));
      // inventory checks made so far: put their lines in grouped order, drop blank placeholder lines
      const invs = (await App.DB.getAll('wcs')).filter((w) => w.kind === 'inventory' && w.inventory && !w.inventory.materialOrder);
      invs.forEach((w) => {
        w.inventory.materialOrder = [...new Set(w.inventory.lines.map((l) => l.materialId).filter((x) => x != null))];
        w.inventory.lines = w.inventory.lines.filter((l) => l.materialId != null && (l.net !== '' || l.gross !== '' || l.tare !== ''));
        if (w.companyId) w.companyId = null;
      });
      await App.DB.bulkPut('wcs', invs);
      await mark('v7-own-wc');
    }

    if (!meta.done.includes('v8-vendors-prices-crt')) {
      // approved recyclers are vendors too
      const comps = await App.DB.getAll('companies');
      await App.DB.bulkPut('companies', comps.filter((c) => (c.roles || []).includes('recycler') && !(c.roles || []).includes('destination'))
        .map((c) => ({ ...c, roles: [...c.roles, 'destination'] })));
      // non-CEW LCD/LED + non-CEW plasma become one "Non-CEW Non-CRT" item; non-CEW items are charged
      const items = await App.DB.getAll('priceItems');
      const oldNonCrt = items.filter((p) => p.appliesTo === 'noncew:lcdled' || p.appliesTo === 'noncew:plasma' || p.appliesTo === 'noncew:noncrt');
      const keep = oldNonCrt.find((p) => p.appliesTo === 'noncew:noncrt') || oldNonCrt.find((p) => p.appliesTo === 'noncew:lcdled') || oldNonCrt[0];
      const drop = oldNonCrt.filter((p) => p !== keep);
      if (keep) {
        const fresh = await App.DB.getAll('companies');
        const moved = fresh.filter((c) => c.rates && drop.some((d) => c.rates[d.id])).map((c) => {
          const rates = { ...c.rates };
          drop.forEach((d) => { if (rates[d.id] && !rates[keep.id]) rates[keep.id] = rates[d.id]; delete rates[d.id]; });
          return { ...c, rates };
        });
        await App.DB.bulkPut('companies', moved);
        await App.DB.bulkDelete('priceItems', drop.map((d) => d.id));
      } else {
        await App.DB.add('priceItems', { name: 'Non-CEW Non-CRT', appliesTo: 'noncew:noncrt', direction: 'charge', basis: 'lb', dropOff: '', pickUp: '', variable: false, notes: '' });
      }
      const left = (await App.DB.getAll('priceItems')).map((p) => {
        if (keep && p.id === keep.id) return { ...p, appliesTo: 'noncew:noncrt', name: /non-cew (lcd|plasma)/i.test(p.name) ? 'Non-CEW Non-CRT' : p.name, direction: 'charge' };
        if (p.appliesTo && p.appliesTo.startsWith('noncew:') && !p.direction) return { ...p, direction: 'charge' };
        return p.direction ? p : { ...p, direction: 'pay' };
      });
      await App.DB.bulkPut('priceItems', left);
      // CRT/plasma lines on residual shipments move to their own CRT/plasma shipment records (no WC)
      const shipments = (await App.DB.getAll('wcs')).filter((w) => w.kind === 'shipment' && w.shipment && (w.shipment.crtPlasma || []).length);
      for (const w of shipments) {
        const residual = (w.shipment.lines || []).some((l) => L().lineNet(l));
        const crt = { reference: w.wcNumber, mode: '', licensePlate: '', lines: w.shipment.crtPlasma, settlement: residual ? { type: '', amount: '', reference: '', date: '' } : (w.shipment.settlement || { type: '' }) };
        if (residual) {
          await App.DB.add('wcs', { wcNumber: '', noWc: true, typeId: null, kind: 'crtShipment', date: w.date, statusId: null, companyId: w.companyId, notes: `Moved from WC #${w.wcNumber}`, createdAt: new Date().toISOString(), crtShipment: crt });
          delete w.shipment.crtPlasma;
          await App.DB.put('wcs', w);
        } else {
          await App.DB.put('wcs', { ...w, kind: 'crtShipment', noWc: true, wcNumber: '', typeId: null, crtShipment: crt, shipment: undefined });
        }
      }
      await mark('v8-vendors-prices-crt');
    }

    // v10: the CBEP units we buy are "CEW CBEP" again; every transfer gets a type (CEW, CBEP, CEW/CBEP);
    // the separate collector CEWID setting is retired (handler transfers use our one CEWID).
    // v11: CBEP is "CBEP" (CEW = CEW CRT / CEW Non-CRT); residual shipments get a type; the generation WC type.
    if (!meta.done.includes('v11-cbep-claims')) {
      for (const p of await App.DB.getAll('priceItems')) {
        if (p.appliesTo === 'cew:cbep' && /^CEW CBEP /.test(String(p.name).trim())) await App.DB.put('priceItems', { ...p, name: String(p.name).trim().replace(/^CEW CBEP /, 'CBEP ') });
      }
      for (const w of await App.DB.getAll('wcs')) {
        if (w.kind === 'shipment' && w.shipment && !w.shipment.shipmentType) { w.shipment.shipmentType = 'cew'; w.shipment.paperwork = w.shipment.paperwork || {}; await App.DB.put('wcs', w); }
      }
      const types = await App.DB.getAll('wcTypes');
      if (!types.some((x) => x.kind === 'generation')) await App.DB.add('wcTypes', { name: 'CBEP residual generated', kind: 'generation', builtin: true });
      const mats = await App.DB.getAll('materials');
      if (!mats.some((m) => /mother ?board/i.test(m.name))) await App.DB.add('materials', { name: 'Motherboards', category: 'Circuit Boards' });
      // each material's 196C residual, from its 196B column (changeable in Settings → Materials)
      for (const m of await App.DB.getAll('materials')) if (!m.residual196C) await App.DB.put('materials', { ...m, residual196C: L().residual196C(m) });
      await mark('v11-cbep-claims');
    }

    // v12: every material is CEW Non-CRT or CBEP — never both. Materials already used for CBEP get a CBEP twin and those
    // entries move to it; a starter CBEP material for each 196C category that has none.
    // v13: inventory checks list only their own program's materials (older CBEP checks also kept the CEW ones);
    // anything already weighed stays, so it can be flagged and moved.
    if (!meta.done.includes('v13-check-lists') && meta.done.includes('v12-material-programs')) {
      const mats = await App.DB.getAll('materials'); const byId = new Map(mats.map((m) => [m.id, m]));
      for (const w of await App.DB.getAll('wcs')) {
        if (w.kind !== 'inventory' || !w.inventory) continue;
        const cbep = L().isCbepInventory(w);
        const weighed = (id) => (w.inventory.lines || []).some((l) => l.materialId === id && (L().lineNet(l) || L().num(l.gross)));
        const keep = (w.inventory.materialOrder || []).filter((id) => { const m = byId.get(id); return !m || weighed(id) || (cbep ? m.program === 'cbep' : m.program !== 'cbep'); });
        if (cbep) mats.filter((m) => m.program === 'cbep' && !keep.includes(m.id)).forEach((m) => keep.push(m.id));
        if (JSON.stringify(keep) !== JSON.stringify(w.inventory.materialOrder || [])) { w.inventory.materialOrder = keep; await App.DB.put('wcs', w); }
      }
      await mark('v13-check-lists');
    }

    if (!meta.done.includes('v12-material-programs')) {
      const mats = await App.DB.getAll('materials'); const wcs = await App.DB.getAll('wcs');
      const oldProgram = (w, l) => { const t = (w.shipment && w.shipment.shipmentType) || 'cew'; return t === 'both' ? (l.program === 'cbep' ? 'cbep' : 'cew') : t; };
      const usedCbep = new Set();
      wcs.forEach((w) => {
        if (w.kind === 'shipment') ((w.shipment && w.shipment.lines) || []).forEach((l) => { if (l.materialId != null && oldProgram(w, l) === 'cbep') usedCbep.add(l.materialId); });
        if (L().isCbepInventory(w)) (w.inventory.lines || []).forEach((l) => { if (l.materialId != null) usedCbep.add(l.materialId); });
      });
      const genMetas = (await App.DB.getAll('meta')).filter((x) => String(x.key).startsWith('cbepGen:'));
      genMetas.forEach((x) => Object.values(x.days || {}).forEach((ls) => ls.forEach((l) => usedCbep.add(l.materialId))));
      const twin = new Map();
      for (const m of mats) {
        if (m.program) continue;
        const res = L().residual196C(m);   // before it has a program: its 196C mapping as it was
        await App.DB.put('materials', { ...m, program: 'cew' });
        if (usedCbep.has(m.id)) twin.set(m.id, await App.DB.add('materials', { name: L().stripProgram(m.name), program: 'cbep', residual196C: res === L().NOT_CBEP ? 'Other' : res, category: 'Not a CEW residual' }));
      }
      const all = await App.DB.getAll('materials');
      for (const res of [...L().RESIDUALS_196C, ...L().BATTERY_CHEMISTRIES]) {
        if (!all.some((m) => m.program === 'cbep' && m.residual196C === res)) await App.DB.add('materials', { name: res, program: 'cbep', residual196C: res, category: 'Not a CEW residual' });
      }
      if (twin.size) {
        for (const w of wcs) {
          let changed = false;
          if (w.kind === 'shipment') ((w.shipment && w.shipment.lines) || []).forEach((l) => { if (oldProgram(w, l) === 'cbep' && twin.has(l.materialId)) { l.materialId = twin.get(l.materialId); changed = true; } });
          if (L().isCbepInventory(w)) {
            (w.inventory.lines || []).forEach((l) => { if (twin.has(l.materialId)) { l.materialId = twin.get(l.materialId); changed = true; } });
            w.inventory.materialOrder = (w.inventory.materialOrder || []).map((id) => twin.get(id) || id); changed = true;
          }
          if (changed) await App.DB.put('wcs', w);
        }
        for (const x of genMetas) { Object.values(x.days || {}).forEach((ls) => ls.forEach((l) => { if (twin.has(l.materialId)) l.materialId = twin.get(l.materialId); })); await App.DB.put('meta', x); }
      }
      await mark('v12-material-programs');
    }

    if (!meta.done.includes('v10-cew-cbep-types')) {
      // (its "CEW CBEP" rename was reversed in v11 — CBEP stays CBEP — so it no longer renames anything)
      for (const w of await App.DB.getAll('wcs')) {
        if (w.kind !== 'transfer' || !w.transfer || w.transfer.transferType) continue;
        const cats = (w.transfer.lines || []).filter((l) => L().num(l.irrUnits) || L().num(l.irrWeight)).map((l) => l.category);
        const cbep = cats.includes('cbep'); const cew = cats.some((c) => ['lcdled', 'crt', 'plasma'].includes(c));
        const fromLog = w.log && w.log.typeText ? L().transferTypeFromText(w.log.typeText) : null;
        w.transfer.transferType = fromLog || (cbep && cew ? 'both' : cbep ? 'cbep' : 'cew');
        w.transfer.logs = w.transfer.logs || { o: null, a: null };
        await App.DB.put('wcs', w);
      }
      const prof = await App.DB.get('facilityProfile', 'profile');
      if (prof && prof.collectorCewID) { await App.DB.put('facilityProfile', { ...prof, oldCollectorCewID: prof.collectorCewID, collectorCewID: '' }); }
      await mark('v10-cew-cbep-types');
    }

    // v9: CBEP is its own thing (never "CEW"), and there can be several CBEP items, each with its own rates.
    // The one "CEW CBEP" item becomes CBEP Computer Towers (keeping its rates); CBEP Printers is added.
    if (!meta.done.includes('v9-cbep-items')) {
      const items = await App.DB.getAll('priceItems');
      const cbep = items.filter((p) => p.appliesTo === 'cew:cbep');
      const named = (n) => cbep.some((p) => L().norm(p.name) === L().norm(n));
      const old = cbep.find((p) => /^cew cbep$/i.test(String(p.name).trim()));
      if (old && !named('CBEP Computer Towers')) await App.DB.put('priceItems', { ...old, name: 'CBEP Computer Towers' });
      else if (!cbep.length) await App.DB.add('priceItems', { name: 'CBEP Computer Towers', appliesTo: 'cew:cbep', direction: 'pay', basis: 'lb', dropOff: '', pickUp: '', variable: false, notes: '' });
      if (!named('CBEP Printers')) await App.DB.add('priceItems', { name: 'CBEP Printers', appliesTo: 'cew:cbep', direction: 'pay', basis: 'lb', dropOff: '', pickUp: '', variable: false, notes: '' });
      const nc = items.find((p) => p.appliesTo === 'noncew:cbep' && /^non-?cew cbep$/i.test(String(p.name).trim()));
      if (nc) await App.DB.put('priceItems', { ...nc, name: 'CBEP without source logs' });
      await mark('v9-cbep-items');
    }

    if (!meta.done.includes('v4-legacy')) {
      const types = await App.DB.getAll('wcTypes');
      const typeId = (kind) => types.find((t) => t.kind === kind).id;
      const taken = new Set((await App.DB.getAll('wcs')).map((w) => L().normLot(w.wcNumber)));
      const uniqueNumber = (wanted, fallback) => {
        let n = String(wanted || '').trim() || fallback;
        while (taken.has(L().normLot(n))) n += '-dup';
        taken.add(L().normLot(n));
        return n;
      };
      const relink = async (oldType, map) => {
        const docs = (await App.DB.getAll('attachments')).filter((d) => d.linkedEntityType === oldType && map.has(d.linkedEntityId));
        docs.forEach((d) => { d.linkedEntityType = 'wc'; d.linkedEntityId = map.get(d.linkedEntityId); });
        await App.DB.bulkPut('attachments', docs);
      };

      const collectorMap = new Map();
      for (const c of await App.DB.getAll('collectors')) {
        const id = await findOrCreateCompany(c.name, 'collector');
        const comp = await App.DB.get('companies', id);
        if (c.cewID && !comp.cewId) { comp.cewId = c.cewID; await App.DB.put('companies', comp); }
        collectorMap.set(c.id, id);
      }

      const transferMap = new Map();
      for (const t of await App.DB.getAll('transfers')) {
        const a = t.amounts || {};
        const lines = [];
        const push = (category, b) => { if (b && (b.units || b.weight)) lines.push({ category, irrUnits: b.units || 0, irrWeight: b.weight || 0, cewUnits: b.units || 0, nonCewWeight: 0 }); };
        push('lcdled', a.nonCrt); push('cbep', a.cbep); push('crt', a.crt);
        const handlerId = t.handlerName ? await findOrCreateCompany(t.handlerName, 'handler') : null;
        const collectorId = collectorMap.get(t.collectorId) || null;
        const id = await App.DB.add('wcs', {
          wcNumber: uniqueNumber(t.referenceNumber, `T-${t.id}`), typeId: typeId('transfer'), kind: 'transfer',
          date: t.dateOfTransfer || '', statusId: null, companyId: handlerId || collectorId, notes: '', createdAt: new Date().toISOString(),
          transfer: { collectorId, handlerId, lines: lines.length ? lines : [blankTransferLine()], timeline: {}, activityNotes: t.collectorActivityNotes || '' },
        });
        transferMap.set(t.id, id);
      }
      const allocs = (await App.DB.getAll('transferAllocations')).filter((x) => x.wcId == null && x.transferId != null);
      allocs.forEach((x) => { x.wcId = transferMap.get(x.transferId) ?? null; delete x.transferId; });
      await App.DB.bulkPut('transferAllocations', allocs);
      await relink('transfer', transferMap);

      const shipMap = new Map();
      for (const s of await App.DB.getAll('shipmentRecords')) {
        const companyId = s.initialDestination ? await findOrCreateCompany(s.initialDestination, 'destination') : null;
        let materialId = null;
        if (s.materialType) {
          const mats = await App.DB.getAll('materials');
          const m = mats.find((x) => L().norm(x.name) === L().norm(s.materialType));
          materialId = m ? m.id : await App.DB.add('materials', { name: s.materialType, category: 'Other' });
        }
        const id = await App.DB.add('wcs', {
          wcNumber: uniqueNumber(s.referenceNumber, `S-${s.id}`), typeId: typeId('shipment'), kind: 'shipment',
          date: s.dateShipped || '', statusId: null, companyId, notes: s.description || '', createdAt: new Date().toISOString(),
          shipment: { lines: [{ materialId, gross: '', tare: '', net: s.poundsShipped || 0 }] },
        });
        shipMap.set(s.id, id);
      }
      await relink('shipmentRecord', shipMap);

      const wcsNow = await App.DB.getAll('wcs');
      const units = (await App.DB.getAll('cancelledUnits')).filter((u) => u.date === undefined);
      units.forEach((u) => {
        const wc = wcsNow.find((w) => w.id === transferMap.get(u.originTransferId));
        Object.assign(u, { date: u.dateCancelled || '', time: '', make: u.manufacturer || '', weight: u.pounds || 0,
          lotNumber: wc ? L().normLot(wc.wcNumber) : '', company: '', boxNumber: '' });
        u.original = { lotNumber: u.lotNumber, company: '', boxNumber: '' };
      });
      await App.DB.bulkPut('cancelledUnits', units);
      await mark('v4-legacy');
    }
  }

  /** Add any shipment-line descriptions not yet on the vendor description list. Returns how many were added. */
  async function learnDescriptions(wc) {
    const lines = ((wc.shipment && wc.shipment.lines) || []).filter((l) => String(l.description || '').trim());
    if (!lines.length) return 0;
    const list = await App.DB.getAll('shipDescriptions');
    const known = (name) => list.some((d) => L().norm(d.name) === L().norm(name) && (!d.vendorId || d.vendorId === wc.companyId));
    const add = [];
    lines.forEach((l) => {
      const name = String(l.description).replace(/\s+/g, ' ').trim();
      if (known(name) || add.some((a) => L().norm(a.name) === L().norm(name))) return;
      add.push({ name, vendorId: wc.companyId || null, cew: l.cew !== false, materialId: l.materialId ?? null });
    });
    await App.DB.bulkAdd('shipDescriptions', add);
    return add.length;
  }

  return { changeWcType, typeChangeBlockers, KIND_NAMES, currentPeriod, inScope, issueGeneration, cbepStored, saveCbepStored, cbepGenDays, saveCbepGenDay, createCbepCheck, cbepDaily, saveCbepDaily, claimPart198, transfer198, shipmentUc, ucRemaining, markSkipped, recordVoidWc, importWcLog, plateChoices, isKnownPlate, learnDescriptions, loadAll, transferParties, partyOptions, partyLabel, createWC, deleteWC, wcNumberTaken, irrNumberTaken, ensurePeriod, findOrCreateCompany, addAliases, mergeCompanies, rewriteUnitCompanies, migrate, blankTransferLine, blankWeighLine };
})();

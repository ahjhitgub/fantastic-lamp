/**
 * store.js — data helpers shared by pages, plus the one-time move of pre-v4
 * records (collectors, transfers, shipments, old unit fields) into the new shape.
 */
window.App = window.App || {};

App.Store = (function () {
  const L = () => App.Logic;

  async function loadAll() {
    const names = ['wcs', 'companies', 'claimPeriods', 'transferAllocations', 'wcTypes', 'wcStatuses', 'materials', 'priceItems'];
    const [wcs, companies, periods, allocations, wcTypes, wcStatuses, materials, priceItems] = await Promise.all(names.map((n) => App.DB.getAll(n)));
    const profile = (await App.DB.get('facilityProfile', 'profile')) || {};
    wcStatuses.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
    companies.sort((a, b) => a.name.localeCompare(b.name));
    materials.sort((a, b) => a.name.localeCompare(b.name));
    periods.sort((a, b) => (b.year - a.year) || (b.month - a.month) || String(a.cewType).localeCompare(b.cewType));
    const keyOrder = App.Logic.PRICE_KEYS.map(([k]) => k);
    priceItems.sort((a, b) => (keyOrder.indexOf(a.appliesTo) - keyOrder.indexOf(b.appliesTo)) || String(a.name).localeCompare(b.name));
    return { wcs, companies, periods, allocations, wcTypes, wcStatuses, materials, priceItems, profile };
  }

  /**
   * Who is on each side of a transfer. We are always the recycler. With a handler
   * selected, we are also the collector; the handler is the customer.
   */
  function transferParties(wc, data) {
    const t = (wc && wc.transfer) || {};
    const byId = (id) => data.companies.find((c) => c.id === id) || null;
    const facility = { name: data.profile.recyclerName || 'Our facility (set the name in Settings)', cewId: data.profile.cewID || '' };
    const handler = byId(t.handlerId);
    const collectorCompany = handler ? null : byId(t.collectorId);
    const collector = handler ? facility : (collectorCompany ? { name: collectorCompany.name, cewId: collectorCompany.cewId || '' } : null);
    return { facility, handler, collector, collectorIsFacility: !!handler, customer: handler || collectorCompany };
  }

  async function wcNumberTaken(wcNumber, exceptId) {
    const k = L().normLot(wcNumber);
    return (await App.DB.getAll('wcs')).some((w) => L().normLot(w.wcNumber) === k && w.id !== exceptId);
  }

  function blankTransferLine() { return { category: 'lcdled', irrUnits: '', irrWeight: '', cewUnits: '', nonCewWeight: '' }; }
  function blankWeighLine() { return { materialId: null, gross: '', tare: '', net: '' }; }

  /**
   * <option>s for "who is it from / going to".
   * transfer → values "handler:ID" / "collector:ID"; anything else → company id (destinations first).
   */
  function partyOptions(kind, companies, selected) {
    const { esc } = App.UI;
    const opt = (value, c) => `<option value="${value}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${esc(c.name)}${c.cewId ? ` — ${esc(c.cewId)}` : ''}</option>`;
    const has = (c, r) => (c.roles || []).includes(r);
    if (kind === 'transfer') {
      const handlers = companies.filter((c) => has(c, 'handler'));
      const collectors = companies.filter((c) => has(c, 'collector'));
      return `<option value="">— choose —</option>`
        + (handlers.length ? `<optgroup label="Handlers (we're the collector)">${handlers.map((c) => opt(`handler:${c.id}`, c)).join('')}</optgroup>` : '')
        + (collectors.length ? `<optgroup label="Approved collectors">${collectors.map((c) => opt(`collector:${c.id}`, c)).join('')}</optgroup>` : '');
    }
    const first = kind === 'shipment' ? companies.filter((c) => has(c, 'destination')) : [];
    const rest = companies.filter((c) => !first.includes(c));
    return `<option value="">— none —</option>`
      + (first.length ? `<optgroup label="Shipping destinations">${first.map((c) => opt(c.id, c)).join('')}</optgroup>` : '')
      + (rest.length ? `<optgroup label="${first.length ? 'Other companies' : 'Companies'}">${rest.map((c) => opt(c.id, c)).join('')}</optgroup>` : '');
  }
  const partyLabel = (kind) => (kind === 'transfer' ? 'From (customer)' : kind === 'shipment' ? 'Going to' : 'Company');

  async function createWC({ wcNumber, typeId, date, companyId, party }) {
    const number = String(wcNumber || '').trim();
    if (!number) throw new Error('Enter a WC #.');
    if (await wcNumberTaken(number)) throw new Error(`WC #${number} already exists.`);
    const type = (await App.DB.getAll('wcTypes')).find((t) => t.id === typeId);
    if (!type) throw new Error('Pick a WC type.');
    const kind = type.kind || 'generic';
    const rec = { wcNumber: number, typeId, kind, date: date || '', statusId: null, companyId: companyId || null, notes: '', createdAt: new Date().toISOString() };
    const [role, idText] = String(party || '').includes(':') ? String(party).split(':') : [null, party];
    const partyId = idText ? Number(idText) : null;
    if (kind === 'transfer') {
      const d = date || App.UI.today();
      rec.transfer = { collectorId: role === 'collector' ? partyId : null, handlerId: role === 'handler' ? partyId : null, mode: '',
        lines: [blankTransferLine()], timeline: { wcAssigned: d, materialReceived: d }, activityNotes: '' };
      if (partyId) {
        rec.companyId = partyId;
        const cust = await App.DB.get('companies', partyId);
        if (cust && (cust.materialMode === 'pickup' || cust.materialMode === 'dropoff')) rec.transfer.mode = cust.materialMode;
      }
    } else if (kind === 'shipment') {
      if (partyId) rec.companyId = partyId;
      rec.shipment = { lines: [blankWeighLine()] };
    } else if (kind === 'inventory') {
      if (partyId) rec.companyId = partyId;
      const mats = (await App.DB.getAll('materials')).filter((m) => m.category !== 'Not a CEW residual').sort((a, b) => a.name.localeCompare(b.name));
      rec.inventory = { forMonth: (date || App.UI.today()).slice(0, 7), lines: mats.map((m) => ({ ...blankWeighLine(), materialId: m.id })) };
    }
    if (kind === 'generic' && partyId) rec.companyId = partyId;
    return App.DB.add('wcs', rec);
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
        r.company.roles = [...(r.company.roles || []), role];
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
    into.roles = Array.from(new Set([...(into.roles || []), ...(from.roles || [])]));
    into.cewId = into.cewId || from.cewId || '';
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
        await App.DB.bulkAdd('priceItems', App.Models.SEED_PRICE_ITEMS.map(([appliesTo, name]) => ({ name, appliesTo, basis: 'lb', dropOff: '', pickUp: '', variable: false, notes: '' })));
      }
      await mark('v5-price-items');
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

  return { loadAll, transferParties, partyOptions, partyLabel, createWC, deleteWC, wcNumberTaken, ensurePeriod, findOrCreateCompany, addAliases, mergeCompanies, rewriteUnitCompanies, migrate, blankTransferLine, blankWeighLine };
})();

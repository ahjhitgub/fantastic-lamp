window.App = window.App || {};
App.Pages = App.Pages || {};

/**
 * Printable documents for one transfer WC. Route: #/doc/<wcId>/<irr|wc|invoice|197>
 * Layouts are generic for now and will be matched to the real forms.
 */
App.Pages.doc = (function () {
  const TYPES = [['irr', 'Inbound Receiving Report'], ['wc', 'Weight Certificate'], ['invoice', 'Purchase Invoice'], ['197', 'CalRecycle 197'], ['merged', 'Merged File']];
  const U = () => App.UI;
  const L = () => App.Logic;
  const usDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[2]}/${m[3]}/${m[1]}` : (iso || ''); };
  const modeText = (m) => (m === 'pickup' ? 'Picked up' : m === 'dropoff' ? 'Dropped off' : '—');

  function letterhead(data, title, fields) {
    const { esc } = U(); const p = data.profile;
    return `
      <div class="doc-head">
        <div>
          <div class="doc-company">${esc(p.recyclerName || 'Facility name — set in Settings')}</div>
          ${p.address ? `<div>${esc(p.address).replace(/\n/g, '<br>')}</div>` : ''}
          ${p.phone ? `<div>${esc(p.phone)}</div>` : ''}
          ${p.cewID ? `<div>CEWID ${esc(p.cewID)}</div>` : ''}
        </div>
        <div class="doc-title">
          <div class="t">${esc(title)}</div>
          <table class="kv"><tbody>${fields.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>`;
  }

  function customerBlock(P, wc) {
    const { esc } = U(); const c = P.customer;
    return `
      <div class="doc-parties">
        <div><div class="lbl">Customer</div>
          ${c ? `<div><strong>${esc(c.name)}</strong></div>${c.owner ? `<div>Attn: ${esc(c.owner)}</div>` : ''}${c.address ? `<div>${esc(c.address).replace(/\n/g, '<br>')}</div>` : ''}${c.phone ? `<div>${esc(c.phone)}</div>` : ''}` : '<div>—</div>'}
        </div>
        <div><div class="lbl">Collector</div>${P.collector ? `<div>${esc(P.collector.name)}</div><div>CEWID ${esc(P.collector.cewId || '—')}</div>` : '<div>—</div>'}</div>
        <div><div class="lbl">Material</div><div>${modeText(wc.transfer.mode)}</div></div>
      </div>`;
  }

  const signatures = (labels) => `<div class="doc-sign">${labels.map((l) => `<div><div class="line"></div>${U().esc(l)}</div>`).join('')}</div>`;

  const unitsText = (r) => (r.part === 'other' && !r.units ? 'Wt.Only' : U().fmt(r.units));
  const IRR_LABELS = { lcdled: 'LCD/LED', crt: 'CRT', plasma: 'PLASMA', cbep: 'CBEP' };
  const addressLines = (text) => String(text || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);

  // ======================================================================
  // Paper forms (IRR, WC, purchase invoice) — laid out like Bellflower's templates
  // ======================================================================
  const WEIGHMASTER_TEXT = 'THIS IS TO CERTIFY that the following described commodity was weighed, measured, or counted by a weighmaster, whose signature is on this certificate, who is a recognized authority of accuracy, as prescribed by Chapter 7 (commencing with Section 12700) of Division 5 of the California Business and Professions Code, administered by the Division of Measurement Standards of the California Department of Food and Agriculture.';
  const HANDLING_NOTE = 'Material with an * next to them have a 10 cent per pound handling deduction.';
  const MIN_ROWS = 15;
  const us = (data) => ({ name: data.profile.recyclerName, address: data.profile.address, phone: data.profile.phone });

  function formHead(data, title, fields) {
    const { esc } = U(); const p = data.profile;
    return `
      <div class="doc-head form-head">
        <div>
          <div class="doc-company">${esc(p.recyclerName || 'Facility name — set in Settings')}</div>
          ${addressLines(p.address).map((l) => `<div>${esc(l)}</div>`).join('')}${p.phone ? `<div>${esc(p.phone)}</div>` : ''}
        </div>
        <div class="doc-title">
          <div class="t form-title">${esc(title)}</div>
          <table class="kv lined"><tbody>${fields.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v || '')}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>`;
  }

  /** Commodity owner / ship-to: the company's name and details, one per line (no field labels). */
  function partyBlock(title, party) {
    const { esc } = U();
    const lines = addressLines(party && party.address);
    const body = !party ? '' : `<div>${esc(party.name || '')}</div>${lines.map((l) => `<div>${esc(l)}</div>`).join('')}${party.phone ? `<div>${esc(party.phone)}</div>` : ''}`;
    return `<div><div class="lbl">${esc(title)}</div>${body}</div>`;
  }

  function vehicleBlock(rows) {
    const { esc } = U();
    return `<div class="form-vehicle"><div class="lbl">VEHICLE INFO:</div>${rows.map(([k, v]) => `<div><span class="lbl">${esc(k)}</span> <strong>${esc(v || '')}</strong></div>`).join('')}</div>`;
  }

  /**
   * The ruled grid. `cols` = [{ label, width }]; `rows` = [{ cells: [...html], bold }];
   * `totals` = cells under the grid (null = no border) plus an optional left-hand note.
   */
  function grid({ cols, rows, totals, note }) {
    const pad = Math.max(0, MIN_ROWS - rows.length);
    const blank = `<tr class="blank">${cols.map(() => '<td></td>').join('')}</tr>`;
    const tot = totals ? (() => {
      const leftSpan = totals.findIndex((t) => t !== null);
      const cells = (pick) => totals.slice(leftSpan).map((t) => (t === null ? '<td class="nob"></td>' : `<${pick === 'h' ? 'th' : 'td class="c"'}>${pick === 'h' ? t[0] : t[1]}</${pick === 'h' ? 'th' : 'td'}>`)).join('');
      return `<tr class="gap"><td class="nob" colspan="${cols.length}"></td></tr>
        <tr class="tot"><td class="nob note-cell" colspan="${leftSpan}" rowspan="2">${note || ''}</td>${cells('h')}</tr>
        <tr class="tot">${cells('v')}</tr>`;
    })() : '';
    return `<table class="doc-table form-grid">
      <colgroup>${cols.map((c) => `<col style="width:${c.width}%">`).join('')}</colgroup>
      <thead><tr>${cols.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.bold ? 'cew' : ''}">${r.cells.map((c) => `<td class="c">${c}</td>`).join('')}</tr>`).join('')}${blank.repeat(pad)}${tot}</tbody>
    </table>`;
  }

  /** Long descriptions print smaller so they stay on one line, like the paper forms. */
  const desc = (text) => (String(text).length > 26 ? `<span class="shrink">${U().esc(text)}</span>` : U().esc(text));
  const signLine = (label, value) => `<div class="wm-line"><span>${U().esc(label)}</span><span class="fill">${U().esc(value || '')}</span></div>`;

  function weighmaster(name) {
    return `<div class="weighmaster"><div class="wm-title">WEIGHMASTER CERTIFICATE</div><p>${WEIGHMASTER_TEXT}</p>
      ${signLine('Scale Person Name:', name)}${signLine('Scale Person Signature:', '')}</div>`;
  }

  const WEIGHT_COLS = (first) => [{ label: first, width: 18 }, { label: 'DESCRIPTION', width: 26 }, { label: 'GROSS', width: 18.6 }, { label: 'TARE', width: 18.7 }, { label: 'NET', width: 18.7 }];
  const weightTotals = (rows) => {
    const t = rows.reduce((a, r) => ({ g: a.g + r.gross, t: a.t + r.tare, n: a.n + r.net }), { g: 0, t: 0, n: 0 });
    return [null, null, ['TOTAL GROSS', U().fmt(t.g)], ['TOTAL TARE', U().fmt(t.t)], ['TOTAL NET', U().fmt(t.n)]];
  };

  /** Inbound Receiving Report */
  function irr(wc, data, P) {
    const { esc, fmt } = U();
    const t = wc.transfer;
    const items = (t.lines || []).map((line) => {
      const m = L().lineMath(line); const desc = String(line.description || '').trim();
      const tare = L().r2(L().num(line.irrTare));
      return { units: m.cat.cew || m.irrUnits ? fmt(m.irrUnits) : 'Wt.Only', label: m.cat.cew ? (m.cat.key === 'cbep' ? L().cbepName(line, data.priceItems) : IRR_LABELS[m.cat.key]) + (desc ? ` — ${desc}` : '') : (desc || 'Other (non-CEW)'),
        gross: L().r2(m.irrWeight + tare), tare, net: m.irrWeight };
    }).filter((x) => x.gross || x.net || x.units !== 'Wt.Only');
    return `${formHead(data, 'Inbound Receiving Report', [['IRR #', t.irrNumber], ['DATE:', L().shortDate(wc.date)], ['SHIPPING DATE:', L().shortDate(t.shippingDate || wc.date)]])}
      <div class="irr-blocks">${partyBlock('COMMODITY OWNER:', P.customer)}${partyBlock('SHIP TO:', us(data))}</div>
      ${vehicleBlock([['LICENSE PLATE:', t.licensePlate]])}
      ${grid({ cols: WEIGHT_COLS('UNITS'), rows: items.map((x) => ({ cells: [x.units, desc(x.label), fmt(x.gross), fmt(x.tare), fmt(x.net)] })), totals: weightTotals(items) })}
      ${wc.notes ? `<p><strong>Notes:</strong> ${esc(wc.notes)}</p>` : ''}
      <div class="form-sign">${signLine('Inbound Report By:', t.irrBy)}</div>`;
  }

  /** Weight certificate for a transfer (the customer is the commodity owner). */
  function weightCert(wc, data, P) {
    const { esc, fmt } = U();
    const t = wc.transfer;
    const rows = L().wcRows(t, data.priceItems);
    return `${formHead(data, 'Weight Certificate', [['INVOICE #', wc.wcNumber], ['DATE:', L().dotDate(wc.date)], ['SHIPPING DATE:', L().dotDate(t.shippingDate || wc.date)]])}
      <div class="irr-blocks">${partyBlock('COMMODITY OWNER:', P.customer)}${partyBlock('SHIP TO:', us(data))}</div>
      ${vehicleBlock([['LICENSE PLATE:', t.licensePlate]])}
      ${grid({ cols: WEIGHT_COLS('UNITS'), rows: rows.map((r) => ({ bold: !!r.claim, cells: [r.weightOnly ? 'Wt. Only' : fmt(r.units), desc(r.label), fmt(r.gross), fmt(r.tare), fmt(r.net)] })), totals: weightTotals(rows) })}
      ${weighmaster(t.scalePerson)}`;
  }

  /** Weight certificate for a residual shipment: we're the commodity owner, the vendor is ship-to; storage note beside the totals. */
  function shipmentWc(wc, data) {
    const { esc, fmt } = U();
    const sh = wc.shipment || {};
    const vendor = data.companies.find((c) => c.id === wc.companyId) || null;
    const matName = (id) => (data.materials.find((m) => m.id === id) || {}).name || '';
    const rows = L().shipmentRows(wc, data.materials).map((r) => ({ ...r, count: r.count ? fmt(r.count) : 'Wt. Only', label: r.label || matName(null) }));
    const note = L().storageSentence(L().residualFifo({ materials: data.materials, wcs: data.wcs }).notes.get(wc.id) || []);
    return `${formHead(data, 'Weight Certificate', [['INVOICE #', wc.wcNumber], ['DATE:', L().dotDate(wc.date)], ['SHIPPING DATE:', L().dotDate(wc.date)]])}
      <div class="irr-blocks">${partyBlock('COMMODITY OWNER:', us(data))}${partyBlock('SHIP TO:', vendor)}</div>
      ${vehicleBlock([['LICENSE PLATE:', sh.licensePlate]])}
      ${grid({ cols: WEIGHT_COLS(sh.countLabel === 'skids' ? 'SKIDS' : 'UNITS'), rows: rows.map((r) => ({ bold: r.bold, cells: [r.count, desc(r.label), fmt(r.gross), fmt(r.tare), fmt(r.net)] })),
        totals: weightTotals(rows), note: esc([note, wc.notes].filter(Boolean).join(' ')) })}
      ${weighmaster(sh.scalePerson)}`;
  }

  /** A CBEP generation certificate: what was generated of one residual during the month. */
  function generationWc(wc, data) {
    const { esc, fmt } = U();
    const g = wc.generation || {}; const net = L().lineNet((g.lines || [])[0] || {});
    const month = g.forMonth ? L().monthLabel(Number(g.forMonth.slice(0, 4)), Number(g.forMonth.slice(5, 7))) : '';
    return `${formHead(data, 'Weight Certificate', [['INVOICE #', wc.wcNumber], ['DATE:', L().dotDate(wc.date)], ['GENERATED IN:', month]])}
      <div class="irr-blocks">${partyBlock('COMMODITY OWNER:', us(data))}<div><div class="lbl">GENERATED FROM:</div><div>Cancellation of CBEP CEW during ${esc(month)}</div></div></div>
      ${grid({ cols: WEIGHT_COLS('UNITS'), rows: [{ bold: true, cells: ['Wt. Only', desc(`CBEP ${g.residual || ''}`), 'Net Only', 'Net Only', fmt(net)] }],
        totals: [null, null, null, null, ['TOTAL NET', fmt(net)]] })}
      ${weighmaster(g.scalePerson)}`;
  }

  /** An inventory WC (e.g. LCD lamps): our facility as commodity owner, each weighing of each material on hand. */
  function inventoryWc(wc, data) {
    const { fmt } = U();
    const inv = wc.inventory || {}; const mat = (id) => data.materials.find((m) => m.id === id);
    const month = inv.forMonth ? L().monthLabel(Number(inv.forMonth.slice(0, 4)), Number(inv.forMonth.slice(5, 7))) : '';
    const rows = (inv.lines || []).filter((l) => L().lineNet(l) || L().num(l.gross)).map((l) => {
      const net = L().lineNet(l); const tare = L().r2(L().num(l.tare)); const m = mat(l.materialId);
      return { bold: true, cells: ['Wt. Only', desc(m ? m.name : 'Material'), fmt(L().num(l.gross) || L().r2(net + tare)), fmt(tare), fmt(net)] };
    });
    const tot = rows.length ? (inv.lines || []).reduce((a, l) => ({ g: a.g + (L().num(l.gross) || L().lineNet(l) + L().num(l.tare)), t: a.t + L().num(l.tare), n: a.n + L().lineNet(l) }), { g: 0, t: 0, n: 0 }) : { g: 0, t: 0, n: 0 };
    return `${formHead(data, 'Weight Certificate', [['INVOICE #', wc.wcNumber], ['DATE:', L().dotDate(wc.date)], ['INVENTORY FOR:', month]])}
      <div class="irr-blocks">${partyBlock('COMMODITY OWNER:', us(data))}</div>
      ${grid({ cols: WEIGHT_COLS('UNITS'), rows, totals: [null, null, ['TOTAL GROSS', fmt(L().r2(tot.g))], ['TOTAL TARE', fmt(L().r2(tot.t))], ['TOTAL NET', fmt(L().r2(tot.n))]] })}
      ${weighmaster(inv.scalePerson || wc.scalePerson)}`;
  }
  /** Any other WC type: its number, date and company, with weight lines to fill in. */
  function genericWc(wc, data) {
    const c = data.companies.find((x) => x.id === wc.companyId);
    return `${formHead(data, 'Weight Certificate', [['INVOICE #', wc.wcNumber], ['DATE:', L().dotDate(wc.date)]])}
      <div class="irr-blocks">${partyBlock('COMMODITY OWNER:', c ? { name: c.name, lines: addressLines(c.address), phone: c.phone } : us(data))}</div>
      ${grid({ cols: WEIGHT_COLS('UNITS'), rows: [], totals: [null, null, ['TOTAL GROSS', ''], ['TOTAL TARE', ''], ['TOTAL NET', '']] })}
      ${weighmaster(wc.scalePerson)}`;
  }

  // ---------------------------------------------------------------- an HTML form drawn into a PDF page (the WC in the Merged File)
  /**
   * Lays the printed form out off-screen exactly as it prints (7.5" wide, the page's 0.5" margins), then copies
   * every border, shaded box and word into a PDF page at the same place — so the PDF matches the printout.
   */
  async function htmlToPdfPage(out, html) {
    const { StandardFonts, rgb } = window.PDFLib;
    const fonts = {
      r: await out.embedFont(StandardFonts.Helvetica), b: await out.embedFont(StandardFonts.HelveticaBold),
      i: await out.embedFont(StandardFonts.HelveticaOblique), bi: await out.embedFont(StandardFonts.HelveticaBoldOblique),
    };
    const charset = new Set(fonts.r.getCharacterSet());
    const safe = (t) => Array.from(t).map((ch) => (charset.has(ch.codePointAt(0)) ? ch : ({ '\u2192': '->', '\u2265': '>=', '\u2264': '<=' }[ch] || '?'))).join('');
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-20000px;top:0;width:720px;background:#fff';
    host.innerHTML = `<div class="doc-sheet print-area" style="padding:0;border:0;box-shadow:none;max-width:none;margin:0">${html}</div>`;
    document.body.append(host);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const o = host.getBoundingClientRect();
      const page = out.addPage([612, 792]);
      const k = Math.min(0.75, 720 / Math.max(1, o.height));      // px → pt (shrinks only if it wouldn't fit one page)
      const X = (x) => 36 + (x - o.left) * k; const Y = (y) => 792 - 36 - (y - o.top) * k;
      const color = (c) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c || ''); return m && (m[4] === undefined || Number(m[4]) > 0) ? rgb(m[1] / 255, m[2] / 255, m[3] / 255) : null; };
      const hidden = (el) => !!el.closest('.no-print') || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden';
      host.querySelectorAll('*').forEach((el) => {
        if (hidden(el)) return;
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const bg = color(cs.backgroundColor);
        if (bg && !(bg.red > 0.99 && bg.green > 0.99 && bg.blue > 0.99)) page.drawRectangle({ x: X(r.left), y: Y(r.bottom), width: r.width * k, height: r.height * k, color: bg });
        [['Top', r.left, r.top, r.right, r.top], ['Bottom', r.left, r.bottom, r.right, r.bottom], ['Left', r.left, r.top, r.left, r.bottom], ['Right', r.right, r.top, r.right, r.bottom]].forEach(([side, x1, y1, x2, y2]) => {
          const w = parseFloat(cs[`border${side}Width`]); const st = cs[`border${side}Style`]; const c = color(cs[`border${side}Color`]);
          if (!w || st === 'none' || st === 'hidden' || !c) return;
          const off = (w / 2) * (side === 'Top' || side === 'Left' ? 1 : -1);
          const vertical = side === 'Left' || side === 'Right';
          page.drawLine({ start: { x: X(x1 + (vertical ? off : 0)), y: Y(y1 + (vertical ? 0 : off)) }, end: { x: X(x2 + (vertical ? off : 0)), y: Y(y2 + (vertical ? 0 : off)) }, thickness: w * k, color: c });
        });
      });
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement; if (!el || hidden(el) || !n.data.trim()) continue;
        const cs = getComputedStyle(el);
        const fs = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold'; const it = cs.fontStyle === 'italic';
        const font = fonts[bold ? (it ? 'bi' : 'b') : (it ? 'i' : 'r')]; const c = color(cs.color) || rgb(0, 0, 0);
        const tt = cs.textTransform;
        const re = /\S+/g; let m;
        while ((m = re.exec(n.data))) {
          range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
          const rr = range.getClientRects()[0]; if (!rr) continue;
          let word = m[0]; if (tt === 'uppercase') word = word.toUpperCase();
          page.drawText(safe(word), { x: X(rr.left), y: Y(rr.bottom - 0.212 * fs), size: fs * k, font, color: c });
        }
      }
    } finally { host.remove(); }
  }

  /** The Merged File: the 197, the WC and the 198 C — inside a claim period, that period's share of a partial transfer. */
  async function buildMergedPdf(wc, data, P, period) {
    await loadScript(PDF_LIB_URL, () => !!window.PDFLib);
    const { PDFDocument } = window.PDFLib;
    const out = await PDFDocument.create();
    const add = async (bytes) => { const src = await PDFDocument.load(bytes); (await out.copyPages(src, src.getPageIndices())).forEach((pg) => out.addPage(pg)); };
    await add(await build197Pdf(L().form197Values({ wc, parties: P, allocations: data.allocations, periods: data.periods })));
    await htmlToPdfPage(out, weightCert(wc, data, P));
    const part = period ? await App.Store.claimPart198(wc, period, data) : null;
    const T = App.Store.transfer198(wc);
    const lines = part ? part.lines : T.lines;
    if (lines.length) {
      const header = P.selfCollected ? facilityHeader198(data, wc) : header198(P.selfCollected ? null : P.customer, T.basis.log);
      await add(await build198Pdf([{ header, pages: L().paginate198(lines), strike: true }]));
    }
    return { bytes: await out.save(), part, has198: !!lines.length };
  }

  /** Purchase invoice: credits for what we buy, deductions for non-CEW units and anything else, final balance. */
  function invoice(wc, data, P) {
    const { esc, fmt } = U();
    const t = wc.transfer;
    const inv = L().invoiceMath({ transfer: t, mode: t.mode, priceItems: data.priceItems, company: P.customer });
    const money = (n) => L().money(n);
    const rate = (r) => (r === null || r === undefined ? '<span class="flag-text no-print">rate needed</span>' : money(r));
    const cols = [{ label: 'UNITS', width: 12 }, { label: 'DESCRIPTION', width: 22 }, { label: 'GROSS', width: 11.5 }, { label: 'TARE', width: 11.5 }, { label: 'NET', width: 11.5 }, { label: 'RATE/LBS', width: 13 }, { label: 'CREDIT', width: 18.5 }];
    const rows = inv.credits.map((r) => ({ bold: r.part === 'cew', cells: [
      r.part === 'other' && !r.units ? 'Wt. Only' : fmt(r.units), desc(r.label + (r.handling ? '*' : '')), fmt(r.gross), fmt(r.tare), fmt(r.weight),
      r.rate === null ? rate(null) : `${money(r.rate)}${r.basis === 'unit' ? '/unit' : ''}`, r.amount === null ? '' : money(r.amount)] }));
    const g = inv.credits.reduce((a, r) => ({ g: a.g + (r.gross || 0), t: a.t + (r.tare || 0), n: a.n + r.weight }), { g: 0, t: 0, n: 0 });
    const ded = inv.deductions;
    const dedRows = ded.map((d) => `<tr><td class="c">${fmt(d.quantity)}</td><td class="c">${esc(d.description)}</td><td class="c">${esc(d.reason)}</td><td class="c">${rate(d.rate)}</td><td class="c">${d.amount === null ? '' : money(d.amount)}</td></tr>`).join('')
      + '<tr class="blank"><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(Math.max(0, 4 - ded.length));
    const invoiceDate = t.poDate || (t.timeline && t.timeline.poSent && t.timeline.poSent !== 'N/A' ? t.timeline.poSent : App.UI.today());
    return `<div class="po">${formHead(data, 'Purchase Invoice', [['PO #', wc.wcNumber], ['DATE:', L().slashDate(invoiceDate)], ['SHIPPING DATE:', L().slashDate(t.shippingDate || wc.date)]])}
      <div class="irr-blocks">${partyBlock('COMMODITY OWNER:', P.customer)}${partyBlock('SHIP TO:', us(data))}</div>
      ${vehicleBlock([['LICENSE PLATE:', t.licensePlate], ['CIRCUMSTANCE:', t.mode === 'pickup' ? 'Pick up' : t.mode === 'dropoff' ? 'Drop off' : '']])}
      ${grid({ cols, rows, totals: [null, null, ['TOTAL GROSS', fmt(g.g)], ['TOTAL TARE', fmt(g.t)], ['TOTAL NET', fmt(g.n)], null, ['TOTAL CREDIT', money(inv.totalCredit)]] })}
      <table class="doc-table form-grid deductions">
        <colgroup><col style="width:15%"><col style="width:22%"><col style="width:33%"><col style="width:12%"><col style="width:18%"></colgroup>
        <thead><tr><th colspan="5">DEDUCTIONS</th></tr><tr><th>QUANTITY</th><th>DESCRIPTION</th><th>REASON FOR DEDUCTION</th><th>RATE</th><th>DEDUCTION</th></tr></thead>
        <tbody>${dedRows}<tr><th colspan="5" class="c">${HANDLING_NOTE}</th></tr></tbody>
      </table>
      <div class="money-boxes">
        <table class="doc-table form-grid box"><tbody><tr><th>TOTAL DEDUCTION</th></tr><tr><td class="c">${money(inv.totalDeduction)}</td></tr></tbody></table>
        <table class="doc-table form-grid box"><tbody><tr><th>FINAL BALANCE</th></tr><tr><td class="c">${money(inv.finalBalance)}</td></tr></tbody></table>
      </div>
      <div class="form-sign">${signLine('Purchase Invoice by:', t.invoiceBy)}</div></div>`;
  }

  // ---------------------------------------------------------------- CalRecycle 197: fill the official form
  const FORM_197_URL = 'forms/CalRecycle197.pdf';
  const PDF_LIB_URL = 'js/vendor/pdf-lib.min.js';
  const SIGNATURE_FONT_URL = 'js/vendor/signature-font.js';
  // the 197's signature boxes (Section IV) — the signer's name is drawn here in a script font
  const SIGNATURE_BOXES = { collector: 'Signature of Approved Collector', recycler: 'Signature of Approved Recycler' };
  let formBytes = null;
  function loadScript(src, ready) {
    return new Promise((resolve, reject) => {
      if (ready()) { resolve(); return; }
      const el = document.createElement('script');
      el.src = src; el.onload = () => resolve(); el.onerror = () => reject(new Error(`Couldn't load ${src}`));
      document.head.append(el);
    });
  }
  // WinAnsi codes for the few characters outside Latin-1 that the form's Arial can show
  const WIN_ANSI = { 0x20ac: 128, 0x201a: 130, 0x192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x2c6: 136, 0x2030: 137, 0x160: 138, 0x2039: 139, 0x152: 140,
    0x17d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2dc: 152, 0x2122: 153, 0x161: 154, 0x203a: 155, 0x153: 156, 0x17e: 158, 0x178: 159 };
  const toWinAnsi = (text) => Array.from(String(text)).map((ch) => {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) return c;
    if (c >= 160 && c <= 255) return c;
    return WIN_ANSI[c] || 63; // '?'
  });

  /**
   * Returns the filled 197 as a PDF (Uint8Array). Nothing about CalRecycle's form changes: same pages, same
   * fields with their own settings. Each value is drawn the way Adobe draws a typed-in value — in the form's own
   * embedded Arial, at the field's own size (Arial 14 in Section I, auto-size everywhere else), with the field's
   * alignment. A value too wide for its box shrinks just enough to fit rather than being cut off.
   */
  async function build197Pdf(values) {
    await loadScript(PDF_LIB_URL, () => !!window.PDFLib);
    const sigNames = Object.values(values.signatures || {}).filter(Boolean);
    if (sigNames.length) await loadScript(SIGNATURE_FONT_URL, () => !!App.SignatureFont);
    if (!formBytes) {
      const res = await fetch(FORM_197_URL);
      if (!res.ok) throw new Error(`Couldn't load the blank 197 (${FORM_197_URL}).`);
      formBytes = await res.arrayBuffer();
    }
    const { PDFDocument, PDFName, PDFHexString, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setFillingGrayscaleColor, moveText, showText, rgb } = window.PDFLib;
    const pdf = await PDFDocument.load(formBytes);
    const form = pdf.getForm();
    // the form's own Arial (Default Resources), with its widths, ascent and descent
    const dr = form.acroForm.dict.lookup(PDFName.of('DR'));
    const fonts = dr.lookup(PDFName.of('Font'));
    const arialRef = fonts.get(PDFName.of('Arial'));
    const arial = pdf.context.lookup(arialRef);
    const firstChar = arial.lookup(PDFName.of('FirstChar')).asNumber();
    const widthsArr = arial.lookup(PDFName.of('Widths'));
    const widths = []; for (let i = 0; i < widthsArr.size(); i += 1) widths.push(widthsArr.lookup(i).asNumber());
    const fd = arial.lookup(PDFName.of('FontDescriptor'));
    const ascent = fd.lookup(PDFName.of('Ascent')).asNumber() / 1000;
    const descent = fd.lookup(PDFName.of('Descent')).asNumber() / 1000;
    const textWidth = (codes) => codes.reduce((sum, c) => sum + (widths[c - firstChar] || 0), 0) / 1000;
    const hex = (codes) => codes.map((c) => c.toString(16).padStart(2, '0')).join('');

    Object.entries(values.fields).forEach(([name, text]) => {
      const fld = form.getTextField(name);
      // CalRecycle set the date box to 14 pt, too big for MM/DD/YYYY — 10 pt shows the whole date in every viewer
      if (name === 'Date of TransferRow1') fld.acroField.setDefaultAppearance('/Arial 10 Tf 0 g');
      const hadFlags = fld.acroField.dict.has(PDFName.of('Ff'));
      fld.setText(text || '');
      if (!hadFlags) fld.acroField.dict.delete(PDFName.of('Ff')); // leave the field's settings exactly as CalRecycle made them
      const widget = fld.acroField.getWidgets()[0];
      const { width: w, height: h } = widget.getRectangle();
      const codes = toWinAnsi(text || '');
      const m = /([\d.]+)\s+Tf/.exec(fld.acroField.getDefaultAppearance() || '');
      let size = m ? Number(m[1]) : 0;
      if (!size) size = Math.floor((h / 1.35) * 10) / 10;          // auto: fit the box height, as Adobe does
      const tw = textWidth(codes);
      if (tw * size > w - 4) size = Math.max(4, Math.floor(((w - 4) / tw) * 10) / 10);
      const q = fld.acroField.getQuadding ? fld.acroField.getQuadding() : 0;
      const x = q === 1 ? (w - tw * size) / 2 : q === 2 ? w - 2 - tw * size : 2;
      const y = (h - (ascent - descent) * size) / 2 - descent * size;
      const content = codes.length
        ? `/Tx BMC\nq\n1 1 ${(w - 2).toFixed(2)} ${(h - 2).toFixed(2)} re W n\nBT\n/Arial ${size} Tf 0 g\n${x.toFixed(2)} ${y.toFixed(2)} Td\n<${hex(codes)}> Tj\nET\nQ\nEMC`
        : '/Tx BMC\nEMC';
      const ap = pdf.context.stream(content, {
        Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h],
        Resources: pdf.context.obj({ Font: pdf.context.obj({ Arial: arialRef }) }),
      });
      widget.setNormalAppearance(pdf.context.register(ap));
    });
    Object.entries(values.checks).forEach(([name, on]) => { const cb = form.getCheckBox(name); if (on) cb.check(); else cb.uncheck(); });
    // "Indicate Reporting Month/Year the CEW are being claimed:" has no field — write it on the same line,
    // in the label's own font and size (Arial 12), right after "claimed:".
    const page2 = pdf.getPages()[1];
    page2.node.setFontDictionary(PDFName.of('F197Arial'), arialRef);
    [[610.68, values.reportingMonths[0]], [394.08, values.reportingMonths[1]]].forEach(([y, text]) => {
      if (!text) return;
      page2.pushOperators(pushGraphicsState(), beginText(), setFontAndSize('F197Arial', 12), setFillingGrayscaleColor(0), moveText(341, y),
        showText(PDFHexString.of(hex(toWinAnsi(text)))), endText(), popGraphicsState());
    });
    // Section IV signatures: the signer's name in a script font, in dark pen-like ink, fitted to the box
    if (sigNames.length) {
      const F = App.SignatureFont; const page1 = pdf.getPages()[0];
      Object.entries(SIGNATURE_BOXES).forEach(([who, fieldName]) => {
        const name = (values.signatures || {})[who];
        if (!name) return;
        const rect = form.getField(fieldName).acroField.getWidgets()[0].getRectangle();
        const chars = Array.from(name).filter((ch) => F.glyphs[ch]);
        const width = chars.reduce((w, ch) => w + F.glyphs[ch][0], 0) / F.upem;
        // capitals reach ~0.72 em and descenders ~0.28 em in this script, so ~1.05 em fits the box height
        const size = Math.min((rect.height - 2) / 1.05, (rect.width - 20) / Math.max(width, 0.01), 26);
        let x = rect.x + 10;
        const y = rect.y + (rect.height - 1.0 * size) / 2 + 0.28 * size;
        chars.forEach((ch) => {
          const [adv, d] = F.glyphs[ch];
          if (d) page1.drawSvgPath(d, { x, y, scale: size / F.upem, color: rgb(0.07, 0.11, 0.33), borderWidth: 0 });
          x += (adv / F.upem) * size;
        });
      });
    }
    return pdf.save({ updateFieldAppearances: false });
  }

  /** Print the filled 197 itself (not the app page). */
  function print197() {
    const frame = document.querySelector('iframe.pdf-frame');
    if (!frame) return false;
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { window.open(frame.src, '_blank'); }
    return true;
  }
  // Ctrl/Cmd+P on the 197 tab prints the form, not the page around it
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p' && document.querySelector('iframe.pdf-frame')) {
      e.preventDefault();
      print197();
    }
  });

  // ---------------------------------------------------------------- CalRecycle 198 (C, UC, Master) on CalRecycle's blank form
  const FORM_198_URL = 'forms/CalRecycle198.pdf';
  let form198Bytes = null;
  // the form's own Helvetica (/Helv) codes plain characters and accented letters as usual; curly quotes etc. become plain
  const HELV_FIX = { '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u00a0': ' ', '\u2026': '...' };
  const helvText = (v) => Array.from(String(v ?? '')).map((ch) => HELV_FIX[ch] || ch)
    .map((ch) => { const c = ch.codePointAt(0); return (c >= 32 && c < 127) || (c >= 192 && c <= 255) || ch === '\n' ? ch : '?'; }).join('');
  const helvHex = (t) => Array.from(t).map((ch) => ch.codePointAt(0).toString(16).padStart(2, '0')).join('');
  function wrapText(text, metrics, size, width) {
    const out = [];
    String(text).split('\n').forEach((para) => {
      let line = '';
      para.split(/\s+/).filter(Boolean).forEach((word) => {
        const next = line ? `${line} ${word}` : word;
        if (!line || metrics.widthOfTextAtSize(next, size) <= width) line = next; else { out.push(line); line = word; }
      });
      out.push(line);
    });
    return out;
  }
  /**
   * A 198 field drawn the way Adobe draws a typed-in value: the form's own Helvetica, the field's alignment,
   * auto size; multi-line fields wrap (starting at 12 pt and shrinking to fit). Returns where the text sits.
   */
  function set198Field(pdf, form, helvRef, metrics, name, value) {
    const { PDFName } = window.PDFLib;
    const text = helvText(value).trim();
    const fld = form.getTextField(name);
    const hadFlags = fld.acroField.dict.has(PDFName.of('Ff'));
    fld.setText(text);
    if (!hadFlags) fld.acroField.dict.delete(PDFName.of('Ff'));
    const widget = fld.acroField.getWidgets()[0];
    const rect = widget.getRectangle(); const w = rect.width; const h = rect.height;
    const q = fld.acroField.getQuadding ? fld.acroField.getQuadding() : 0;
    const xFor = (tw) => (q === 1 ? (w - tw) / 2 : q === 2 ? w - 2 - tw : 2);
    let body = ''; let first = null;
    if (text) {
      if (fld.isMultiline()) {
        let size = 12; let lines = [];
        // shrink until the lines fit the height and the longest word fits the width (a date in the narrow Date box)
        for (; size > 4; size -= 0.5) {
          lines = wrapText(text, metrics, size, w - 4);
          if (lines.length * size * 1.15 <= h - 3 && lines.every((ln) => metrics.widthOfTextAtSize(ln, size) <= w - 4)) break;
        }
        body = lines.map((ln, i) => {
          const tw = metrics.widthOfTextAtSize(ln, size); const x = xFor(tw); const y = h - 2 - size * 0.9 - i * size * 1.15;
          if (i === 0) first = { x, y, size, width: tw };
          return `/Helv ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${helvHex(ln)}> Tj`;
        }).join('\n');
      } else {
        const tw1 = metrics.widthOfTextAtSize(text, 1);
        let size = Math.floor((h / 1.35) * 10) / 10;
        if (tw1 * size > w - 4) size = Math.max(4, Math.floor(((w - 4) / tw1) * 10) / 10);
        const tw = tw1 * size; const x = xFor(tw); const y = (h - 0.925 * size) / 2 + 0.207 * size;
        first = { x, y, size, width: tw };
        body = `/Helv ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${helvHex(text)}> Tj`;
      }
    }
    const content = body ? `/Tx BMC\nq\n1 1 ${(w - 2).toFixed(2)} ${(h - 2).toFixed(2)} re W n\nBT\n0 g\n${body}\nET\nQ\nEMC` : '/Tx BMC\nEMC';
    const ap = pdf.context.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: pdf.context.obj({ Font: pdf.context.obj({ Helv: helvRef }) }) });
    widget.setNormalAppearance(pdf.context.register(ap));
    return first ? { ...first, pageX: rect.x + first.x, pageY: rect.y + first.y } : null;
  }
  /**
   * Fills CalRecycle's blank 198: each set = { header, pages: [{lines, totals}], strike } — 7 entries per page,
   * a fresh copy of the form per page, flattened and joined. On the 198 C (strike) a red line goes through the
   * units of each struck entry, as on Bellflower's own 198 Cs.
   */
  async function build198Pdf(sets) {
    await loadScript(PDF_LIB_URL, () => !!window.PDFLib);
    if (!form198Bytes) {
      const res = await fetch(FORM_198_URL);
      if (!res.ok) throw new Error(`Couldn't load the blank 198 (${FORM_198_URL}).`);
      form198Bytes = await res.arrayBuffer();
    }
    const { PDFDocument, PDFName, StandardFonts, rgb } = window.PDFLib;
    const out = await PDFDocument.create();
    for (const set of sets) {
      for (const pg of set.pages) {
        const pdf = await PDFDocument.load(form198Bytes);
        const form = pdf.getForm();
        const metrics = await pdf.embedFont(StandardFonts.Helvetica);
        const helvRef = form.acroForm.dict.lookup(PDFName.of('DR')).lookup(PDFName.of('Font')).get(PDFName.of('Helv'));
        const put = (n, v) => set198Field(pdf, form, helvRef, metrics, n, v);
        Object.entries(set.header).forEach(([n, v]) => put(n, v));
        const marks = [];
        for (let i = 0; i < 7; i += 1) {
          const l = pg.lines[i]; const n = i + 1;
          const u = (x) => (l && L().num(x) ? String(L().num(x)) : '');
          put(`Date mdyRow${n}`, l ? l.date : ''); put(`Type of CA SourceRow${n}`, l ? l.type : ''); put(`NameRow${n}`, l ? l.name : '');
          put(`Address City State ZipRow${n}`, l ? l.address : ''); put(`Contact Person Name  PhoneRow${n}`, l ? l.contact : '');
          const c = put(`CRT CEW UnitsRow${n}`, u(l && l.crt)); const nc = put(`NonCRT CEW UnitsRow${n}`, u(l && l.noncrt)); put(`CBEP CEW UnitsRow${n}`, u(l && l.cbep));
          if (set.strike && l && l.struck) [c, nc].forEach((m) => { if (m) marks.push(m); });
        }
        put('CRT CEW UnitsRowTotal', String(pg.totals.crt)); put('NonCRT CEW UnitsRowTotal', String(pg.totals.noncrt)); put('CBEP CEW UnitsRowTotal', String(pg.totals.cbep));
        form.flatten({ updateFieldAppearances: false });
        const page = pdf.getPages()[0];
        marks.forEach((m) => page.drawLine({ start: { x: m.pageX - 3, y: m.pageY - 2 }, end: { x: m.pageX + m.width + 4, y: m.pageY + m.size * 0.85 }, thickness: 1.3, color: rgb(0.86, 0.1, 0.1) }));
        const [copied] = await out.copyPages(pdf, [0]);
        out.addPage(copied);
      }
    }
    return out.save();
  }
  const oneLineAddress = (a) => addressLines(a).join(', ');
  /** The collector/handler boxes: from the company's record (Contact Name = its owner), else from the 198 O/A. */
  function header198(company, log) {
    const h = (log && log.header) || {};
    const isHandler = company && (company.roles || []).includes('handler');
    return {
      'Approved CollectorHandler': (company && company.name) || h.name || '',
      CEWID: company ? (isHandler ? 'Handler' : (company.cewId || h.cewid || '')) : (h.cewid || ''),
      'Approved CollectorHandler Address City Zip': (company && oneLineAddress(company.address)) || h.address || '',
      'Contact Name': (company && company.owner) || h.contact || '',
      Telephone: (company && company.phone) || h.phone || '',
      'Description of CEW Collection Activity': h.activity || '',
      'Location of Collection Event if different from above': h.location || '',
    };
  }
  /** Our facility's boxes (198 Master): we're the collector on a handler's transfer. */
  function facilityHeader198(data, wc) {
    const p = data.profile; const mode = wc.transfer.mode;
    return {
      'Approved CollectorHandler': p.recyclerName || '', CEWID: p.cewID || '', 'Approved CollectorHandler Address City Zip': oneLineAddress(p.address),
      'Contact Name': p.form198ContactName || '', Telephone: p.form198ContactPhone || p.phone || '',
      'Description of CEW Collection Activity': mode === 'pickup' ? 'Pick up' : mode === 'dropoff' ? 'Drop off' : '',
      'Location of Collection Event if different from above': '',
    };
  }
  const mdy = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; };
  /** Everything the 198 tabs need for one transfer. */
  function transfer198Docs(wc, data, P) {
    const T = App.Store.transfer198(wc);
    const company = P.selfCollected ? null : P.customer;
    const header = P.selfCollected ? facilityHeader198(data, wc) : header198(company, T.basis.log);
    const docs = {};
    if (T.basis.log) {
      docs['198c'] = { label: '198 C', sets: [{ header, pages: L().paginate198(T.lines), strike: true }], lines: T.lines };
      docs['198uc'] = { label: '198 UC', sets: [{ header, pages: L().paginate198(T.uc), strike: false }], lines: T.uc };
      const rem = App.Store.ucRemaining(wc, data);
      const shipped = L().logTotals(T.uc).crt + L().logTotals(T.uc).noncrt - (L().logTotals(rem.remaining).crt + L().logTotals(rem.remaining).noncrt);
      if (shipped > 0 && rem.remaining.length) docs['198ucr'] = { label: '198 UC — Remaining', sets: [{ header, pages: L().paginate198(rem.remaining), strike: false }], lines: rem.remaining };
      if (P.handler) {
        const claimed = L().claimedTotals(T.lines); const hh = P.handler;
        const line = { date: mdy(wc.date), type: 'H', name: hh.name, address: oneLineAddress(hh.address) || (T.basis.log.header || {}).address || '',
          contact: [hh.owner || (T.basis.log.header || {}).contact, hh.phone || (T.basis.log.header || {}).phone].filter(Boolean).join(' '), ...claimed };
        docs['198m'] = { label: '198 Master', sets: [{ header: facilityHeader198(data, wc), pages: L().paginate198([line]), strike: false }], lines: [line] };
      }
    }
    return { T, docs };
  }
  function lines198Summary(lines, strike) {
    const { esc, fmt } = U();
    return `<table class="doc-table"><thead><tr><th>Date</th><th>Type</th><th>Name</th><th>Address</th><th>Contact</th><th class="num">CRT</th><th class="num">Non-CRT</th><th class="num">CBEP</th>${strike ? '<th></th>' : ''}</tr></thead><tbody>${
      lines.map((l) => `<tr class="${strike && l.struck ? 'struck-row' : ''}"><td>${esc(l.date)}</td><td>${esc(l.type)}</td><td>${esc(l.name)}</td><td>${esc(l.address)}</td><td>${esc(l.contact)}</td><td class="num">${l.crt ? fmt(l.crt) : ''}</td><td class="num">${l.noncrt ? fmt(l.noncrt) : ''}</td><td class="num">${l.cbep ? fmt(l.cbep) : ''}</td>${strike ? `<td>${l.struck ? `<span class="badge flag">struck${l.split ? ' (split)' : ''}</span>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  }
  /** Shows a filled 198 like the 197: on the page, Open / Download / Print, and a plain summary underneath. */
  async function show198(container, bar, { title, sets, build, summary, filename, formLabel }) {
    const { h } = U();
    const printBtn = bar.querySelector('[data-a="print"]');
    printBtn.textContent = `Print ${title}`; printBtn.disabled = true;
    const box = h(`<div class="panel pdf-box">
      <div class="row spread"><div><strong>${U().esc(title)}${formLabel === undefined ? ' — on CalRecycle\'s 198 (Rev. 1/2026)' : formLabel}</strong>
        <div class="hint">${formLabel === undefined ? '7 entries per page. ' : ''}Print at <strong>Actual size</strong> (100%).</div></div>
        <div class="row"><a class="button" data-a="open" target="_blank" rel="noopener">Open in a new tab</a><a class="button" data-a="download">Download PDF</a></div></div>
      <div data-role="pdf"><p class="muted">Filling in the 198…</p></div></div>`);
    container.append(box, h(`<details class="panel" open><summary><strong>What's on this ${U().esc(title)}</strong></summary><div class="doc-sheet">${summary}</div></details>`),
      h(`<div class="print-area print-only"><p>Use the <strong>Print ${U().esc(title)}</strong> button to print the form.</p></div>`));
    try {
      const bytes = build ? await build() : await build198Pdf(sets);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      box.querySelector('[data-a="open"]').href = url;
      const dl = box.querySelector('[data-a="download"]'); dl.href = url; dl.download = filename;
      box.querySelector('[data-role="pdf"]').replaceChildren(h(`<iframe class="pdf-frame" title="${U().esc(title)}" src="${url}"></iframe>`));
      printBtn.disabled = false;
    } catch (err) {
      box.querySelectorAll('a.button').forEach((x) => { x.hidden = true; }); printBtn.hidden = true;
      box.querySelector('[data-role="pdf"]').replaceChildren(U().notice(`${U().errText(err)} The filled form needs the site opened from its web address (GitHub Pages).`, 'error'));
    }
  }

  /** Plain-text summary of the same values, under the PDF. */
  function form197Summary(values, P) {
    const { esc } = U();
    const f = values.fields;
    const rows = (suffix) => [['CA Sourced CRT CEW', 'CRT'], ['CA Sourced Non-CRT CEW', 'NonCRT'], ['CA Sourced CBEP CEW', 'CBEP'], ['Totals', 'Totals']].map(([label, key]) => {
      const k = key === 'Totals' ? 'Totals' : `CA Sourced ${key} CEW`;
      return `<tr><td>${label}</td><td class="num">${esc(f[`Units Transferred${k}${suffix}`] || '')}</td><td class="num">${esc(f[`Weights Transferred lbs${k}${suffix}`] || '')}</td><td class="num">${esc(f[`SA Units From Units Transferred${k}${suffix}`] || '')}</td></tr>`;
    }).join('');
    const table = (title, suffix) => `<table class="doc-table"><thead><tr><th>${title}</th><th class="num">Units transferred</th><th class="num">Weights transferred (lbs)</th><th class="num">SA units</th></tr></thead><tbody>${rows(suffix)}</tbody></table>`;
    return `
      <h3>I. Transfer Information</h3>
      <table class="doc-table"><tbody>
        <tr><th>Date of transfer</th><td>${esc(f['Date of TransferRow1'])}</td><th>Approved collector</th><td>${esc(f['Approved Collector NameRow1'])}</td><th>Collector CEWID #</th><td>${esc(f['Collector CEWID Row1'])}</td></tr>
        <tr><th>Approved recycler</th><td colspan="3">${esc(f['Approved Recycler NameRow1'])}</td><th>Recycler CEWID #</th><td>${esc(f['Recycler CEWID Row1'])}</td></tr>
      </tbody></table>
      ${P && P.collectorIsFacility && P.dualEntity ? '<p><strong>Dual entity transfer</strong> — we are both the approved collector and the approved recycler.</p>' : ''}
      <h3>II. Transfer Amounts</h3>${table('CEW type', '')}
      <p><strong>Collector activity:</strong> ${esc(f['documented in the collection log']) || '—'}</p>
      <h3>III. Documents provided</h3>
      <p>${values.checks[L().F197_CHECK_LOGS] ? '☒' : '☐'} Collection logs / 198 / 198SA &nbsp; ${values.checks[L().F197_CHECK_184] ? '☒' : '☐'} Proof of designations / 184s</p>
      <h3>IV. Printed names and signatures</h3>
      <p>Collector: ${esc(f['Printed NameRow1']) || '—'}${values.signatures && values.signatures.collector ? ' (signed)' : ''} · Recycler: ${esc(f['Printed NameRow1_2']) || '—'}${values.signatures && values.signatures.recycler ? ' (signed)' : ''}</p>
      <h3>V. Transfer Discrepancy Detail</h3>
      ${values.needTables ? `<p><strong>Recycler Table 1</strong> — Reporting Month/Year: ${esc(values.reportingMonths[0] || '')}</p>${table('CEW type', '_2')}
        ${values.reportingMonths[1] ? `<p><strong>Recycler Table 2</strong> — Reporting Month/Year: ${esc(values.reportingMonths[1])}</p>${table('CEW type', '_3')}` : '<p>Recycler Table 2: left blank until the rest is claimed.</p>'}`
        : '<p>Tables left blank — everything listed above is claimed in one month.</p>'}`;
  }

  return {
    async render(container) {
      const { h, esc } = U();
      const [idStr, typeParam] = App.State.routeParams;
      const data = await App.Store.loadAll();
      const wc = data.wcs.find((w) => w.id === Number(idStr));
      const DOC198 = ['198c', '198uc', '198ucr', '198m'];
      const type = TYPES.some(([k]) => k === typeParam) || DOC198.includes(typeParam) ? typeParam : 'irr';
      // a CRT/plasma shipment's 198 UC: the entries of each source transfer's UC that went out with it (locked once made)
      if (wc && (wc.kind === 'crtShipment' || (wc.kind === 'shipment' && L().crtLines(wc).length)) && typeParam === '198uc') {
        const recycler = data.companies.find((c) => c.id === wc.companyId);
        const bar = h(`<div class="doc-toolbar"><a href="#/crtplasma">← CRT & Plasma</a><span class="spacer"></span><button type="button" class="primary" data-a="print">Print</button></div>`);
        bar.querySelector('[data-a="print"]').addEventListener('click', () => { if (!print197()) window.print(); });
        container.append(bar);
        const parts = await App.Store.shipmentUc(wc, data);
        parts.filter((x) => x.missing).forEach((x) => container.append(U().notice(`WC #${esc(x.wc.wcNumber)} has no 198 O/A entered yet, so its 198 UC can't be made. Add its logs on the transfer.`, 'warning')));
        parts.filter((x) => x.short && (x.short.crt || x.short.plasma)).forEach((x) => container.append(U().notice(`WC #${esc(x.wc.wcNumber)}: ${[x.short.crt ? `${x.short.crt} CRT` : '', x.short.plasma ? `${x.short.plasma} plasma` : ''].filter(Boolean).join(' and ')} unit(s) in this shipment have no logs left on its 198 UC (non-CEW, or already sent).`, 'warning')));
        const ok = parts.filter((x) => !x.missing && x.lines.length);
        if (!ok.length) { container.append(U().empty('No 198 UC entries for this shipment', 'Enter the source transfers\' 198 O/A first.')); return; }
        const sets = ok.map((x) => {
          const P2 = App.Store.transferParties(x.wc, data);
          const hd = P2.selfCollected ? facilityHeader198(data, x.wc) : header198(P2.customer, x.basis.log);
          return { header: hd, pages: L().paginate198(x.lines), strike: false };
        });
        await show198(container, bar, { title: '198 UC — Shipped', sets, filename: `198_UC_shipped_${wc.date || ''}${recycler ? `_${recycler.name.replace(/\W+/g, '_')}` : ''}.pdf`,
          summary: `<p>Shipped ${esc(wc.date || '')}${recycler ? ` to ${esc(recycler.name)}` : ''}. These entries are locked to this shipment and won't go out again.</p>${ok.map((x) => `<h3>WC #${esc(x.wc.wcNumber)}</h3>${lines198Summary(x.lines, false)}`).join('')}` });
        return;
      }
      if (wc && !wc.noWc && (wc.kind === 'inventory' || wc.kind === 'generic')) {
        const bar = h(`<div class="doc-toolbar"><a href="#/wc/${wc.id}">← WC #${esc(wc.wcNumber)}</a><span class="spacer"></span><button type="button" class="primary" data-a="print">Print</button></div>`);
        bar.querySelector('[data-a="print"]').addEventListener('click', () => window.print());
        container.append(bar, h(`<div class="doc-sheet print-area">${wc.kind === 'inventory' ? inventoryWc(wc, data) : genericWc(wc, data)}</div>`));
        return;
      }
      if (wc && wc.kind === 'generation') {
        const bar = h(`<div class="doc-toolbar"><a href="#/wc/${wc.id}">← WC #${esc(wc.wcNumber)}</a><span class="spacer"></span><button type="button" class="primary" data-a="print">Print</button></div>`);
        bar.querySelector('[data-a="print"]').addEventListener('click', () => window.print());
        container.append(bar, h(`<div class="doc-sheet print-area">${generationWc(wc, data)}</div>`));
        return;
      }
      if (wc && wc.kind === 'shipment') {
        const bar = h(`<div class="doc-toolbar"><a href="#/wc/${wc.id}">← WC #${esc(wc.wcNumber)}</a><span class="spacer"></span><button type="button" class="primary" data-a="print">Print</button></div>`);
        bar.querySelector('[data-a="print"]').addEventListener('click', () => window.print());
        container.append(bar, h(`<div class="doc-sheet print-area">${shipmentWc(wc, data)}</div>`));
        return;
      }
      if (!wc || wc.kind !== 'transfer') {
        container.append(U().header('Documents'), U().empty('Transfer not found', '<a href="#/transfers">Back to transfers</a>'));
        return;
      }
      const P = App.Store.transferParties(wc, data);
      const allocs = data.allocations.filter((a) => a.wcId === wc.id);
      const D198 = transfer198Docs(wc, data, P);

      const bar = h(`
        <div class="doc-toolbar">
          <a href="#/wc/${wc.id}">← WC #${esc(wc.wcNumber)}</a>
          <span class="spacer"></span>
          ${TYPES.map(([k, label]) => `<a class="button ${k === type ? 'primary' : ''}" href="#/doc/${wc.id}/${k}">${esc(label)}</a>`).join('')}
          ${Object.entries(D198.docs).map(([k, d]) => `<a class="button ${k === type ? 'primary' : ''}" href="#/doc/${wc.id}/${k}">${esc(d.label)}</a>`).join('')}
          <button type="button" class="primary" data-a="print">Print</button>
        </div>`);
      bar.querySelector('[data-a="print"]').addEventListener('click', () => { if (!print197()) window.print(); });
      container.append(bar);

      const inv = L().invoiceMath({ transfer: wc.transfer, mode: wc.transfer.mode, priceItems: data.priceItems, company: P.customer });
      if (type === 'invoice' && inv.missing) container.append(U().notice(`${inv.missing} rate(s) still needed — enter them in the Pricing section of the WC.`, 'warning'));
      if (type === 'invoice' && !wc.transfer.mode) container.append(U().notice('Pick up or drop off isn\u2019t chosen on the WC, so price-list rates can\u2019t be picked.', 'warning'));

      const period = App.Store.currentPeriod(data);
      if (type === 'merged') {
        if (period && !allocs.some((a) => a.claimPeriodId === period.id)) container.append(U().notice(`This transfer isn't on ${esc(App.Models.formatPeriodLabel(period))} — its Merged File here has the whole 198 C.`, 'info'));
        if (!D198.T.basis.log) container.append(U().notice(`No 198 ${D198.T.basis.which} entered yet, so the Merged File has only the 197 and the WC.`, 'warning'));
        const on = period && allocs.some((a) => a.claimPeriodId === period.id) ? period : null;
        let info = '';
        await show198(container, bar, { title: 'Merged File', formLabel: ' — 197, WC and 198 C', filename: `Merged_WC${wc.wcNumber}_${wc.date || ''}${on ? `_${L().periodMonthKey(on)}` : ''}.pdf`,
          build: async () => { const r = await buildMergedPdf(wc, data, P, on); info = r.part && r.part.partial ? `Claimed over several months: this is ${App.Models.formatPeriodLabel(on)}'s share of the 198 C, with every struck line.` : ''; return r.bytes; },
          summary: `<p>In order: the CalRecycle 197, the Weight Certificate, and the 198 C${on ? ` for ${esc(App.Models.formatPeriodLabel(on))}` : ''}.</p>` });
        if (info) container.insertBefore(U().notice(info, 'info'), container.querySelector('.pdf-box'));
        return;
      }
      if (type === '198c' && period && allocs.some((a) => a.claimPeriodId === period.id)) {
        const part = await App.Store.claimPart198(wc, period, data);
        if (part.partial) {
          const header = P.selfCollected ? facilityHeader198(data, wc) : header198(P.customer, D198.T.basis.log);
          container.append(U().notice(`Claimed over several months: this is ${esc(App.Models.formatPeriodLabel(period))}'s share — its entries are locked to this claim, and every struck line is included.${part.short ? ` ${part.short} unit(s) of this claim couldn't be found among the entries left.` : ''}`, part.short ? 'warning' : 'info'));
          await show198(container, bar, { title: '198 C', sets: [{ header, pages: L().paginate198(part.lines), strike: true }], filename: `198_C_WC${wc.wcNumber}_${L().periodMonthKey(period)}.pdf`, summary: lines198Summary(part.lines, true) });
          return;
        }
      }
      if (DOC198.includes(type)) {
        const d = D198.docs[type];
        if (!d) {
          container.append(U().empty(D198.T.basis.log ? 'Nothing to show here' : `No 198 ${D198.T.basis.which} entered yet`,
            D198.T.basis.log ? '' : `${D198.T.basis.which === 'A' ? 'Customer adjustments were required, so the 198 C and UC come from the 198 A. ' : ''}Enter it on <a href="#/wc/${wc.id}">the WC</a> (Source logs).`));
          return;
        }
        const T = D198.T;
        if (!T.plan.complete) container.append(U().noticeHtml(`The struck units don't add up yet: ${L().strikeTotals(T.plan.plan).crt} of ${T.plan.targets.crt} CRT and ${L().strikeTotals(T.plan.plan).noncrt} of ${T.plan.targets.plasma} plasma. Fix them on <a href="#/wc/${wc.id}">the WC</a> (Source logs) before sending this.`, 'warning'));
        const info = `<p>Based on the <strong>198 ${T.basis.which}</strong>${T.basis.which === 'A' ? ' (customer adjustments were required)' : ''}. Struck on the 198 C: ${T.plan.targets.crt} CRT and ${T.plan.targets.plasma} plasma unit(s)${T.plan.saved ? ' (your choice of entries)' : ' (entries picked automatically — change them on the WC)'}.</p>`;
        await show198(container, bar, { title: d.label, sets: d.sets, filename: `${d.label.replace(/\W+/g, '_')}_WC${wc.wcNumber}_${wc.date || ''}.pdf`,
          summary: info + lines198Summary(d.lines, type === '198c') });
        return;
      }

      if (type === '197') {
        const values = L().form197Values({ wc, parties: P, allocations: data.allocations, periods: data.periods });
        const printBtn = bar.querySelector('[data-a="print"]');
        printBtn.textContent = 'Print 197'; printBtn.disabled = true;
        const box = h(`<div class="panel pdf-box">
          <div class="row spread"><div><strong>CalRecycle 197 (Rev. 1/2026) — CalRecycle's own form, filled in</strong>
            <div class="hint">Prints exactly like the original: in the print dialog choose <strong>Actual size</strong> (100%), not "fit to page". Signatures in Section IV are done on paper or in Adobe; the form stays fillable.</div></div>
            <div class="row"><a class="button" data-a="open" target="_blank" rel="noopener">Open in a new tab</a><a class="button" data-a="download">Download PDF</a></div></div>
          <div data-role="pdf"><p class="muted">Filling in the 197…</p></div></div>`);
        container.append(box,
          h(`<details class="panel" open><summary><strong>What's on this 197</strong></summary><div class="doc-sheet">${form197Summary(values, P)}</div></details>`),
          h('<div class="print-area print-only"><p>To print the CalRecycle 197 exactly as the official form, use the <strong>Print 197</strong> button (or Ctrl+P) on the 197 page.</p></div>'));
        try {
          const bytes = await build197Pdf(values);
          const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          box.querySelector('[data-a="open"]').href = url;
          const dl = box.querySelector('[data-a="download"]'); dl.href = url; dl.download = `CalRecycle197_WC${wc.wcNumber}_${wc.date || ''}.pdf`;
          box.querySelector('[data-role="pdf"]').replaceChildren(h(`<iframe class="pdf-frame" title="CalRecycle 197" src="${url}"></iframe>`));
          printBtn.disabled = false;
        } catch (err) {
          box.querySelectorAll('a.button').forEach((x) => { x.hidden = true; });
          printBtn.hidden = true;
          box.querySelector('[data-role="pdf"]').replaceChildren(U().notice(`${U().errText(err)} The filled form needs the site opened from its web address (GitHub Pages), not from a file on this computer. The values are listed below.`, 'error'));
        }
        return;
      }
      const body = { irr, wc: weightCert, invoice }[type](wc, data, P, allocs);
      container.append(h(`<div class="doc-sheet print-area">${body}</div>`));
    },
  };
})();

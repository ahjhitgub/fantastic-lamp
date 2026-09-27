window.App = window.App || {};
App.Pages = App.Pages || {};

/**
 * Printable documents for one transfer WC. Route: #/doc/<wcId>/<irr|wc|invoice|197>
 * Layouts are generic for now and will be matched to the real forms.
 */
App.Pages.doc = (function () {
  const TYPES = [['irr', 'Inbound Receiving Report'], ['wc', 'Weight Certificate'], ['invoice', 'Purchase Invoice'], ['197', 'CalRecycle 197']];
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

  /** Commodity owner / ship-to. `labelled` = the Address / Zip Code / Phone style used for customers. */
  function partyBlock(title, party, labelled) {
    const { esc } = U();
    const lines = addressLines(party && party.address);
    const body = !party ? '' : labelled
      ? `<div class="party-name">${esc(party.name || '')}</div>
         <table class="kv-left"><tbody>
           <tr><th>Address:</th><td>${esc(lines[0] || '')}</td></tr>
           <tr><th>Zip Code:</th><td>${esc(lines.slice(1).join(', '))}</td></tr>
           <tr><th>Phone:</th><td>${esc(party.phone || '')}</td></tr>
         </tbody></table>`
      : `<div>${esc(party.name || '')}</div>${lines.map((l) => `<div>${esc(l)}</div>`).join('')}${party.phone ? `<div>${esc(party.phone)}</div>` : ''}`;
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
      return { units: m.cat.cew || m.irrUnits ? fmt(m.irrUnits) : 'Wt.Only', label: m.cat.cew ? IRR_LABELS[m.cat.key] + (desc ? ` — ${desc}` : '') : (desc || 'Other (non-CEW)'),
        gross: L().r2(m.irrWeight + tare), tare, net: m.irrWeight };
    }).filter((x) => x.gross || x.net || x.units !== 'Wt.Only');
    return `${formHead(data, 'Inbound Receiving Report', [['IRR #', t.irrNumber], ['DATE:', L().shortDate(wc.date)], ['SHIPPING DATE:', L().shortDate(t.shippingDate || wc.date)]])}
      <div class="irr-blocks">${partyBlock('COMMODITY OWNER:', P.customer, true)}${partyBlock('SHIP TO:', us(data), false)}</div>
      ${vehicleBlock([['LICENSE PLATE:', t.licensePlate]])}
      ${grid({ cols: WEIGHT_COLS('UNITS'), rows: items.map((x) => ({ cells: [x.units, desc(x.label), fmt(x.gross), fmt(x.tare), fmt(x.net)] })), totals: weightTotals(items) })}
      ${wc.notes ? `<p><strong>Notes:</strong> ${esc(wc.notes)}</p>` : ''}
      <div class="form-sign">${signLine('Inbound Report By:', t.irrBy)}</div>`;
  }

  /** Weight certificate for a transfer (the customer is the commodity owner). */
  function weightCert(wc, data, P) {
    const { esc, fmt } = U();
    const t = wc.transfer;
    const rows = L().wcRows(t);
    return `${formHead(data, 'Weight Certificate', [['INVOICE #', wc.wcNumber], ['DATE:', L().dotDate(wc.date)], ['SHIPPING DATE:', L().dotDate(t.shippingDate || wc.date)]])}
      <div class="irr-blocks">${partyBlock('COMMODITY OWNER:', P.customer, true)}${partyBlock('SHIP TO:', us(data), false)}</div>
      ${vehicleBlock([['LICENSE PLATE:', t.licensePlate]])}
      ${grid({ cols: WEIGHT_COLS('UNITS'), rows: rows.map((r) => ({ bold: r.label.startsWith('CEW '), cells: [r.weightOnly ? 'Wt. Only' : fmt(r.units), desc(r.label), fmt(r.gross), fmt(r.tare), fmt(r.net)] })), totals: weightTotals(rows) })}
      ${weighmaster(t.scalePerson)}`;
  }

  /** Weight certificate for a residual shipment: we're the commodity owner, the vendor is ship-to; storage note beside the totals. */
  function shipmentWc(wc, data) {
    const { esc, fmt } = U();
    const sh = wc.shipment || {};
    const vendor = data.companies.find((c) => c.id === wc.companyId) || null;
    const matName = (id) => (data.materials.find((m) => m.id === id) || {}).name || '';
    const rows = (sh.lines || []).filter((l) => l.description || l.materialId != null || L().lineNet(l)).map((l) => {
      const net = L().lineNet(l); const tare = L().r2(L().num(l.tare));
      const count = L().num(l.count);
      return { bold: l.cew !== false, count: count ? fmt(count) : 'Wt. Only', label: l.description || matName(l.materialId), gross: L().num(l.gross) || L().r2(net + tare), tare, net };
    });
    const note = L().storageSentence(L().residualFifo({ materials: data.materials, wcs: data.wcs }).notes.get(wc.id) || []);
    return `${formHead(data, 'Weight Certificate', [['INVOICE #', wc.wcNumber], ['DATE:', L().dotDate(wc.date)], ['SHIPPING DATE:', L().dotDate(wc.date)]])}
      <div class="irr-blocks">${partyBlock('COMMODITY OWNER:', us(data), false)}${partyBlock('SHIP TO:', vendor, false)}</div>
      ${vehicleBlock([['LICENSE PLATE:', sh.licensePlate]])}
      ${grid({ cols: WEIGHT_COLS(sh.countLabel === 'skids' ? 'SKIDS' : 'UNITS'), rows: rows.map((r) => ({ bold: r.bold, cells: [r.count, desc(r.label), fmt(r.gross), fmt(r.tare), fmt(r.net)] })),
        totals: weightTotals(rows), note: esc([note, wc.notes].filter(Boolean).join(' ')) })}
      ${weighmaster(sh.scalePerson)}`;
  }

  /** Purchase invoice: credits for what we buy, deductions for non-CEW units and anything else, final balance. */
  function invoice(wc, data, P) {
    const { esc, fmt } = U();
    const t = wc.transfer;
    const inv = L().invoiceMath({ transfer: t, mode: t.mode, priceItems: data.priceItems, company: P.customer });
    const money = (n) => L().money(n);
    const rate = (r) => (r === null || r === undefined ? '<span class="flag-text no-print">rate needed</span>' : money(r));
    const cols = [{ label: 'UNITS', width: 12 }, { label: 'DESCRIPTION', width: 22 }, { label: 'GROSS', width: 11.5 }, { label: 'TARE', width: 11.5 }, { label: 'NET', width: 11.5 }, { label: 'RATE/LBS', width: 13 }, { label: 'CREDIT', width: 18.5 }];
    const rows = inv.credits.map((r) => ({ bold: r.label.startsWith('CEW '), cells: [
      r.part === 'other' && !r.units ? 'Wt. Only' : fmt(r.units), desc(r.label + (r.handling ? '*' : '')), fmt(r.gross), fmt(r.tare), fmt(r.weight),
      r.rate === null ? rate(null) : `${money(r.rate)}${r.basis === 'unit' ? '/unit' : ''}`, r.amount === null ? '' : money(r.amount)] }));
    const g = inv.credits.reduce((a, r) => ({ g: a.g + (r.gross || 0), t: a.t + (r.tare || 0), n: a.n + r.weight }), { g: 0, t: 0, n: 0 });
    const ded = inv.deductions;
    const dedRows = ded.map((d) => `<tr><td class="c">${fmt(d.quantity)}</td><td class="c">${esc(d.description)}</td><td class="c">${esc(d.reason)}</td><td class="c">${rate(d.rate)}</td><td class="c">${d.amount === null ? '' : money(d.amount)}</td></tr>`).join('')
      + '<tr class="blank"><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(Math.max(0, 4 - ded.length));
    const invoiceDate = t.poDate || (t.timeline && t.timeline.poSent && t.timeline.poSent !== 'N/A' ? t.timeline.poSent : App.UI.today());
    return `<div class="po">${formHead(data, 'Purchase Invoice', [['PO #', wc.wcNumber], ['DATE:', L().slashDate(invoiceDate)], ['SHIPPING DATE:', L().slashDate(t.shippingDate || wc.date)]])}
      <div class="irr-blocks">${partyBlock('COMMODITY OWNER:', P.customer, true)}${partyBlock('SHIP TO:', us(data), false)}</div>
      ${vehicleBlock([['LICENSE PLATE:', t.licensePlate], ['CIRCUMSTANCE:', t.circumstance]])}
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
      <div class="form-sign">${signLine('Purchase Invoice by:', t.invoiceBy)}${signLine('Invoice by Signature:', '')}</div></div>`;
  }

  // ---------------------------------------------------------------- CalRecycle 197: fill the official form
  const FORM_197_URL = 'forms/CalRecycle197.pdf';
  const PDF_LIB_URL = 'js/vendor/pdf-lib.min.js';
  let formBytes = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.PDFLib) { resolve(); return; }
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
    await loadScript(PDF_LIB_URL);
    if (!formBytes) {
      const res = await fetch(FORM_197_URL);
      if (!res.ok) throw new Error(`Couldn't load the blank 197 (${FORM_197_URL}).`);
      formBytes = await res.arrayBuffer();
    }
    const { PDFDocument, PDFName, PDFHexString, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setFillingGrayscaleColor, moveText, showText } = window.PDFLib;
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
      <h3>IV. Printed names</h3>
      <p>Collector: ${esc(f['Printed NameRow1']) || '—'} · Recycler: ${esc(f['Printed NameRow1_2']) || '—'}</p>
      <h3>V. Transfer Discrepancy Detail</h3>
      ${values.needTables ? `<p><strong>Recycler Table 1</strong> — Reporting Month/Year: ${esc(values.reportingMonths[0] || '')}</p>${table('CEW type', '_2')}
        ${values.reportingMonths[1] ? `<p><strong>Recycler Table 2</strong> — Reporting Month/Year: ${esc(values.reportingMonths[1])}</p>${table('CEW type', '_3')}` : '<p>Recycler Table 2: left blank until the rest is claimed.</p>'}`
        : '<p>Tables left blank — everything listed above is claimed in one month.</p>'}`;
  }

  return {
    async render(container) {
      const { h, esc } = U();
      const [idStr, typeParam] = App.State.routeParams;
      const type = TYPES.some(([k]) => k === typeParam) ? typeParam : 'irr';
      const data = await App.Store.loadAll();
      const wc = data.wcs.find((w) => w.id === Number(idStr));
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

      const bar = h(`
        <div class="doc-toolbar">
          <a href="#/wc/${wc.id}">← WC #${esc(wc.wcNumber)}</a>
          <span class="spacer"></span>
          ${TYPES.map(([k, label]) => `<a class="button ${k === type ? 'primary' : ''}" href="#/doc/${wc.id}/${k}">${esc(label)}</a>`).join('')}
          <button type="button" class="primary" data-a="print">Print</button>
        </div>`);
      bar.querySelector('[data-a="print"]').addEventListener('click', () => { if (!print197()) window.print(); });
      container.append(bar);

      const inv = L().invoiceMath({ transfer: wc.transfer, mode: wc.transfer.mode, priceItems: data.priceItems, company: P.customer });
      if (type === 'invoice' && inv.missing) container.append(U().notice(`${inv.missing} rate(s) still needed — enter them in the Pricing section of the WC.`, 'warning'));
      if (type === 'invoice' && !wc.transfer.mode) container.append(U().notice('Pick up or drop off isn\u2019t chosen on the WC, so price-list rates can\u2019t be picked.', 'warning'));

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

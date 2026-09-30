/*
 * Reads a CalRecycle 198 collection log (198 O / 198 A) into entries:
 *   { header: {name, cewid, address, contact, phone, activity, location, form},
 *     rows: [{date, type, name, address, contact, crt, noncrt, cbep, page}],
 *     pages: [{page, sum:[crt,noncrt,cbep], written:[…]|null}], method, scanned }
 *
 * Handles CalRecycle's fillable 198 (its fields), a 198 saved as PDF (the table's drawn cells), a spreadsheet
 * copy printed to PDF, the older 2020 layout (per-row activity and pounds columns), and .xlsx spreadsheets.
 * A PDF with no text at all is a scan: `scanned: true`, to be typed in by hand.
 * Runs in the browser (pdf.js loaded on demand) and in Node (tests).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.App = root.App || {}; root.App.LogRead = api; }
}(typeof self !== 'undefined' ? self : this, () => {
  const DATE = /^\d{1,2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{2,4}/;
  const num = (s) => { const t = String(s ?? '').replace(/,/g, '').trim(); if (!t || t === '-') return 0; const n = Number(t); return Number.isFinite(n) ? Math.round(n) : 0; };
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

  // ------------------------------------------------------------ which column is which (by heading text)
  function columnKind(text) {
    // spaces removed: some PDFs space heading letters apart ("C BEP", "N on-CRT")
    const t = text.toLowerCase().replace(/\s+/g, '');
    if (/forcalrecycle/.test(t)) return 'calrecycle';
    if (/pounds|lbs|weight/.test(t)) return 'pounds';
    if (/cbep/.test(t)) return 'cbep';
    if (/non-?crt/.test(t)) return 'noncrt';
    if (/crt/.test(t)) return 'crt';
    if (/date/.test(t)) return 'date';
    if (/type/.test(t)) return 'type';
    if (/contact/.test(t)) return 'contact';
    if (/addres/.test(t)) return 'address';   // "Addres" is misspelled on some copies
    if (/description|circumstance/.test(t)) return 'activity';
    if (/name/.test(t)) return 'name';
    return 'other';
  }

  // ------------------------------------------------------------ header block (Section I) from text lines
  function headerInfo(lines) {
    const text = lines.join('\n');
    const get = (re) => { const m = re.exec(text); return m && m[1] ? clean(m[1].split(/\s{2,}/)[0]) : ''; };
    return {
      name: get(/Approved Collector\/Handler(?: Organization)?:[ \t]*(.*?)(?:[ \t]{2,}CEW ?ID|$)/m),
      cewid: get(/CEW ?ID ?#?:[ \t]*(\S.*)$/m),
      address: get(/Approved Collector\/Handler Address,[ \t]*City,?[ \t]*(?:Zip:?)?[ \t]*(.*)$/m),
      contact: get(/(?:Primary )?Contact Name:[ \t]*(.*?)(?:[ \t]{2,}Telephone|$)/m),
      phone: get(/Telephone[ \t]*#?:[ \t]*(.*)$/m),
      activity: get(/Description of CEW Collection Activity:[ \t]*(.*)$/m),
      location: get(/Location of Collection Event \(if different from above\):[ \t]*(.*)$/m),
      form: get(/^[ \t]*(CalRecycle 198[^\n]*?\)|CalRecycle 198 \([^\n]*?)(?:[ \t]{2,}|$)/m),
    };
  }

  // ------------------------------------------------------------ PDF
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  /** Straight horizontal and vertical strokes/thin fills drawn on the page (the table's borders). */
  async function pageSegments(page, OPS) {
    const ops = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
    const H = []; const V = [];
    const addRect = (pts) => {
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
      if (x1 - x0 < 3 && y1 - y0 > 4) V.push({ x: (x0 + x1) / 2, y0, y1 });
      else if (y1 - y0 < 3 && x1 - x0 > 4) H.push({ y: (y0 + y1) / 2, x0, x1 });
      else if (x1 - x0 >= 3 && y1 - y0 >= 3) { V.push({ x: x0, y0, y1 }, { x: x1, y0, y1 }); H.push({ y: y0, x0, x1 }, { y: y1, x0, x1 }); }
    };
    for (let i = 0; i < ops.fnArray.length; i += 1) {
      const fn = ops.fnArray[i]; const args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm.slice());
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(args, ctm);
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (args && args[0]) ctm = mul(Array.from(Object.values(args[0])), ctm); }
      else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.constructPath) {
        const paint = args[0];
        if (paint === OPS.endPath) continue; // clipping paths aren't drawn
        const data = Array.from(Object.values(args[1][0] || {}));
        let k = 0; let start = null; let cur = null; let poly = [];
        const flush = () => {
          if (poly.length === 5 || poly.length === 4) { addRect(poly); poly = []; return; }
          for (let j = 1; j < poly.length; j += 1) {
            const [a, b] = [poly[j - 1], poly[j]];
            if (Math.abs(a[0] - b[0]) < 1.5 && Math.abs(a[1] - b[1]) > 4) V.push({ x: (a[0] + b[0]) / 2, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) });
            else if (Math.abs(a[1] - b[1]) < 1.5 && Math.abs(a[0] - b[0]) > 4) H.push({ y: (a[1] + b[1]) / 2, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]) });
          }
          poly = [];
        };
        while (k < data.length) {
          const code = data[k];
          if (code === 0) { flush(); cur = apply(ctm, data[k + 1], data[k + 2]); start = cur; poly = [cur]; k += 3; }
          else if (code === 1) { cur = apply(ctm, data[k + 1], data[k + 2]); poly.push(cur); k += 3; }
          else if (code === 2) { cur = apply(ctm, data[k + 5], data[k + 6]); poly.push(cur); k += 7; }
          else if (code === 3) { cur = apply(ctm, data[k + 3], data[k + 4]); poly.push(cur); k += 5; }
          else if (code === 4) { if (start) poly.push(start); k += 1; }
          else k += 1;
        }
        flush();
      }
    }
    return { H, V };
  }

  const cluster = (vals, tol) => {
    const out = [];
    vals.slice().sort((a, b) => a - b).forEach((v) => { if (out.length && v - out[out.length - 1].at(-1) <= tol) out[out.length - 1].push(v); else out.push([v]); });
    return out.map((g) => g.reduce((s, x) => s + x, 0) / g.length);
  };

  /** Text items → words with page positions (y up), and text lines for the header block. */
  function pageWords(textContent) {
    return textContent.items.filter((it) => it.str && it.str.trim()).map((it) => {
      const x = it.transform[4]; const y = it.transform[5]; const h = Math.abs(it.transform[3]) || it.height || 8;
      return { text: it.str, x0: x, x1: x + it.width, y, cy: y + h * 0.35, h };
    });
  }
  function textLines(words) {
    const lines = [];
    words.slice().sort((a, b) => b.y - a.y || a.x0 - b.x0).forEach((w) => {
      const line = lines.find((l) => Math.abs(l.y - w.y) < 2.5);
      if (line) line.words.push(w); else lines.push({ y: w.y, words: [w] });
    });
    return lines.map((l) => {
      const ws = l.words.sort((a, b) => a.x0 - b.x0);
      let s = ''; let last = null;
      ws.forEach((w) => { if (last) s += (w.x0 - last.x1 > 6 ? '    ' : (w.x0 - last.x1 > 0.8 ? ' ' : '')); s += w.text; last = w; });
      return s;
    });
  }

  function tableRows(words, segs) {
    // the heading row: the line holding "Date" / "(m/d/y)" and the unit headings
    const dateHead = words.filter((w) => /^\(?m\/d\/y\)?$|^Date/.test(w.text.trim())).sort((a, b) => b.y - a.y)
      .find((w) => words.some((o) => /CRT/.test(o.text) && Math.abs(o.cy - w.cy) < 30 && o.x0 > w.x1));
    if (!dateHead) return null;
    const headY = dateHead.cy;
    // column borders: vertical lines crossing the heading row
    const xs = cluster(segs.V.filter((v) => v.y0 - 2 <= headY && v.y1 + 2 >= headY).map((v) => v.x), 2);
    if (xs.length < 6) return null;
    const left = xs[0]; const right = xs[xs.length - 1];
    // row borders: horizontal lines covering at least half the table's width — drawn whole or in per-cell pieces
    const width = right - left;
    const groups = [];
    segs.H.filter((h) => h.x1 > left - 2 && h.x0 < right + 2).sort((a, b) => a.y - b.y).forEach((h) => {
      const g = groups.find((x) => Math.abs(x.y - h.y) <= 1.5);
      if (g) g.parts.push(h); else groups.push({ y: h.y, parts: [h] });
    });
    const covered = (parts) => {
      let total = 0; let end = -Infinity;
      parts.map((p) => [Math.max(p.x0, left), Math.min(p.x1, right)]).sort((a, b) => a[0] - b[0]).forEach(([a, b]) => {
        if (b <= end) return; total += b - Math.max(a, end); end = b;
      });
      return total;
    };
    const ys = groups.filter((g) => covered(g.parts) >= width * 0.5).map((g) => g.parts.reduce((s2, p) => s2 + p.y, 0) / g.parts.length).sort((a, b) => b - a);
    const above = ys.filter((y) => y > headY + 1);
    const headTop = above.length ? Math.min(...above) : headY + 20;   // the nearest border above the heading
    // heading text per column, over the heading band (up to the first border below the heading text)
    const headBottom = ys.find((y) => y < headY - 1 && words.some((w) => w.cy < y && DATE.test(w.text.trim()) || /^N\/A$/.test(w.text.trim()))) ?? headY - 20;
    const cols = [];
    for (let i = 0; i < xs.length - 1; i += 1) {
      const head = words.filter((w) => (w.x0 + w.x1) / 2 > xs[i] && (w.x0 + w.x1) / 2 < xs[i + 1] && w.cy < headTop && w.cy > headBottom)
        .sort((a, b) => b.y - a.y || a.x0 - b.x0).map((w) => w.text).join(' ');
      cols.push({ x0: xs[i], x1: xs[i + 1], kind: columnKind(head), head });
    }
    const bands = ys.filter((y) => y <= headBottom + 0.5);
    const rows = []; let written = null;
    for (let i = 0; i < bands.length - 1; i += 1) {
      const top = bands[i]; const bottom = bands[i + 1];
      if (top - bottom < 6) continue;
      const cell = {};
      cols.forEach((c) => {
        const inside = words.filter((w) => (w.x0 + w.x1) / 2 > c.x0 && (w.x0 + w.x1) / 2 < c.x1 && w.cy < top && w.cy > bottom).sort((a, b) => b.y - a.y || a.x0 - b.x0);
        const txt = clean(inside.map((w) => w.text).join(' '));
        if (txt) cell[c.kind] = cell[c.kind] ? `${cell[c.kind]} ${txt}` : txt;
      });
      const first = cell.date || '';
      if (/^N\/A/i.test(first) || /total/i.test(cell.contact || '') || /total/i.test(cell.activity || '')) {
        written = [num(cell.crt), num(cell.noncrt), num(cell.cbep)]; break;
      }
      if (!Object.keys(cell).length) continue;
      if (!DATE.test(first) && !cell.name) continue;
      rows.push(cell);
    }
    return { rows, written, cols: cols.map((c) => c.kind) };
  }

  async function readPdf(pdfjs, bytes) {
    const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true, isEvalSupported: false }).promise;
    // CalRecycle's fillable 198: the values live in its fields
    const fields = (await doc.getFieldObjects().catch(() => null)) || {};
    const fv = (name) => { const f = fields[name]; return f && f[0] && f[0].value ? String(f[0].value) : ''; };
    if (fv('Date mdyRow1') || fv('NameRow1')) {
      const rows = [];
      for (let n = 1; n <= 40; n += 1) {
        const r = { date: fv(`Date mdyRow${n}`), type: fv(`Type of CA SourceRow${n}`), name: fv(`NameRow${n}`), address: fv(`Address City State ZipRow${n}`),
          contact: fv(`Contact Person Name  PhoneRow${n}`), crt: num(fv(`CRT CEW UnitsRow${n}`)), noncrt: num(fv(`NonCRT CEW UnitsRow${n}`)), cbep: num(fv(`CBEP CEW UnitsRow${n}`)) };
        if (r.date || r.name || r.address) rows.push({ ...r, name: clean(r.name), address: clean(r.address), contact: clean(r.contact), page: 1 });
      }
      const header = { name: fv('Approved CollectorHandler'), cewid: fv('CEWID'), address: fv('Approved CollectorHandler Address City Zip'),
        contact: fv('Contact Name'), phone: fv('Telephone'), activity: fv('Description of CEW Collection Activity'),
        location: fv('Location of Collection Event if different from above'), form: 'CalRecycle 198 (fillable)' };
      const sum = [0, 1, 2].map((i) => rows.reduce((s, r) => s + [r.crt, r.noncrt, r.cbep][i], 0));
      const written = [num(fv('CRT CEW UnitsRowTotal')), num(fv('NonCRT CEW UnitsRowTotal')), num(fv('CBEP CEW UnitsRowTotal'))];
      return { header, rows, pages: [{ page: 1, sum, written }], method: 'form fields', scanned: false };
    }
    const out = { header: null, rows: [], pages: [], method: 'table', scanned: false };
    let anyText = false;
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const words = pageWords(await page.getTextContent());
      if (words.length > 5) anyText = true;
      if (p === 1) out.header = headerInfo(textLines(words));
      const t = tableRows(words, await pageSegments(page, pdfjs.OPS));
      if (!t) { out.pages.push({ page: p, sum: [0, 0, 0], written: null, noTable: true }); continue; }
      const rows = t.rows.map((c) => ({ date: clean(c.date), type: clean(c.type).toUpperCase(), name: clean(c.name), address: clean(c.address), contact: clean(c.contact),
        crt: num(c.crt), noncrt: num(c.noncrt), cbep: num(c.cbep), page: p, activity: clean(c.activity) }));
      out.rows.push(...rows);
      out.pages.push({ page: p, sum: [0, 1, 2].map((i) => rows.reduce((s, r) => s + [r.crt, r.noncrt, r.cbep][i], 0)), written: t.written });
    }
    // no text, or no entries readable anywhere: a scan (or a layout we can't read) — typed in by hand
    if (!anyText || !out.rows.length) return { header: out.header, rows: [], pages: out.pages, method: 'scan', scanned: true };
    // older layouts put the activity on each row: bring it up to the header when it's the same throughout
    if (out.header && !out.header.activity) { const acts = [...new Set(out.rows.map((r) => r.activity).filter(Boolean))]; if (acts.length === 1) out.header.activity = acts[0]; }
    out.rows.forEach((r) => { delete r.activity; });
    return out;
  }

  // ------------------------------------------------------------ XLSX (a zip of XML files)
  async function unzip(bytes, inflateRaw) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i -= 1) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a spreadsheet (no zip directory).');
    const count = dv.getUint16(eocd + 10, true); let off = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n += 1) {
      const method = dv.getUint16(off + 10, true); const size = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true); const extra = dv.getUint16(off + 30, true); const comment = dv.getUint16(off + 32, true);
      const local = dv.getUint32(off + 42, true);
      const name = dec.decode(bytes.subarray(off + 46, off + 46 + nameLen));
      const lNameLen = dv.getUint16(local + 26, true); const lExtra = dv.getUint16(local + 28, true);
      const data = bytes.subarray(local + 30 + lNameLen + lExtra, local + 30 + lNameLen + lExtra + size);
      files[name] = { method, data };
      off += 46 + nameLen + extra + comment;
    }
    const text = async (name) => {
      const f = files[name]; if (!f) return null;
      const raw = f.method === 0 ? f.data : await inflateRaw(f.data);
      return dec.decode(raw);
    };
    return { names: Object.keys(files), text };
  }
  const xmlText = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const colIndex = (ref) => ref.replace(/\d+/g, '').split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

  async function readXlsx(bytes, inflateRaw) {
    const zip = await unzip(bytes, inflateRaw);
    const shared = [];
    const ss = await zip.text('xl/sharedStrings.xml');
    if (ss) (ss.match(/<si>[\s\S]*?<\/si>/g) || []).forEach((si) => shared.push(xmlText((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).join(''))));
    const sheetName = zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    const xml = await zip.text(sheetName);
    const grid = [];
    (xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []).forEach((row) => {
      const r = Number((/<row[^>]*\br="(\d+)"/.exec(row) || [])[1]);
      const cells = [];
      (row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach((c) => {
        const ref = (/\br="([A-Z]+\d+)"/.exec(c) || [])[1]; if (!ref) return;
        const t = (/\bt="(\w+)"/.exec(c) || [])[1];
        const v = (/<v>([\s\S]*?)<\/v>/.exec(c) || [])[1];
        const is = (/<is>([\s\S]*?)<\/is>/.exec(c) || [])[1];
        let val = null;
        if (t === 's' && v != null) val = shared[Number(v)];
        else if (t === 'inlineStr' && is) val = xmlText(is);
        else if (t === 'str' && v != null) val = xmlText(v);
        else if (v != null) val = Number(v);
        cells[colIndex(ref)] = val;
      });
      grid[r - 1] = cells;
    });
    const s = (v) => (v == null ? '' : String(v).trim());
    const excelDate = (v) => {
      if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`; }
      return s(v);
    };
    const lines = grid.filter(Boolean).map((cells) => cells.filter((c) => c != null && s(c) !== '').map(s).join('    '));
    const header = headerInfo(lines);
    const rows = []; const pages = []; let cols = null; let page = null;
    grid.forEach((cells) => {
      if (!cells) return;
      const a = s(cells[0]);
      if (/^Date/i.test(a) && cells.some((c) => /crt/i.test(s(c)))) {
        cols = cells.map((c) => columnKind(s(c))); page = { page: pages.length + 1, sum: [0, 0, 0], written: null }; pages.push(page); return;
      }
      if (!cols || !page) return;
      const rec = {};
      cols.forEach((k, i) => { if (cells[i] != null && s(cells[i]) !== '') rec[k] = rec[k] ? `${rec[k]} ${s(cells[i])}` : (k === 'date' ? excelDate(cells[i]) : s(cells[i])); });
      if (/^N\/A/i.test(a) || Object.values(rec).some((v) => /^total/i.test(v))) { page.written = [num(rec.crt), num(rec.noncrt), num(rec.cbep)]; cols = null; return; }
      if (!rec.date || !DATE.test(rec.date)) return;
      const r = { date: rec.date, type: s(rec.type).toUpperCase(), name: clean(rec.name), address: clean(rec.address), contact: clean(rec.contact), crt: num(rec.crt), noncrt: num(rec.noncrt), cbep: num(rec.cbep), page: page.page };
      rows.push(r); page.sum = [page.sum[0] + r.crt, page.sum[1] + r.noncrt, page.sum[2] + r.cbep];
    });
    return { header: { ...header, form: header.form || 'CalRecycle 198 (spreadsheet)' }, rows, pages, method: 'spreadsheet', scanned: false };
  }

  // ------------------------------------------------------------ browser entry point
  let pdfjsPromise = null;
  async function loadPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(new URL('js/vendor/pdfjs/pdf.min.mjs', document.baseURI).href).then((m) => {
        m.GlobalWorkerOptions.workerSrc = new URL('js/vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
        return m;
      });
    }
    return pdfjsPromise;
  }
  const browserInflate = async (data) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());

  /** Browser: read an uploaded File (PDF or XLSX). */
  async function readFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    if (isPdf) return readPdf(await loadPdfJs(), bytes);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes, browserInflate);
    throw new Error('That file isn\'t a PDF or an Excel (.xlsx) spreadsheet.');
  }

  return { readPdf, readXlsx, readFile, headerInfo, columnKind, _internal: { pageSegments, pageWords, tableRows, cluster } };
}));

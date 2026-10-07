window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.settings = (function () {
  let msg = null;

  /** A simple editable list: rows of inputs with Save / Delete, plus an add row. */
  function listPanel({ title, intro, items, fields, onSave, onDelete, onAdd, onMove, canDelete }) {
    const { h, esc } = App.UI;
    const input = (f, v) => {
      if (f.checkbox) return `<label class="row"><input type="checkbox" data-f="${f.key}" ${v ? 'checked' : ''}> ${esc(f.checkbox)}</label>`;
      return f.options
        ? `<select data-f="${f.key}">${App.UI.options(f.options.map((o) => ({ value: o, label: o })), v)}</select>`
        : `<input data-f="${f.key}" value="${esc(v)}" placeholder="${esc(f.label)}">`;
    };
    const el = h(`
      <div class="panel">
        <h2>${esc(title)}</h2>
        ${intro ? `<p class="muted mt-0">${intro}</p>` : ''}
        ${items.length ? `<table><thead><tr>${fields.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th></th></tr></thead><tbody>
          ${items.map((it, i) => `<tr data-i="${i}">${fields.map((f) => `<td>${f.readOnly && f.readOnly(it) ? esc(it[f.key]) : input(f, it[f.key])}</td>`).join('')}
            <td class="row">
              ${onMove ? `<button type="button" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-a="down" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>` : ''}
              <button type="button" data-a="save">Save</button>
              ${!canDelete || canDelete(it) === true ? '<button type="button" class="danger" data-a="delete">Delete</button>' : `<span class="muted">${esc(canDelete(it))}</span>`}
            </td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">None yet.</p>'}
        <div class="field-row" data-role="add">${fields.map((f) => `<div class="field"><label>${esc(f.label)}</label>${input(f, f.checkbox ? false : f.options ? f.options[0] : '')}</div>`).join('')}
          <div class="field"><label>&nbsp;</label><button type="button" class="primary" data-a="add">Add</button></div></div>
      </div>`);
    const read = (scope) => Object.fromEntries(fields.map((f) => {
      const x = scope.querySelector(`[data-f="${f.key}"]`);
      return [f.key, !x ? undefined : x.type === 'checkbox' ? x.checked : x.value.trim()];
    }).filter(([, v]) => v !== undefined));
    el.querySelectorAll('tbody tr').forEach((tr) => {
      const it = items[Number(tr.dataset.i)];
      const on = (sel, fn) => { const b = tr.querySelector(sel); if (b) b.addEventListener('click', fn); };
      tr._save = () => onSave(it, read(tr));
      on('[data-a="save"]', () => tr._save());
      on('[data-a="delete"]', () => onDelete(it));
      on('[data-a="up"]', () => onMove(it, -1));
      on('[data-a="down"]', () => onMove(it, 1));
    });
    const addRow = el.querySelector('[data-role="add"]');
    el.querySelector('[data-a="add"]').addEventListener('click', () => onAdd(read(addRow)));
    App.UI.sectionSave(el, title, (m) => { msg = m; });
    return el;
  }

  const done = (text, kind = 'ok') => { if (App.UI.batching) { App.UI.batchNote(text, kind); return; } msg = { text, kind }; App.rerender(); };

  return {
    async render(container) {
      const { h, esc, header } = App.UI;
      const data = await App.Store.loadAll();
      container.append(header('Settings & Backup', `Version ${esc(App.Models.VERSION)} — ${esc(App.Models.VERSION_NAME)}. What changed in each version is in CHANGELOG.md.`));
      if (msg) { container.append(App.UI.notice(msg.text, msg.kind)); msg = null; }

      // ---- facility
      const prof = h(`
        <form class="panel">
          <h2>Facility profile</h2>
          <div class="field-row">
            <div class="field" style="flex:2"><label>Recycler name</label><input name="recyclerName" value="${esc(data.profile.recyclerName)}"></div>
            <div class="field"><label>Recycler CEWID #</label><input name="cewID" value="${esc(data.profile.cewID)}"></div>
            <div class="field"><label>CalRecycle claim rate — CEW Non-CRT ($/lb)</label><input name="rateNonCRT" inputmode="decimal" value="${esc((data.profile.claimRates || {}).NonCRT || '')}"></div>
            <div class="field"><label>CalRecycle claim rate — CBEP ($/lb)</label><input name="rateCBEP" inputmode="decimal" value="${esc((data.profile.claimRates || {}).CBEP || '')}"></div>
            <div class="field"><label>Archive transfers on claims closed more than … days ago</label><input name="archiveDays" inputmode="numeric" value="${esc(data.profile.archiveDays || 90)}"></div>
            <div class="field"><label>Make/model weight check: flag when more than … % off</label><input name="modelTolerance" inputmode="numeric" value="${esc(data.profile.modelTolerance || 50)}"></div>
            <div class="field"><label>… once a make/model has been seen … times</label><input name="modelMinSeen" inputmode="numeric" value="${esc(data.profile.modelMinSeen || 3)}"></div>
            <div class="field"><label>&nbsp;</label><label class="row"><input type="checkbox" name="largeText" ${data.profile.largeText ? 'checked' : ''}> Larger text, higher contrast</label></div>
            <div class="field"><label>Federal employer identification number (FEIN)</label><input name="fein" value="${esc(data.profile.fein || '')}"></div>
            <div class="field"><label>Recycler contact <span class="muted">(CEWIS claims)</span></label><input name="recyclerContact" value="${esc(data.profile.recyclerContact || '')}"></div>
            <div class="field"><label>Phone</label><input name="phone" value="${esc(data.profile.phone)}"></div>
          </div>
          <div class="field"><label>Address <span class="muted">(printed on the IRR, WC and purchase invoice)</span></label><textarea name="address" rows="2">${esc(data.profile.address)}</textarea></div>
          <div class="field-row">
            <div class="field"><label>&nbsp;</label><label class="row"><input type="checkbox" name="dualEntity" ${data.profile.dualEntity ? 'checked' : ''}> Dual entity — approved as both a collector and a recycler</label></div>
            <div class="field"><label>198 contact name <span class="muted">(on the 198 Master)</span></label><input name="form198ContactName" value="${esc(data.profile.form198ContactName || '')}"></div>
            <div class="field"><label>198 contact phone <span class="muted">(blank = facility phone)</span></label><input name="form198ContactPhone" value="${esc(data.profile.form198ContactPhone || '')}"></div>
          </div>
          <div class="field"><label>Authorized WC signers <span class="muted">— one name per line; each WC's scale person is picked from this list</span></label><textarea name="wcSigners" rows="3">${esc((data.profile.wcSigners || []).join('\n'))}</textarea></div>
          <div class="field"><label>Authorized 197 signers <span class="muted">— one name per line; only these people can sign the CalRecycle 197</span></label><textarea name="form197Signers" rows="3">${esc((data.profile.form197Signers || []).join('\n'))}</textarea></div>
          <div class="field"><label>Our vehicles' license plates <span class="muted">— separate several with commas; used on pick-ups and our deliveries</span></label><input name="vehicles" value="${esc((data.profile.vehicles || []).join(', '))}"></div>
          <p class="hint">We're the recycler on every transfer, and the collector whenever a handler is selected.</p>
          <button type="submit" class="primary">Save profile</button>
        </form>`);
      prof.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(prof);
        await App.DB.put('facilityProfile', { ...data.profile, id: 'profile', recyclerName: String(fd.get('recyclerName')).trim(), cewID: String(fd.get('cewID')).trim(), fein: String(fd.get('fein') || '').trim(), recyclerContact: String(fd.get('recyclerContact') || '').trim(),
          phone: String(fd.get('phone') || '').trim(), address: String(fd.get('address') || '').trim(),
          claimRates: { NonCRT: String(fd.get('rateNonCRT') || '').trim(), CBEP: String(fd.get('rateCBEP') || '').trim() },
          archiveDays: Number(fd.get('archiveDays')) || 90, modelMinSeen: Number(fd.get('modelMinSeen')) || 3, modelTolerance: Number(fd.get('modelTolerance')) || 50,
          largeText: fd.get('largeText') === 'on',
          dualEntity: fd.get('dualEntity') === 'on', form198ContactName: String(fd.get('form198ContactName') || '').trim(), form198ContactPhone: String(fd.get('form198ContactPhone') || '').trim(),
          vehicles: App.Logic.splitPlates(fd.get('vehicles')),
          wcSigners: [...new Set(String(fd.get('wcSigners') || '').split(/\n+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean))],
          form197Signers: [...new Set(String(fd.get('form197Signers') || '').split(/\n+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean))] });
        done('Profile saved.');
      });
      container.append(prof);

      // ---- WC types
      const typeUse = (id) => data.wcs.filter((w) => w.typeId === id).length;
      container.append(listPanel({
        title: 'WC types',
        intro: 'Transfer, Residual Shipment and Inventory Check are built in. Types you add here are simple WCs with a number, date, company, status, notes and attachments.',
        items: data.wcTypes,
        fields: [{ key: 'name', label: 'Name' }],
        canDelete: (t) => (t.builtin ? 'built in' : (typeUse(t.id) ? `used by ${typeUse(t.id)} WC(s)` : true)),
        onSave: async (t, v) => { if (!v.name) return; await App.DB.put('wcTypes', { ...t, name: v.name }); done('WC type saved.'); },
        onDelete: async (t) => { if (!confirm(`Delete the "${t.name}" type?`)) return; await App.DB.delete('wcTypes', t.id); done('WC type deleted.'); },
        onAdd: async (v) => {
          if (!v.name) return;
          if (data.wcTypes.some((t) => App.Logic.norm(t.name) === App.Logic.norm(v.name))) { done(`"${v.name}" already exists.`, 'error'); return; }
          await App.DB.add('wcTypes', { name: v.name, kind: 'generic', builtin: false });
          done(`Added the "${v.name}" WC type.`);
        },
      }));

      // ---- statuses
      const statusUse = (id) => data.wcs.filter((w) => w.statusId === id).length;
      container.append(listPanel({
        title: 'WC statuses',
        intro: 'Your own list — for example Pending IRR, WC made, Done, Paid. Shown in this order everywhere.',
        items: data.wcStatuses,
        fields: [{ key: 'name', label: 'Name' }],
        onSave: async (s, v) => { if (!v.name) return; await App.DB.put('wcStatuses', { ...s, name: v.name }); done('Status saved.'); },
        onDelete: async (s) => {
          const n = statusUse(s.id);
          if (!confirm(`Delete the "${s.name}" status?${n ? ` ${n} WC(s) using it will go back to no status.` : ''}`)) return;
          const affected = data.wcs.filter((w) => w.statusId === s.id).map((w) => ({ ...w, statusId: null }));
          await App.DB.bulkPut('wcs', affected);
          await App.DB.delete('wcStatuses', s.id);
          App.Pages.wc.reset();
          done('Status deleted.');
        },
        onMove: async (s, dir) => {
          const list = data.wcStatuses.slice();
          const i = list.findIndex((x) => x.id === s.id); const j = i + dir;
          if (j < 0 || j >= list.length) return;
          [list[i], list[j]] = [list[j], list[i]];
          await App.DB.bulkPut('wcStatuses', list.map((x, k) => ({ ...x, order: k })));
          App.rerender();
        },
        onAdd: async (v) => {
          if (!v.name) return;
          await App.DB.add('wcStatuses', { name: v.name, order: data.wcStatuses.length });
          done(`Added the "${v.name}" status.`);
        },
      }));

      // ---- materials: CEW Non-CRT and CBEP residuals are separate lists — never combined, even with the same name
      const matUse = (id) => data.wcs.filter((w) => ((w.shipment || w.inventory || {}).lines || []).some((l) => l.materialId === id)).length;
      const strip = App.Logic.stripProgram;
      const dupe = (name, program, id) => data.materials.some((m) => m.id !== id && (m.program || 'cew') === program && App.Logic.norm(strip(m.name)) === App.Logic.norm(strip(name)));
      container.append(listPanel({
        title: 'CEW Non-CRT residuals',
        intro: 'Shown as "CEW Non-CRT …" everywhere. Used on CEW residual shipments and Non-CRT inventory checks; the column decides where the weight lands on the 196B. "Needs its own WC" (LCD lamps) means its inventory must be on a weight certificate with nothing else on it.',
        items: data.materials.filter((m) => m.program !== 'cbep'),
        fields: [{ key: 'name', label: 'Material (shown as CEW Non-CRT …)' }, { key: 'category', label: '196B column', options: App.Logic.RESIDUAL_CATEGORIES },
          { key: 'ownWc', label: 'Inventory', checkbox: 'needs its own WC' }],
        canDelete: (m) => (matUse(m.id) ? `on ${matUse(m.id)} WC(s)` : true),
        onSave: async (m, v) => {
          if (!v.name) return;
          if (dupe(v.name, 'cew', m.id)) { done(`CEW Non-CRT ${strip(v.name)} already exists.`, 'error'); return; }
          await App.DB.put('materials', { ...m, name: strip(v.name), category: v.category, ownWc: !!v.ownWc, program: 'cew' }); App.Pages.wc.reset(); done('Saved.');
        },
        onDelete: async (m) => { if (!confirm(`Delete ${App.Logic.materialLabel(m)}?`)) return; await App.DB.delete('materials', m.id); done('Material deleted.'); },
        onAdd: async (v) => {
          if (!v.name) return;
          if (dupe(v.name, 'cew', null)) { done(`CEW Non-CRT ${strip(v.name)} already exists.`, 'error'); return; }
          await App.DB.add('materials', { name: strip(v.name), category: v.category, ownWc: !!v.ownWc, program: 'cew' });
          done(`Added CEW Non-CRT ${strip(v.name)}.`);
        },
      }));
      container.append(listPanel({
        title: 'CBEP residuals',
        intro: 'Shown as "CBEP …" everywhere. Your own names for what comes out of CBEP dismantling (power boards, motherboards, lithium-ion batteries…), each sorted into its 196C category — the daily log, the CBEP month-end check, CBEP shipments and the generation certificates all use these.',
        items: data.materials.filter((m) => m.program === 'cbep'),
        fields: [{ key: 'name', label: 'Material (shown as CBEP …)' }, { key: 'residual196C', label: '196C category', options: [...App.Logic.RESIDUALS_196C, ...App.Logic.BATTERY_CHEMISTRIES] }],
        canDelete: (m) => (matUse(m.id) ? `on ${matUse(m.id)} WC(s)` : true),
        onSave: async (m, v) => {
          if (!v.name) return;
          if (dupe(v.name, 'cbep', m.id)) { done(`CBEP ${strip(v.name)} already exists.`, 'error'); return; }
          await App.DB.put('materials', { ...m, name: strip(v.name), residual196C: v.residual196C, program: 'cbep', category: 'Not a CEW residual' }); App.Pages.wc.reset(); done('Saved.');
        },
        onDelete: async (m) => { if (!confirm(`Delete ${App.Logic.materialLabel(m)}?`)) return; await App.DB.delete('materials', m.id); done('Material deleted.'); },
        onAdd: async (v) => {
          if (!v.name) return;
          if (dupe(v.name, 'cbep', null)) { done(`CBEP ${strip(v.name)} already exists.`, 'error'); return; }
          await App.DB.add('materials', { name: strip(v.name), residual196C: v.residual196C, program: 'cbep', category: 'Not a CEW residual' });
          done(`Added CBEP ${strip(v.name)}.`);
        },
      }));

      // ---- recycle bin (30 days)
      const bin = await App.Store.trash();
      const binEl = h(`<div class="panel"><h2>Recycle bin</h2>
        <p class="hint mt-0">Deleted WCs, companies and attachments stay here for 30 days.</p>
        ${bin.length ? `<table class="compact" data-list="trash"><thead><tr><th>What</th><th>Kind</th><th>Deleted</th><th></th></tr></thead><tbody>${bin.map((x) => `<tr><td>${esc(x.label)}</td><td>${esc({ wc: 'WC', company: 'Company', attachment: 'Attachment' }[x.kind] || x.kind)}</td>
          <td>${esc(new Date(x.deletedAt).toLocaleString())}</td><td><button type="button" class="small" data-restore="${x.id}">Restore</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Empty.</p>'}</div>`);
      binEl.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
        try { const it = await App.Store.restoreFromTrash(Number(b.dataset.restore)); msg = { kind: 'ok', text: `Restored ${it.label}.` }; } catch (e) { msg = { kind: 'error', text: App.UI.errText(e) }; }
        App.rerender();
      }));
      container.append(binEl);

      // ---- usual weights by make & model (learned from cancellation logs)
      const allUnits = await App.DB.getAll('cancelledUnits');
      const excl = ((await App.DB.get('meta', 'modelExclusions')) || { ids: [] }).ids;
      const wmap = App.Logic.modelWeights(allUnits, excl);
      const opt = { minSeen: data.profile.modelMinSeen || 3, tolerance: (data.profile.modelTolerance || 50) / 100 };
      const flagged = allUnits.filter((u) => !excl.includes(u.id) && App.Logic.modelWeightFlag(u, wmap, opt)).slice(0, 60);
      const top = [...wmap].filter(([, v]) => v.n >= opt.minSeen).sort((a, b) => b[1].n - a[1].n).slice(0, 80);
      const uw = h(`<div class="panel"><h2>Usual weights by make & model</h2>
        <p class="hint mt-0">Learned from your cancellation logs (CBEP by device); entries far off a model's usual weight are flagged on import and in the log. Bulk entries don't count.</p>
        ${flagged.length ? `<h3>Flagged entries</h3><table class="compact" data-list="model-flags"><thead><tr><th>Date</th><th>Make / model / device</th><th class="num">Weight</th><th class="num">Usual</th><th></th></tr></thead><tbody>${flagged.map((u) => { const f = App.Logic.modelWeightFlag(u, wmap, opt);
          return `<tr><td>${esc(u.date)}</td><td>${esc(u.device || `${u.make} ${u.model}`)}</td><td class="num">${esc(u.weight)}</td><td class="num">${esc(f.usual)} (${f.n} seen)</td><td><button type="button" class="small" data-excl="${u.id}">Don't learn from this</button></td></tr>`; }).join('')}</tbody></table>` : ''}
        ${top.length ? `<details><summary>${top.length} makes/models learned</summary><table class="compact"><thead><tr><th>Make / model / device</th><th class="num">Usual lbs</th><th class="num">Seen</th></tr></thead><tbody>${top.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.median}</td><td class="num">${v.n}</td></tr>`).join('')}</tbody></table></details>` : '<p class="muted">Nothing learned yet.</p>'}</div>`);
      uw.querySelectorAll('[data-excl]').forEach((b) => b.addEventListener('click', async () => {
        await App.DB.put('meta', { key: 'modelExclusions', ids: [...excl, Number(b.dataset.excl)] }); msg = { kind: 'ok', text: 'That entry no longer counts toward its usual weight.' }; App.rerender();
      }));
      container.append(uw);

      // ---- backup
      const backup = h(`
        <div class="panel">
          <h2>Backup</h2>
          <p class="muted mt-0">Everything lives only in this browser. Download a backup regularly — it includes attached files.</p>
          <div class="row"><button type="button" class="primary" data-a="download">Download backup</button>
            <button type="button" data-a="folder">Choose a folder for automatic backups</button><span class="muted" data-role="last"></span></div>
          <div class="field-row">
            <div class="field" style="flex:2"><label>Restore from a backup file (replaces everything)</label><input type="file" accept=".json,application/json" data-f="file"></div>
            <div class="field"><label>&nbsp;</label><button type="button" data-a="restore">Restore</button></div>
          </div>
        </div>`);
      backup.querySelector('[data-a="download"]').addEventListener('click', async () => { await App.Backup.downloadBackup(); App.rerender(); });
      (async () => {
        const last = await App.Backup.lastBackup(); const f = await App.Backup.folder();
        backup.querySelector('[data-role="last"]').textContent = `${last ? `Last backup: ${new Date(last.at).toLocaleString()}` : 'No backup yet'}${f ? ` · automatic backups go to the folder "${f.name}" once a day` : ''}`;
      })();
      const fb = backup.querySelector('[data-a="folder"]');
      if (!App.Backup.folderSupported()) { fb.disabled = true; fb.title = 'Automatic folder backups need Chrome or Edge.'; }
      fb.addEventListener('click', async () => {
        try { const name = await App.Backup.chooseFolder(); msg = { kind: 'ok', text: `Backed up to "${name}" — from now on, once a day while the app is open.` }; } catch (e) { if (e && e.name === 'AbortError') return; msg = { kind: 'error', text: App.UI.errText(e) }; }
        App.rerender();
      });
      backup.querySelector('[data-a="restore"]').addEventListener('click', async () => {
        const file = backup.querySelector('[data-f="file"]').files[0];
        if (!file) return;
        if (!confirm('Replace ALL current data with this backup?')) return;
        try {
          await App.Backup.importFromFile(file);
          await App.Store.migrate();
          App.Pages.wc.reset();
          done('Backup restored.');
        } catch (err) { done(`Restore failed: ${App.UI.errText(err)}`, 'error'); }
      });
      container.append(backup);

      const erase = h(`
        <details class="panel"><summary>Erase everything</summary>
          <p class="muted">Deletes every record in this browser. Download a backup first.</p>
          <button type="button" class="danger" data-a="erase">Erase all data</button>
        </details>`);
      erase.querySelector('[data-a="erase"]').addEventListener('click', async () => {
        if (!confirm('Erase ALL data in this browser? This cannot be undone.')) return;
        if (prompt('Type ERASE to confirm') !== 'ERASE') return;
        await App.DB.clearAll();
        await App.Store.migrate();
        App.setPeriod(null);
        App.Pages.wc.reset();
        done('All data erased.');
      });
      container.append(erase);
    },
  };
})();

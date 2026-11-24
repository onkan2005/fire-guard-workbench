// "Shopping & photos" page: the shopping checklist as photo cards (drop / pick / paste a picture per item),
// "Got it" ticks, notes, totals, print, CSV, a self-contained HTML export with photos, and import of photos
// from the older Components_Photo_Checklist.html file. Photos live in IndexedDB (this browser only).
import { bomFor, CATEGORIES, SAFETY, CHIPS } from './bom.js';

const GOT_KEY = 'fireguard-checklist-v1', NOTE_KEY = 'fireguard-notes-v1', EXTRA_KEY = 'fireguard-extra-v1';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const peso = n => '₱' + Math.round(n).toLocaleString();
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };

// ---------- photo storage (IndexedDB, falls back to memory) ----------
const mem = {};
let dbp = null;
const db = () => dbp || (dbp = new Promise((res, rej) => {
  try { const r = indexedDB.open('fireguard-photos', 1); r.onupgradeneeded = () => r.result.createObjectStore('photos'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); }
}));
async function photoAll() {
  try {
    const d = await db();
    return await new Promise(res => { const out = {}, rq = d.transaction('photos').objectStore('photos').openCursor(); rq.onsuccess = () => { const c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); }; rq.onerror = () => res(out); });
  } catch { return { ...mem }; }
}
async function photoPut(k, v) {
  if (v == null) delete mem[k]; else mem[k] = v;
  try { const d = await db(); await new Promise((res, rej) => { const tx = d.transaction('photos', 'readwrite'), st = tx.objectStore('photos'); v == null ? st.delete(k) : st.put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch { }
}
async function shrink(file, max = 1000) {
  const url = URL.createObjectURL(file), im = new Image(); im.src = url; await im.decode();
  const r = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
  c.width = Math.round(im.width * r); c.height = Math.round(im.height * r); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url); return c.toDataURL('image/jpeg', 0.8);
}

// names in the older photo checklist → items here
const OLD_MAP = {
  'ESP32 DevKit (yours)': 'esp32', 'DHT22 (AM2302)': 'dht22', 'MQ-2 gas/smoke module': 'mq2', 'IR flame sensor': 'flame', 'Relay module': 'relay', 'LCD': 'lcd', 'Buzzer': 'buzzer',
  'Mini submersible pump': 'pumps', 'Silicone tubing': 'tube', 'Spray / mist nozzle': 'tube', 'USB data cable': 'usb', 'Diode': 'd4007', 'Resistor 10 kΩ': 'r_mq', 'Resistor 20 kΩ': 'r_mq', 'Resistor 330 Ω': 'r_led', 'Resistor 1 kΩ': 'r_echo',
  'Electrolytic capacitor': 'c470u', 'Ceramic capacitor': 'c100n', 'Level shifter (optional)': 'lls', 'Male pin header (if needed)': 'headers', 'Jumper wires, male-to-male': 'jmm',
  'Jumper wires, male-to-female': 'jmf', 'Jumper wires, female-to-female': 'jff', 'Hookup wire, red and black': 'hookup', 'Breadboard': 'bb830', 'Small screwdriver': 'drivers',
  'Wire stripper / cutter': 'stripper', 'Electrical tape': 'etape', 'Double-sided foam tape or hot glue gun': 'zipties', 'Cable ties (optional)': 'zipties', 'Tank container': 'tank',
  'Source container': 'source', 'Base and “house”': 'house', 'Multimeter (recommended)': 'dmm', 'Soldering iron kit (optional)': 'iron',
};
// items from the older checklist that this build replaces: their photos are kept as "Other photos" with a pointer to the right part
const OLD_REPLACED = {
  'USB power bank': 'Not used in this build. Buy a 5 V 2 A USB phone charger for the ESP32 instead.',
  '4×AA battery holder': 'Not used in this build. Buy a 4×AAA battery holder with switch (6 V) for the pumps instead.',
  'AA rechargeable batteries (NiMH)': 'Not used in this build. Buy AAA alkaline batteries (4 + 4 spare) instead: 4×1.5 V = 6 V for the pumps.',
  'AA battery charger (if needed)': 'Not needed: this build uses AAA alkaline batteries, which are not recharged.',
  'Water level sensor': 'Not used in this build. The tank level comes from the HC-SR04 ultrasonic sensor (or the DIY wire probes option).',
  'LED stick': 'Not used in this build. It uses 17 single 5 mm LEDs with 74HC595 chips (or 5 RGB LEDs with the RGB option).',
  'Transistor': 'Not needed: the relay module has its own transistor and opto-isolator, and the ESP32 drives the LEDs through the 74HC595 chips.',
  'Spray / mist nozzle': 'Optional: fits on the end of the sprinkler tube (listed with the silicone tubing).',
  'Resistor 20 kΩ': 'Goes with the 10 kΩ: the pair is the MQ-2 divider (listed as “10 kΩ + 20 kΩ resistor”).',
};

export function createShop({ getOptions, optionLabel, partCards, onFindPart, download }) {
  const page = document.getElementById('shopPage');
  let got = load(GOT_KEY, {}), notes = load(NOTE_KEY, {}), extra = load(EXTRA_KEY, []), photos = {}, hovered = null;
  photoAll().then(p => { photos = p; render(); });

  const itemsNow = () => [...bomFor(getOptions()), ...extra];
  function render() {
    const items = itemsNow(), bom = items.filter(i => !i.extra);
    const req = bom.filter(i => !i.optional && !i.owned), opt = bom.filter(i => i.optional);
    const sum = (list, k) => list.reduce((s, i) => s + i.qty * (i[k] || 0), 0);
    const left = req.filter(i => !got[i.id]);
    const nPhotos = items.filter(i => photos[i.id]).length, nGot = items.filter(i => got[i.id] || i.owned).length;
    const card = i => `<article class="sc${got[i.id] || i.owned ? ' done' : ''}" data-item="${i.id}">
        <div class="ph" tabindex="0" role="button" aria-label="${photos[i.id] ? 'Zoom photo of ' : 'Add a photo of '}${esc(i.name)}" data-ph="${i.id}">
          ${photos[i.id] ? `<img src="${photos[i.id]}" alt="${esc(i.name)}"><button class="rp" data-change="${i.id}" type="button">Change</button><button class="x" data-del="${i.id}" type="button" aria-label="Remove photo">✕</button>` : '<span>Drop a photo here<br><small>or click to choose · Ctrl+V pastes</small></span>'}
        </div>
        <div class="b"><div class="t"><span class="n">${esc(i.name)}</span>${i.optional ? ' <em>optional</em>' : ''}${i.owned ? ' <em>you have it</em>' : ''}</div>
          <div class="q">Qty ${esc(i.qty)}${i.lo ? ` · ${peso(i.qty * i.lo)}–${peso(i.qty * i.hi)}` : ''}</div>
          ${i.why ? `<p class="sp">${esc(i.why)}</p>` : ''}
          <div class="f"><label><input type="checkbox" class="got" data-item="${i.id}" ${got[i.id] || i.owned ? 'checked' : ''} ${i.owned ? 'disabled' : ''}> Got it</label>
          <input type="text" class="note" data-item="${i.id}" placeholder="Notes (store, price, model…)" value="${esc(notes[i.id] || '')}"></div></div></article>`;
    const cats = [...CATEGORIES, ['extra', 'Other photos (imported)']].map(([key, title]) => {
      const list = items.filter(i => (i.extra ? 'extra' : i.cat) === key); if (!list.length) return '';
      return `<h2>${esc(title)}</h2><div class="sg">${list.map(card).join('')}</div>`;
    }).join('');
    page.innerHTML = `
      <div class="shoptop"><div><h1>Shopping & photos</h1><small id="shopStat">Photos ${nPhotos}/${items.length} · Got it ${nGot}/${items.length} · for your build: ${esc(optionLabel())}</small></div>
        <div class="tot"><span>Needed: <b>${peso(sum(req, 'lo'))}–${peso(sum(req, 'hi'))}</b></span><span>Still to buy: <b>${peso(sum(left, 'lo'))}–${peso(sum(left, 'hi'))}</b></span><span class="mu">Optional extras: ${peso(sum(opt, 'lo'))}–${peso(sum(opt, 'hi'))}</span></div>
        <div class="row"><button class="sm primary" id="spSave" title="Download one HTML file with every photo, tick and note: good for GDrive or printing">Save with photos</button><button class="sm" id="spPrint">Print</button><button class="sm" id="spCsv">CSV</button>
          <label class="sm filebtn" title="Bring in the photos from your older Components_Photo_Checklist.html">Import old checklist<input type="file" id="spImport" accept=".html,text/html" hidden></label><button class="sm" id="spClear">Untick all</button></div></div>
      <p class="mu small">Photos and notes are saved in this browser only. Use <b>Save with photos</b> to keep or share them. Change the build options in the Build guide and this list follows.</p>
      ${cats}
      <h2>Real build: safety & gotchas</h2><div class="notes">${SAFETY.map(([t, d]) => `<p><b>${esc(t)}</b> ${esc(d)}</p>`).join('')}</div>
      <h2>Which chips can I use? (shift registers & “shifters”)</h2><div class="notes">${CHIPS.map(([t, d]) => `<p><b>${esc(t)}:</b> ${esc(d)}</p>`).join('')}</div>
      <h2>Parts in this build <span class="mu small">(click to find it in 3D)</span></h2><div class="pcards">${partCards()}</div>
      <input type="file" id="spFile" accept="image/*" hidden>`;
  }

  // ---------- interactions ----------
  async function setPhoto(id, file) {
    if (!file || !file.type.startsWith('image/')) return;
    try { photos[id] = await shrink(file); await photoPut(id, photos[id]); render(); } catch { alert('Could not read that picture. Try a JPG or PNG.'); }
  }
  let pickFor = null;
  page.addEventListener('click', e => {
    const del = e.target.closest('[data-del]'), ch = e.target.closest('[data-change]'), ph = e.target.closest('[data-ph]'), find = e.target.closest('[data-part]');
    if (del) { e.stopPropagation(); delete photos[del.dataset.del]; photoPut(del.dataset.del, null); render(); return; }
    if (ch) { e.stopPropagation(); pickFor = ch.dataset.change; page.querySelector('#spFile').click(); return; }
    if (ph) { const id = ph.dataset.ph; if (photos[id]) openViewer(photos[id], itemsNow().find(i => i.id === id)?.name || ''); else { pickFor = id; page.querySelector('#spFile').click(); } return; }
    if (find) { onFindPart(find.dataset.part); return; }
    if (e.target.id === 'spPrint') { document.body.classList.add('print-shop'); window.print(); setTimeout(() => document.body.classList.remove('print-shop'), 500); }
    if (e.target.id === 'spCsv') csv();
    if (e.target.id === 'spSave') exportHtml();
    if (e.target.id === 'spClear' && confirm('Untick every item?')) { got = {}; store(GOT_KEY, got); render(); }
  });
  page.addEventListener('keydown', e => { const ph = e.target.closest && e.target.closest('[data-ph]'); if (ph && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ph.click(); } });
  page.addEventListener('change', e => {
    if (e.target.id === 'spFile') { const f = e.target.files[0]; if (f && pickFor) setPhoto(pickFor, f); e.target.value = ''; return; }
    if (e.target.id === 'spImport') { const f = e.target.files[0]; if (f) importOld(f); e.target.value = ''; return; }
    if (e.target.classList.contains('got')) { got[e.target.dataset.item] = e.target.checked; store(GOT_KEY, got); render(); }
  });
  page.addEventListener('input', e => { if (e.target.classList.contains('note')) { notes[e.target.dataset.item] = e.target.value; store(NOTE_KEY, notes); } });
  page.addEventListener('dragover', e => { const c = e.target.closest('.sc'); if (c) { e.preventDefault(); c.classList.add('drop'); } });
  page.addEventListener('dragleave', e => { const c = e.target.closest('.sc'); if (c) c.classList.remove('drop'); });
  page.addEventListener('drop', e => { const c = e.target.closest('.sc'); if (!c) return; e.preventDefault(); c.classList.remove('drop'); setPhoto(c.dataset.item, e.dataTransfer.files[0]); });
  page.addEventListener('mouseover', e => { const c = e.target.closest('.sc'); hovered = c ? c.dataset.item : hovered; });
  document.addEventListener('paste', e => {
    if (page.hidden || !hovered || /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type === 'text') return;
    const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); setPhoto(hovered, f); }
  });

  // ---------- zoomable viewer ----------
  const viewer = document.getElementById('photoViewer');
  let z = 1, px = 0, py = 0;
  const apply = () => { viewer.querySelector('img').style.transform = `translate(${px}px,${py}px) scale(${z})`; };
  function openViewer(src, title) {
    viewer.innerHTML = `<div class="vb"><span>${esc(title)}</span><span><button data-z="1.4" type="button">+</button><button data-z="0.7" type="button">−</button><button data-z="0" type="button">Fit</button><button data-close type="button">Close</button></span></div><div class="vs"><img src="${src}" alt="${esc(title)}" draggable="false"></div>`;
    z = 1; px = py = 0; apply(); viewer.hidden = false; viewer.querySelector('[data-close]').focus();
  }
  viewer.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.close !== undefined) viewer.hidden = true; else if (b.dataset.z === '0') { z = 1; px = py = 0; apply(); } else { z = Math.max(1, Math.min(8, z * +b.dataset.z)); apply(); } });
  viewer.addEventListener('wheel', e => { e.preventDefault(); z = Math.max(1, Math.min(8, z * (e.deltaY < 0 ? 1.15 : 0.87))); apply(); }, { passive: false });
  viewer.addEventListener('dblclick', () => { z = z > 1 ? 1 : 2.5; px = py = 0; apply(); });
  let dragP = null;
  viewer.addEventListener('pointerdown', e => { if (e.target.tagName === 'IMG') { dragP = { x: e.clientX - px, y: e.clientY - py }; e.target.setPointerCapture(e.pointerId); } });
  viewer.addEventListener('pointermove', e => { if (dragP) { px = e.clientX - dragP.x; py = e.clientY - dragP.y; apply(); } });
  viewer.addEventListener('pointerup', () => { dragP = null; });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !viewer.hidden) viewer.hidden = true; });

  // ---------- export / import ----------
  function csv() {
    const rows = [['category', 'qty', 'item', 'why', 'est_min_php', 'est_max_php', 'optional', 'got_it', 'notes', 'has_photo'],
      ...itemsNow().map(i => [i.extra ? 'Other' : CATEGORIES.find(c => c[0] === i.cat)[1], i.qty, i.name, i.why || '', i.qty * (i.lo || 0), i.qty * (i.hi || 0), i.optional ? 'yes' : '', got[i.id] || i.owned ? 'yes' : '', notes[i.id] || '', photos[i.id] ? 'yes' : ''])];
    download(new Blob([rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }), 'fire-guard-shopping-list.csv');
  }
  function exportHtml() {
    const items = itemsNow();
    const cats = [...CATEGORIES, ['extra', 'Other photos']].map(([key, title]) => {
      const list = items.filter(i => (i.extra ? 'extra' : i.cat) === key); if (!list.length) return '';
      return `<h2>${esc(title)}</h2><div class="g">${list.map(i => `<div class="c${got[i.id] || i.owned ? ' d' : ''}">${photos[i.id] ? `<img src="${photos[i.id]}" alt="${esc(i.name)}">` : '<div class="np">no photo yet</div>'}<div class="b"><b>${got[i.id] || i.owned ? '☑' : '☐'} ${esc(i.name)}</b><div class="q">Qty ${esc(i.qty)}${i.lo ? ` · ${peso(i.qty * i.lo)}–${peso(i.qty * i.hi)}` : ''}</div>${i.why ? `<p>${esc(i.why)}</p>` : ''}${notes[i.id] ? `<p class="n">Notes: ${esc(notes[i.id])}</p>` : ''}</div></div>`).join('')}</div>`;
    }).join('');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fire Guard components checklist</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:0;padding:16px;color:#14232e;background:#fff}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 8px;color:#1d4e63}.g{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}.c{border:1px solid #cfdae1;border-radius:8px;overflow:hidden;break-inside:avoid}.c.d{border-color:#2fbf5b}.c img{width:100%;height:170px;object-fit:contain;background:#f3f6f8;display:block}.np{height:60px;display:flex;align-items:center;justify-content:center;color:#8a99a4;background:#f3f6f8}.b{padding:8px 10px}.q{color:#5b6e7b;font-size:12.5px}p{margin:4px 0;font-size:12.5px}.n{color:#1d4e63}</style></head><body>
<h1>Fire Guard: components checklist</h1><div>Build: ${esc(optionLabel())} · Got it ${items.filter(i => got[i.id] || i.owned).length}/${items.length} · Photos ${items.filter(i => photos[i.id]).length}/${items.length} · ${new Date().toLocaleDateString()}</div>${cats}</body></html>`;
    download(new Blob([html], { type: 'text/html' }), 'fire-guard-checklist-with-photos.html');
  }
  async function importOld(file) {
    try {
      const t = await file.text();
      const data = JSON.parse(/DATA=(\[[\s\S]*?\]\]\]\]);/.exec(t)[1]);
      const saved = JSON.parse(/<script id="saved" type="application\/json">([\s\S]*?)<\/script>/.exec(t)[1]);
      const names = ['ESP32 DevKit (yours)']; data.forEach(([, its]) => its.forEach(([, n]) => names.push(n)));
      let matched = 0, extras = 0;
      for (const [idx, src] of Object.entries(saved.p || {})) {
        const name = names[+idx]; if (!name) continue;
        let id = OLD_MAP[name];
        if (id && photos[id] && !OLD_MAP[name + '#2']) { // slot already has a photo: keep both, extra one goes to "Other"
          if (photos[id] === src) continue; id = null;
        }
        if (OLD_REPLACED[name]) { // an earlier version put these on the AAA / charger cards: take them back off
          for (const k of ['charger', 'aaaholder', 'aaa']) if (photos[k] === src) { delete photos[k]; await photoPut(k, null); delete got[k]; if (notes[k] === saved.n?.[idx]) delete notes[k]; }
        }
        if (!id) {
          id = 'x_' + idx; const why = OLD_REPLACED[name] || 'Imported from your older photo checklist.';
          const old = extra.find(x => x.id === id); if (old) old.why = why; else extra.push({ id, extra: true, qty: '—', name, why }); extras++;
        }
        else matched++;
        photos[id] = src; await photoPut(id, src);
        if (saved.g && saved.g[idx]) got[id] = true;
        if (saved.n && saved.n[idx]) notes[id] = saved.n[idx];
      }
      store(EXTRA_KEY, extra); store(GOT_KEY, got); store(NOTE_KEY, notes); render();
      alert(`Imported ${matched + extras} photos: ${matched} matched to items here, ${extras} kept under “Other photos”.`);
    } catch (e) { alert('That file does not look like the Components photo checklist.'); }
  }
  return { render, get photos() { return photos; }, get got() { return got; }, setPhoto, importOld };
}

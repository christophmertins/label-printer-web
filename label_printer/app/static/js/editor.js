/*
 * WYSIWYG editor for label documents.
 * Elements live in millimetre coordinates (printable area), the same model
 * that app/label_render.py uses.
 */

const Editor = (() => {
  const canvas = document.getElementById('canvas');
  const stageWrap = document.getElementById('stageWrap');
  const labelSelect = document.getElementById('labelSelect');
  const lengthInput = document.getElementById('lengthInput');
  const lengthField = document.getElementById('lengthField');
  const orientationSelect = document.getElementById('orientationSelect');
  const layerList = document.getElementById('layerList');
  const propsPanel = document.getElementById('propsPanel');
  const templateSelect = document.getElementById('templateSelect');
  const sizeHint = document.getElementById('sizeHint');

  const MIN_SIZE = 2;      // mm
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const MAX_UNDO = 50;

  const S = {
    cfg: null,
    labels: [],
    doc: null,
    scale: 4,
    selId: null,
    drag: null,
    undo: [],
    redo: [],
    dirty: false,
    lastSaveName: null,
    templates: [],
    busy: false,
  };

  const docSize = () => {
    const info = S.labels.find((l) => l.id === S.doc.label_id);
    const w = info ? info.width_mm : 62;
    const h = info && info.endless ? (S.doc.label_length_mm || 60) : (info ? info.length_mm : 100);
    const vertical = S.doc.orientation === 'vertical';
    return { w: vertical ? h : w, h: vertical ? w : h, info };
  };

  /* ── id / helpers ─────────────────────────────────────── */

  const uid = () => 'el_' + Math.random().toString(36).slice(2, 9);
  const fmt = (v) => Math.round(v * 100) / 100;

  function toast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast'; }, 3200);
  }

  function openModal({ title, bodyHTML, okLabel = 'OK', onOk } = {}) {
    const modal = document.getElementById('modal');
    document.getElementById('modalTitle').textContent = title || '';
    document.getElementById('modalBody').innerHTML = bodyHTML || '';
    const ok = document.getElementById('modalOk');
    ok.textContent = okLabel;
    modal.classList.remove('hidden');
    const close = (val) => {
      modal.classList.add('hidden');
      ok.onclick = null;
      document.getElementById('modalCancel').onclick = null;
      document.querySelector('#modalBody input')?.removeEventListener('keydown', key);
    };
    const key = (e) => { if (e.key === 'Enter') { const v = document.querySelector('#modalBody input')?.value; close(); onOk && onOk(v); } };
    ok.onclick = () => { const v = document.querySelector('#modalBody input')?.value; close(); onOk && onOk(v); };
    const cancelBtn = document.getElementById('modalCancel');
    if (cancelBtn) cancelBtn.onclick = () => close();
    setTimeout(() => document.querySelector('#modalBody input')?.focus(), 30);
  }

  async function confirm(message) {
    return new Promise((resolve) => {
      openModal({
        title: 'Bestätigung',
        bodyHTML: `<p>${message}</p>`,
        okLabel: 'Ja',
        onOk: () => resolve(true),
      });
      document.getElementById('modalCancel').onclick = () => { document.getElementById('modal').classList.add('hidden'); resolve(false); };
      document.getElementById('modalOk').onclick = () => { document.getElementById('modal').classList.add('hidden'); resolve(true); };
    });
  }

  function promptModal(title, current, onOk) {
    openModal({
      title,
      bodyHTML: `<input type="text" value="${escapeHtml(current || '')}" placeholder="Name">`,
      okLabel: 'OK',
      onOk: (v) => onOk(String(v || '').trim()),
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── document state ───────────────────────────────────── */

  function snapshot() {
    const json = JSON.stringify(S.doc);
    if (S.undo[S.undo.length - 1] === json) return;
    S.undo.push(json);
    if (S.undo.length > MAX_UNDO) S.undo.shift();
    S.redo = [];
  }

  function commit() {
    markDirty();
  }

  function markDirty() {
    S.dirty = true;
    document.title = '● Etiketten-Studio';
  }

  function newDoc() {
    const info = S.labels[0];
    const labelId = info ? info.id : '62';
    S.doc = {
      name: 'Neues Etikett',
      label_id: labelId,
      label_length_mm: 60,
      orientation: 'horizontal',
      elements: [],
    };
    S.selId = null;
    S.undo = [];
    S.redo = [];
    S.dirty = false;
    S.lastSaveName = null;
    document.title = 'Etiketten-Studio';
    afterDocChange(true);
  }

  function importDoc(doc) {
    S.doc = {
      name: doc.name || 'Vorlage',
      label_id: S.labels.some((l) => l.id === doc.label_id) ? doc.label_id : S.labels[0].id,
      label_length_mm: doc.label_length_mm || 60,
      orientation: doc.orientation === 'vertical' ? 'vertical' : 'horizontal',
      elements: Array.isArray(doc.elements) ? doc.elements : [],
    };
    S.selId = null;
    S.undo = [JSON.stringify(S.doc)];
    S.redo = [];
    S.dirty = false;
    document.title = 'Etiketten-Studio';
    afterDocChange(true);
  }

  function cloneDoc() {
    return JSON.parse(JSON.stringify(S.doc));
  }

  function afterDocChange(recomputeScale) {
    if (recomputeScale) fitScale();
    syncLabelControls();
    updateLayerList();
    updatePropsPanel();
    updateTemplateControls();
    redraw();
  }

  /* ── label controls ───────────────────────────────────── */

  function fitScale() {
    const { w, h } = docSize();
    if (!w || !h) { S.scale = 4; return; }
    const availW = Math.max(320, stageWrap.clientWidth - 80);
    const availH = Math.max(240, stageWrap.clientHeight - 90);
    S.scale = Render.clamp(Math.min(availW / w, availH / h), 1.5, 10);
  }

  function syncLabelControls() {
    labelSelect.value = S.doc.label_id;
    orientationSelect.value = S.doc.orientation || 'horizontal';
    const { info } = docSize();
    const endless = !!(info && info.endless);
    lengthInput.disabled = !endless;
    lengthField.style.opacity = endless ? '1' : '0.45';
    if (endless) {
      lengthInput.value = Math.round(S.doc.label_length_mm || 60);
    }
    const { w, h } = docSize();
    const mm = `Druckbereich: ${fmt(w)} × ${fmt(h)} mm`;
    const dpi = ` · Vorlage: ${Math.round(w * 11.81)} × ${Math.round(h * 11.81)} px @300dpi`;
    sizeHint.textContent = mm + dpi;
  }

  function onLabelChange() {
    const id = labelSelect.value;
    if (!id) return;
    snapshot();
    S.doc.label_id = id;
    if (docSize().info && docSize().info.endless) {
      S.doc.label_length_mm = Math.max(10, Math.min(1000, parseFloat(lengthInput.value) || 60));
    }
    S.selId = null;
    commit();
    afterDocChange(true);
  }

  function onLengthChange() {
    const v = parseFloat(lengthInput.value);
    if (Number.isNaN(v)) return;
    snapshot();
    S.doc.label_length_mm = Math.max(10, Math.min(1000, v));
    commit();
    afterDocChange(false);
  }

  function onOrientationChange() {
    const v = orientationSelect.value;
    if (v === S.doc.orientation) return;
    snapshot();
    S.doc.orientation = v;
    S.selId = null;
    commit();
    afterDocChange(true);
  }

  /* ── element creation ─────────────────────────────────── */

  function addElement(type, data) {
    const { w: docW, h: docH } = docSize();
    snapshot();
    let el;
    if (type === 'qr') {
      const size = Math.min(28, docW * 0.5, docH * 0.5);
      el = {
        id: uid(),
        type: 'qr',
        x_mm: fmt(docW - size - 2),
        y_mm: fmt(docH - size - 2),
        w_mm: fmt(size),
        h_mm: fmt(size),
        rotation_deg: 0,
        props: { value: data || 'https://example.com', ecl: 'M', quiet: 4 },
      };
    } else if (type === 'image') {
      const s = Math.min(30, docW * 0.5, docH * 0.5);
      el = {
        id: uid(),
        type: 'image',
        x_mm: fmt((docW - s) / 2),
        y_mm: fmt((docH - s) / 2),
        w_mm: fmt(s),
        h_mm: fmt(s),
        rotation_deg: 0,
        props: { src: data || null, mode: 'fit' },
      };
    } else {
      el = {
        id: uid(),
        type: 'text',
        x_mm: 2,
        y_mm: 2,
        w_mm: fmt(Math.min(60, docW - 4)),
        h_mm: 15,
        rotation_deg: 0,
        props: {
          text: data || 'Text',
          fontFamily: 'sans',
          bold: false,
          italic: false,
          fontsize_mm: 7,
          color: '#000000',
          align: 'left',
          valign: 'top',
          lineHeight: 1.25,
        },
      };
    }
    S.doc.elements.push(el);
    S.selId = el.id;
    commit();
    afterDocChange(false);
  }

  /* ── selection ────────────────────────────────────────── */

  const getSelected = () => S.doc.elements.find((e) => e.id === S.selId);

  function elPointpx(el) {
    return {
      x: (parseFloat(el.x_mm) || 0) * S.scale,
      y: (parseFloat(el.y_mm) || 0) * S.scale,
      w: (parseFloat(el.w_mm) || 0) * S.scale,
      h: (parseFloat(el.h_mm) || 0) * S.scale,
      cx: ((parseFloat(el.x_mm) || 0) * S.scale) + ((parseFloat(el.w_mm) || 0) * S.scale) / 2,
      cy: ((parseFloat(el.y_mm) || 0) * S.scale) + ((parseFloat(el.h_mm) || 0) * S.scale) / 2,
      rot: (parseFloat(el.rotation_deg) || 0) * Math.PI / 180,
    };
  }

  function handlePositions(p) {
    const m = 0, len = 6;
    const off = p.h / 2 + 22;
    const out = {
      nw: [p.x, p.y],
      n: [p.cx, p.y],
      ne: [p.x + p.w, p.y],
      e: [p.x + p.w, p.cy],
      se: [p.x + p.w, p.y + p.h],
      s: [p.cx, p.y + p.h],
      sw: [p.x, p.y + p.h],
      w: [p.x, p.cy],
      rotate: [p.cx, p.y - off],
    };
    const rot = p.rot;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (const k in out) {
      const [hx, hy] = out[k];
      out[k] = [
        p.cx + (hx - p.cx) * cs - (hy - p.cy) * sn,
        p.cy + (hx - p.cx) * sn + (hy - p.cy) * cs,
      ];
    }
    out._len = len;
    return out;
  }

  function hitTest(mx, my) {
    const ctx = canvas.getContext('2d');
    for (let i = S.doc.elements.length - 1; i >= 0; i--) {
      const el = S.doc.elements[i];
      const p = elPointpx(el);
      const w = Math.max(1, p.w), h = Math.max(1, p.h);
      const cx = p.cx, cy = p.cy;
      ctx.save();
      ctx.beginPath();
      ctx.translate(cx, cy);
      ctx.rotate(p.rot);
      ctx.rect(-w / 2, -h / 2, w, h);
      if (ctx.isPointInPath(mx, my)) {
        ctx.restore();
        return el;
      }
      ctx.restore();
    }
    return null;
  }

  function hitHandle(mx, my, p) {
    if (!p) return null;
    const handles = handlePositions(p);
    const r = Math.max(6, handles._len + 2);
    for (const k of Object.keys(handles)) {
      if (k === '_len') continue;
      const [hx, hy] = handles[k];
      if (Math.hypot(mx - hx, my - hy) <= r) return k;
    }
    return null;
  }

  function startDrag(e) {
    const mx = e.offsetX, my = e.offsetY;
    const el = getSelected();

    if (el) {
      const p = elPointpx(el);
      const handle = hitHandle(mx, my, p);
      if (handle) {
        snapshot();
        if (handle === 'rotate') S.drag = { mode: 'rotate', el, handle, start: { cx: p.cx, cy: p.cy } };
        else S.drag = { mode: 'resize', el, handle, start: { x: parseFloat(el.x_mm), y: parseFloat(el.y_mm), w: parseFloat(el.w_mm), h: parseFloat(el.h_mm), px: mx, py: my }, p };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    const hit = hitTest(mx, my);
    selectEl(hit ? hit.id : null);
    if (hit) {
      snapshot();
      S.drag = { mode: 'move', el: hit, start: { mx, my, x: parseFloat(hit.x_mm), y: parseFloat(hit.y_mm) } };
      canvas.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e) {
    if (!S.drag) return;
    const { mode, el, handle, start } = S.drag;
    const mx = e.offsetX, my = e.offsetY;

    if (mode === 'move') {
      const { w: docW, h: docH } = docSize();
      el.x_mm = fmt(Render.clamp(start.x + (mx - start.mx) / S.scale, 0, Math.max(0, docW - el.w_mm)));
      el.y_mm = fmt(Render.clamp(start.y + (my - start.my) / S.scale, 0, Math.max(0, docH - el.h_mm)));
    } else if (mode === 'resize') {
      const sx = (mx - start.px) / S.scale;
      const sy = (my - start.py) / S.scale;
      const ox = start.x, oy = start.y, ow = start.w, oh = start.h;
      let nw = ow, nh = oh, nx = ox, ny = oy;
      if (handle.includes('e')) nw = ow + sx;
      if (handle.includes('w')) { nw = ow - sx; nx = ox + sx; }
      if (handle.includes('s')) nh = oh + sy;
      if (handle.includes('n')) { nh = oh - sy; ny = oy + sy; }
      nw = Math.max(MIN_SIZE, nw);
      nh = Math.max(MIN_SIZE, nh);
      if (el.type === 'qr') nh = nw;
      el.w_mm = fmt(nw);
      el.h_mm = fmt(nh);
      el.x_mm = fmt(nx);
      el.y_mm = fmt(ny);
    } else if (mode === 'rotate') {
      const ang = Math.atan2(my - start.cy, mx - start.cx) * 180 / Math.PI;
      el.rotation_deg = Math.round((ang + 90) % 360 + ((ang + 90) < 0 ? 360 : 0)) % 360;
    }
    redraw();
  }

  function endDrag(e) {
    if (!S.drag) return;
    S.drag = null;
    commit();
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  }

  function selectEl(id) {
    if (S.selId === id) { updatePropsPanel(); redraw(); return; }
    S.selId = id;
    updateLayerList();
    updatePropsPanel();
    redraw();
  }

  /* ── drawing ──────────────────────────────────────────── */

  function redraw() {
    const { w, h } = docSize();
    canvas.width = Math.max(1, Math.round(w * S.scale));
    canvas.height = Math.max(1, Math.round(h * S.scale));
    Render.renderDoc(canvas, S.doc, S.scale).then(() => {
      drawSelection();
    });
  }

  function drawSelection() {
    const el = getSelected();
    const ctx = canvas.getContext('2d');
    if (!el) return;
    const p = elPointpx(el);
    ctx.save();
    ctx.translate(p.cx, p.cy);
    ctx.rotate(p.rot);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-p.w / 2 - 2, -p.h / 2 - 2, p.w + 4, p.h + 4);
    ctx.setLineDash([]);
    ctx.restore();

    const handles = handlePositions(p);
    for (const k of Object.keys(handles)) {
      if (k === '_len') continue;
      const [hx, hy] = handles[k];
      ctx.beginPath();
      if (k === 'rotate') {
        ctx.moveTo(p.cx, p.cy - p.h / 2 - 10);
        ctx.lineTo(hx, hy - 2);
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = '#fff';
        ctx.arc(hx, hy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2563eb';
        ctx.stroke();
      } else {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  /* ── layers panel ─────────────────────────────────────── */

  function updateLayerList() {
    layerList.innerHTML = '';
    const icons = { text: 'T', qr: '▦', image: '🖼' };
    for (let i = S.doc.elements.length - 1; i >= 0; i--) {
      const el = S.doc.elements[i];
      const li = document.createElement('li');
      li.innerHTML = `<span class="el-icon">${icons[el.type] || '•'}</span><span>${escapeHtml(el.props && el.props.text ? el.props.text.split('\n')[0].slice(0, 22) : ({ text: 'Text', qr: 'QR-Code', image: 'Bild' })[el.type])}</span>`;
      if (el.id === S.selId) li.classList.add('selected');
      li.addEventListener('click', () => selectEl(el.id));
      li.title = 'Klicken zum Auswählen';
      layerList.appendChild(li);
    }
  }

  function moveLayer(dir) {
    const el = getSelected();
    if (!el) return;
    const idx = S.doc.elements.indexOf(el);
    const nidx = idx + dir;
    if (nidx < 0 || nidx >= S.doc.elements.length) return;
    snapshot();
    S.doc.elements.splice(idx, 1);
    S.doc.elements.splice(nidx, 0, el);
    commit();
    updateLayerList();
    updatePropsPanel();
    redraw();
  }

  function duplicateEl() {
    const el = getSelected();
    if (!el) return;
    snapshot();
    const copy = JSON.parse(JSON.stringify(el));
    copy.id = uid();
    copy.x_mm = Math.max(0, parseFloat(copy.x_mm) + 3);
    copy.y_mm = Math.max(0, parseFloat(copy.y_mm) + 3);
    S.doc.elements.push(copy);
    S.selId = copy.id;
    commit();
    afterDocChange(false);
  }

  function deleteEl() {
    const el = getSelected();
    if (!el) return;
    snapshot();
    S.doc.elements = S.doc.elements.filter((e) => e.id !== el.id);
    S.selId = null;
    commit();
    afterDocChange(false);
  }

  /* ── properties panel ─────────────────────────────────── */

  const FIELD_LABELS = {
    x_mm: 'X (mm)', y_mm: 'Y (mm)', w_mm: 'W (mm)', h_mm: 'H (mm)', rotation_deg: 'Drehung (°)',
  };

  function row(label, inner) {
    return `<div class="prop-row">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
  }

  function numRow(field, min, max, step) {
    return row(FIELD_LABELS[field], `<input type="number" data-field="${field}" value="${fmt(getSelected()[field])}" min="${min}" max="${max}" step="${step}">`);
  }

  function selectRow(field, options, label) {
    return row(label || ' ', `<select data-field="${field}">${options}</select>`);
  }

  function buildProps() {
    const el = getSelected();
    if (!el) { propsPanel.innerHTML = '<div class="props-empty">Wähle ein Element aus.<br>Klicke auf der Etikette oder in die Liste.</div>'; return; }
    const p = el.props || {};
    let s = '';

    s += `<div class="prop-section"><h4>Position</h4>`;
    s += `<div class="prop-row prop-row-sm">${numRow('x_mm', 0, 1000, 0.5)}</div>`;
    s += `<div class="prop-row prop-row-sm">${numRow('y_mm', 0, 1000, 0.5)}</div>`;
    s += `<div class="prop-row prop-row-sm">${numRow('w_mm', 1, 1000, 0.5)}</div>`;
    s += el.type === 'qr' ? '' : `<div class="prop-row prop-row-sm">${numRow('h_mm', 1, 1000, 0.5)}</div>`;
    s += `<div class="prop-row prop-row-sm">${numRow('rotation_deg', 0, 359, 5)}</div>`;
    s += `</div>`;

    if (el.type === 'text') {
      s += `<div class="prop-section"><h4>Text</h4>`;
      s += row('', `<textarea data-field="text" rows="4">${escapeHtml(p.text || '')}</textarea>`);
      const fam = ['sans', 'serif', 'mono'].map((f) => `<option value="${f}"${p.fontFamily === f ? ' selected' : ''}>${f === 'sans' ? 'Sans' : f === 'serif' ? 'Serif' : 'Mono'}</option>`).join('');
      s += selectRow('fontFamily', fam, 'Schrift');
      s += '<div class="prop-row">' +
        '<label>&nbsp;</label><div style="flex:1;display:flex;gap:12px">' +
        `<label style="width:auto"><input type="checkbox" data-field="bold"${p.bold ? ' checked' : ''}> Fett</label>` +
        `<label style="width:auto"><input type="checkbox" data-field="italic"${p.italic ? ' checked' : ''}> Kursiv</label>` +
        '</div></div>';
      s += row('Größe', `<input type="number" data-field="fontsize_mm" value="${p.fontsize_mm || 6}" min="1" max="100" step="0.5">`);
      s += row('Zeilenhöhe', `<input type="number" data-field="lineHeight" value="${p.lineHeight || 1.25}" min="0.8" max="3" step="0.05">`);
      s += row('Farbe', `<input type="color" data-field="color" value="${p.color || '#000000'}">`);
      s += row('', `<div class="prop-btn-group" data-group="align">
        ${['left', 'center', 'right'].map((a) => `<button class="btn${p.align === a ? ' active' : ''}" data-value="${a}">${a === 'left' ? 'Links' : a === 'center' ? 'Mitte' : 'Rechts'}</button>`).join('')}
        </div>`);
      s += row('', `<div class="prop-btn-group" data-group="valign">
        ${['top', 'middle', 'bottom'].map((a) => `<button class="btn${p.valign === a ? ' active' : ''}" data-value="${a}">${a === 'top' ? 'Oben' : a === 'middle' ? 'Mitte' : 'Unten'}</button>`).join('')}
        </div>`);
      s += `</div>`;
    } else if (el.type === 'qr') {
      s += `<div class="prop-section"><h4>QR-Code</h4>`;
      s += row('', `<input type="text" data-field="value" value="${escapeHtml(p.value || '')}" placeholder="z. B. https://...">`);
      s += selectRow('ecl', ['L', 'M', 'Q', 'H'].map((e) => `<option value="${e}"${p.ecl === e ? ' selected' : ''}>${e}</option>`).join(''), 'Korrektur');
      s += row('Rand', `<input type="number" data-field="quiet" value="${p.quiet != null ? p.quiet : 4}" min="0" max="10" step="1">`);
      s += `<p style="font-size:11px;color:var(--c-muted);margin-top:4px">QR-Codes sind quadratisch (W = H).</p>`;
      s += `</div>`;
    } else if (el.type === 'image') {
      s += `<div class="prop-section"><h4>Bild</h4>`;
      s += row('', `<button class="btn btn-primary" data-action="pickImage" style="width:100%">Bild wählen</button>`);
      if (p.src) s += row('', `<button class="btn" data-action="removeImage" style="width:100%">Bild entfernen</button>`);
      s += selectRow('mode', `<option value="fit"${p.mode !== 'stretch' ? ' selected' : ''}>Passend (Proportionen erhalten)</option><option value="stretch"${p.mode === 'stretch' ? ' selected' : ''}>Strecken (volle Box)</option>`, 'Anpassung');
      s += `</div>`;
    }
    propsPanel.innerHTML = s;

    bindProps(el);
    document.querySelector('#propsPanel input[data-field="text"]')?.focus?.();
  }

  function setNumberProp(el, field, v) {
    const n = parseFloat(v);
    if (Number.isNaN(n)) return;
    if (field === 'w_mm' && el.type === 'qr') { el.h_mm = fmt(Math.max(MIN_SIZE, n)); }
    if (field === 'h_mm' && el.type === 'qr') { el.w_mm = el.h_mm; }
    el[field] = fmt(Math.max(0, n));
  }

  function bindProps(el) {
    propsPanel.querySelectorAll('input[data-field], select[data-field], textarea[data-field]').forEach((inp) => {
      const field = inp.dataset.field;
      const set = () => {
        snapshotBefore();
        if (inp.type === 'checkbox') { el.props[field] = inp.checked; }
        else if (field === 'text') { el.props.text = inp.value; }
        else if (field === 'value') { el.props.value = inp.value; }
        else if (['x_mm', 'y_mm', 'w_mm', 'h_mm', 'rotation_deg'].includes(field)) { setNumberProp(el, field, inp.value); }
        else { el.props[field] = inp.value; }
        commit();
        updateLayerList();
        redraw();
      };
      inp.addEventListener('input', set);
      inp.addEventListener('change', set);
    });
    propsPanel.querySelectorAll('.prop-btn-group').forEach((grp) => {
      grp.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const group = grp.dataset.group;
          snapshotBefore();
          el.props[group === 'align' ? 'align' : 'valign'] = btn.dataset.value;
          commit();
          updatePropsPanel();
          redraw();
        });
      });
    });
    propsPanel.querySelectorAll('[data-action="pickImage"]').forEach((b) => b.addEventListener('click', () => document.getElementById('imageInput').click()));
    propsPanel.querySelectorAll('[data-action="removeImage"]').forEach((b) => b.addEventListener('click', () => {
      snapshotBefore();
      el.props.src = null;
      commit();
      updatePropsPanel();
      redraw();
    }));
  }

  function snapshotBefore() {
    if (!S.drag) snapshot();
  }

  function updatePropsPanel() {
    buildProps();
  }

  /* ── undo / redo ──────────────────────────────────────── */

  function undo() { applyHistory(S.undo, S.redo); }
  function redo() { applyHistory(S.redo, S.undo); }

  function applyHistory(from, to) {
    if (!from.length) return;
    const prevJson = JSON.stringify(S.doc);
    to.push(prevJson);
    S.doc = JSON.parse(from.pop());
    S.selId = null;
    S.dirty = true;
    document.title = '● Etiketten-Studio';
    afterDocChange(false);
  }

  /* ── templates ────────────────────────────────────────── */

  async function refreshTemplates() {
    try {
      const data = await apiGet('api/templates');
      S.templates = data.templates || [];
    } catch (e) {
      S.templates = [];
      toast('Vorlagen konnten nicht geladen werden.', 'error');
    }
    fillTemplateSelect();
  }

  function fillTemplateSelect() {
    const cur = templateSelect.value;
    templateSelect.innerHTML = '<option value="">— Vorlage wählen —</option>' +
      S.templates.map((t) => `<option value="${escapeHtml(t.file)}">${escapeHtml(t.name)}${t.label_id ? ' · ' + escapeHtml(t.label_id) : ''}</option>`).join('');
    if (cur) templateSelect.value = cur;
    document.getElementById('btnLoadTemplate').disabled = !templateSelect.value;
    document.getElementById('btnDeleteTemplate').disabled = !templateSelect.value;
  }

  async function loadSelectedTemplate() {
    const file = templateSelect.value;
    if (!file) return;
    if (S.dirty && !await confirm('Ungespeicherte Änderungen werden verworfen. Fortfahren?')) return;
    try {
      const doc = await apiGet('api/templates/' + encodeURIComponent(file));
      importDoc(doc);
      S.lastSaveName = doc.name || file;
      toast(`Vorlage „${file}“ geladen.`, 'success');
    } catch (e) {
      toast(e.message || 'Laden fehlgeschlagen.', 'error');
    }
  }

  async function saveAsTemplate() {
    promptModal('Vorlage speichern', S.lastSaveName || S.doc.name, async (name) => {
      if (!name) return;
      try {
        const doc = cloneDoc();
        doc.name = name;
        await apiSend('PUT', 'api/templates/' + encodeURIComponent(name), doc);
        S.lastSaveName = name;
        S.dirty = false;
        document.title = 'Etiketten-Studio';
        toast(`Vorlage „${name}“ gespeichert.`, 'success');
        await refreshTemplates();
        templateSelect.value = name;
        fillTemplateSelect();
      } catch (e) {
        toast(e.message || 'Speichern fehlgeschlagen.', 'error');
      }
    });
  }

  async function deleteSelectedTemplate() {
    const file = templateSelect.value;
    if (!file) return;
    if (!await confirm(`Vorlage „${file}“ wirklich löschen?`)) return;
    try {
      await apiSend('DELETE', 'api/templates/' + encodeURIComponent(file));
      toast(`Vorlage „${file}“ gelöscht.`, 'success');
      await refreshTemplates();
    } catch (e) {
      toast(e.message || 'Löschen fehlgeschlagen.', 'error');
    }
  }

  function updateTemplateControls() {
    fillTemplateSelect();
  }

  /* ── preview & print ──────────────────────────────────── */

  async function showPreview() {
    let data;
    try {
      data = await apiSend('POST', 'api/preview', cloneDoc());
    } catch (e) {
      toast(e.message || 'Vorschau fehlgeschlagen.', 'error');
      return;
    }
    const img = document.getElementById('previewImg');
    img.src = data.image;
    document.getElementById('previewInfo').textContent =
      `${data.width_px} × ${data.height_px} px bei 300 dpi · ${data.width_mm} × ${data.height_mm} mm · Etikett: ${data.label_name}`;
    document.getElementById('previewModal').classList.remove('hidden');
  }

  async function print() {
    if (S.busy) return;
    S.busy = true;
    document.getElementById('btnPrint').disabled = true;
    try {
      const data = await apiSend('POST', 'api/print', cloneDoc());
      const errs = data.detail && data.detail.printer_state && data.detail.printer_state.errors;
      if (errs && errs.length) {
        toast('Drucker-Fehler: ' + errs.join(' · '), 'error');
      } else {
        toast(data.message || 'Druckauftrag gesendet.', 'success');
      }
      document.getElementById('previewModal').classList.add('hidden');
    } catch (e) {
      toast(e.message || 'Druck fehlgeschlagen.', 'error');
    } finally {
      S.busy = false;
      document.getElementById('btnPrint').disabled = false;
      refreshStatus();
    }
  }

  function closePreview() {
    document.getElementById('previewModal').classList.add('hidden');
  }

  /* ── keyboard ─────────────────────────────────────────── */

  function onKey(e) {
    const target = e.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (typing) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (getSelected()) { e.preventDefault(); deleteEl(); }
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && getSelected()) {
      e.preventDefault();
      const el = getSelected();
      const step = e.shiftKey ? 0.1 : 1;
      snapshot();
      if (e.key === 'ArrowUp') el.y_mm = fmt(Math.max(0, parseFloat(el.y_mm) - step));
      if (e.key === 'ArrowDown') el.y_mm = fmt(parseFloat(el.y_mm) + step);
      if (e.key === 'ArrowLeft') el.x_mm = fmt(Math.max(0, parseFloat(el.x_mm) - step));
      if (e.key === 'ArrowRight') el.x_mm = fmt(parseFloat(el.x_mm) + step);
      commit();
      updatePropsPanel();
      redraw();
    }
  }

  function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 900;
        const r = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * r);
        c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL('image/png');
        const sel = getSelected();
        if (sel && sel.type === 'image') {
          snapshot();
          sel.props.src = dataUrl;
          commit();
          updatePropsPanel();
          redraw();
        } else {
          addElement('image', dataUrl);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ── API helpers ──────────────────────────────────────── */

  async function apiGet(path) {
    const r = await fetch(path);
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Anfrage fehlgeschlagen.');
    return data;
  }

  async function apiSend(method, path, body) {
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Anfrage fehlgeschlagen.');
    return data;
  }

  /* ── init ─────────────────────────────────────────────── */

  function init(cfg) {
    S.cfg = cfg;
    S.labels = cfg.labels || [];
    S.endlessRange = cfg.endless_length_range_mm || [10, 1000];
    lengthInput.min = S.endlessRange[0];
    lengthInput.max = S.endlessRange[1];

    labelSelect.innerHTML = S.labels.map((l) => `<option value="${l.id}">${escapeHtml(l.name)} · ${fmt(l.width_mm)} mm${l.endless ? ' (fortlaufend)' : ' × ' + fmt(l.length_mm) + ' mm'}</option>`).join('');

    bindEvents();
    newDoc();
    refreshTemplates();
  }

  function bindEvents() {
    labelSelect.addEventListener('change', onLabelChange);
    lengthInput.addEventListener('input', onLengthChange);
    lengthInput.addEventListener('change', onLengthChange);
    orientationSelect.addEventListener('change', onOrientationChange);

    canvas.addEventListener('pointerdown', startDrag);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    document.querySelectorAll('.add-tool').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        if (tool === 'image') {
          document.getElementById('imageInput').click();
          return;
        }
        addElement(tool);
      });
    });

    document.getElementById('imageInput').addEventListener('change', (e) => {
      handleImageFile(e.target.files[0]);
      e.target.value = '';
    });

    document.getElementById('btnUp').addEventListener('click', () => moveLayer(1));
    document.getElementById('btnDown').addEventListener('click', () => moveLayer(-1));
    document.getElementById('btnDuplicate').addEventListener('click', duplicateEl);
    document.getElementById('btnDeleteEl').addEventListener('click', deleteEl);

    document.getElementById('btnSaveTemplate').addEventListener('click', saveAsTemplate);
    document.getElementById('btnLoadTemplate').addEventListener('click', loadSelectedTemplate);
    document.getElementById('btnDeleteTemplate').addEventListener('click', deleteSelectedTemplate);
    document.getElementById('btnNewDoc').addEventListener('click', async () => {
      if (S.dirty && !await confirm('Ungespeicherte Änderungen werden verworfen. Fortfahren?')) return;
      newDoc();
    });
    templateSelect.addEventListener('change', () => {
      document.getElementById('btnLoadTemplate').disabled = !templateSelect.value;
      document.getElementById('btnDeleteTemplate').disabled = !templateSelect.value;
    });

    document.getElementById('btnPreview').addEventListener('click', showPreview);
    document.getElementById('btnPrint').addEventListener('click', print);
    document.getElementById('previewClose').addEventListener('click', closePreview);
    document.getElementById('previewPrint').addEventListener('click', print);

    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { fitScale(); redraw(); });

    const panelMq = window.matchMedia('(max-width: 860px)');
    const setPanelState = () => {
      const mobile = panelMq.matches;
      document.querySelectorAll('.panel').forEach((p) => {
        p.classList.toggle('collapsed', mobile);
      });
      document.querySelectorAll('.panel h3').forEach((h) => {
        h.title = mobile ? 'Zum Auf-/Zuklappen tippen' : '';
      });
    };
    document.querySelectorAll('.panel h3').forEach((h) => {
      h.addEventListener('click', () => {
        if (!panelMq.matches) return;
        h.parentElement.classList.toggle('collapsed');
      });
    });
    setPanelState();
    if (panelMq.addEventListener) panelMq.addEventListener('change', setPanelState);
    else panelMq.addListener(setPanelState);
  }

  return {
    init,
    newDoc,
    importDoc,
    addElement,
    getDoc: cloneDoc,
    print,
    showPreview,
    handleImageFile,
    markDirty: commit,
    _test: { newDoc, addElement, importDoc },
  };
})();
/*
 * Client-side preview renderer.
 * Mirrors app/label_render.py so the on-screen preview matches the 300 dpi
 * print output. Coordinate system: millimetres inside the printable area.
 */

const Render = (() => {
  const FONT_FAMILIES = { sans: 'Label Sans', serif: 'Label Serif', mono: 'Label Mono' };
  const FONT_FALLBACK = 'Label Sans';

  const imageCache = new Map();

  function fontFor(family, bold, italic, sizePx) {
    const fam = FONT_FAMILIES[family] || FONT_FALLBACK;
    const style = italic ? 'italic ' : '';
    const weight = bold ? 'bold ' : '';
    return `${style}${weight}${sizePx}px "${fam}", sans-serif`;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (imageCache.has(src)) return imageCache.get(src);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imageCache.set(src, p);
    return p;
  }

  function drawText(ctx, el, wPx, hPx, pxPerMm) {
    const p = el.props || {};
    if (!p.text) return;
    const sizeMm = parseFloat(p.fontsize_mm) || 6;
    const lineHeight = parseFloat(p.lineHeight) || 1.25;
    const fontPx = sizeMm * pxPerMm;
    ctx.font = fontFor(p.fontFamily, p.bold, p.italic, fontPx);
    ctx.fillStyle = p.color || '#000000';
    ctx.textBaseline = 'top';

    const lines = String(p.text).split('\n');
    const lineH = fontPx * lineHeight;
    const totalH = lineH * lines.length;

    let ty;
    if (p.valign === 'middle') ty = Math.max(0, (hPx - totalH) / 2);
    else if (p.valign === 'bottom') ty = Math.max(0, hPx - totalH);
    else ty = 0;

    for (const line of lines) {
      if (line) {
        const tw = ctx.measureText(line).width;
        let tx = 0;
        if (p.align === 'center') tx = (wPx - tw) / 2;
        else if (p.align === 'right') tx = wPx - tw;
        ctx.fillText(line, tx, ty);
      }
      ty += lineH;
    }
  }

  function drawQr(ctx, el, wPx, hPx) {
    const p = el.props || {};
    if (!p.value) return;
    if (typeof qrcode !== 'function') return;
    const ecl = ['L', 'M', 'Q', 'H'].includes(p.ecl) ? p.ecl : 'M';
    let qr;
    try {
      qr = qrcode(0, ecl);
      qr.addData(String(p.value));
      qr.make();
    } catch (e) { return; }
    const n = qr.getModuleCount();
    const quiet = clamp(parseInt(p.quiet) || 4, 0, 10);
    const modules = n + 2 * quiet;
    const mod = Math.max(1, Math.floor(Math.min(wPx, hPx) / modules));
    const sizePx = mod * modules;
    const ox = Math.floor((wPx - sizePx) / 2);
    const oy = Math.floor((hPx - sizePx) / 2);
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) {
          ctx.rect(ox + (c + quiet) * mod, oy + (r + quiet) * mod, mod, mod);
        }
      }
    }
    ctx.fill();
  }

  async function drawImage(ctx, el, wPx, hPx) {
    const p = el.props || {};
    const img = await loadImage(p.src);
    if (!img) {
      ctx.fillStyle = '#eeeeee';
      ctx.fillRect(0, 0, wPx, hPx);
      ctx.fillStyle = '#999999';
      ctx.font = `${Math.min(12, wPx / 6)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Bild', wPx / 2, hPx / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      return;
    }
    if (p.mode === 'stretch') {
      ctx.drawImage(img, 0, 0, wPx, hPx);
    } else {
      const r = Math.min(wPx / img.width, hPx / img.height);
      const nw = img.width * r, nh = img.height * r;
      ctx.drawImage(img, (wPx - nw) / 2, (hPx - nh) / 2, nw, nh);
    }
  }

  function renderContent(ctx, el, wPx, hPx, pxPerMm) {
    switch (el.type) {
      case 'text': drawText(ctx, el, wPx, hPx, pxPerMm); break;
      case 'qr': drawQr(ctx, el, wPx, hPx); break;
      case 'image': drawImage(ctx, el, wPx, hPx); break;
    }
  }

  /*
   * Render a document into a canvas. The canvas is expected to already be
   * sized to the label dimensions in pixels. Elements may be drawn
   * asynchronously (images); the returned promise resolves when a frame that
   * covers all elements has been drawn, and `onFrame` is called each time.
   */
  async function renderDoc(canvas, doc, pxPerMm, onFrame) {
    const ctx = canvas.getContext('2d');
    const wPx = canvas.width, hPx = canvas.height;
    ctx.clearRect(0, 0, wPx, hPx);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, wPx, hPx);

    const elements = (doc.elements || []).map((el) => ({ ...el, props: { ...(el.props || {}) } }));

    for (const el of elements) {
      const w = (parseFloat(el.w_mm) || 0) * pxPerMm;
      const h = (parseFloat(el.h_mm) || 0) * pxPerMm;
      const cx = (parseFloat(el.x_mm) || 0) * pxPerMm + w / 2;
      const cy = (parseFloat(el.y_mm) || 0) * pxPerMm + h / 2;
      const deg = parseFloat(el.rotation_deg) || 0;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(deg * Math.PI / 180);
      ctx.translate(-w / 2, -h / 2);
      await renderContent(ctx, el, Math.max(1, w), Math.max(1, h), pxPerMm);
      ctx.restore();
    }

    if (onFrame) onFrame();
  }

  return { renderDoc, fontFor, clamp };
})();
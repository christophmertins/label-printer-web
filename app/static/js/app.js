/*
 * Bootstrap: loads config, starts status polling and makes sure the bundled
 * DejaVu fonts (same files the server uses) are ready before first render.
 */

(async () => {
  try {
    await loadWebFonts();
  } catch (e) {
    console.warn('Fonts nicht verfügbar, Vorschau nutzt Fallback.', e);
  }

  let cfg;
  try {
    cfg = await fetch('/api/config').then((r) => r.json());
  } catch (e) {
    document.getElementById('toast').textContent = 'Backend nicht erreichbar.';
    document.getElementById('toast').className = 'toast show error';
    return;
  }

  Editor.init(cfg);
  refreshStatus();
  setInterval(refreshStatus, 15000);
})();

function refreshStatus() {
  fetch('/api/status')
    .then((r) => r.json())
    .then((s) => {
      const dot = document.getElementById('printerDot');
      const label = document.getElementById('printerLabel');
      const box = document.getElementById('printerStatus');
      dot.classList.toggle('on', !!s.connected);
      dot.classList.toggle('off', !s.connected);
      label.textContent = s.connected
        ? `Drucker verbunden (${s.model || ''})`.trim()
        : 'Drucker nicht verbunden / aus';
      box.title = s.connected ? `Gerät: ${s.identifier}` : (s.error || '');
    })
    .catch(() => {
      const dot = document.getElementById('printerDot');
      dot.classList.add('off');
      document.getElementById('printerLabel').textContent = 'Status unbekannt';
    });
}

async function loadWebFonts() {
  const fonts = [
    ['Label Sans', 'normal', 400],
    ['Label Sans', 'bold', 700],
    ['Label Sans', 'italic', 400],
    ['Label Sans', 'bold italic', 700],
    ['Label Serif', 'normal', 400],
    ['Label Serif', 'bold', 700],
    ['Label Serif', 'italic', 400],
    ['Label Serif', 'bold italic', 700],
    ['Label Mono', 'normal', 400],
    ['Label Mono', 'bold', 700],
  ];
  await Promise.all(fonts.map(([family, style, weight]) => document.fonts.load(`${style} ${weight} 20px "${family}"`)));
}
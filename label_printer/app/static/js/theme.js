/*
 * Hell/Dunkel: ohne gespeicherte Wahl folgt das Design dem System, ein Klick
 * auf #btnTheme legt eine feste Wahl in localStorage ab.
 */
(() => {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const stored = () => localStorage.getItem('theme');

  function apply(theme) {
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#181b21' : '#2563eb';
    document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  }

  apply(stored() || (mq.matches ? 'dark' : 'light'));

  mq.addEventListener('change', (e) => {
    if (!stored()) apply(e.matches ? 'dark' : 'light');
  });

  window.Theme = {
    current: () => root.dataset.theme,
    toggle() {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', next);
      apply(next);
      return next;
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btnTheme');
    if (!btn) return;
    const dark = root.dataset.theme === 'dark';
    btn.textContent = dark ? '☀️' : '🌙';
    btn.title = dark ? 'Zum hellen Design wechseln' : 'Zum dunklen Design wechseln';
    btn.setAttribute('aria-pressed', String(dark));
    btn.addEventListener('click', () => Theme.toggle());
    document.addEventListener('themechange', (e) => {
      const isDark = e.detail === 'dark';
      btn.textContent = isDark ? '☀️' : '🌙';
      btn.title = isDark ? 'Zum hellen Design wechseln' : 'Zum dunklen Design wechseln';
      btn.setAttribute('aria-pressed', String(isDark));
    });
  });
})();

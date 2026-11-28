// Applies the saved appearance before the first paint (no light flash in dark mode).
// Mirrors applyPrefs in app.js: the new design ("club") is the default and dark-first – also on the login screen.
try {
  var p = JSON.parse(localStorage.getItem('sot-prefs') || '{}');
  var club = p.design !== 'classic';
  var root = document.documentElement;
  if (club) root.classList.add('design-club');
  if (p.theme === 'light' || p.theme === 'dark') root.dataset.theme = p.theme;
  else if (club) root.dataset.theme = 'dark';
  if (p.glass) root.classList.add('glass');
  if (p.lang) root.lang = p.lang;
  var dark = root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  var bar = club ? (dark ? '#061520' : '#f1e9dc') : (dark ? '#002941' : '#ffffff');
  document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', bar); });
} catch (e) {}

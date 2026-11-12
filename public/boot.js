// Applies the saved appearance before the first paint (no light flash in dark mode).
try {
  var p = JSON.parse(localStorage.getItem('sot-prefs') || '{}');
  if (p.theme === 'light' || p.theme === 'dark') document.documentElement.dataset.theme = p.theme;
  if (p.glass) document.documentElement.classList.add('glass');
  if (p.lang) document.documentElement.lang = p.lang;
} catch (e) {}

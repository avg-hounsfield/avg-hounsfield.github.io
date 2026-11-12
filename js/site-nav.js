// Phone menu for the generated pages (topics, regions, protocols, about).
// The app (index.html) opens the same menu from js/app.js.
(function () {
  const btn = document.getElementById('mobileMenuBtn');
  const nav = document.getElementById('headerNav');
  if (!btn || !nav) return;

  const setOpen = open => {
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('active', open);
    nav.classList.toggle('mobile-open', open);
  };

  btn.addEventListener('click', e => {
    e.stopPropagation();
    setOpen(btn.getAttribute('aria-expanded') !== 'true');
  });
  document.addEventListener('click', e => {
    if (nav.classList.contains('mobile-open') && !nav.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav.classList.contains('mobile-open')) {
      setOpen(false);
      btn.focus();
    }
  });
})();

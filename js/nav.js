/* ============================================================
   nav.js — shared navigation drawer for all pages
   ============================================================ */

(function () {

  const PAGE_HREFS = {
    index:           'index.html',
    analyzer:        'analyzer.html',
    archive:         'archive.html',
    practice:        'practice.html',
    import:          'import.html',
    recommendations: 'recommendations.html'
  };

  let _toastTimer;

  function showNavToast(msg) {
    const el = document.getElementById('az-toast')
             || document.getElementById('hub-toast')
             || document.getElementById('import-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  function initNav(currentPage) {
    if (!currentPage) {
      const filename = window.location.pathname.split('/').pop() || 'index.html';
      currentPage = filename.replace('.html', '') || 'index';
    }

    const hamburger = document.getElementById('hamburger-btn');
    const drawer    = document.getElementById('nav-drawer');
    const overlay   = document.getElementById('nav-overlay');
    const closeBtn  = document.getElementById('nav-drawer-close');
    if (!hamburger || !drawer) return;

    function openDrawer() {
      drawer.classList.add('open');
      if (overlay) overlay.classList.remove('hidden');
    }

    function closeDrawer() {
      drawer.classList.remove('open');
      if (overlay) overlay.classList.add('hidden');
    }

    hamburger.addEventListener('click', openDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (overlay)  overlay.addEventListener('click', closeDrawer);

    // Highlight the current page link
    const activeHref = PAGE_HREFS[currentPage];
    if (activeHref) {
      drawer.querySelectorAll('a.nav-item').forEach(a => {
        a.classList.toggle('nav-item-active', a.getAttribute('href') === activeHref);
      });
    }

    // Coming-soon buttons
    const progressBtn = document.getElementById('nav-progress-btn');
    if (progressBtn) progressBtn.addEventListener('click', () => {
      closeDrawer();
      showNavToast('Coming soon! 🚀');
    });

    const openingsBtn = document.getElementById('nav-openings-btn');
    if (openingsBtn) openingsBtn.addEventListener('click', () => {
      window.location.href = 'openings.html';
    });

    // Settings — non-analyzer pages go to home
    const settingsLink = document.getElementById('change-api-key-link');
    if (settingsLink && currentPage !== 'analyzer') {
      settingsLink.addEventListener('click', () => {
        closeDrawer();
        window.location.href = 'index.html';
      });
    }
  }

  window.initNav = initNav;

})();

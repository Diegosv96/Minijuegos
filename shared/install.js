// "Add to home screen" banner for the games menu.
// Browsers never install a site on their own: Chromium on Android lets the page
// open the system prompt from a button; everywhere else the banner explains the
// steps for that browser. Opening the menu with ?instalar=1 shows it as a sheet
// on top of the page, even if it was dismissed before.
(() => {
  const box = document.getElementById('install');
  if (!box) return;

  const params = new URLSearchParams(location.search);
  const featured = params.has('instalar');
  const ua = navigator.userAgent;

  // Inside the client's app (it passes ?token=... or exposes a bridge) or
  // already opened from the home screen: nothing to offer
  const inClientApp = params.has('token') || window.ReactNativeWebView ||
    (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.gameBridge) ||
    window.Android;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (inClientApp || standalone) return;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const DISMISS_KEY = 'install_dismissed';
  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
  }
  function saveDismissed() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
  }
  if (dismissed() && !featured) return;

  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  if (!ios && !android) return;    // desktop: not worth it

  // Built-in browsers of other apps (Instagram, Facebook, LinkedIn, TikTok...)
  // and Android webviews cannot install
  const inOtherApp = /FBAN|FBAV|Instagram|LinkedInApp|Twitter|TikTok|musical_ly|Snapchat|Pinterest|Line\//.test(ua) ||
    (android && /; wv\)/.test(ua));

  const SHARE = '<svg class="glyph" viewBox="0 0 24 24" aria-label="Compartir"><path d="M12 15V3M8 7l4-4 4 4M7 10H5v11h14V10h-2"/></svg>';
  const ADD = '<b>Añadir a pantalla de inicio</b>';

  function steps(list) {
    return '<ol>' + list.map(s => `<li>${s}</li>`).join('') + '</ol>';
  }

  function render(body) {
    box.innerHTML =
      '<div class="install-card" role="dialog" aria-labelledby="install-title">' +
        '<button class="install-close" type="button" aria-label="Cerrar">&times;</button>' +
        '<div class="install-head">' +
          '<img src="icons/icon-180.png" alt="" width="48" height="48">' +
          '<div><h2 id="install-title">Ten los juegos a mano</h2>' +
          '<p>Añádelos a la pantalla de inicio de tu móvil.</p></div>' +
        '</div>' + body +
      '</div>';
    box.classList.toggle('featured', featured);
    box.hidden = false;
    box.querySelector('.install-close').addEventListener('click', close);
  }

  function close() {
    box.hidden = true;
    saveDismissed();
  }

  // Tapping the dark area around the sheet closes it too
  box.addEventListener('click', e => { if (featured && e.target === box) close(); });

  if (inOtherApp) {
    render('<p class="install-text">Este navegador no permite añadirlos. Toca el menú ' +
      '<b>⋯</b> y elige <b>Abrir en el navegador</b> (Chrome o Safari).</p>');
    return;
  }

  if (ios) {
    // Every iPhone browser runs on Safari's engine: none lets the page open
    // the prompt, and each one puts Share in a different place
    let share;
    if (/CriOS/.test(ua)) share = `Toca ${SHARE} <b>Compartir</b> en la barra de direcciones.`;
    else if (/EdgiOS|FxiOS/.test(ua)) share = `Abre el menú y toca ${SHARE} <b>Compartir</b>.`;
    else share = `Toca ${SHARE} <b>Compartir</b> (abajo, o dentro del menú <b>⋯</b>).`;
    render(steps([share, `Elige ${ADD}. Si no lo ves, desliza hacia abajo.`, 'Confirma con <b>Añadir</b>.']));
    return;
  }

  // Android
  if (/Firefox/.test(ua)) {
    render(steps(['Abre el menú <b>⋮</b>.', 'Toca <b>Instalar</b> o <b>Añadir a pantalla de inicio</b>.']));
    return;
  }

  // Chromium browsers fire beforeinstallprompt when the site can be installed;
  // if it never comes (older browser, or already installed), show the steps
  let prompt = null;
  const fallback = setTimeout(() => {
    render(steps(['Abre el menú <b>⋮</b> del navegador.',
      'Toca <b>Añadir a pantalla de inicio</b> o <b>Instalar aplicación</b>.']));
  }, 3000);

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    clearTimeout(fallback);
    prompt = e;
    render('<button class="install-btn" type="button">Añadir a la pantalla de inicio</button>');
    box.querySelector('.install-btn').addEventListener('click', async () => {
      if (!prompt) return;
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      prompt = null;
      if (outcome === 'accepted') close();
    });
  });

  window.addEventListener('appinstalled', close);
})();

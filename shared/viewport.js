// Opened from the iPhone home screen, iOS often reports a viewport short by
// the status bar (793 instead of 852) after moving between pages. There the
// app owns the whole screen, so --app-h is the real screen height; the
// full-screen games size #stage with it. Load before game.js.
(function () {
  const standalone = matchMedia('(display-mode: standalone)');
  function update() {
    const root = document.documentElement.style;
    if (standalone.matches && innerWidth === screen.width) root.setProperty('--app-h', screen.height + 'px');
    else root.removeProperty('--app-h');
  }
  update();
  addEventListener('resize', update);
})();

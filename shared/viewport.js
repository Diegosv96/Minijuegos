// Opened from the iPhone home screen with the translucent status bar, iOS
// places the page under the status bar but still reports a viewport that is
// short by that bar (793 instead of 852), leaving a blank band at the bottom.
// There the app owns the whole screen, so --app-h is the real screen height;
// full-screen games size #stage with it. Load before game.js.
(function () {
  const standalone = matchMedia('(display-mode: standalone)');
  function update() {
    const full = standalone.matches && innerWidth === screen.width && innerHeight < screen.height;
    document.documentElement.style.setProperty('--app-h', full ? screen.height + 'px' : '100%');
  }
  update();
  addEventListener('resize', update);
})();

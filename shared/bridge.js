// Bridge between the games and the native app that hosts them in a webview.
// Exposes window.notify(payload) and window.getToken() for every game.
(() => {
  // Sending results to the app is disabled for now: notify() only logs to
  // the console. Set to true when the app is ready to receive the messages.
  const BRIDGE_ENABLED = false;

  // Session token supplied by the app in the URL (?token=...).
  // The game never validates it; it only passes it along.
  function getToken() {
    return new URLSearchParams(location.search).get('token') || null;
  }

  function notify(payload) {
    if (BRIDGE_ENABLED) {
      const msg = JSON.stringify(payload);
      try {
        if (window.ReactNativeWebView) {                       // React Native
          window.ReactNativeWebView.postMessage(msg); return;
        }
        if (window.webkit && window.webkit.messageHandlers &&
            window.webkit.messageHandlers.gameBridge) {        // iOS WKWebView
          window.webkit.messageHandlers.gameBridge.postMessage(payload); return;
        }
        if (window.Android && typeof window.Android.postMessage === 'function') { // Android
          window.Android.postMessage(msg); return;
        }
      } catch (e) { /* fall through to console */ }
    }
    // Hide the token in the console: it is a live session credential
    const shown = payload && payload.token ? { ...payload, token: '***' } : payload;
    console.log('[notify]', BRIDGE_ENABLED ? 'No app bridge found.' : 'Bridge disabled.', shown);
  }

  window.notify = notify;
  window.getToken = getToken;

  // Back-to-menu links keep ?token=... and must not reach the game's own tap handlers
  document.querySelectorAll('a.back').forEach(a => {
    a.href += location.search;
    a.addEventListener('pointerdown', e => e.stopPropagation());
  });
})();

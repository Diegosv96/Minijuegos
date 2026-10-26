// Blocks page zoom (double tap and pinch) on every page. iOS ignores
// user-scalable=no in the viewport tag, so the gestures are cancelled here too.
(() => {
  // Second tap of a double tap. Buttons and links are left alone: their
  // touch-action already stops the zoom and they must keep their click.
  let lastTouchEnd = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTouchEnd < 350 && !e.target.closest('button, a')) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  // Pinch: Safari's own gesture events, and two-finger moves elsewhere
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(type =>
    document.addEventListener(type, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  document.addEventListener('dblclick', e => e.preventDefault());
})();

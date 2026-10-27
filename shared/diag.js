// TEMPORAL: diagnóstico de la barra de estado y del alto de pantalla en iPhone.
// Quitar (este archivo y sus <script>) al acabar.
(function () {
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;left:8px;right:8px;top:35%;z-index:30;margin:0;padding:8px;' +
    'font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;background:#000c;color:#fff;' +
    'border-radius:8px;pointer-events:none';
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  // Fixed element pinned to top and bottom: how tall iOS makes fixed layers
  const fixed = document.createElement('div');
  fixed.style.cssText = 'position:fixed;visibility:hidden;top:0;bottom:0;width:1px';
  document.body.append(box, probe, fixed);
  const meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');

  function show() {
    const cs = getComputedStyle(probe);
    const stage = document.getElementById('stage');
    const canvas = document.querySelector('canvas');
    const vv = window.visualViewport;
    box.textContent =
      'standalone: ' + matchMedia('(display-mode: standalone)').matches +
      '\nsafe top/bottom: ' + cs.paddingTop + ' / ' + cs.paddingBottom +
      '\ninner: ' + innerWidth + 'x' + innerHeight + '  screen: ' + screen.width + 'x' + screen.height +
      '\nvisualViewport: ' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) : '-') +
      '\nhtml client: ' + document.documentElement.clientHeight +
      '  fixed: ' + fixed.getBoundingClientRect().height +
      (stage ? '\nstage: ' + stage.clientWidth + 'x' + stage.clientHeight : '') +
      (canvas ? '\ncanvas: ' + canvas.style.width + ' x ' + canvas.style.height : '') +
      '\nstatus-bar meta: ' + (meta ? meta.content : 'none');
  }
  show();
  addEventListener('resize', show);
  setTimeout(show, 500);
})();
